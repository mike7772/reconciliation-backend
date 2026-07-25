import { Application, urlencoded, json, static as estatic } from "express";
import morgan from "morgan";
import * as fs from "fs";
import { WriteStream } from "fs";
import * as path from "path";
import rateLimiter from "./shared/middleware/rateLimit";
import requestId from "./shared/middleware/requestId";
import httpMetrics from "./shared/middleware/httpMetrics";
import { startEventLoopUtilizationGauge } from "./shared/adapters/eventLoopUtilization";
import { createUncaughtErrorHandler } from "./shared/errors/errorHandler";
import Routes from "./routes";
import { Container } from "./composition/container";
import { startQueueMetricsPolling } from "./modules/imports/imports.composition";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import cookieParser from "cookie-parser";
import compression from "compression";
import * as swaggerUi from "swagger-ui-express";
import generateOpenApiDocument from "./config/openapi/document";

export default class Server {
  constructor(
    app: Application,
    private readonly container: Container
  ) {
    this.config(app);
    new Routes(app, container);
    // Error-handling middleware must be registered after routes so it can
    // actually catch errors passed via next(err) from route handlers.
    app.use(createUncaughtErrorHandler(container.logger));

    startEventLoopUtilizationGauge(container.metrics);
    startQueueMetricsPolling(container);

    process.on("beforeExit", (code) => {
      container.logger.info("Process beforeExit", { code });
    });
  }

  public config(app: Application): void {
    const accessLogStream: WriteStream = fs.createWriteStream(
      path.join(__dirname, "../logs/access.log"),
      { flags: "a" }
    );

    const whitelist = ["http://localhost:3000"];
    const corsOptions = {
      origin: function (origin: any, callback: CallableFunction) {
        // allow requests with no origin
        // (like mobile apps or curl requests or ejs internal post routes)
        if (!origin || origin === "null") {
          return callback(undefined, true);
        }
        if (whitelist.indexOf(origin) !== -1) {
          callback(undefined, true);
        } else {
          console.log("cors not allowed ", origin);
          callback(new Error("Not allowed by CORS"));
        }
      },
      credentials: true,
    };

    app.use(requestId);
    app.use(httpMetrics(this.container.metrics));
    app.use("/public", estatic(__dirname + "/public"));
    app.use(morgan("dev"));
    app.use(morgan("combined", { stream: accessLogStream }));
    app.use(cors());
    // app.use(cors(corsOptions));
    // use csrf
    app.use(json());
    app.use(urlencoded({ extended: true }));
    app.use(cookieParser());
    app.use(helmet());
    app.use(rateLimiter()); //  apply to all requests
    app.set("trust proxy", false); // only if the server is behind a reverse proxy (Heroku, Bluemix, AWS ELB, Nginx, etc)
    app.use(
      session({
        secret: "yourSecretKey", // Change this to a long random string
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false }, // Set secure to true if using HTTPS
      })
    );
    app.use(compression());
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(generateOpenApiDocument()));
  }
}
