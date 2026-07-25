import { NextFunction, Request, Response } from "express";
import { MetricsRecorder } from "../ports/MetricsRecorder";

/**
 * Records HTTP request count/duration labeled by method, route *pattern*,
 * and status - never the raw path, which would leak import/resource IDs
 * into label values and blow up cardinality. req.route.path is the
 * pattern (e.g. "/v1/imports/:id"), populated by Express once routing
 * completes; read lazily in the `finish` handler so it's always available
 * by the time we look at it, regardless of where this middleware is
 * mounted relative to route matching.
 */
export default function httpMetrics(metrics: MetricsRecorder) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startNs = process.hrtime.bigint();

    res.on("finish", () => {
      const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
      const route = req.route?.path
        ? `${req.baseUrl}${req.route.path}`
        : "unmatched";
      const labels = { method: req.method, route, status: String(res.statusCode) };

      metrics.incrementCounter("http_requests_total", labels);
      metrics.observeHistogram("http_request_duration_seconds", durationSeconds, labels);
    });

    next();
  };
}
