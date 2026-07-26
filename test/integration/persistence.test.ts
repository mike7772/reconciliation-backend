import { PrismaImportRepository, AcceptedTransactionInput } from "../../src/modules/imports/imports.repository";
import { ExponentialBackoffRetryPolicy } from "../../src/shared/adapters/exponentialBackoffRetryPolicy";
import { getTestPrisma, cleanDatabase, disconnectTestPrisma } from "./helpers";
import { Logger } from "../../src/shared/ports/Logger";
import { MetricsRecorder } from "../../src/shared/ports/MetricsRecorder";

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

function buildRepository(): PrismaImportRepository {
  const prisma = getTestPrisma();
  const retryPolicy = new ExponentialBackoffRetryPolicy(
    { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5 },
    fakeLogger(),
    fakeMetrics()
  );
  return new PrismaImportRepository(prisma, retryPolicy);
}

function acceptedTx(overrides: Partial<AcceptedTransactionInput> = {}): AcceptedTransactionInput {
  return {
    providerId: "provider-1",
    transactionId: "txn-1",
    accountId: "acc-1",
    merchantId: "merchant-1",
    amount: 10,
    currency: "USD",
    timestamp: new Date("2026-07-20T10:00:00.000Z"),
    description: null,
    fingerprint: "fingerprint-1",
    riskScore: 20,
    riskLevel: "low",
    ...overrides,
  };
}

describe("Database persistence and constraints (integration)", () => {
  let repo: PrismaImportRepository;

  beforeEach(async () => {
    await cleanDatabase();
    repo = buildRepository();
  });

  afterAll(async () => {
    await cleanDatabase();
    await disconnectTestPrisma();
  });

  it("enforces the idempotencyKey unique constraint at the database level", async () => {
    const first = await repo.createPendingImport({ idempotencyKey: "dup-key", providerId: "p1" });
    expect(first).not.toBeNull();

    const second = await repo.createPendingImport({ idempotencyKey: "dup-key", providerId: "p2" });
    expect(second).toBeNull();

    const found = await repo.findByIdempotencyKey("dup-key");
    expect(found?.providerId).toBe("p1");
  });

  it("persists accepted transactions and advances progress counters atomically", async () => {
    const created = await repo.createPendingImport({ idempotencyKey: "k1", providerId: "provider-1" });
    const importId = created!.id;

    const result = await repo.commitBatch(importId, {
      acceptedTransactions: [acceptedTx()],
      rejectedRecords: [{ lineNumber: 1, reasonCode: "X", message: "irrelevant", rawValue: null }],
      processedDelta: 2,
      checkpointOffset: BigInt(100),
      checkpointLineNumber: 2,
    });

    expect(result).toEqual({ acceptedCount: 1, duplicateCount: 0 });

    const updated = await repo.findById(importId);
    expect(updated?.processedCount).toBe(2);
    expect(updated?.acceptedCount).toBe(1);
    expect(updated?.rejectedCount).toBe(1);
    expect(updated?.checkpointLineNumber).toBe(2);
    expect(updated?.checkpointOffset).toBe(BigInt(100));
  });

  it("rejects a duplicate (providerId, transactionId) against an already-accepted transaction", async () => {
    const created = await repo.createPendingImport({ idempotencyKey: "k2", providerId: "provider-1" });
    const importId = created!.id;

    await repo.commitBatch(importId, {
      acceptedTransactions: [acceptedTx({ transactionId: "txn-dup" })],
      rejectedRecords: [],
      processedDelta: 1,
      checkpointOffset: BigInt(50),
      checkpointLineNumber: 1,
    });

    // A second, later batch (still ahead of the checkpoint) resubmits the
    // same (providerId, transactionId) - simulating the same transaction
    // appearing again later in the same file, or in a different import.
    const second = await repo.commitBatch(importId, {
      acceptedTransactions: [acceptedTx({ transactionId: "txn-dup" })],
      rejectedRecords: [],
      processedDelta: 1,
      checkpointOffset: BigInt(100),
      checkpointLineNumber: 2,
    });

    expect(second.acceptedCount).toBe(0);
    expect(second.duplicateCount).toBe(1);

    const rows = await getTestPrisma().transaction.findMany({ where: { importId } });
    expect(rows).toHaveLength(1);
  });

  it("resolves an in-batch duplicate (same providerId+transactionId twice in one commitBatch call)", async () => {
    const created = await repo.createPendingImport({ idempotencyKey: "k3", providerId: "provider-1" });
    const importId = created!.id;

    const result = await repo.commitBatch(importId, {
      acceptedTransactions: [
        acceptedTx({ transactionId: "txn-inbatch" }),
        acceptedTx({ transactionId: "txn-inbatch" }),
      ],
      rejectedRecords: [],
      processedDelta: 2,
      checkpointOffset: BigInt(50),
      checkpointLineNumber: 2,
    });

    expect(result.acceptedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
  });

  it("is safe to redeliver the same batch twice (checkpoint-guarded idempotent replay)", async () => {
    const created = await repo.createPendingImport({ idempotencyKey: "k4", providerId: "provider-1" });
    const importId = created!.id;

    const batch = {
      acceptedTransactions: [acceptedTx({ transactionId: "txn-redelivered" })],
      rejectedRecords: [],
      processedDelta: 1,
      checkpointOffset: BigInt(75),
      checkpointLineNumber: 1,
    };

    const first = await repo.commitBatch(importId, batch);
    // Simulates the worker crashing after commit but before the caller
    // observed success, triggering a redelivery of the identical batch.
    const redelivered = await repo.commitBatch(importId, batch);

    expect(first.acceptedCount).toBe(1);
    // Checkpoint guard short-circuits: no re-insert attempt, no double count.
    expect(redelivered).toEqual({ acceptedCount: 0, duplicateCount: 0 });

    const updated = await repo.findById(importId);
    expect(updated?.acceptedCount).toBe(1);
    expect(updated?.processedCount).toBe(1);

    const rows = await getTestPrisma().transaction.findMany({ where: { importId } });
    expect(rows).toHaveLength(1);
  });

  it("does not treat the same transactionId under a different providerId as a duplicate", async () => {
    const importA = await repo.createPendingImport({ idempotencyKey: "k5a", providerId: "provider-a" });
    const importB = await repo.createPendingImport({ idempotencyKey: "k5b", providerId: "provider-b" });

    const resultA = await repo.commitBatch(importA!.id, {
      acceptedTransactions: [acceptedTx({ providerId: "provider-a", transactionId: "shared-id" })],
      rejectedRecords: [],
      processedDelta: 1,
      checkpointOffset: BigInt(10),
      checkpointLineNumber: 1,
    });
    const resultB = await repo.commitBatch(importB!.id, {
      acceptedTransactions: [acceptedTx({ providerId: "provider-b", transactionId: "shared-id" })],
      rejectedRecords: [],
      processedDelta: 1,
      checkpointOffset: BigInt(10),
      checkpointLineNumber: 1,
    });

    expect(resultA.acceptedCount).toBe(1);
    expect(resultB.acceptedCount).toBe(1);
  });
});
