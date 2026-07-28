/**
 * Ensures the dedicated integration-test database exists and is migrated,
 * so `npm run test:integration` never depends on a manual `CREATE DATABASE`
 * step - the spec explicitly requires tests not to depend on manual
 * database preparation. Safe to run on every test invocation: creating an
 * already-existing database is a no-op (the "already exists" error is
 * caught and ignored), and `prisma migrate deploy` only applies pending
 * migrations.
 *
 * Wired as `pretest:integration`/`pretest:all` in package.json, so it runs
 * automatically before those test scripts - never invoked directly.
 */
import { config } from "dotenv";
config();
config({ path: ".env.test", override: true });

import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";

const TEST_DATABASE_URL = process.env.DATABASE_URL;

function parseDatabaseName(url: string): { databaseName: string; maintenanceUrl: string } {
  const lastSlash = url.lastIndexOf("/");
  const afterSlash = url.slice(lastSlash + 1);
  const databaseName = afterSlash.split("?")[0];
  const queryString = afterSlash.includes("?") ? afterSlash.slice(afterSlash.indexOf("?")) : "";
  const maintenanceUrl = `${url.slice(0, lastSlash)}/postgres${queryString}`;
  return { databaseName, maintenanceUrl };
}

async function ensureDatabaseExists(databaseName: string, maintenanceUrl: string): Promise<void> {
  const client = new PrismaClient({ datasources: { db: { url: maintenanceUrl } } });
  try {
    await client.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    console.log(`[setupTestDb] created database "${databaseName}"`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(message)) {
      console.log(`[setupTestDb] database "${databaseName}" already exists, skipping creation`);
    } else {
      throw err;
    }
  } finally {
    await client.$disconnect();
  }
}

async function main(): Promise<void> {
  if (!TEST_DATABASE_URL) {
    throw new Error("DATABASE_URL is not set - check .env and .env.test");
  }

  const { databaseName, maintenanceUrl } = parseDatabaseName(TEST_DATABASE_URL);
  await ensureDatabaseExists(databaseName, maintenanceUrl);

  console.log(`[setupTestDb] applying migrations to "${databaseName}"...`);
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  console.log("[setupTestDb] test database ready");
}

main().catch((err) => {
  console.error("[setupTestDb] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
