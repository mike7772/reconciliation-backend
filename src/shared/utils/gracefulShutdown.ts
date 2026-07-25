import { Logger } from "../ports/Logger";

export interface ShutdownStep {
  name: string;
  run: () => Promise<void>;
}

/**
 * Registers SIGTERM/SIGINT handlers that run each step in order (never
 * skipping later steps if an earlier one throws - so a failed DB
 * disconnect, say, doesn't prevent Redis from also being closed), then
 * exits. A force-exit timer guarantees the process doesn't hang forever if
 * a step never resolves (e.g. an in-flight import that never reaches a
 * batch boundary) - never a bare process.exit() while work might still be
 * active, but never an unbounded wait either.
 */
export function registerGracefulShutdown(
  logger: Logger,
  steps: ShutdownStep[],
  gracePeriodMs: number
): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("Shutdown signal received, starting graceful shutdown", {
      signal,
      gracePeriodMs,
    });

    const forceExitTimer = setTimeout(() => {
      logger.error("Graceful shutdown grace period expired, forcing exit");
      process.exit(1);
    }, gracePeriodMs);
    forceExitTimer.unref();

    for (const step of steps) {
      try {
        logger.info("Running shutdown step", { step: step.name });
        await step.run();
      } catch (err) {
        logger.error("Shutdown step failed", {
          step: step.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    clearTimeout(forceExitTimer);
    logger.info("Graceful shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
