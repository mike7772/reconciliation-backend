import { Queue } from "bullmq";
import { Container } from "../../composition/container";
import { ImportService } from "./domain/ImportService";
import { ImportProcessor } from "./domain/ImportProcessor";
import { PrismaImportRepository } from "./infrastructure/PrismaImportRepository";
import { MinioFileStorage } from "./infrastructure/MinioFileStorage";
import { PiscinaRiskScorer } from "./infrastructure/PiscinaRiskScorer";
import { BullMqJobQueue, IMPORT_QUEUE_NAME, ImportJobData } from "./infrastructure/BullMqJobQueue";
import { ExponentialBackoffRetryPolicy } from "../../shared/adapters/exponentialBackoffRetryPolicy";
import { RetryPolicy } from "../../shared/ports/RetryPolicy";

function buildRetryPolicy(container: Container): RetryPolicy {
  return new ExponentialBackoffRetryPolicy(
    {
      maxAttempts: Number(process.env.DB_RETRY_MAX_ATTEMPTS) || 4,
      baseDelayMs: Number(process.env.DB_RETRY_BASE_DELAY_MS) || 100,
      maxDelayMs: Number(process.env.DB_RETRY_MAX_DELAY_MS) || 2000,
    },
    container.logger.child({ module: "retry-policy" }),
    container.metrics
  );
}

export function buildImportService(container: Container): ImportService {
  const importRepository = new PrismaImportRepository(container.prisma, buildRetryPolicy(container));
  const fileStorage = new MinioFileStorage(container.minio, container.minioBucket);
  const queue = new Queue<ImportJobData>(IMPORT_QUEUE_NAME, {
    connection: container.queueConnection,
  });
  const jobQueue = new BullMqJobQueue(queue);

  return new ImportService({
    importRepository,
    fileStorage,
    jobQueue,
    idGenerator: container.idGenerator,
    logger: container.logger.child({ module: "imports" }),
  });
}

const QUEUE_METRICS_POLL_INTERVAL_MS = 5000;

/**
 * Polls BullMQ job counts and republishes them as gauges. Runs in the API
 * server process (which is what serves /metrics) using a lightweight,
 * read-only Queue client - it never enqueues anything itself.
 */
export function startQueueMetricsPolling(container: Container): () => void {
  const queue = new Queue<ImportJobData>(IMPORT_QUEUE_NAME, {
    connection: container.queueConnection,
  });

  const interval = setInterval(async () => {
    try {
      const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
      container.metrics.setGauge("import_queue_waiting", counts.waiting ?? 0);
      container.metrics.setGauge("import_queue_active", counts.active ?? 0);
      container.metrics.setGauge("import_queue_delayed", counts.delayed ?? 0);
      container.metrics.setGauge("import_queue_failed", counts.failed ?? 0);
    } catch (err) {
      container.logger.warn("Failed to poll queue metrics", {
        error: (err as Error).message,
      });
    }
  }, QUEUE_METRICS_POLL_INTERVAL_MS);
  interval.unref();

  return () => clearInterval(interval);
}

export interface ImportProcessorHandle {
  processor: ImportProcessor;
  /** Destroys the Piscina worker-thread pool - part of graceful shutdown. */
  close: () => Promise<void>;
}

export function buildImportProcessor(container: Container): ImportProcessorHandle {
  const importRepository = new PrismaImportRepository(container.prisma, buildRetryPolicy(container));
  const fileStorage = new MinioFileStorage(container.minio, container.minioBucket);
  const riskScorer = new PiscinaRiskScorer();
  const queue = new Queue<ImportJobData>(IMPORT_QUEUE_NAME, {
    connection: container.queueConnection,
  });
  const jobQueue = new BullMqJobQueue(queue);

  const processor = new ImportProcessor({
    importRepository,
    fileStorage,
    riskScorer,
    jobQueue,
    logger: container.logger.child({ module: "import-processor" }),
    metrics: container.metrics,
    shutdownSignal: container.shutdownSignal,
  });

  return { processor, close: () => riskScorer.close() };
}
