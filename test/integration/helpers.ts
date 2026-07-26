import { Readable } from "stream";
import express, { Express } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import requestId from "../../src/shared/middleware/requestId";
import authenticate from "../../src/shared/middleware/authenticate";
import { ImportService } from "../../src/modules/imports/imports.service";
import { PrismaImportRepository } from "../../src/modules/imports/imports.repository";
import { JobQueue } from "../../src/modules/imports/imports.jobQueue";
import { FileStorage, StoredFileInfo } from "../../src/shared/ports/FileStorage";
import { Logger } from "../../src/shared/ports/Logger";
import { UuidIdGenerator } from "../../src/shared/adapters/uuidIdGenerator";
import { MetricsRecorder } from "../../src/shared/ports/MetricsRecorder";
import { ExponentialBackoffRetryPolicy } from "../../src/shared/adapters/exponentialBackoffRetryPolicy";
import {
  createImportHandler,
  createGetImportHandler,
  createCancelImportHandler,
  createSummaryHandler,
  createRejectionsHandler,
} from "../../src/modules/imports/imports.controller";

/**
 * These integration tests exercise the real Postgres database and the real
 * Express/controller/repository stack. MinIO and BullMQ are replaced with
 * in-memory fakes: the behavior under test (persistence, constraints,
 * idempotency, pagination, redelivery) lives entirely in the
 * database/repository layer, and the real MinIO/BullMQ wiring is already
 * covered by manual end-to-end verification against the live Docker stack
 * (see SUBMISSION.md) - duplicating that here would mean standing up MinIO
 * and Redis for every test run without exercising any additional logic.
 */

let prisma: PrismaClient | null = null;

export function getTestPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export async function disconnectTestPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

/** Deletes all rows created by tests, in FK-safe order. Cheap enough to run
 *  between tests since these tables stay small in the test suite. */
export async function cleanDatabase(): Promise<void> {
  const client = getTestPrisma();
  await client.transaction.deleteMany();
  await client.rejectedRecord.deleteMany();
  await client.uploadedFile.deleteMany();
  await client.import.deleteMany();
  await client.user.deleteMany();
}

function fakeLogger(): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
}

function fakeMetrics(): MetricsRecorder {
  return {
    incrementCounter: () => {},
    observeHistogram: () => {},
    setGauge: () => {},
    incrementGauge: () => {},
    decrementGauge: () => {},
  };
}

class InMemoryFileStorage implements FileStorage {
  public stored = new Map<string, Buffer>();

  async store(key: string, stream: Readable): Promise<StoredFileInfo> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    this.stored.set(key, body);
    return { bucket: "test-bucket", key, sizeBytes: body.length, checksum: "fake-checksum" };
  }

  async read(key: string): Promise<Readable> {
    return Readable.from([this.stored.get(key) ?? Buffer.alloc(0)]);
  }
}

class InMemoryJobQueue implements JobQueue {
  public enqueued: string[] = [];
  async enqueueImportProcessing(importId: string): Promise<void> {
    this.enqueued.push(importId);
  }
}

export interface TestApp {
  app: Express;
  fileStorage: InMemoryFileStorage;
  jobQueue: InMemoryJobQueue;
  importService: ImportService;
}

/** Builds a real Express app wired to the real ImportRepository (backed by
 *  the test Postgres database) and the real authenticate middleware, with
 *  only FileStorage/JobQueue faked. */
export function buildTestApp(): TestApp {
  const client = getTestPrisma();
  const logger = fakeLogger();
  const metrics = fakeMetrics();
  const retryPolicy = new ExponentialBackoffRetryPolicy(
    { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
    logger,
    metrics
  );

  const importRepository = new PrismaImportRepository(client, retryPolicy);
  const fileStorage = new InMemoryFileStorage();
  const jobQueue = new InMemoryJobQueue();
  const idGenerator = new UuidIdGenerator();

  const importService = new ImportService({
    importRepository,
    fileStorage,
    jobQueue,
    idGenerator,
    logger,
  });

  const app = express();
  app.use(requestId);
  app.post("/v1/imports", authenticate, createImportHandler(importService, logger));
  app.get("/v1/imports/:id", authenticate, createGetImportHandler(importService));
  app.post("/v1/imports/:id/cancel", authenticate, createCancelImportHandler(importService));
  app.get("/v1/imports/:id/summary", authenticate, createSummaryHandler(importService));
  app.get("/v1/imports/:id/rejections", authenticate, createRejectionsHandler(importService));

  return { app, fileStorage, jobQueue, importService };
}

export function signTestToken(payload: { id: string; email: string } = {
  id: "test-user-id",
  email: "test@example.com",
}): string {
  return jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: "1h" });
}
