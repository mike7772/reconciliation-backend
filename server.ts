import { config } from "dotenv";
config();

import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import ExpressServer from "./src/index";
import checkConnections from "./src/config/checkConnections";

async function bootstrap(): Promise<void> {
  // Postgres must be reachable to start; Redis/MinIO failures are logged
  // but never block startup (see checkConnections).
  await checkConnections();

  const app = express();
  new ExpressServer(app);

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer);

  io.on("connection", (socket: Socket) => {
    console.log(`User Connected: ${socket.id}`);

    socket.on("event", (data: string) => {
      socket.join(data);
    });

    socket.on("disconnect", () => {
      console.log("User Disconnected", socket.id);
    });
  });

  httpServer
    .listen(Number(process.env.PORT), "localhost", () => {
      console.info(`Server running on : http://localhost:${process.env.PORT}`);
    })
    .on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.log("server startup error: address already in use");
      } else {
        console.log("Port Error: ", err);
      }
    });
}

bootstrap().catch((err) => {
  console.error("Fatal startup error: Postgres is not reachable.", err);
  process.exit(1);
});
