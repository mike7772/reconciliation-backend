# Reconciliation Backend

A production-oriented Node.js service that imports large NDJSON transaction
files, processes them asynchronously (streaming parse -> validate ->
normalize -> fingerprint -> risk score -> persist), and exposes the results
through an HTTP API - without blocking on the import itself and without
loading the file into memory.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it's built, [docs/adr/](docs/adr/)
for the reasoning behind the key decisions, [BENCHMARK.md](BENCHMARK.md) for
performance results, and [SUBMISSION.md](SUBMISSION.md) for a summary of
trade-offs and known gaps.

## Requirements

- Node.js 22+
- Docker + Docker Compose (`docker-compose` v1 binary or the `docker compose`
  v2 plugin - both work with the commands below)

## Running Everything with Docker Compose

This is the fastest path to a fully working system - Postgres, Redis, MinIO,
the API server, and the worker all start together:

```bash
docker compose up --build
# or, if you only have the standalone v1 binary:
docker-compose up --build
```

This runs database migrations automatically on startup (`prisma migrate
deploy`, in both the `app` and `worker` containers - safe to run twice). Once
up:

- API: http://localhost:4000
- Swagger/OpenAPI UI: http://localhost:4000/api-docs
- BullMQ dashboard: http://localhost:4000/admin/queues (`admin`/`password` by
  default - HTTP Basic Auth, not the JWT bearer scheme, since this is a
  browser-navigated page)
- Worker metrics: http://localhost:9465/metrics
- MinIO console: http://localhost:9011 (`minioadmin`/`minioadmin` by default)

## Running Locally (without Docker for the app itself)

Bring up just the infrastructure, then run the app/worker directly:

```bash
docker compose up -d postgres redis minio minio-init
cp .env.example .env   # adjust values if needed
npm install
npx prisma migrate deploy
npm run dev             # runs tsc --watch, the API server, and the worker together
```

Or run each process independently:

```bash
npm run serve           # API server only (nodemon server.ts)
npm run serve:worker    # worker only (nodemon worker.ts)
```

## Authentication

`POST /api/auth/register` and `POST /api/auth/login` are public (they issue
the credentials). Every `/v1/imports*` endpoint requires a bearer token:

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane","email":"jane@example.com","password":"password123"}'

TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@example.com","password":"password123"}' | jq -r .data.token)

curl http://localhost:4000/v1/imports/some-id -H "Authorization: Bearer $TOKEN"
```

`/health/live`, `/health/ready`, and `/metrics` stay unauthenticated -
monitoring tools and load balancers need to reach them without credentials.

## Running Migrations

```bash
npx prisma migrate deploy   # applies existing migrations (used by Docker)
npm run migrate:dev         # creates + applies a new migration during development
```

## Generating Test Data

```bash
npm run generate:data -- --records=500000
# writes to test/fixtures/generated.ndjson by default
# --out=<path> and --provider=<id> are also accepted
```

The generated file has a fixed, documented mix so every rejection path is
exercised at scale: ~1% invalid JSON, ~1% missing a required field, ~1%
unsupported currency, ~0.5% in-file duplicate `transactionId`s, and one
oversized description per 1,000 lines.

## Running Tests

```bash
npm run test:unit          # 43 tests, no external dependencies (fakes only)
npm run test:integration   # 15 tests, requires Postgres reachable (e.g. docker compose up -d postgres)
npm run test:all           # both together
```

Integration tests point at a separate database (`reconciliation_system_test`,
same Postgres instance) so they never touch development data, and clean up
their own rows between tests. **No manual database preparation is
required**: `test:integration` and `test:all` each run a `pretest` script
(`test/setupTestDb.ts`) automatically first, which creates the test database
if it doesn't exist yet and applies migrations - safe to run every time,
whether it's the first run ever or the hundredth. The only prerequisite is
that Postgres itself is reachable (`docker compose up -d postgres`, or the
full stack).

## Running the Benchmark

Requires the app + worker to be running (Docker Compose or locally) and a
generated fixture:

```bash
npm run generate:data -- --records=500000
npm run benchmark -- --file=test/fixtures/generated.ndjson
```

This uploads the file via a real streaming multipart request, polls status
until the import finishes, and throughout the run samples `GET /health/live`
plus both the app's and worker's `/metrics` to measure API latency, memory,
and event-loop behavior *while an import is actively processing*. Results
are printed and written to `BENCHMARK_RESULTS.json`. See
[BENCHMARK.md](BENCHMARK.md) for interpreted results.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API server port |
| `NODE_ENV` | `dev` | Affects rate-limit config, and selects the object-storage backend: MinIO unless set to `production`, in which case Cloudflare R2 is used (see `src/config/objectStorage.ts`) |
| `RATE_LIMIT_TIME` / `RATE_LIMIT_REQUEST` | `100` / `100` | Global rate limiter window/max |
| `MAX_UPLOAD_BYTES` | `2147483648` (2 GiB) | Hard cap on uploaded file size |
| `MAX_CONCURRENT_IMPORTS` | `2` | BullMQ worker concurrency (bounded parallel imports) |
| `DB_RETRY_MAX_ATTEMPTS` | `4` | Retry attempts for transient DB errors during batch commits |
| `DB_RETRY_BASE_DELAY_MS` / `DB_RETRY_MAX_DELAY_MS` | `100` / `2000` | Exponential backoff bounds |
| `WORKER_METRICS_PORT` | `9465` | Worker's own Prometheus port (separate process/registry) |
| `SHUTDOWN_GRACE_PERIOD_MS` | `30000` | Max time graceful shutdown waits before forcing exit |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | - / `1d` | Auth token signing |
| `ADMIN_DASHBOARD_USER` / `ADMIN_DASHBOARD_PASSWORD` | `admin` / `password` | HTTP Basic Auth credentials for the BullMQ dashboard (`/admin/queues`) |
| `DATABASE_URL` | - | Postgres connection string |
| `REDIS_URL` | - | Redis connection string (used by both the cache client and BullMQ) |
| `MINIO_ENDPOINT` / `MINIO_PORT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `MINIO_BUCKET` / `MINIO_USE_SSL` | see `.env.example` | MinIO connection (used when `NODE_ENV` is not `production`) |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_PUBLIC_URL` | - | Cloudflare R2 connection (used when `NODE_ENV=production` - see `src/config/objectStorage.ts`) |

Full defaults: [.env.example](.env.example). Docker Compose overrides
`DATABASE_URL`/`REDIS_URL`/`MINIO_ENDPOINT`/`MINIO_PORT` to point at
container DNS names (`postgres`, `redis`, `minio`) rather than `localhost`.

## Deploying to Render

`render.yaml` is a Render Blueprint defining one Web Service
(`reconciliation-app`) plus managed Postgres and Redis:

```bash
render blueprint launch
# or: connect this repo in the Render dashboard - it auto-detects render.yaml
```

**Deployment-environment trade-off**: the API server and worker run as
**one Render service**, both started by `render-start.sh` (via
`concurrently`), rather than as two separate services like locally
(`docker-compose.yml` still runs them as two separate containers, matching
`ARCHITECTURE.md`'s documented design). This is purely to fit a single
free-tier Render service instead of requiring a paid Background Worker
plan - not a reversal of the architecture itself. Consequences worth
knowing:
- A crash/restart takes both processes down together - they no longer
  fail independently, unlike the local/documented design.
- The worker's own `:9465/metrics` is not reachable from outside the
  container (Render only routes external traffic to one port per Web
  Service) - only the app's `/metrics` is externally visible.
- If a paid plan becomes available, splitting this back into two services
  restores full process isolation - see git history for the prior
  two-service version of `render.yaml`.

`render.yaml`'s `dockerCommand` deliberately stays as the two simplest
possible tokens (`sh render-start.sh`) rather than an inline multi-command
string: Render's `dockerCommand` field is not run through a shell and does
its own naive tokenizing, so anything with `&&` or nested quotes gets
mangled. All the actual command logic lives inside `render-start.sh`,
interpreted by a real shell inside the container.

Object storage switches automatically based on `NODE_ENV`
(`src/config/objectStorage.ts`) - the blueprint sets `NODE_ENV=production`,
so Render uses Cloudflare R2. Locally, `docker compose up` keeps
`NODE_ENV=dev` and keeps using the local MinIO container - no manual
switching required either way.

Render has no native S3-compatible storage product, so R2 (not a
self-hosted MinIO on Render, which would need a paid persistent disk) is
the object-storage backend for the deployed environment. Before the first
deploy:

1. Create a bucket in the Cloudflare R2 dashboard and generate an API
   token (Account ID, Access Key ID, Secret Access Key).
2. After the blueprint creates the service, fill in `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_PUBLIC_URL` in the
   Render dashboard - they're deliberately marked `sync: false` in
   `render.yaml` so real credentials never get committed.

`JWT_SECRET` and `ADMIN_DASHBOARD_PASSWORD` are auto-generated by Render
(`generateValue: true`) rather than hardcoded - retrieve the generated
`ADMIN_DASHBOARD_PASSWORD` from the dashboard if you need to reach
`/admin/queues` on the deployed instance.

## Known Limitations

- **No live public deployment at the time of writing** - `render.yaml`
  and the R2-backed production storage path are in place and verified
  (see `docs/adr/004-file-storage-strategy.md`), but actually running
  `render blueprint launch` against a real Render account is a step the
  repository owner needs to take themselves.
- **MIME-type validation is extension-based** (`.ndjson`/`.jsonl`), not
  content-sniffed - there's no reliable magic-byte signature for NDJSON to
  sniff against, so the client-declared MIME type is stored but not enforced
  beyond the extension check.
- **Rate limiting is global**, not per-provider (per-provider limits are
  listed as a bonus feature in the spec, not a requirement).
- **No SSE/WebSocket progress push, OpenTelemetry tracing, dead-letter
  queue, or resumable client uploads** - all listed as bonus features and
  intentionally out of scope for this submission.
- **Queue depth is not actively capped** - a very fast burst of upload
  requests would grow the BullMQ waiting queue rather than being rejected
  with `429`; it's visible via the `import_queue_waiting` metric but not
  bounded. Documented as a deliberate simplicity trade-off rather than an
  oversight - see `ARCHITECTURE.md` §11.
- **`byCurrency`/`byRiskLevel` summaries are computed at read time** via
  `GROUP BY` queries rather than maintained as running aggregates during
  processing - see `ARCHITECTURE.md` §4 for the reasoning.
- **The 500,000-record benchmark run's exact numbers depend on the machine
  it's run on** (this was developed and benchmarked on a 4-vCPU / ~3.8 GiB
  RAM environment) - see `BENCHMARK.md`.
