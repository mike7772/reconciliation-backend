/**
 * Distinct from ReadinessState/cancellation: this signals "the process is
 * shutting down", checked by long-running work (like import processing) at
 * its next safe checkpoint so it can pause - not cancel - promptly. Unlike
 * user-initiated cancellation, a shutdown-paused import is left in
 * `processing` (not `cancelled`) since its checkpoint is already durable
 * and it's expected to resume when a worker picks the job up again.
 */
export class ShutdownSignal {
  private shuttingDown = false;

  requestShutdown(): void {
    this.shuttingDown = true;
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }
}
