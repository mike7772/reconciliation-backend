import { createHash } from "crypto";

export interface RiskScoreInput {
  amount: number;
  descriptionLength: number;
  transactionHourUtc: number; // 0-23
  merchantId: string;
  fingerprint: string;
}

export type RiskLevel = "low" | "medium" | "high";

// Simulates the non-trivial per-transaction computation this step
// represents. This is exactly why scoring runs in a Piscina worker pool
// (see riskScoreWorker.ts) instead of inline on the HTTP event loop -
// running this synchronously for 500k records would visibly stall request
// handling if done on the main thread.
const CPU_SIMULATION_ITERATIONS = 500;

/**
 * Deterministic, documented risk-scoring algorithm producing a 0-100 score.
 * Same input always produces the same output - no randomness, no I/O.
 *
 * Signals combined (each normalized to 0-100 before weighting):
 *  - amountFactor (weight 0.35): log-scaled transaction amount. Larger
 *    amounts score higher; capped so amounts at/above $50,000 all hit the
 *    same maximum contribution rather than dominating the score.
 *  - hourFactor (weight 0.15): a flat "unusual hours" heuristic - UTC
 *    00:00-04:59 scores high (100), all other hours score low (20).
 *  - descriptionFactor (weight 0.15): missing/very short descriptions
 *    score higher (0 chars = 100, tapering linearly to 0 by 40+ chars) -
 *    a vague/absent description is treated as a mild risk signal.
 *  - merchantFactor (weight 0.25): a stable per-merchant baseline derived
 *    by hashing merchantId to a 0-100 value, so the same merchant always
 *    contributes the same baseline across every transaction/run.
 *  - fingerprintFactor (weight 0.10): a small amount of deterministic
 *    variation derived from the transaction's own fingerprint, so two
 *    transactions with identical amount/hour/merchant don't always land
 *    on the exact same score.
 *
 * Weights sum to 1.0. See ARCHITECTURE.md for the full rationale.
 */
export function calculateRiskScore(input: RiskScoreInput): number {
  const amountFactor = Math.min(
    100,
    (Math.log10(input.amount + 1) / Math.log10(50_000)) * 100
  );
  const hourFactor = input.transactionHourUtc < 5 ? 100 : 20;
  const descriptionFactor = Math.max(0, 100 - (input.descriptionLength / 40) * 100);
  const merchantFactor = hashToPercent(input.merchantId);
  const fingerprintFactor = hashToPercent(input.fingerprint);

  const weighted =
    amountFactor * 0.35 +
    hourFactor * 0.15 +
    descriptionFactor * 0.15 +
    merchantFactor * 0.25 +
    fingerprintFactor * 0.1;

  simulateCpuBoundWork(input.fingerprint);

  return Math.round(Math.min(100, Math.max(0, weighted)));
}

export function riskLevelFor(score: number): RiskLevel {
  if (score < 40) return "low";
  if (score < 70) return "medium";
  return "high";
}

function hashToPercent(value: string): number {
  const hash = createHash("sha256").update(value).digest();
  const n = hash.readUInt32BE(0);
  return (n / 0xffffffff) * 100;
}

function simulateCpuBoundWork(seed: string): void {
  let acc = createHash("sha256").update(seed).digest();
  for (let i = 0; i < CPU_SIMULATION_ITERATIONS; i++) {
    acc = createHash("sha256").update(acc).digest();
  }
}
