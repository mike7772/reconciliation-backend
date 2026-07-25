import { config } from "dotenv";
config();

import { Worker } from "bullmq";
import { buildContainer } from "./src/composition/container";
import checkConnections from "./src/config/checkConnections";
import { buildImportProcessor } from "./src/modules/imports/imports.composition";
import { IMPORT_QUEUE_NAME, ImportJobData } from "./src/modules/imports/infrastructure/BullMqJobQueue";

const MAX_CONCURRENT_IMPORTS = Number(process.env.MAX_CONCURRENT_IMPORTS) || 2;

async function bootstrap(): Promise<void> {
  const container = buildContainer();
  await checkConnections(container);

  const importProcessor = buildImportProcessor(container);

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

  container.logger.info("Import worker started", {
    queue: IMPORT_QUEUE_NAME,
    concurrency: MAX_CONCURRENT_IMPORTS,
  });
}

bootstrap().catch((err) => {
  console.error("Fatal worker startup error:", err);
  process.exit(1);
});
