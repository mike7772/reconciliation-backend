import { Readable } from "stream";
import { Import } from "@prisma/client";
import { ImportRepository, ImportSummary, RejectionPage } from "./ports/ImportRepository";
import { FileStorage } from "./ports/FileStorage";
import { JobQueue } from "./ports/JobQueue";
import { IdGenerator } from "../../../shared/ports/IdGenerator";
import { Logger } from "../../../shared/ports/Logger";
import { AppError } from "../../../shared/errors/AppError";
import httpStatusCodes from "../../../shared/constants/httpStatusCodes";

export interface CreateImportParams {
  idempotencyKey: string;
  providerId: string;
  fileStream: Readable;
  originalFilename: string;
  mimeType: string;
}

export interface ImportServiceDeps {
  importRepository: ImportRepository;
  fileStorage: FileStorage;
  jobQueue: JobQueue;
  idGenerator: IdGenerator;
  logger: Logger;
}

export class ImportService {
  constructor(private readonly deps: ImportServiceDeps) {}

  /** Fast-path check, used before even reading the multipart body. */
  async findExistingByIdempotencyKey(idempotencyKey: string): Promise<Import | null> {
    return this.deps.importRepository.findByIdempotencyKey(idempotencyKey);
  }

  async createImport(params: CreateImportParams): Promise<Import> {
    const created = await this.deps.importRepository.createPendingImport({
      idempotencyKey: params.idempotencyKey,
      providerId: params.providerId,
    });

    if (!created) {
      // Lost the race to a concurrent request with the same idempotency
      // key: the file was never uploaded, nothing to clean up.
      const existing = await this.deps.importRepository.findByIdempotencyKey(
        params.idempotencyKey
      );
      if (existing) {
        this.deps.logger.info("Idempotency key race resolved to existing import", {
          importId: existing.id,
        });
        return existing;
      }
      // Extremely unlikely (row deleted between the failed insert and this
      // lookup) - surface as a normal server error rather than silently
      // retrying, per the "don't hide programming errors" rule.
      throw new AppError(
        httpStatusCodes.INTERNAL_SERVER,
        "IMPORT_CREATE_FAILED",
        "Failed to create import"
      );
    }

    const storageKey = `imports/${created.id}/${this.deps.idGenerator.generate()}.ndjson`;
    const stored = await this.deps.fileStorage.store(storageKey, params.fileStream);

    await this.deps.importRepository.attachUploadedFile(created.id, {
      storageBucket: stored.bucket,
      storageKey: stored.key,
      sizeBytes: BigInt(stored.sizeBytes),
      checksum: stored.checksum,
      originalFilename: params.originalFilename,
      mimeType: params.mimeType,
    });

    await this.deps.jobQueue.enqueueImportProcessing(created.id);

    this.deps.logger.info("Import created", {
      importId: created.id,
      providerId: params.providerId,
      sizeBytes: stored.sizeBytes,
    });

    return created;
  }

  async getImport(id: string): Promise<Import> {
    const found = await this.deps.importRepository.findById(id);
    if (!found) {
      throw new AppError(httpStatusCodes.NOT_FOUND, "IMPORT_NOT_FOUND", "Import not found");
    }
    return found;
  }

  async cancelImport(id: string): Promise<Import> {
    const updated = await this.deps.importRepository.requestCancellation(id);
    if (!updated) {
      throw new AppError(httpStatusCodes.NOT_FOUND, "IMPORT_NOT_FOUND", "Import not found");
    }
    return updated;
  }

  async getSummary(id: string): Promise<ImportSummary> {
    await this.getImport(id); // 404s consistently if the import doesn't exist
    return this.deps.importRepository.getSummary(id);
  }

  async getRejections(id: string, limit: number, cursor: string | null): Promise<RejectionPage> {
    await this.getImport(id);
    return this.deps.importRepository.getRejections(id, limit, cursor);
  }
}
