import { Import, UploadedFile, RiskLevel } from "@prisma/client";

export interface CreateImportInput {
  idempotencyKey: string;
  providerId: string;
}

export interface AttachUploadedFileInput {
  storageBucket: string;
  storageKey: string;
  sizeBytes: bigint;
  checksum: string;
  originalFilename: string;
  mimeType: string;
}

export interface AcceptedTransactionInput {
  providerId: string;
  transactionId: string;
  accountId: string;
  merchantId: string;
  amount: number;
  currency: string;
  timestamp: Date;
  description: string | null;
  fingerprint: string;
  riskScore: number;
  riskLevel: RiskLevel;
}

export interface RejectedRecordInput {
  lineNumber: number;
  reasonCode: string;
  message: string;
  rawValue: unknown;
}

export interface CommitBatchInput {
  acceptedTransactions: AcceptedTransactionInput[];
  rejectedRecords: RejectedRecordInput[];
  processedDelta: number;
  checkpointOffset: bigint;
  checkpointLineNumber: number;
}

export interface CommitBatchResult {
  /** Rows actually inserted - excludes anything skipped as a duplicate. */
  acceptedCount: number;
  /** acceptedTransactions.length - acceptedCount, whether the conflict was
   *  against an existing row or another record earlier in the same batch. */
  duplicateCount: number;
}

export interface RejectionPage {
  items: Array<{
    id: string;
    lineNumber: number;
    reasonCode: string;
    message: string;
    rawValue: unknown;
  }>;
  nextCursor: string | null;
}

export interface CurrencySummary {
  currency: string;
  transactionCount: number;
  totalAmount: string;
}

export interface ImportSummary {
  totals: { accepted: number; rejected: number; duplicates: number };
  byCurrency: CurrencySummary[];
  byRiskLevel: { low: number; medium: number; high: number };
}

export interface ImportRepository {
  /**
   * Inserts a new pending Import row. Returns null instead of throwing if
   * idempotencyKey already exists (adapter translates the unique-constraint
   * violation) - the caller falls back to findByIdempotencyKey to resolve a
   * race against a concurrent request using the same key.
   */
  createPendingImport(input: CreateImportInput): Promise<Import | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<Import | null>;
  findById(id: string): Promise<Import | null>;
  attachUploadedFile(importId: string, file: AttachUploadedFileInput): Promise<void>;
  getUploadedFile(importId: string): Promise<UploadedFile | null>;
  requestCancellation(id: string): Promise<Import | null>;

  markProcessing(id: string): Promise<Import | null>;
  markCompleted(id: string): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
  markCancelled(id: string): Promise<void>;

  /**
   * Persists one processed batch (accepted transactions + rejected records)
   * and advances progress counters/checkpoint in a single DB transaction -
   * so a crash between "records written" and "checkpoint advanced" can
   * never happen; either the whole batch is durable or none of it is.
   */
  commitBatch(importId: string, input: CommitBatchInput): Promise<CommitBatchResult>;

  getSummary(importId: string): Promise<ImportSummary>;
  getRejections(importId: string, limit: number, cursor: string | null): Promise<RejectionPage>;
}
