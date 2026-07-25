export interface MetricsRecorder {
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void;
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
  incrementGauge(name: string, labels?: Record<string, string>, value?: number): void;
  decrementGauge(name: string, labels?: Record<string, string>, value?: number): void;
}
