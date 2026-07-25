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

export function buildImportProcessor(container: Container): ImportProcessor {
  const importRepository = new PrismaImportRepository(container.prisma, buildRetryPolicy(container));
  const fileStorage = new MinioFileStorage(container.minio, container.minioBucket);
  const riskScorer = new PiscinaRiskScorer();

  return new ImportProcessor({
    importRepository,
    fileStorage,
    riskScorer,
    logger: container.logger.child({ module: "import-processor" }),
  });
}
