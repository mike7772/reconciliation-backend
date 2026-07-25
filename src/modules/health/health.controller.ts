import { Request, Response } from "express";
import { Container } from "../../composition/container";
import httpStatusCodes from "../../shared/constants/httpStatusCodes";

export function createLiveHandler() {
  return (_req: Request, res: Response): void => {
    res.status(httpStatusCodes.OK).json({ status: "alive" });
  };
}

export function createReadyHandler(container: Container) {
  return async (_req: Request, res: Response): Promise<void> => {
    if (container.readiness.isShuttingDown()) {
      res
        .status(httpStatusCodes.SERVICE_UNAVAILABLE)
        .json({ status: "not_ready", reason: "shutting_down" });
      return;
    }

    const checks: Record<string, boolean> = {};

    try {
      await container.prisma.$queryRaw`SELECT 1`;
      checks.postgres = true;
    } catch {
      checks.postgres = false;
    }

    try {
      checks.redis = container.redis.isOpen && (await container.redis.ping()) === "PONG";
    } catch {
      checks.redis = false;
    }

    try {
      checks.minio = await container.minio.bucketExists(container.minioBucket);
    } catch {
      checks.minio = false;
    }

    // Postgres is the hard dependency (matches checkConnections at startup);
    // Redis/MinIO are reported but don't flip overall readiness.
    const ready = checks.postgres;
    res
      .status(ready ? httpStatusCodes.OK : httpStatusCodes.SERVICE_UNAVAILABLE)
      .json({ status: ready ? "ready" : "not_ready", checks });
  };
}

export function createMetricsHandler(container: Container) {
  return async (_req: Request, res: Response): Promise<void> => {
    res.set("Content-Type", container.metricsRegistry.contentType);
    res.end(await container.metricsRegistry.metrics());
  };
}
