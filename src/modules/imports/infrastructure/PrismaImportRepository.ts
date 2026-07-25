import { PrismaClient, Prisma, Import, UploadedFile } from "@prisma/client";
import {
  ImportRepository,
  CreateImportInput,
  AttachUploadedFileInput,
  CommitBatchInput,
  CommitBatchResult,
  ImportSummary,
  RejectionPage,
} from "../domain/ports/ImportRepository";
import { encodeCursor, decodeCursor } from "../../../shared/utils/cursor";
import { RetryPolicy } from "../../../shared/ports/RetryPolicy";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

// Transient/infrastructure failures worth retrying: connection issues,
// timeouts, and write conflicts/deadlocks under concurrent batch commits.
// Deliberately excludes constraint violations, validation errors, and
// anything else that would just fail identically on a retry.
const RETRYABLE_PRISMA_ERROR_CODES = new Set([
  "P1001", // can't reach database server
  "P1002", // database timed out
  "P1008", // operation timed out
  "P1017", // server closed the connection
  "P2024", // timed out fetching a connection from the pool
  "P2028", // transaction API error
  "P2034", // write conflict or deadlock
]);

function isRetryableDbError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_PRISMA_ERROR_CODES.has(err.code);
  }
  return err instanceof Prisma.PrismaClientInitializationError;
}

function decodeRejectionCursor(cursor: string): { lineNumber: number; id: string } {
  const [lineNumberStr, id] = decodeCursor(cursor);
  return { lineNumber: Number(lineNumberStr), id };
}

export class PrismaImportRepository implements ImportRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly retryPolicy: RetryPolicy
  ) {}

  async createPendingImport(input: CreateImportInput): Promise<Import | null> {
    try {
      return await this.prisma.import.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          providerId: input.providerId,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return null;
      }
      throw err;
    }
  }

  findByIdempotencyKey(idempotencyKey: string): Promise<Import | null> {
    return this.prisma.import.findUnique({ where: { idempotencyKey } });
  }

  findById(id: string): Promise<Import | null> {
    return this.prisma.import.findUnique({ where: { id } });
  }

  async attachUploadedFile(importId: string, file: AttachUploadedFileInput): Promise<void> {
    await this.prisma.uploadedFile.create({
      data: {
        importId,
        storageBucket: file.storageBucket,
        storageKey: file.storageKey,
        sizeBytes: file.sizeBytes,
        checksum: file.checksum,
        originalFilename: file.originalFilename,
        mimeType: file.mimeType,
      },
    });
  }

  getUploadedFile(importId: string): Promise<UploadedFile | null> {
    return this.prisma.uploadedFile.findUnique({ where: { importId } });
  }

  async requestCancellation(id: string): Promise<Import | null> {
    const existing = await this.prisma.import.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    // Already terminal (or already cancelling) - cancellation is a no-op,
    // never regresses a finished job back to an in-flight-looking status.
    if (existing.status !== "pending" && existing.status !== "processing") {
      return existing;
    }

    return this.prisma.import.update({
      where: { id },
      data: { cancelRequested: true, status: "cancelling" },
    });
  }

  async markProcessing(id: string): Promise<Import | null> {
    try {
      return await this.prisma.import.update({
        where: { id },
        data: { status: "processing", startedAt: new Date() },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        return null;
      }
      throw err;
    }
  }

  async markCompleted(id: string): Promise<void> {
    await this.prisma.import.update({
      where: { id },
      data: { status: "completed", completedAt: new Date() },
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.prisma.import.update({
      where: { id },
      data: { status: "failed", completedAt: new Date(), failureReason: reason },
    });
  }

  async markCancelled(id: string): Promise<void> {
    await this.prisma.import.update({
      where: { id },
      data: { status: "cancelled", completedAt: new Date() },
    });
  }

  async commitBatch(importId: string, input: CommitBatchInput): Promise<CommitBatchResult> {
    return this.retryPolicy.execute("commitBatch", () => this.commitBatchOnce(importId, input), isRetryableDbError);
  }

  private async commitBatchOnce(
    importId: string,
    input: CommitBatchInput
  ): Promise<CommitBatchResult> {
    return this.prisma.$transaction(async (tx) => {
      // Idempotency guard: if a prior attempt's transaction actually
      // committed but its success never reached the caller (e.g. the
      // connection dropped right after commit, triggering a retry), the
      // checkpoint will already be at or past this batch's target. Without
      // this check, retrying would re-run correctly for the row inserts
      // (skipDuplicates makes those safe) but would double-count the
      // increment-based counters below, which are not naturally idempotent.
      const current = await tx.import.findUniqueOrThrow({
        where: { id: importId },
        select: { checkpointLineNumber: true },
      });
      if (current.checkpointLineNumber >= input.checkpointLineNumber) {
        return { acceptedCount: 0, duplicateCount: 0 };
      }

      let acceptedCount = 0;
      if (input.acceptedTransactions.length > 0) {
        const created = await tx.transaction.createMany({
          data: input.acceptedTransactions.map((t) => ({
            importId,
            providerId: t.providerId,
            transactionId: t.transactionId,
            accountId: t.accountId,
            merchantId: t.merchantId,
            amount: t.amount,
            currency: t.currency,
            timestamp: t.timestamp,
            description: t.description,
            fingerprint: t.fingerprint,
            riskScore: t.riskScore,
            riskLevel: t.riskLevel,
          })),
          skipDuplicates: true,
        });
        acceptedCount = created.count;
      }

      if (input.rejectedRecords.length > 0) {
        await tx.rejectedRecord.createMany({
          data: input.rejectedRecords.map((r) => ({
            importId,
            lineNumber: r.lineNumber,
            reasonCode: r.reasonCode,
            message: r.message,
            rawValue: r.rawValue as Prisma.InputJsonValue,
          })),
        });
      }

      const duplicateCount = input.acceptedTransactions.length - acceptedCount;

      await tx.import.update({
        where: { id: importId },
        data: {
          processedCount: { increment: input.processedDelta },
          acceptedCount: { increment: acceptedCount },
          rejectedCount: { increment: input.rejectedRecords.length },
          duplicateCount: { increment: duplicateCount },
          checkpointOffset: input.checkpointOffset,
          checkpointLineNumber: input.checkpointLineNumber,
        },
      });

      return { acceptedCount, duplicateCount };
    });
  }

  async getSummary(importId: string): Promise<ImportSummary> {
    const importRow = await this.prisma.import.findUniqueOrThrow({ where: { id: importId } });

    const [byCurrency, byRiskLevel] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ["currency"],
        where: { importId },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ["riskLevel"],
        where: { importId },
        _count: { _all: true },
      }),
    ]);

    const riskLevelCounts = { low: 0, medium: 0, high: 0 };
    for (const row of byRiskLevel) {
      riskLevelCounts[row.riskLevel] = row._count._all;
    }

    return {
      totals: {
        accepted: importRow.acceptedCount,
        rejected: importRow.rejectedCount,
        duplicates: importRow.duplicateCount,
      },
      byCurrency: byCurrency.map((row) => ({
        currency: row.currency,
        transactionCount: row._count._all,
        totalAmount: row._sum.amount?.toString() ?? "0",
      })),
      byRiskLevel: riskLevelCounts,
    };
  }

  async getRejections(
    importId: string,
    limit: number,
    cursor: string | null
  ): Promise<RejectionPage> {
    const decoded = cursor ? decodeRejectionCursor(cursor) : null;

    const rows = await this.prisma.rejectedRecord.findMany({
      where: {
        importId,
        ...(decoded
          ? {
              OR: [
                { lineNumber: { gt: decoded.lineNumber } },
                { lineNumber: decoded.lineNumber, id: { gt: decoded.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ lineNumber: "asc" }, { id: "asc" }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return {
      items: items.map((r) => ({
        id: r.id,
        lineNumber: r.lineNumber,
        reasonCode: r.reasonCode,
        message: r.message,
        rawValue: r.rawValue,
      })),
      nextCursor: hasMore && last ? encodeCursor([last.lineNumber, last.id]) : null,
    };
  }
}
