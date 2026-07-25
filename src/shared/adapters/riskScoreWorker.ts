import { calculateRiskScore, riskLevelFor, RiskScoreInput } from "../utils/riskScore";

// Piscina task entry point - runs inside a worker thread, not the main
// event loop. Keep this file free of any Express/Prisma/BullMQ imports;
// it only needs the pure, deterministic scoring function. Takes a batch
// (not a single record) so per-task overhead is amortized across many
// transactions - see RiskScorer.ts for why.
export default function riskScoreBatchTask(batch: RiskScoreInput[]) {
  return batch.map((input) => {
    const score = calculateRiskScore(input);
    return { score, level: riskLevelFor(score) };
  });
}
