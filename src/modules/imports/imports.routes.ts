import { Router } from "express";
import { Container } from "../../composition/container";
import { buildImportService } from "./imports.composition";
import authenticate from "../../shared/middleware/authenticate";
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

  router.post("/v1/imports", authenticate, createImportHandler(importService, container.logger));
  router.get("/v1/imports/:id", authenticate, createGetImportHandler(importService));
  router.post("/v1/imports/:id/cancel", authenticate, createCancelImportHandler(importService));
  router.get("/v1/imports/:id/summary", authenticate, createSummaryHandler(importService));
  router.get("/v1/imports/:id/rejections", authenticate, createRejectionsHandler(importService));

  return router;
}
