import { Queue } from "bullmq";
import { Container } from "../../composition/container";
import { ImportService } from "./domain/ImportService";
import { ImportProcessor } from "./domain/ImportProcessor";
import { PrismaImportRepository } from "./infrastructure/PrismaImportRepository";
import { MinioFileStorage } from "./infrastructure/MinioFileStorage";
import { PiscinaRiskScorer } from "./infrastructure/PiscinaRiskScorer";
import { BullMqJobQueue, IMPORT_QUEUE_NAME, ImportJobData } from "./infrastructure/BullMqJobQueue";

export function buildImportService(container: Container): ImportService {
  const importRepository = new PrismaImportRepository(container.prisma);
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
  const importRepository = new PrismaImportRepository(container.prisma);
  const fileStorage = new MinioFileStorage(container.minio, container.minioBucket);
  const riskScorer = new PiscinaRiskScorer();

  return new ImportProcessor({
    importRepository,
    fileStorage,
    riskScorer,
    logger: container.logger.child({ module: "import-processor" }),
  });
}
