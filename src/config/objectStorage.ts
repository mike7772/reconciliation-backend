import { Client } from "minio";

// Cloudflare R2 speaks the same S3 API MinIO does, so the exact same
// `minio` client library and the exact same FileStorage port/adapter
// (shared/adapters/MinioFileStorage.ts) work against either backend
// unmodified - only the connection details constructed here differ. This
// is precisely the trade-off ADR-004 (file-storage strategy) called out:
// swapping the object-storage backend is a configuration change, not a
// code change.
const isProduction = process.env.NODE_ENV === "production";

const client = isProduction
  ? new Client({
      endPoint: `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      useSSL: true,
      accessKey: process.env.R2_ACCESS_KEY_ID as string,
      secretKey: process.env.R2_SECRET_ACCESS_KEY as string,
      // R2 doesn't have real AWS regions but its S3-compatible endpoint
      // still expects a region to be present in the SigV4 signature.
      region: "auto",
    })
  : new Client({
      endPoint: process.env.MINIO_ENDPOINT || "localhost",
      port: Number(process.env.MINIO_PORT) || 9000,
      useSSL: process.env.MINIO_USE_SSL === "true",
      accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
      secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
    });

export const MINIO_BUCKET = isProduction
  ? (process.env.R2_BUCKET_NAME as string)
  : process.env.MINIO_BUCKET || "reconciliation-system";

export default client;
