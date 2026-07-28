import { Registry, collectDefaultMetrics } from "prom-client";
import IORedis from "ioredis";
import prisma from "../config/prisma";
import redis from "../config/redis";
import minio, { MINIO_BUCKET } from "../config/objectStorage";
import { Logger } from "../shared/ports/Logger";
import { Clock } from "../shared/ports/Clock";
import { IdGenerator } from "../shared/ports/IdGenerator";
import { MetricsRecorder } from "../shared/ports/MetricsRecorder";
import { createPinoLogger } from "../shared/adapters/pinoLogger";
import { SystemClock } from "../shared/adapters/systemClock";
import { UuidIdGenerator } from "../shared/adapters/uuidIdGenerator";
import { PromMetricsRecorder } from "../shared/adapters/promMetricsRecorder";
import { ReadinessState } from "../shared/state/ReadinessState";
import { ShutdownSignal } from "../shared/state/ShutdownSignal";

export interface Container {
  logger: Logger;
  clock: Clock;
  idGenerator: IdGenerator;
  metricsRegistry: Registry;
  metrics: MetricsRecorder;
  prisma: typeof prisma;
  redis: typeof redis;
  minio: typeof minio;
  minioBucket: string;
  // Dedicated ioredis connection for BullMQ (Phase 3+). BullMQ requires
  // ioredis specifically; this is separate from the `redis` client above,
  // which is used for the app's own caching.
  queueConnection: IORedis;
  readiness: ReadinessState;
  shutdownSignal: ShutdownSignal;
}

export function buildContainer(): Container {
  const metricsRegistry = new Registry();
  collectDefaultMetrics({ register: metricsRegistry });

  const queueConnection = new IORedis(
    process.env.REDIS_URL || "redis://localhost:6379",
    { maxRetriesPerRequest: null }
  );
  queueConnection.on("error", (err) => {
    console.error("BullMQ Redis connection error:", err.message);
  });

  return {
    logger: createPinoLogger(),
    clock: new SystemClock(),
    idGenerator: new UuidIdGenerator(),
    metricsRegistry,
    metrics: new PromMetricsRecorder(metricsRegistry),
    prisma,
    redis,
    minio,
    minioBucket: MINIO_BUCKET,
    queueConnection,
    readiness: new ReadinessState(),
    shutdownSignal: new ShutdownSignal(),
  };
}
