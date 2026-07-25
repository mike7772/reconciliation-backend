import { RetryPolicy } from "../ports/RetryPolicy";
import { Logger } from "../ports/Logger";
import { MetricsRecorder } from "../ports/MetricsRecorder";
import { RetryAbortedError } from "../errors/RetryAbortedError";

export interface RetryConfig {
  /** Total attempts including the first (non-retry) one. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ExponentialBackoffRetryPolicy implements RetryPolicy {
  constructor(
    private readonly config: RetryConfig,
    private readonly logger: Logger,
    private readonly metrics: MetricsRecorder
  ) {}

  async execute<T>(
    operationName: string,
    fn: () => Promise<T>,
    isRetryable: (err: unknown) => boolean,
    shouldAbort?: () => Promise<boolean>
  ): Promise<T> {
    let attempt = 0;

    for (;;) {
      attempt += 1;

      try {
        return await fn();
      } catch (err) {
        const retryable = isRetryable(err);
        const attemptsLeft = attempt < this.config.maxAttempts;

        if (!retryable || !attemptsLeft) {
          this.metrics.incrementCounter("retry_exhausted_total", { operation: operationName });
          this.logger.error("Operation failed, not retrying", {
            operation: operationName,
            attempt,
            retryable,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }

        if (shouldAbort && (await shouldAbort())) {
          this.metrics.incrementCounter("retry_aborted_total", { operation: operationName });
          this.logger.warn("Retry aborted by cancellation signal", {
            operation: operationName,
            attempt,
          });
          throw new RetryAbortedError(operationName);
        }

        const delay = this.computeDelayMs(attempt);
        this.metrics.incrementCounter("retry_attempts_total", { operation: operationName });
        this.logger.warn("Operation failed, retrying", {
          operation: operationName,
          attempt,
          delayMs: delay,
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(delay);
      }
    }
  }

  /** Exponential backoff capped at maxDelayMs, with up to 50% jitter added
   *  on top of half the capped value - keeps a floor under the delay
   *  (avoiding near-zero waits) while still spreading retries out to avoid
   *  a thundering herd against the same struggling dependency. */
  private computeDelayMs(attempt: number): number {
    const exponential = this.config.baseDelayMs * 2 ** (attempt - 1);
    const capped = Math.min(exponential, this.config.maxDelayMs);
    const jitter = Math.random() * capped * 0.5;
    return Math.round(capped * 0.5 + jitter);
  }
}
