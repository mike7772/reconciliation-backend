import { config } from "dotenv";
config();

import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import ExpressServer from "./src/index";
import checkConnections from "./src/config/checkConnections";
import { buildContainer } from "./src/composition/container";
import { registerGracefulShutdown } from "./src/shared/utils/gracefulShutdown";

const SHUTDOWN_GRACE_PERIOD_MS = Number(process.env.SHUTDOWN_GRACE_PERIOD_MS) || 30000;

async function bootstrap(): Promise<void> {
  const container = buildContainer();

  // Postgres must be reachable to start; Redis/MinIO failures are logged
  // but never block startup (see checkConnections).
  await checkConnections(container);

  const app = express();
  new ExpressServer(app, container);

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer);

  io.on("connection", (socket: Socket) => {
    container.logger.info("Socket connected", { socketId: socket.id });

    socket.on("event", (data: string) => {
      socket.join(data);
    });

    socket.on("disconnect", () => {
      container.logger.info("Socket disconnected", { socketId: socket.id });
    });
  });

  httpServer
    .listen(Number(process.env.PORT), "0.0.0.0", () => {
      container.logger.info("Server started", { port: process.env.PORT });
      console.info(`Server running on : http://localhost:${process.env.PORT}`);
    })
    .on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        container.logger.error("Server startup error: address already in use");
      } else {
        container.logger.error("Port error", { error: err.message });
      }
    });

  registerGracefulShutdown(
    container.logger,
    [
      {
        // Flips /health/ready to unhealthy first, before anything else
        // stops - gives a load balancer/orchestrator a window to stop
        // routing new traffic here while the rest of shutdown proceeds.
        name: "mark-not-ready",
        run: () => {
          container.readiness.markShuttingDown();
          return Promise.resolve();
        },
      },
      {
        // Stops accepting new connections; waits for in-flight requests
        // to finish rather than cutting them off.
        name: "close-http-server",
        run: () => new Promise((resolve, reject) => {
          httpServer.close((err) => (err ? reject(err) : resolve()));
        }),
      },
      { name: "close-socket-io", run: () => io.close() },
      { name: "disconnect-prisma", run: () => container.prisma.$disconnect() },
      { name: "quit-redis", run: () => container.redis.quit().then(() => undefined) },
      { name: "quit-queue-connection", run: () => container.queueConnection.quit().then(() => undefined) },
    ],
    SHUTDOWN_GRACE_PERIOD_MS
  );
}

bootstrap().catch((err) => {
  console.error("Fatal startup error: Postgres is not reachable.", err);
  process.exit(1);
});
