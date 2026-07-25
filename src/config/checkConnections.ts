import prisma from "./prisma";
import redis from "./redis";
import minio, { MINIO_BUCKET } from "./minio";

// Postgres is a hard dependency: if this throws, startup is aborted by the
// caller. Redis and MinIO are best-effort: failures are logged, never thrown,
// so the server still comes up without them.

async function checkPostgres(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
  console.info("Postgres: connected");
}

async function checkRedis(): Promise<void> {
  try {
    await redis.connect();
    await redis.ping();
    console.info("Redis: connected");
  } catch (err) {
    console.warn(
      `Redis: not reachable, continuing without it (${(err as Error).message})`
    );
  }
}

async function checkMinio(): Promise<void> {
  try {
    await minio.bucketExists(MINIO_BUCKET);
    console.info("MinIO: connected");
  } catch (err) {
    console.warn(
      `MinIO: not reachable, continuing without it (${(err as Error).message})`
    );
  }
}

export default async function checkConnections(): Promise<void> {
  await checkPostgres();
  await Promise.all([checkRedis(), checkMinio()]);
}
