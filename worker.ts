import { config } from "dotenv";
config();

import { Worker } from "bullmq";
import { buildContainer } from "./src/composition/container";
import checkConnections from "./src/config/checkConnections";
import { buildImportProcessor } from "./src/modules/imports/imports.composition";
import { IMPORT_QUEUE_NAME, ImportJobData } from "./src/modules/imports/imports.jobQueue";
import { startMetricsHttpServer } from "./src/shared/adapters/metricsHttpServer";
import { startEventLoopUtilizationGauge } from "./src/shared/adapters/eventLoopUtilization";
import { registerGracefulShutdown } from "./src/shared/utils/gracefulShutdown";

const MAX_CONCURRENT_IMPORTS = Number(process.env.MAX_CONCURRENT_IMPORTS) || 2;
const WORKER_METRICS_PORT = Number(process.env.WORKER_METRICS_PORT) || 9465;
const SHUTDOWN_GRACE_PERIOD_MS = Number(process.env.SHUTDOWN_GRACE_PERIOD_MS) || 30000;

async function bootstrap(): Promise<void> {
  const container = buildContainer();
  await checkConnections(container);

  const { processor: importProcessor, close: closeRiskScorer } = buildImportProcessor(container);

  const worker = new Worker<ImportJobData>(
    IMPORT_QUEUE_NAME,
    async (job) => {
      container.logger.info("Processing import job", {
        jobId: job.id,
        importId: job.data.importId,
      });
      await importProcessor.process(job.data.importId);
    },
    {
      connection: container.queueConnection,
      concurrency: MAX_CONCURRENT_IMPORTS,
    }
  );

  worker.on("failed", (job, err) => {
    container.logger.error("Import job failed", {
      jobId: job?.id,
      importId: job?.data?.importId,
      error: err.message,
    });
  });

  const metricsServer = startMetricsHttpServer(container.metricsRegistry, WORKER_METRICS_PORT);
  startEventLoopUtilizationGauge(container.metrics);

  container.logger.info("Import worker started", {
    queue: IMPORT_QUEUE_NAME,
    concurrency: MAX_CONCURRENT_IMPORTS,
    metricsPort: WORKER_METRICS_PORT,
  });

  registerGracefulShutdown(
    container.logger,
    [
      {
        // Signals the currently-processing import (if any) to pause at its
        // next batch boundary instead of running to completion. Without
        // this, worker.close() below would wait for the *entire* file to
        // finish - for a large import that's minutes, not the handful of
        // seconds a batch boundary takes.
        name: "signal-shutdown",
        run: () => {
          container.shutdownSignal.requestShutdown();
          return Promise.resolve();
        },
      },
      {
        // Stops pulling new jobs; waits for the active job's current
        // processor invocation to return (which, now that shutdown has
        // been signaled, happens at the next batch boundary).
        name: "close-bullmq-worker",
        run: () => worker.close(),
      },
      { name: "close-piscina-pool", run: () => closeRiskScorer() },
      { name: "close-metrics-server", run: () => new Promise((resolve) => metricsServer.close(() => resolve())) },
      { name: "disconnect-prisma", run: () => container.prisma.$disconnect() },
      { name: "quit-redis", run: () => container.redis.quit().then(() => undefined) },
      { name: "quit-queue-connection", run: () => container.queueConnection.quit().then(() => undefined) },
    ],
    SHUTDOWN_GRACE_PERIOD_MS
  );
}

bootstrap().catch((err) => {
  console.error("Fatal worker startup error:", err);
  process.exit(1);
});
