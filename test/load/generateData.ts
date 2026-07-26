/**
 * Generates an NDJSON file matching the transaction shape the imports
 * pipeline expects, deliberately mixing in the failure modes the spec
 * requires the parser/validator to survive: invalid JSON, missing fields,
 * unsupported currencies, in-file duplicate transactionIds, and one
 * excessively long line. The mix ratio is fixed (not random per-run) so
 * benchmark runs are comparable across executions.
 *
 * Usage: npm run generate:data -- --records=500000 [--out=path] [--provider=id]
 */
import { createWriteStream } from "fs";
import * as path from "path";

interface Args {
  records: number;
  out: string;
  providerId: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (name: string, fallback: string): string => {
    const prefix = `--${name}=`;
    const found = args.find((a) => a.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
  };

  return {
    records: Number(get("records", "500000")),
    out: get("out", path.join(__dirname, "..", "fixtures", "generated.ndjson")),
    providerId: get("provider", "load-test-provider"),
  };
}

const MERCHANTS = Array.from({ length: 50 }, (_, i) => `merchant-${i + 1}`);
const ACCOUNTS = Array.from({ length: 2000 }, (_, i) => `acc-${i + 1}`);
const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD"];
const UNSUPPORTED_CURRENCIES = ["XYZ", "ZZZ", "QQQ"];

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function randomDescription(seed: number): string {
  const words = ["Subscription", "payment", "for", "invoice", "monthly", "service", "renewal", "order"];
  const length = 3 + (seed % 6);
  return Array.from({ length }, (_, i) => pick(words, seed + i)).join(" ");
}

/**
 * Builds one line for record index `i`. A fixed proportion of records are
 * deliberately broken so the generated file exercises every rejection path:
 *  - ~1% invalid JSON
 *  - ~1% missing a required field
 *  - ~1% unsupported currency code
 *  - ~0.5% duplicate transactionId (repeats an earlier transactionId in
 *    this same file, same provider - the in-file duplicate-detection case)
 *  - ~0.01% (1 in 10,000) an excessively long description, to exercise the
 *    "extremely long strings"/raw-value-capping requirement
 * The remainder (~96.5%) are valid.
 */
function buildLine(i: number, providerId: string): string {
  const bucket = i % 1000;
  const seed = i + 1;
  const transactionId =
    bucket === 5 && i > 1000 ? `txn-${i - 997}` /* duplicates an earlier id */ : `txn-${seed}`;

  if (bucket === 0) {
    return `{invalid json at line ${i}`;
  }

  const record: Record<string, unknown> = {
    transactionId,
    accountId: pick(ACCOUNTS, seed),
    merchantId: pick(MERCHANTS, seed),
    amount: Math.round((10 + (seed % 5000) + (seed % 7) / 10) * 100) / 100,
    currency: bucket === 10 ? pick(UNSUPPORTED_CURRENCIES, seed) : pick(CURRENCIES, seed),
    timestamp: new Date(Date.UTC(2026, 0, 1) + seed * 60_000).toISOString(),
    description: bucket === 999 ? "x".repeat(2000) : randomDescription(seed),
  };

  if (bucket === 20) {
    delete record.merchantId; // missing required field
  }

  return JSON.stringify(record);
}

async function main(): Promise<void> {
  const { records, out, providerId } = parseArgs();

  const stream = createWriteStream(out, { flags: "w" });
  let streamError: Error | null = null;
  stream.once("error", (err) => {
    streamError = err;
  });
  const writeLine = (line: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (streamError) {
        reject(streamError);
        return;
      }
      if (!stream.write(line + "\n")) {
        stream.once("drain", resolve);
      } else {
        resolve();
      }
    });

  console.log(`Generating ${records} records to ${out} (provider=${providerId})...`);
  const startedAt = Date.now();

  for (let i = 1; i <= records; i++) {
    await writeLine(buildLine(i, providerId));
    if (i % 100_000 === 0) {
      console.log(`  ${i}/${records} lines written`);
    }
  }

  await new Promise<void>((resolve, reject) => {
    stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`Done in ${seconds}s -> ${out}`);
}

main().catch((err) => {
  console.error("generate:data failed:", err);
  process.exit(1);
});
