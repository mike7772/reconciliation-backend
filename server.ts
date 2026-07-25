import { config } from "dotenv";
config();

import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import ExpressServer from "./src/index";
import checkConnections from "./src/config/checkConnections";
import { buildContainer } from "./src/composition/container";

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
    .listen(Number(process.env.PORT), "localhost", () => {
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
}

bootstrap().catch((err) => {
  console.error("Fatal startup error: Postgres is not reachable.", err);
  process.exit(1);
});
