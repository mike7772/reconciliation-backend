import { ExponentialBackoffRetryPolicy } from "../../src/shared/adapters/exponentialBackoffRetryPolicy";
import { RetryAbortedError } from "../../src/shared/errors/RetryAbortedError";
import { Logger } from "../../src/shared/ports/Logger";
import { MetricsRecorder } from "../../src/shared/ports/MetricsRecorder";

function fakeLogger(): Logger {
  const logger: Logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => logger),
  };
  return logger;
}

function fakeMetrics(): MetricsRecorder {
  return {
    incrementCounter: jest.fn(),
    observeHistogram: jest.fn(),
    setGauge: jest.fn(),
    incrementGauge: jest.fn(),
    decrementGauge: jest.fn(),
  };
}

describe("ExponentialBackoffRetryPolicy", () => {
  it("returns the result immediately when the operation succeeds on the first attempt", async () => {
    const policy = new ExponentialBackoffRetryPolicy(
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10 },
      fakeLogger(),
      fakeMetrics()
    );

    const fn = jest.fn().mockResolvedValue("ok");
    const result = await policy.execute("op", fn, () => true);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable failure up to maxAttempts, then throws the last error", async () => {
    const policy = new ExponentialBackoffRetryPolicy(
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
      fakeLogger(),
      fakeMetrics()
    );

    const err = new Error("transient");
    const fn = jest.fn().mockRejectedValue(err);

    await expect(policy.execute("op", fn, () => true)).rejects.toThrow("transient");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry when isRetryable returns false, even on the first failure", async () => {
    const policy = new ExponentialBackoffRetryPolicy(
      { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 },
      fakeLogger(),
      fakeMetrics()
    );

    const err = new Error("validation failed");
    const fn = jest.fn().mockRejectedValue(err);

    await expect(policy.execute("op", fn, () => false)).rejects.toThrow("validation failed");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("succeeds after a transient failure followed by a success", async () => {
    const policy = new ExponentialBackoffRetryPolicy(
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
      fakeLogger(),
      fakeMetrics()
    );

    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("recovered");

    const result = await policy.execute("op", fn, () => true);

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("aborts with RetryAbortedError when shouldAbort signals cancellation between attempts", async () => {
    const policy = new ExponentialBackoffRetryPolicy(
      { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 },
      fakeLogger(),
      fakeMetrics()
    );

    const fn = jest.fn().mockRejectedValue(new Error("transient"));
    const shouldAbort = jest.fn().mockResolvedValue(true);

    await expect(policy.execute("op", fn, () => true, shouldAbort)).rejects.toBeInstanceOf(
      RetryAbortedError
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("records a retry_attempts_total metric for each retry and retry_exhausted_total on final failure", async () => {
    const metrics = fakeMetrics();
    const policy = new ExponentialBackoffRetryPolicy(
      { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5 },
      fakeLogger(),
      metrics
    );

    const fn = jest.fn().mockRejectedValue(new Error("transient"));

    await expect(policy.execute("db-write", fn, () => true)).rejects.toThrow();

    expect(metrics.incrementCounter).toHaveBeenCalledWith("retry_attempts_total", {
      operation: "db-write",
    });
    expect(metrics.incrementCounter).toHaveBeenCalledWith("retry_exhausted_total", {
      operation: "db-write",
    });
  });
});
