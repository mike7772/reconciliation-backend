import { Router } from "express";
import { Container } from "../../composition/container";
import { buildImportService } from "./imports.composition";
import {
  createImportHandler,
  createGetImportHandler,
  createCancelImportHandler,
  createSummaryHandler,
  createRejectionsHandler,
} from "./imports.controller";

export default function createImportRoutes(container: Container): Router {
  const router = Router();
  const importService = buildImportService(container);

  router.post("/v1/imports", createImportHandler(importService, container.logger));
  router.get("/v1/imports/:id", createGetImportHandler(importService));
  router.post("/v1/imports/:id/cancel", createCancelImportHandler(importService));
  router.get("/v1/imports/:id/summary", createSummaryHandler(importService));
  router.get("/v1/imports/:id/rejections", createRejectionsHandler(importService));

  return router;
}
