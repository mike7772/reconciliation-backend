import { PrismaImportRepository } from "../../src/modules/imports/imports.repository";
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
  const retryPolicy = new ExponentialBackoffRetryPolicy(
    { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5 },
    fakeLogger(),
    fakeMetrics()
  );
  return new PrismaImportRepository(getTestPrisma(), retryPolicy);
}

describe("Rejected-record cursor pagination (integration)", () => {
  let repo: PrismaImportRepository;
  let importId: string;

  beforeEach(async () => {
    await cleanDatabase();
    repo = buildRepository();
    const created = await repo.createPendingImport({ idempotencyKey: "rej-k1", providerId: "provider-1" });
    importId = created!.id;

    // 25 rejected records across two batches, mirroring how the real
    // processor commits progressively as it streams through a file.
    await repo.commitBatch(importId, {
      acceptedTransactions: [],
      rejectedRecords: Array.from({ length: 15 }, (_, i) => ({
        lineNumber: i + 1,
        reasonCode: "INVALID_JSON",
        message: "Line is not valid JSON",
        rawValue: `raw-${i + 1}`,
      })),
      processedDelta: 15,
      checkpointOffset: BigInt(150),
      checkpointLineNumber: 15,
    });
    await repo.commitBatch(importId, {
      acceptedTransactions: [],
      rejectedRecords: Array.from({ length: 10 }, (_, i) => ({
        lineNumber: i + 16,
        reasonCode: "VALIDATION_FAILED",
        message: "Missing field",
        rawValue: `raw-${i + 16}`,
      })),
      processedDelta: 10,
      checkpointOffset: BigInt(250),
      checkpointLineNumber: 25,
    });
  });

  afterAll(async () => {
    await cleanDatabase();
    await disconnectTestPrisma();
  });

  it("returns the first page in ascending line-number order with a next cursor", async () => {
    const page = await repo.getRejections(importId, 10, null);

    expect(page.items).toHaveLength(10);
    expect(page.items.map((i) => i.lineNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(page.nextCursor).not.toBeNull();
  });

  it("returns subsequent pages using the cursor, with no overlap or gaps", async () => {
    const seen: number[] = [];
    let cursor: string | null = null;

    for (let i = 0; i < 10; i++) {
      const page: Awaited<ReturnType<typeof repo.getRejections>> = await repo.getRejections(
        importId,
        10,
        cursor
      );
      seen.push(...page.items.map((item) => item.lineNumber));
      cursor = page.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("returns null nextCursor on the final page (bounded result set)", async () => {
    const page1 = await repo.getRejections(importId, 20, null);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await repo.getRejections(importId, 20, page1.nextCursor);
    expect(page2.items).toHaveLength(5);
    expect(page2.nextCursor).toBeNull();
  });
});
