# ADR-002: Piscina Worker-Thread Pool for Risk Scoring

## Status
Accepted

## Context
Risk scoring is deliberately CPU-intensive (500 chained SHA-256 hashes per
transaction, simulating real fraud-scoring work) and must run for every
accepted transaction - up to 500,000+ per import. Run synchronously on the
worker process's main thread, this would stall that process's own event loop
(job pickup, progress logging, its `/metrics` endpoint) for the entire
duration of the import.

Options considered:
1. **Run inline** on the main thread.
2. **One `worker_threads` thread per transaction** (or per HTTP request).
3. **A fixed-size, reusable worker-thread pool** (Piscina), fed in bounded
   batches.
4. **A separate OS process** (e.g. spawned via `child_process`) instead of
   threads.

## Decision
Use Piscina, a reusable `worker_threads` pool, sized once at startup and fed
via `scoreBatch(inputs: RiskScoreInput[])` - one Piscina task per batch of up
to 500 transactions (the same batch that gets committed to the database
together), not one task per transaction.

`shared/ports/RiskScorer.ts` defines the port (`scoreBatch`); `shared/adapters/
PiscinaRiskScorer.ts` is the concrete adapter, and `shared/adapters/
riskScoreWorker.ts` is the actual code that runs inside each pool thread,
calling the pure `calculateRiskScore`/`riskLevelFor` functions from
`shared/utils/riskScore.ts`.

## Consequences
- **Positive**: the worker process's own event loop stays responsive
  throughout processing - confirmed in `BENCHMARK.md` (event-loop lag stayed
  under 25ms, utilization under 0.25, at 50,000 records).
- **Positive**: batching amortizes Piscina's per-task
  scheduling/serialization overhead across many records (~2x throughput
  versus one task per transaction, per the comment in `RiskScorer.ts`),
  while still bounding how many records are "in flight" in the pool at once
  to one batch's worth.
- **Negative**: worker threads share the process's memory budget - a very
  large batch size would raise peak RSS. Mitigated by keeping the batch size
  at 500 (same constant used for DB commits), not scaling it with file size.
- **Negative**: Piscina adds a dependency and a small fixed startup cost
  (thread pool creation) - negligible relative to processing a
  500,000-record file.

## Alternatives Rejected
- **Inline execution** was rejected outright - it directly violates "the
  scoring implementation must not significantly block the HTTP server's [or
  worker's] event loop."
- **One thread per transaction** was explicitly disallowed by the spec ("do
  not create one worker thread for every transaction or HTTP request") and
  would be prohibitively expensive - `worker_threads` have real creation/
  teardown cost, and 500,000 short-lived threads would spend more time on
  scheduling overhead than actual scoring.
- **A separate OS process (child_process)** was rejected as heavier than
  necessary here: `worker_threads` share the process's V8 isolate
  infrastructure more cheaply than spawning OS processes, and Piscina already
  provides pool management (queueing, backpressure, graceful pool shutdown
  via `close()`) that would otherwise need to be hand-rolled for a
  process-based pool.
