/** Thrown when a retry loop is stopped early by shouldAbort(), not by
 *  exhausting attempts or hitting a non-retryable error. */
export class RetryAbortedError extends Error {
  constructor(operationName: string) {
    super(`Retry aborted for operation "${operationName}"`);
  }
}
