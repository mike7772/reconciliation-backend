import { PrismaClient, Prisma, Import } from "@prisma/client";
import {
  ImportRepository,
  CreateImportInput,
  AttachUploadedFileInput,
} from "../domain/ports/ImportRepository";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

export class PrismaImportRepository implements ImportRepository {
  constructor(private readonly prisma: PrismaClient) {}

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
}
