import { createServer, Server as HttpServer } from "http";
import { Registry } from "prom-client";

/**
 * A minimal (no Express) HTTP server exposing GET /metrics for processes
 * that aren't already running an Express app - e.g. the BullMQ worker.
 * prom-client's Registry is in-process memory, so a separate process's
 * metrics are only visible if that process exposes its own scrape target;
 * this is the standard fix (one Prometheus target per process) rather than
 * trying to funnel worker metrics through the API server's registry.
 */
export function startMetricsHttpServer(registry: Registry, port: number): HttpServer {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/metrics") {
      res.setHeader("Content-Type", registry.contentType);
      res.end(await registry.metrics());
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  server.listen(port);
  return server;
}
