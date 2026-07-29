# ADR-001: Job Execution Model - BullMQ with a Separate Worker Process

## Status
Accepted

## Context
Importing a file with hundreds of thousands of records cannot run inline
within the HTTP request that uploads it - the spec requires the API to
return before processing completes, and requires the API to stay responsive
while an import runs. Something has to durably hand off "process this
import" from the API process to somewhere else, survive an API restart, and
recover if the somewhere-else crashes mid-file.

Options considered:
1. **In-process background processing** (e.g. `setImmediate`/a promise queue
   inside the API process, no separate worker).
2. **BullMQ (Redis-backed queue) with a separate worker process.**
3. **A full separate microservice** with its own API, reached over HTTP/gRPC.

## Decision
Use BullMQ with a dedicated worker process (`worker.ts`), sharing the same
codebase and Postgres database as the API server, communicating only via a
Redis-backed job queue.

Postgres remains the authoritative source of truth for import status,
progress, and counters - not BullMQ. BullMQ's job payload is just
`{ importId }`; every other piece of state the API reads (`GET /v1/imports/:id`,
`/summary`, `/rejections`) comes from Postgres, never from queue introspection.
BullMQ's own stalled-job detection (configurable lock duration) handles "the
worker died mid-job" recovery by redelivering the job; the combination of
checkpointing and idempotent batch commits (see ADR-003 and
`ARCHITECTURE.md` §5) makes that redelivery safe.

Two separate Redis client libraries are used deliberately: `ioredis` for
BullMQ (which requires it) and the `redis` package for the app's own
lightweight caching needs, kept as genuinely separate connections rather than
forcing one library to serve both roles.

## Consequences
- **Positive**: a crashed API process doesn't lose in-flight imports (the job
  already sits durably in Redis); a crashed worker gets its job redelivered
  automatically; the API stays responsive because request handling and batch
  processing are different Node.js processes entirely, not just different
  async tasks sharing one event loop.
- **Positive**: horizontal scaling is straightforward - more worker replicas
  each pull from the same queue with bounded concurrency each.
- **Negative**: introduces Redis as a required dependency (mitigated: it was
  already optional-but-useful infrastructure per the assignment, and the
  `docker-compose.yml` brings it up automatically).
- **Negative**: two processes to operate and monitor instead of one - offset
  by giving the worker its own `/metrics` port so it's independently
  observable.

## Alternatives Rejected
- **In-process background processing** was rejected because it doesn't
  survive an API process restart or crash - an in-flight import would simply
  vanish, with no durable record that it needs to resume, violating the "job
  state must not remain permanently locked" and "recover safely from
  failures" requirements.
- **A full separate microservice** was rejected as disproportionate: it would
  duplicate the Prisma schema/repository layer across two codebases (or
  require a network API between them) for no benefit at this scale - the
  worker and API already need to agree on the same database schema, so
  sharing one codebase and repository layer, split only at the process
  boundary, is simpler and has one fewer thing that can drift out of sync.

## Deployment-Environment Note (not a reversal of this decision)

On the free-tier Render deployment specifically (see `render.yaml` and
README's "Deploying to Render"), the API server and worker run as **one**
Render service via `render-start.sh` (`concurrently`), rather than as the
two separate services this ADR describes - purely to avoid requiring a
paid Background Worker plan. Locally (`docker-compose.yml`) and in the
architecture this ADR documents, they remain two independent processes.
The trade-off is explicit and reversible: on that single Render service, a
crash takes both processes down together instead of failing independently,
and the worker's `/metrics` isn't externally reachable - both are
documented, not silent, limitations of that one deployment target.
