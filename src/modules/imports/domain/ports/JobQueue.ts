export interface JobQueue {
  enqueueImportProcessing(importId: string): Promise<void>;
}
