/**
 * Repeatable load/benchmark script. Uploads a generated NDJSON file to a
 * running instance of the app (docker-compose stack by default), then:
 *  - keeps polling a lightweight endpoint throughout processing to prove
 *    the API stays responsive while a large import runs
 *  - samples both the app's and the worker's /metrics endpoints to capture
 *    peak memory/event-loop behavior during the run
 *  - reports total duration, throughput, and API latency percentiles
 *
 * Usage:
 *   npm run generate:data -- --records=500000
 *   npm run benchmark -- --file=test/fixtures/generated.ndjson
 */
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";

const BASE_URL = process.env.BENCHMARK_BASE_URL || "http://localhost:4000";
const WORKER_METRICS_URL = process.env.WORKER_METRICS_URL || "http://localhost:9465/metrics";
const POLL_INTERVAL_MS = 300;
const METRICS_SAMPLE_INTERVAL_MS = 1000;

function parseArgs(): { file: string } {
  const args = process.argv.slice(2);
  const prefix = "--file=";
  const found = args.find((a) => a.startsWith(prefix));
  return {
    file: found ? found.slice(prefix.length) : path.join(__dirname, "..", "fixtures", "generated.ndjson"),
  };
}

interface LatencySample {
  atMs: number;
  endpoint: string;
  durationMs: number;
  status: number;
}

interface MetricsSample {
  atMs: number;
  residentMemoryBytes: number | null;
  heapUsedBytes: number | null;
  eventLoopLagSeconds: number | null;
  eventLoopUtilization: number | null;
}

function parsePromMetric(text: string, name: string): number | null {
  const match = text.match(new RegExp(`^${name}(?:\\{[^}]*\\})? (.+)$`, "m"));
  return match ? Number(match[1]) : null;
}

async function sampleMetrics(url: string): Promise<MetricsSample> {
  const atMs = Date.now();
  try {
    const res = await fetch(url);
    const text = await res.text();
    return {
      atMs,
      residentMemoryBytes: parsePromMetric(text, "process_resident_memory_bytes"),
      heapUsedBytes: parsePromMetric(text, "nodejs_heap_size_used_bytes"),
      eventLoopLagSeconds: parsePromMetric(text, "nodejs_eventloop_lag_seconds"),
      eventLoopUtilization: parsePromMetric(text, "nodejs_eventloop_utilization"),
    };
  } catch {
    return { atMs, residentMemoryBytes: null, heapUsedBytes: null, eventLoopLagSeconds: null, eventLoopUtilization: null };
  }
}

async function timedFetch(endpoint: string, init?: RequestInit): Promise<{ status: number; body: any; durationMs: number }> {
  const start = performance.now();
  const res = await fetch(`${BASE_URL}${endpoint}`, init);
  const durationMs = performance.now() - start;
  const body = await res.json().catch(() => null);
  return { status: res.status, body, durationMs };
}

async function registerAndLogin(): Promise<string> {
  const email = `benchmark-${randomUUID()}@example.com`;
  const password = "password123";
  await timedFetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Benchmark", email, password }),
  });
  const login = await timedFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return login.body.data.token as string;
}

/** Streams the file directly into the multipart request body - the file is
 *  never buffered in memory client-side, matching the server-side streaming
 *  requirement this benchmark is exercising. */
function uploadFile(
  filePath: string,
  providerId: string,
  idempotencyKey: string,
  token: string
): Promise<{ status: number; body: any; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const boundary = `----benchmark${randomUUID()}`;
    const url = new URL(`${BASE_URL}/v1/imports`);
    const filename = path.basename(filePath);

    const preamble =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="providerId"\r\n\r\n${providerId}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`;
    const epilogue = `\r\n--${boundary}--\r\n`;

    const fileSize = fs.statSync(filePath).size;
    const contentLength = Buffer.byteLength(preamble) + fileSize + Buffer.byteLength(epilogue);

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": contentLength,
          "Idempotency-Key": idempotencyKey,
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode || 0, body: JSON.parse(raw), durationMs: 0 });
        });
      }
    );
    req.on("error", reject);

    const start = performance.now();
    req.write(preamble);
    const fileStream = fs.createReadStream(filePath);
    fileStream.on("error", reject);
    fileStream.pipe(req, { end: false });
    fileStream.on("end", () => {
      req.end(epilogue);
    });
    req.on("close", () => {
      // durationMs is filled in by the caller from wall-clock timing instead,
      // since 'close' fires after 'end' resolves the promise above.
      void start;
    });
  });
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

async function main(): Promise<void> {
  const { file } = parseArgs();
  if (!fs.existsSync(file)) {
    console.error(`Fixture not found: ${file}`);
    console.error(`Run: npm run generate:data -- --records=500000`);
    process.exit(1);
  }

  const fileSizeBytes = fs.statSync(file).size;
  const providerId = `benchmark-provider-${Date.now()}`;
  const idempotencyKey = `benchmark-${Date.now()}`;

  console.log(`Registering benchmark user and authenticating...`);
  const token = await registerAndLogin();

  const latencySamples: LatencySample[] = [];
  const metricsSamples: MetricsSample[] = [];
  let stopSampling = false;

  const samplingLoop = (async () => {
    while (!stopSampling) {
      const health = await timedFetch("/health/live");
      latencySamples.push({
        atMs: Date.now(),
        endpoint: "GET /health/live",
        durationMs: health.durationMs,
        status: health.status,
      });

      const [appMetrics, workerMetrics] = await Promise.all([
        sampleMetrics(`${BASE_URL}/metrics`),
        sampleMetrics(WORKER_METRICS_URL),
      ]);
      metricsSamples.push(appMetrics, workerMetrics);

      await new Promise((r) => setTimeout(r, METRICS_SAMPLE_INTERVAL_MS));
    }
  })();

  console.log(`Uploading ${file} (${(fileSizeBytes / 1024 / 1024).toFixed(1)} MiB)...`);
  const uploadStart = performance.now();
  const uploadResult = await uploadFile(file, providerId, idempotencyKey, token);
  const uploadDurationMs = performance.now() - uploadStart;
  console.log(`Upload accepted in ${uploadDurationMs.toFixed(0)}ms:`, uploadResult.body);

  if (uploadResult.status !== 202) {
    stopSampling = true;
    await samplingLoop;
    throw new Error(`Expected 202, got ${uploadResult.status}: ${JSON.stringify(uploadResult.body)}`);
  }

  const importId = uploadResult.body.id as string;
  console.log(`Polling GET /v1/imports/${importId} until terminal status...`);

  const processingStart = performance.now();
  let finalStatus: any = null;
  for (;;) {
    const poll = await timedFetch(`/v1/imports/${importId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    latencySamples.push({
      atMs: Date.now(),
      endpoint: "GET /v1/imports/:id",
      durationMs: poll.durationMs,
      status: poll.status,
    });

    if (poll.body.status === "completed" || poll.body.status === "failed") {
      finalStatus = poll.body;
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  const processingDurationMs = performance.now() - processingStart;

  stopSampling = true;
  await samplingLoop;

  const healthLatencies = latencySamples.filter((s) => s.endpoint === "GET /health/live").map((s) => s.durationMs);
  const statusLatencies = latencySamples.filter((s) => s.endpoint === "GET /v1/imports/:id").map((s) => s.durationMs);

  const memSamples = metricsSamples.map((s) => s.residentMemoryBytes).filter((v): v is number => v !== null);
  const heapSamples = metricsSamples.map((s) => s.heapUsedBytes).filter((v): v is number => v !== null);
  const lagSamples = metricsSamples.map((s) => s.eventLoopLagSeconds).filter((v): v is number => v !== null);
  const utilSamples = metricsSamples.map((s) => s.eventLoopUtilization).filter((v): v is number => v !== null);

  const processed = finalStatus?.progress?.processed ?? 0;
  const throughput = processed / (processingDurationMs / 1000);

  const summary = {
    dataset: {
      file,
      fileSizeMiB: Number((fileSizeBytes / 1024 / 1024).toFixed(2)),
      recordsProcessed: processed,
      accepted: finalStatus?.progress?.accepted ?? 0,
      rejected: finalStatus?.progress?.rejected ?? 0,
      duplicates: finalStatus?.progress?.duplicates ?? 0,
    },
    timing: {
      uploadResponseMs: Number(uploadDurationMs.toFixed(1)),
      processingDurationMs: Number(processingDurationMs.toFixed(1)),
      processingDurationSeconds: Number((processingDurationMs / 1000).toFixed(2)),
      recordsPerSecond: Number(throughput.toFixed(1)),
    },
    apiLatencyDuringProcessing: {
      healthLiveMs: {
        count: healthLatencies.length,
        p50: Number(percentile(healthLatencies, 50).toFixed(2)),
        p95: Number(percentile(healthLatencies, 95).toFixed(2)),
        p99: Number(percentile(healthLatencies, 99).toFixed(2)),
        max: Number((Math.max(0, ...healthLatencies)).toFixed(2)),
      },
      importStatusMs: {
        count: statusLatencies.length,
        p50: Number(percentile(statusLatencies, 50).toFixed(2)),
        p95: Number(percentile(statusLatencies, 95).toFixed(2)),
        p99: Number(percentile(statusLatencies, 99).toFixed(2)),
        max: Number((Math.max(0, ...statusLatencies)).toFixed(2)),
      },
    },
    resourceUsageDuringProcessing: {
      peakResidentMemoryMiB: memSamples.length ? Number((Math.max(...memSamples) / 1024 / 1024).toFixed(1)) : null,
      peakHeapUsedMiB: heapSamples.length ? Number((Math.max(...heapSamples) / 1024 / 1024).toFixed(1)) : null,
      peakEventLoopLagMs: lagSamples.length ? Number((Math.max(...lagSamples) * 1000).toFixed(2)) : null,
      peakEventLoopUtilization: utilSamples.length ? Number(Math.max(...utilSamples).toFixed(4)) : null,
      sampleCount: metricsSamples.length,
    },
    configuration: {
      workerConcurrency: Number(process.env.MAX_CONCURRENT_IMPORTS) || 2,
      dbBatchSize: 500,
      note: "dbBatchSize is the BATCH_SIZE constant in imports.processor.ts, not independently configurable via env",
    },
    machine: {
      platform: os.platform(),
      arch: os.arch(),
      cpuModel: os.cpus()[0]?.model ?? "unknown",
      cpuCount: os.cpus().length,
      totalMemoryGiB: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(1)),
    },
  };

  const outPath = path.join(__dirname, "..", "..", "BENCHMARK_RESULTS.json");
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

  console.log("\n=== Benchmark summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWritten to ${outPath}`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
