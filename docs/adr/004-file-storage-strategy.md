# ADR-004: MinIO with Direct Streaming Upload and Ranged-Read Resume

## Status
Accepted

## Context
Uploaded files may contain 500,000+ records and must never be fully buffered
in memory or on local disk as a single blob, per the spec. The chosen
storage layer also needs to support resuming processing from a byte offset
after a crash, without re-reading (and re-processing) already-committed
bytes.

Options considered:
1. **Local disk** (write the upload to a temp file, process from there).
2. **Buffer fully in memory** as a single Buffer/string.
3. **S3-compatible object storage (MinIO)**, streamed in both directions.

## Decision
Stream the upload directly into MinIO using `busboy` (true streaming
multipart parsing, no local-disk hop) and `putObject` with the live request
stream - the file is never fully materialized anywhere in the API process.
The worker reads it back via MinIO's ranged GET (`getPartialObject`), passing
the persisted `checkpointOffset` as the start of the range when resuming
after a crash or restart.

`shared/ports/FileStorage.ts` defines the port (`store`/`read`);
`shared/adapters/MinioFileStorage.ts` is the concrete adapter. The storage
key is server-generated (`imports/{importId}/{uuid}.ndjson`), never derived
from the client-supplied filename - this also closes off path-traversal via
a malicious filename, since the filename is stored purely as metadata
(`UploadedFile.originalFilename`) and never used to construct a path.

## Consequences
- **Positive**: memory usage during upload and during processing is bounded
  by stream buffer sizes, not file size - verified in `BENCHMARK.md` (peak
  RSS stayed around 185 MiB while processing a 10 MiB / 50,000-record file).
- **Positive**: ranged-GET resume means a worker crash partway through a
  500,000-record file only costs reprocessing since the last committed
  checkpoint (at most one batch of 500 records), not the whole file.
- **Positive**: MinIO is S3-API-compatible, so the same `FileStorage`
  interface works unmodified against a real S3-compatible provider in
  production - the port/adapter boundary makes that a configuration change,
  not a code change. This is no longer hypothetical: `src/config/
  objectStorage.ts` constructs the same `minio` client library against
  either local MinIO (dev) or Cloudflare R2 (`NODE_ENV=production`),
  selected purely by environment, with zero changes to `MinioFileStorage.ts`,
  the `FileStorage` port, or anything in `imports.service.ts`/`imports.processor.ts`.
  Verified end-to-end against a live R2 bucket: bucket creation, upload,
  download, and a full import (upload -> worker reads from R2 -> processes
  -> persists -> completed) all behaved identically to the MinIO path.
- **Negative**: introduces MinIO as a required piece of infrastructure
  (mitigated: it runs in `docker-compose.yml` alongside Postgres/Redis, and
  was already called for by the assignment's infrastructure list).

## Alternatives Rejected
- **Local disk** was rejected because it doesn't fit a multi-instance
  deployment (a second API replica or the worker process, potentially on a
  different host, couldn't read a file written to the first instance's local
  disk) and adds a cleanup burden (orphaned temp files after a crash) that
  object storage's explicit key-per-import layout avoids.
- **Buffering fully in memory** was rejected outright - it directly violates
  the "must never be stored in memory as one string, buffer, array, or
  object" requirement, and would make memory usage scale linearly with file
  size, defeating the goal of bounded memory consumption regardless of
  dataset size.
