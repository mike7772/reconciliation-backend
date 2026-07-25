import { Import } from "@prisma/client";

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
  requestCancellation(id: string): Promise<Import | null>;
}
