import { Router } from "express";
import { Queue } from "bullmq";
import { Container } from "../../composition/container";
import { ImportService } from "./domain/ImportService";
import { PrismaImportRepository } from "./infrastructure/PrismaImportRepository";
import { MinioFileStorage } from "./infrastructure/MinioFileStorage";
import { BullMqJobQueue, IMPORT_QUEUE_NAME, ImportJobData } from "./infrastructure/BullMqJobQueue";
import {
  createImportHandler,
  createGetImportHandler,
  createCancelImportHandler,
} from "./imports.controller";

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

export default function createImportRoutes(container: Container): Router {
  const router = Router();
  const importService = buildImportService(container);

  router.post("/v1/imports", createImportHandler(importService, container.logger));
  router.get("/v1/imports/:id", createGetImportHandler(importService));
  router.post("/v1/imports/:id/cancel", createCancelImportHandler(importService));

  return router;
}
