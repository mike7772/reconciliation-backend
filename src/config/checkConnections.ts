import { Container } from "../composition/container";

// Postgres is a hard dependency: if this throws, startup is aborted by the
// caller. Redis and MinIO are best-effort: failures are logged, never thrown,
// so the server still comes up without them.

async function checkPostgres(container: Container): Promise<void> {
  await container.prisma.$queryRaw`SELECT 1`;
  container.logger.info("Postgres: connected");
}

async function checkRedis(container: Container): Promise<void> {
  try {
    await container.redis.connect();
    await container.redis.ping();
    container.logger.info("Redis: connected");
  } catch (err) {
    container.logger.warn("Redis: not reachable, continuing without it", {
      error: (err as Error).message,
    });
  }
}

async function checkMinio(container: Container): Promise<void> {
  try {
    await container.minio.bucketExists(container.minioBucket);
    container.logger.info("MinIO: connected");
  } catch (err) {
    container.logger.warn("MinIO: not reachable, continuing without it", {
      error: (err as Error).message,
    });
  }
}

export default async function checkConnections(container: Container): Promise<void> {
  await checkPostgres(container);
  await Promise.all([checkRedis(container), checkMinio(container)]);
}
