# ADR-003: Database Constraints as the Duplicate/Idempotency Source of Truth

## Status
Accepted

## Context
Two distinct correctness requirements need to hold under concurrency, across
process restarts, and across separate import files:
1. Repeating `POST /v1/imports` with the same `Idempotency-Key` must not
   create a second import.
2. The same `transactionId` from the same provider, appearing twice (within
   one file, across separate files, or resubmitted after a crash/retry) must
   be counted as a duplicate, not accepted twice.

An in-memory `Set` (of idempotency keys, or of seen transaction IDs) was
explicitly disallowed by the spec and would fail regardless: it doesn't
survive a process restart, doesn't work across the API and worker processes
(different processes, different memory), and doesn't resolve races between
two concurrent requests hitting different in-memory state.

## Decision
Both guarantees are enforced with PostgreSQL unique constraints, checked by
attempting the write and translating a constraint violation into the correct
business outcome, rather than checking-then-writing (which would itself be a
race):

- `Import.idempotencyKey UNIQUE` - `createPendingImport` inserts and catches
  Prisma error `P2002`, returning `null` to signal "someone else already
  holds this key"; the caller (`ImportService.createImport`) then looks the
  existing row up and returns it instead of failing the request.
- `Transaction.(providerId, transactionId) UNIQUE` - `commitBatch` inserts
  accepted transactions via `createMany({ skipDuplicates: true })`
  (`ON CONFLICT DO NOTHING`), and reports `acceptedCount` vs.
  `duplicateCount` from the actual insert result, not from a pre-check.

A resubmission of the same `transactionId` with *different* field values is
explicitly first-write-wins: the second submission is skipped by the
constraint and counted as a duplicate; its differing values are never
applied. This is documented rather than silently assumed, since the spec
leaves the exact behavior as an implementation decision.

## Consequences
- **Positive**: correctness holds regardless of which process, which
  request, or which retry attempt gets there first - the database is the
  single arbiter, not application-level coordination.
- **Positive**: combined with the checkpoint guard in `commitBatch` (see
  `ARCHITECTURE.md` §5), this also makes BullMQ job redelivery safe for free -
  redelivery is just another kind of "the same write happening twice."
- **Negative**: relies on catching and correctly classifying a specific
  Prisma error code (`P2002`) - if Prisma's error taxonomy changed
  incompatibly, this would need updating (mitigated: `isRetryableDbError`/
  `UNIQUE_CONSTRAINT_VIOLATION` are centralized in one file,
  `imports.repository.ts`).
- **Negative**: `skipDuplicates` silently drops conflicting rows rather than
  reporting per-row *why* a specific transaction was a duplicate versus
  accepted - acceptable here because the aggregate `duplicateCount` is what
  the spec's summary/progress model requires, not a rejected-record-style
  per-row reason.

## Alternatives Rejected
- **In-memory Set** - rejected per the spec itself and for the reasons above
  (doesn't survive restarts, doesn't work across processes).
- **Redis-based distributed lock/set** (e.g. `SETNX` on an idempotency key)
  was considered as a lighter-weight alternative to a DB constraint, but
  rejected: it would introduce a second source of truth that could drift
  from Postgres (e.g. a key expiring in Redis while the Postgres row still
  exists), and Postgres already has to be consulted anyway to create/read the
  `Import` row - a unique index there is strictly simpler and has one fewer
  moving part than keeping Redis and Postgres in sync.
- **Application-level "check then insert"** (`SELECT` for an existing key/
  transaction, then `INSERT` if absent) was rejected because it's a
  textbook TOCTOU race under concurrent requests - exactly the "concurrent
  requests using the same key must not create duplicate imports" scenario
  the spec calls out. Attempt-the-write-and-catch-the-conflict is the only
  approach that's actually race-free without external locking.
