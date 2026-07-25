import { Router } from "express";
import { Container } from "../../composition/container";
import { createLiveHandler, createReadyHandler, createMetricsHandler } from "./health.controller";

export default function createHealthRoutes(container: Container): Router {
  const router = Router();

  router.get("/health/live", createLiveHandler());
  router.get("/health/ready", createReadyHandler(container));
  router.get("/metrics", createMetricsHandler(container));

  return router;
}
