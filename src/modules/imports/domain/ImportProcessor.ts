import { Readable } from "stream";
import { RiskLevel } from "@prisma/client";
import { ImportRepository, AcceptedTransactionInput, RejectedRecordInput } from "./ports/ImportRepository";
import { FileStorage } from "./ports/FileStorage";
import { RiskScorer } from "./ports/RiskScorer";
import { JobQueue } from "./ports/JobQueue";
import { Logger } from "../../../shared/ports/Logger";
import { MetricsRecorder } from "../../../shared/ports/MetricsRecorder";
import { ShutdownSignal } from "../../../shared/state/ShutdownSignal";
import { parseNdjsonLines, ParsedLine } from "../../../shared/utils/ndjsonLines";
import { capJsonValue } from "../../../shared/utils/capJsonValue";
import { normalizeRecord } from "./transaction/normalize";
import { transactionSchema } from "./transaction/transaction.schema";
import { calculateFingerprint } from "./transaction/fingerprint";

const BATCH_SIZE = 500;
const MAX_RAW_VALUE_CHARS = 1000;

export interface ImportProcessorDeps {
  importRepository: ImportRepository;
  fileStorage: FileStorage;
  riskScorer: RiskScorer;
  jobQueue: JobQueue;
  logger: Logger;
  metrics: MetricsRecorder;
  shutdownSignal: ShutdownSignal;
}

function capRawValue(value: unknown): unknown {
  return capJsonValue(value, MAX_RAW_VALUE_CHARS);
}

export class ImportProcessor {
  constructor(private readonly deps: ImportProcessorDeps) {}

  async process(importId: string): Promise<void> {
    const { importRepository, logger } = this.deps;

    const importRow = await importRepository.findById(importId);
    if (!importRow) {
      logger.warn("Import not found for processing", { importId });
      return;
    }

    if (importRow.status !== "pending" && importRow.status !== "processing") {
      // Terminal state, or already picked up - never reprocess (idempotent
      // against BullMQ redelivering the same job).
      logger.info("Import already in a terminal state, skipping", {
        importId,
        status: importRow.status,
      });
      return;
    }

    const metrics = this.deps.metrics;
    const startNs = process.hrtime.bigint();
    metrics.incrementGauge("active_imports");

    const finish = (outcome: "completed" | "failed" | "cancelled" | "paused"): void => {
      const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
      metrics.observeHistogram("import_duration_seconds", durationSeconds, { outcome });
      metrics.decrementGauge("active_imports");
      if (outcome === "failed") {
        metrics.incrementCounter("import_processing_failures_total");
      }
    };

    if (importRow.cancelRequested) {
      await importRepository.markCancelled(importId);
      finish("cancelled");
      return;
    }

    const uploadedFile = await importRepository.getUploadedFile(importId);
    if (!uploadedFile) {
      await importRepository.markFailed(importId, "Uploaded file metadata missing");
      logger.error("Uploaded file metadata missing", { importId });
      finish("failed");
      return;
    }

    await importRepository.markProcessing(importId);

    const startOffset = Number(importRow.checkpointOffset);
    const startLineNumber = importRow.checkpointLineNumber;

    let stream: Readable;
    try {
      stream = await this.deps.fileStorage.read(uploadedFile.storageKey, startOffset);
    } catch (err) {
      await importRepository.markFailed(importId, "Failed to read uploaded file");
      logger.error("Failed to open file for processing", {
        importId,
        error: (err as Error).message,
      });
      finish("failed");
      return;
    }

    let batch: ParsedLine[] = [];

    // Returns false if processing should stop (cancellation observed).
    const flush = async (): Promise<boolean> => {
      if (batch.length === 0) return true;

      const { accepted, rejected, processedCount } = await this.validateAndScoreBatch(
        batch,
        importRow.providerId
      );
      const lastLine = batch[batch.length - 1];

      const result = await importRepository.commitBatch(importId, {
        acceptedTransactions: accepted,
        rejectedRecords: rejected,
        // Counts only non-empty lines, so processed === accepted + rejected
        // + duplicates always holds; blank lines are skipped entirely,
        // never counted in any bucket.
        processedDelta: processedCount,
        checkpointOffset: BigInt(lastLine.byteOffsetAfter),
        checkpointLineNumber: lastLine.lineNumber,
      });

      metrics.incrementCounter("records_processed_total", {}, processedCount);
      metrics.incrementCounter("records_accepted_total", {}, result.acceptedCount);
      metrics.incrementCounter("records_rejected_total", {}, rejected.length);
      metrics.incrementCounter("records_duplicate_total", {}, result.duplicateCount);

      batch = [];

      const current = await importRepository.findById(importId);
      if (current?.cancelRequested) {
        await importRepository.markCancelled(importId);
        finish("cancelled");
        return false;
      }

      if (this.deps.shutdownSignal.isShuttingDown()) {
        // Distinct from cancellation: leave status as "processing" (already
        // set) rather than marking it cancelled - the checkpoint just
        // written is durable, so whichever worker picks this job up next
        // resumes from exactly here instead of restarting the whole file.
        //
        // Re-enqueue *before* returning: this processor function is about
        // to resolve normally, which BullMQ treats as the job succeeding -
        // with removeOnComplete it would otherwise vanish with nothing
        // left to ever pick this import back up. A fresh job now waits in
        // the queue for whenever a worker (this one restarted, or another)
        // is next available.
        await this.deps.jobQueue.enqueueImportProcessing(importId);
        logger.info("Pausing import for shutdown at batch boundary", { importId });
        finish("paused");
        return false;
      }

      return true;
    };

    try {
      for await (const line of parseNdjsonLines(stream, startOffset, startLineNumber)) {
        batch.push(line);
        if (batch.length >= BATCH_SIZE) {
          const shouldContinue = await flush();
          if (!shouldContinue) return;
        }
      }

      const shouldContinue = await flush();
      if (!shouldContinue) return;

      await importRepository.markCompleted(importId);
      logger.info("Import completed", { importId });
      finish("completed");
    } catch (err) {
      logger.error("Import processing failed", { importId, error: (err as Error).message });
      await importRepository.markFailed(importId, "Processing failed unexpectedly");
      finish("failed");
    }
  }

  private async validateAndScoreBatch(
    lines: ParsedLine[],
    providerId: string
  ): Promise<{
    accepted: AcceptedTransactionInput[];
    rejected: RejectedRecordInput[];
    processedCount: number;
  }> {
    const accepted: AcceptedTransactionInput[] = [];
    const rejected: RejectedRecordInput[] = [];
    let processedCount = 0;
    // Index into `accepted` for each entry queued for scoring, so results
    // (returned in the same order) can be written back to the right record.
    const toScore: Array<{
      acceptedIndex: number;
      amount: number;
      descriptionLength: number;
      transactionHourUtc: number;
      merchantId: string;
      fingerprint: string;
    }> = [];

    for (const line of lines) {
      if (line.raw.trim() === "") {
        continue; // empty lines are silently skipped - not counted at all
      }
      processedCount += 1;

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(line.raw);
      } catch {
        rejected.push({
          lineNumber: line.lineNumber,
          reasonCode: line.oversized ? "LINE_TOO_LONG" : "INVALID_JSON",
          message: line.oversized
            ? "Line exceeds the maximum allowed length"
            : "Line is not valid JSON",
          rawValue: capRawValue(line.raw.slice(0, MAX_RAW_VALUE_CHARS)),
        });
        continue;
      }

      if (typeof parsedJson !== "object" || parsedJson === null || Array.isArray(parsedJson)) {
        rejected.push({
          lineNumber: line.lineNumber,
          reasonCode: "INVALID_RECORD",
          message: "Record must be a JSON object",
          rawValue: capRawValue(parsedJson),
        });
        continue;
      }

      const normalized = normalizeRecord(parsedJson as Record<string, unknown>);
      const validation = transactionSchema.safeParse(normalized);
      if (!validation.success) {
        rejected.push({
          lineNumber: line.lineNumber,
          reasonCode: "VALIDATION_FAILED",
          message: validation.error.issues[0]?.message || "Validation failed",
          rawValue: capRawValue(parsedJson),
        });
        continue;
      }

      const transaction = validation.data;
      const fingerprint = calculateFingerprint(transaction);
      const timestamp = new Date(transaction.timestamp);

      toScore.push({
        acceptedIndex: accepted.length,
        amount: transaction.amount,
        descriptionLength: transaction.description?.length ?? 0,
        transactionHourUtc: timestamp.getUTCHours(),
        merchantId: transaction.merchantId,
        fingerprint,
      });

      accepted.push({
        providerId,
        transactionId: transaction.transactionId,
        accountId: transaction.accountId,
        merchantId: transaction.merchantId,
        amount: transaction.amount,
        currency: transaction.currency,
        timestamp,
        description: transaction.description ?? null,
        fingerprint,
        riskScore: 0,
        riskLevel: "low" as RiskLevel,
      });
    }

    if (toScore.length > 0) {
      const scores = await this.deps.riskScorer.scoreBatch(
        toScore.map((entry) => ({
          amount: entry.amount,
          descriptionLength: entry.descriptionLength,
          transactionHourUtc: entry.transactionHourUtc,
          merchantId: entry.merchantId,
          fingerprint: entry.fingerprint,
        }))
      );

      scores.forEach((result, i) => {
        const target = accepted[toScore[i].acceptedIndex];
        target.riskScore = result.score;
        target.riskLevel = result.level;
      });
    }

    return { accepted, rejected, processedCount };
  }
}
