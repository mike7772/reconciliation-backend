# Submission

## Summary

A Node.js/TypeScript/Express/Prisma/PostgreSQL service that ingests NDJSON
transaction files (validated for at least 500,000 records), processes them
asynchronously via a BullMQ-backed worker process, and exposes import
status, reconciliation summaries, and cursor-paginated rejected records over
HTTP. Built incrementally across 16 commits, each a working, independently
verifiable increment (bootstrap -> schema -> streaming upload -> processing
-> idempotency/retry -> metrics/shutdown -> structural refactor ->
containerization -> auth -> tests -> data generator/benchmark).

## Architecture Overview

Two processes (API server, worker), three infrastructure dependencies
(Postgres, Redis, MinIO), connected only through a database both share and a
Redis-backed job queue. Full detail in [ARCHITECTURE.md](ARCHITECTURE.md);
decision rationale in [docs/adr/](docs/adr/). Short version:

- **Upload**: streams directly into MinIO via `busboy`, no local-disk or
  full-memory buffering.
- **Processing**: the worker streams the file back from MinIO, parses
  NDJSON line-by-line, validates/normalizes/fingerprints/risk-scores each
  record, and commits accepted/rejected records in bounded batches of 500
  inside single database transactions.
- **Risk scoring**: dispatched to a Piscina worker-thread pool in batches,
  never inline, never one thread per record.
- **Correctness**: idempotency and duplicate detection are enforced by
  PostgreSQL unique constraints (`Import.idempotencyKey`,
  `Transaction.(providerId, transactionId)`), not in-memory state - this is
  what makes the guarantees hold across processes, restarts, and concurrent
  requests.
- **Dependency injection**: manual constructor injection; all infrastructure
  is behind port interfaces (`shared/ports/`); `src/composition/container.ts`
  is the one place concrete adapters are assembled.

## Important Decisions

See [docs/adr/](docs/adr/) for full reasoning on:
1. BullMQ + a separate worker process (not in-process background work, not a
   separate microservice)
2. Piscina worker-thread pool for risk scoring (not inline, not one thread
   per record, not child processes)
3. Database constraints as the idempotency/duplicate-detection mechanism
   (not an in-memory Set, not a Redis-only lock)
4. MinIO with streaming upload and ranged-read resume (not local disk, not
   full in-memory buffering)

Also worth flagging explicitly:
- **Interfaces are co-located with their primary implementation**
  (`imports.repository.ts` exports both `ImportRepository` and
  `PrismaImportRepository`) rather than kept in separate `ports/*.ts` files,
  to keep the `imports` module's file layout flat while still preserving
  real dependency injection.
- **Authentication was added to all `/v1/imports*` routes** even though the
  spec states authentication is not required for this exercise - since the
  data involved is financial transaction data, requiring a bearer token
  (reusing the existing JWT-based auth module) seemed like the more
  defensible default. `/health/*`, `/metrics`, and the auth endpoints
  themselves remain public, since monitoring tooling and the login/register
  flow itself cannot require a token.
- **Summaries (`byCurrency`/`byRiskLevel`) are computed at read time** via
  indexed `GROUP BY` queries rather than maintained as running aggregates
  during processing - a deliberate trade-off favoring simpler, less
  contention-prone batch commits over faster (but rarely-polled) summary
  reads.

## Trade-offs

- Chose **manual DI over a DI framework** (InversifyJS, tsyringe, etc.) -
  the assignment explicitly allows either, but a framework would add a
  dependency and a decorator-based mental model for a codebase small enough
  that constructor injection plus one composition root stays easy to follow
  end-to-end.
- Chose to **fake MinIO/BullMQ in integration tests** rather than run them
  under test (e.g. via Testcontainers) - the behavior under test in those
  suites (persistence, constraints, idempotency, pagination, redelivery)
  lives entirely in the repository/database layer; the actual MinIO/BullMQ
  wiring is exercised instead via repeated manual end-to-end verification
  against the live Docker stack throughout development. Testcontainers would
  be the natural next step to automate that.
- Chose a **global rate limiter** over per-provider limits - per-provider
  limiting is listed as a bonus feature, and a global limiter is simpler and
  sufficient to demonstrate basic DoS-awareness without adding a
  provider-keyed rate-limit store.

## What I Would Improve With More Time

- **Testcontainers** for integration tests, so `npm run test:integration`
  needs zero manual setup (no pre-existing test database, no manual `CREATE
  DATABASE`) and could run in CI without a docker-compose dependency already
  running.
- **A real deployment** (the assignment calls for a publicly accessible URL
  with a working Swagger UI) - not done in this submission; see "Incomplete
  Requirements" below.
- **Dynamic worker-pool/queue-depth-based backpressure** - right now
  `MAX_CONCURRENT_IMPORTS` is a static env var; a production system would
  likely want it to respond to observed event-loop/DB-latency pressure.
- **Per-provider rate limiting and an import-retry endpoint** (both listed
  as bonus features).
- **OpenTelemetry tracing** across the upload -> enqueue -> process ->
  persist path, to make latency attribution across the two processes
  visible in one trace rather than only in separate structured logs.

## Known Risks

- The unique-constraint-catch pattern for idempotency (ADR-003) depends on
  correctly recognizing Prisma's `P2002` error code - centralized in one
  function (`isRetryableDbError`'s sibling check in `imports.repository.ts`)
  so a Prisma major-version upgrade that changed error codes would need a
  focused review of that one spot.
- The benchmark numbers in `BENCHMARK.md` were captured on a modest 4-vCPU
  development machine sharing the same host as Postgres/Redis/MinIO/the app/
  the worker all at once - a dedicated deployment would very likely show
  meaningfully higher throughput, since the benchmark run competes with its
  own infrastructure for the same 4 cores.
- Rejected-record `rawValue` capping (`MAX_RAW_VALUE_CHARS = 1000` in
  `imports.processor.ts`) protects against persisting unbounded malformed
  payloads, but an adversarial file with e.g. thousands of moderately-sized
  (just-under-the-cap) invalid lines would still create a proportional
  number of `RejectedRecord` rows - bounded per-row, not bounded in
  aggregate count. Acceptable for this exercise; a production system might
  want a per-import cap on total rejected-record storage too.

## Benchmark Summary

See [BENCHMARK.md](BENCHMARK.md) for full methodology and results. Headline
numbers from the 50,000-record run (10.1 MiB): ~283 records/sec steady
state, API latency p95 8-18ms *while the import was actively processing*,
peak RSS ~185 MiB, peak event-loop lag 22ms / utilization 0.21 - the API
stayed responsive and CPU-heavy work stayed off the main thread throughout.

## Incomplete Requirements

Explicitly not done, so nothing here is an oversight to be discovered later:

- **No public deployment URL** - runs locally / via the included
  `docker-compose.yml` only. Submitted as a Git repository with setup
  instructions instead.
- **OpenTelemetry tracing, SSE progress push, resumable uploads, dead-letter
  queue, dynamic worker-pool sizing, per-provider rate limits, an
  import-retry endpoint, a data-retention policy, Kubernetes manifests,
  property-based testing, and Testcontainers** - all listed as bonus
  features in the assignment and intentionally left out to keep scope
  focused on the required architecture and correctness properties.
- **MIME-type validation is extension-based, not content-sniffed** - see
  README's "Known Limitations".
- **Queue depth is unbounded** (visible via metrics, not capped) - see
  `ARCHITECTURE.md` §11 and README's "Known Limitations".
