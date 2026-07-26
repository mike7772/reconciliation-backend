import { Readable } from "stream";
import { Import } from "@prisma/client";
import { ImportService, ImportServiceDeps } from "../../src/modules/imports/imports.service";
import {
  ImportRepository,
  CreateImportInput,
  AttachUploadedFileInput,
  CommitBatchInput,
  CommitBatchResult,
  ImportSummary,
  RejectionPage,
} from "../../src/modules/imports/imports.repository";
import { FileStorage, StoredFileInfo } from "../../src/shared/ports/FileStorage";
import { JobQueue } from "../../src/modules/imports/imports.jobQueue";
import { IdGenerator } from "../../src/shared/ports/IdGenerator";
import { Logger } from "../../src/shared/ports/Logger";
import { AppError } from "../../src/shared/errors/AppError";

function makeImport(overrides: Partial<Import> = {}): Import {
  return {
    id: "import-1",
    idempotencyKey: "key-1",
    providerId: "provider-1",
    status: "pending",
    processedCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    duplicateCount: 0,
    checkpointOffset: BigInt(0),
    checkpointLineNumber: 0,
    cancelRequested: false,
    failureReason: null,
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    startedAt: null,
    completedAt: null,
    ...overrides,
  } as Import;
}

/** In-memory fake standing in for PrismaImportRepository - no database involved. */
class FakeImportRepository implements ImportRepository {
  public imports = new Map<string, Import>();

  async createPendingImport(input: CreateImportInput): Promise<Import | null> {
    const existingByKey = [...this.imports.values()].find(
      (i) => i.idempotencyKey === input.idempotencyKey
    );
    if (existingByKey) {
      return null;
    }
    const created = makeImport({
      id: `import-${this.imports.size + 1}`,
      idempotencyKey: input.idempotencyKey,
      providerId: input.providerId,
    });
    this.imports.set(created.id, created);
    return created;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Import | null> {
    return [...this.imports.values()].find((i) => i.idempotencyKey === idempotencyKey) ?? null;
  }

  async findById(id: string): Promise<Import | null> {
    return this.imports.get(id) ?? null;
  }

  async attachUploadedFile(_importId: string, _file: AttachUploadedFileInput): Promise<void> {}

  async getUploadedFile(): Promise<null> {
    return null;
  }

  async requestCancellation(id: string): Promise<Import | null> {
    const existing = this.imports.get(id);
    if (!existing) return null;

    if (existing.status !== "pending" && existing.status !== "processing") {
      return existing;
    }

    const updated = { ...existing, cancelRequested: true, status: "cancelling" } as Import;
    this.imports.set(id, updated);
    return updated;
  }

  async markProcessing(id: string): Promise<Import | null> {
    const existing = this.imports.get(id);
    if (!existing) return null;
    const updated = { ...existing, status: "processing" } as Import;
    this.imports.set(id, updated);
    return updated;
  }

  async markCompleted(id: string): Promise<void> {
    const existing = this.imports.get(id);
    if (existing) this.imports.set(id, { ...existing, status: "completed" } as Import);
  }

  async markFailed(id: string, reason: string): Promise<void> {
    const existing = this.imports.get(id);
    if (existing) {
      this.imports.set(id, { ...existing, status: "failed", failureReason: reason } as Import);
    }
  }

  async markCancelled(id: string): Promise<void> {
    const existing = this.imports.get(id);
    if (existing) this.imports.set(id, { ...existing, status: "cancelled" } as Import);
  }

  async commitBatch(_importId: string, _input: CommitBatchInput): Promise<CommitBatchResult> {
    return { acceptedCount: 0, duplicateCount: 0 };
  }

  async getSummary(_importId: string): Promise<ImportSummary> {
    return {
      totals: { accepted: 0, rejected: 0, duplicates: 0 },
      byCurrency: [],
      byRiskLevel: { low: 0, medium: 0, high: 0 },
    };
  }

  async getRejections(_importId: string, _limit: number, _cursor: string | null): Promise<RejectionPage> {
    return { items: [], nextCursor: null };
  }
}

class FakeFileStorage implements FileStorage {
  async store(key: string, stream: Readable): Promise<StoredFileInfo> {
    stream.resume();
    return { bucket: "test-bucket", key, sizeBytes: 123, checksum: "fake-checksum" };
  }
  async read(): Promise<Readable> {
    return Readable.from([]);
  }
}

class FakeJobQueue implements JobQueue {
  public enqueued: string[] = [];
  async enqueueImportProcessing(importId: string): Promise<void> {
    this.enqueued.push(importId);
  }
}

class FakeIdGenerator implements IdGenerator {
  private counter = 0;
  generate(): string {
    this.counter += 1;
    return `fake-id-${this.counter}`;
  }
}

function fakeLogger(): Logger {
  const logger: Logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => logger),
  };
  return logger;
}

function buildService(): { service: ImportService; deps: ImportServiceDeps; repo: FakeImportRepository; jobQueue: FakeJobQueue } {
  const repo = new FakeImportRepository();
  const jobQueue = new FakeJobQueue();
  const deps: ImportServiceDeps = {
    importRepository: repo,
    fileStorage: new FakeFileStorage(),
    jobQueue,
    idGenerator: new FakeIdGenerator(),
    logger: fakeLogger(),
  };
  return { service: new ImportService(deps), deps, repo, jobQueue };
}

describe("ImportService (use case, fake dependencies)", () => {
  it("creates a pending import, stores the file, and enqueues processing", async () => {
    const { service, jobQueue } = buildService();

    const created = await service.createImport({
      idempotencyKey: "key-abc",
      providerId: "provider-1",
      fileStream: Readable.from(["line1\n"]),
      originalFilename: "file.ndjson",
      mimeType: "application/octet-stream",
    });

    expect(created.status).toBe("pending");
    expect(created.idempotencyKey).toBe("key-abc");
    expect(jobQueue.enqueued).toEqual([created.id]);
  });

  it("returns the existing import when the same idempotency key races a concurrent request", async () => {
    const { service, repo } = buildService();

    // Simulate: another request already won the race and inserted the row
    // between our createPendingImport call failing and our fallback lookup.
    const original = jest.spyOn(repo, "createPendingImport");
    const winner = makeImport({ id: "winner-import", idempotencyKey: "shared-key" });
    original.mockImplementationOnce(async () => {
      repo.imports.set(winner.id, winner);
      return null;
    });

    const result = await service.createImport({
      idempotencyKey: "shared-key",
      providerId: "provider-1",
      fileStream: Readable.from(["line1\n"]),
      originalFilename: "file.ndjson",
      mimeType: "application/octet-stream",
    });

    expect(result.id).toBe("winner-import");
  });

  it("throws a 404 AppError when getting a non-existent import", async () => {
    const { service } = buildService();

    await expect(service.getImport("does-not-exist")).rejects.toMatchObject({
      statusCode: 404,
      code: "IMPORT_NOT_FOUND",
    } as Partial<AppError>);
  });

  it("transitions a pending import to cancelling on cancel request", async () => {
    const { service, repo } = buildService();
    const pending = makeImport({ id: "import-x", status: "pending" });
    repo.imports.set(pending.id, pending);

    const result = await service.cancelImport("import-x");

    expect(result.status).toBe("cancelling");
    expect(result.cancelRequested).toBe(true);
  });

  it("transitions a processing import to cancelling on cancel request", async () => {
    const { service, repo } = buildService();
    const processing = makeImport({ id: "import-y", status: "processing" });
    repo.imports.set(processing.id, processing);

    const result = await service.cancelImport("import-y");

    expect(result.status).toBe("cancelling");
  });

  it("treats cancelling a completed import as a no-op (does not regress a terminal status)", async () => {
    const { service, repo } = buildService();
    const completed = makeImport({ id: "import-z", status: "completed" });
    repo.imports.set(completed.id, completed);

    const result = await service.cancelImport("import-z");

    expect(result.status).toBe("completed");
  });

  it("throws a 404 AppError when cancelling a non-existent import", async () => {
    const { service } = buildService();

    await expect(service.cancelImport("does-not-exist")).rejects.toMatchObject({
      statusCode: 404,
      code: "IMPORT_NOT_FOUND",
    } as Partial<AppError>);
  });
});
