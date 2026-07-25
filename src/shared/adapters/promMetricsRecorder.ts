import { Registry, Counter, Gauge, Histogram } from "prom-client";
import { MetricsRecorder } from "../ports/MetricsRecorder";

// NOTE: prom-client fixes a metric's label names at creation time (from the
// first call's labels), so every call site for a given metric name must
// consistently pass the same set of label keys.
export class PromMetricsRecorder implements MetricsRecorder {
  private readonly counters = new Map<string, Counter<string>>();
  private readonly histograms = new Map<string, Histogram<string>>();
  private readonly gauges = new Map<string, Gauge<string>>();

  constructor(private readonly registry: Registry) {}

  incrementCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
    let counter = this.counters.get(name);
    if (!counter) {
      counter = new Counter({
        name,
        help: name,
        labelNames: Object.keys(labels),
        registers: [this.registry],
      });
      this.counters.set(name, counter);
    }
    counter.inc(labels, value);
  }

  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = new Histogram({
        name,
        help: name,
        labelNames: Object.keys(labels),
        registers: [this.registry],
      });
      this.histograms.set(name, histogram);
    }
    histogram.observe(labels, value);
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    let gauge = this.gauges.get(name);
    if (!gauge) {
      gauge = new Gauge({
        name,
        help: name,
        labelNames: Object.keys(labels),
        registers: [this.registry],
      });
      this.gauges.set(name, gauge);
    }
    gauge.set(labels, value);
  }
}
