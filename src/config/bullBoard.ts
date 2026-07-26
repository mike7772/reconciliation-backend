import { Queue } from "bullmq";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { Container } from "../composition/container";
import { IMPORT_QUEUE_NAME, ImportJobData } from "../modules/imports/imports.jobQueue";

export const BULL_BOARD_BASE_PATH = "/admin/queues";

/**
 * Read-only visual dashboard over the same BullMQ queue the worker
 * consumes from. Uses its own lightweight Queue client (like
 * startQueueMetricsPolling) rather than the worker's own Queue instance -
 * this runs in the API process, a separate one from the worker.
 */
export function buildBullBoardRouter(container: Container) {
  const queue = new Queue<ImportJobData>(IMPORT_QUEUE_NAME, {
    connection: container.queueConnection,
  });

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_BASE_PATH);

  createBullBoard({
    queues: [new BullMQAdapter(queue)],
    serverAdapter,
  });

  return serverAdapter.getRouter();
}
