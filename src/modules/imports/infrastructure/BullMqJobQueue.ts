import { Queue } from "bullmq";
import { JobQueue } from "../domain/ports/JobQueue";

export const IMPORT_QUEUE_NAME = "import-processing";

export interface ImportJobData {
  importId: string;
}

export class BullMqJobQueue implements JobQueue {
  constructor(private readonly queue: Queue<ImportJobData>) {}

  async enqueueImportProcessing(importId: string): Promise<void> {
    await this.queue.add(
      "process-import",
      { importId },
      {
        attempts: 1, // Phase 5 introduces a deliberate, bounded retry policy.
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
  }
}
