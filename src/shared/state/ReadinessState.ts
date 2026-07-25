/**
 * Mutable shutdown flag consulted by GET /health/ready - flipped once
 * during graceful shutdown so a load balancer stops routing new traffic
 * here before the process actually stops accepting connections.
 */
export class ReadinessState {
  private shuttingDown = false;

  markShuttingDown(): void {
    this.shuttingDown = true;
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }
}
