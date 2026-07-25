import { createHash } from "crypto";
import { Transaction } from "./transaction.schema";

// Fields, their order, and the algorithm are fixed and documented here:
// changing any of them changes every fingerprint ever produced. If this
// ever needs to change, bump FINGERPRINT_VERSION so old and new
// fingerprints are never silently conflated.
//
// description is deliberately EXCLUDED - it's free text that doesn't
// affect whether two records represent the same underlying transaction.
export const FINGERPRINT_VERSION = 1;
export const FINGERPRINT_ALGORITHM = "sha256";

export function calculateFingerprint(transaction: Transaction): string {
  const canonical = [
    FINGERPRINT_VERSION,
    transaction.transactionId,
    transaction.accountId,
    transaction.merchantId,
    transaction.amount.toFixed(2),
    transaction.currency,
    transaction.timestamp,
  ].join("|");

  return createHash(FINGERPRINT_ALGORITHM).update(canonical, "utf8").digest("hex");
}
