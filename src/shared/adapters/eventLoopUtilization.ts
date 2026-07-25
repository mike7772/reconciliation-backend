import { performance } from "perf_hooks";
import { MetricsRecorder } from "../ports/MetricsRecorder";

const POLL_INTERVAL_MS = 5000;

/**
 * Event-loop *utilization* (fraction of time the loop is busy vs idle) is a
 * distinct signal from event-loop *lag* (already collected for free by
 * prom-client's collectDefaultMetrics, based on the same perf_hooks data but
 * measuring delay rather than busy-fraction) - high utilization with low
 * lag can mean the loop is busy but keeping up; rising lag is the more
 * urgent signal that it's falling behind.
 *
 * Returns a stop function; the interval is unref'd so it never keeps the
 * process alive on its own.
 */
export function startEventLoopUtilizationGauge(metrics: MetricsRecorder): () => void {
  let last = performance.eventLoopUtilization();

  const interval = setInterval(() => {
    const current = performance.eventLoopUtilization(last);
    metrics.setGauge("nodejs_eventloop_utilization", current.utilization);
    last = performance.eventLoopUtilization();
  }, POLL_INTERVAL_MS);
  interval.unref();

  return () => clearInterval(interval);
}
