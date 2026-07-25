export const MAX_DESCRIPTION_LENGTH = 500;

// Strips ASCII control characters (0x00-0x1F, 0x7F) that have no legitimate
// place in these fields and could otherwise carry log injection or other
// unexpected downstream behavior. Constructed from char codes rather than a
// literal regex to avoid embedding literal control bytes in source.
const CONTROL_CHAR_PATTERN = new RegExp(
  "[" +
    Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join("") +
    String.fromCharCode(127) +
    "]",
  "g"
);

function sanitizeString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(CONTROL_CHAR_PATTERN, "").trim();
}

const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Re-serializes a valid ISO-8601 timestamp to a single canonical form
 * (UTC, milliseconds, "Z" suffix) so two logically-identical timestamps
 * written differently (e.g. with/without milliseconds, "+00:00" vs "Z")
 * normalize to the same string - required for a deterministic fingerprint.
 * Returns undefined for anything that isn't a strict ISO-8601 string,
 * rather than relying on Date's looser parsing (which accepts formats
 * that aren't actually ISO-8601).
 */
function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !ISO_8601_PATTERN.test(value)) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

/**
 * Raw, unvalidated fields straight out of JSON.parse. Only the fields we
 * expect are ever read here - unexpected extra fields are silently dropped
 * rather than passed through, so they can never smuggle unexpected
 * behavior into downstream code.
 */
export interface NormalizedInput {
  transactionId: unknown;
  accountId: unknown;
  merchantId: unknown;
  amount: unknown;
  currency: unknown;
  timestamp: unknown;
  description: unknown;
}

export function normalizeRecord(raw: Record<string, unknown>): NormalizedInput {
  return {
    transactionId: sanitizeString(raw.transactionId),
    accountId: sanitizeString(raw.accountId),
    merchantId: sanitizeString(raw.merchantId),
    amount: raw.amount,
    currency:
      typeof raw.currency === "string" ? raw.currency.trim().toUpperCase() : raw.currency,
    timestamp: normalizeTimestamp(raw.timestamp),
    description:
      raw.description === undefined
        ? undefined
        : (sanitizeString(raw.description) as string | undefined)?.slice(
            0,
            MAX_DESCRIPTION_LENGTH
          ),
  };
}
