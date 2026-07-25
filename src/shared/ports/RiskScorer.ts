import { RiskScoreInput, RiskLevel } from "../utils/riskScore";

export interface RiskScoreResult {
  score: number;
  level: RiskLevel;
}

export interface RiskScorer {
  /**
   * Batched rather than one-at-a-time: dispatching a whole batch as a
   * single Piscina task amortizes per-task serialization/scheduling
   * overhead across many records instead of paying it per transaction -
   * ~2x throughput in practice. The caller still bounds concurrency by
   * choosing how many batches are in flight at once, never firing all
   * batches for a file at once.
   */
  scoreBatch(inputs: RiskScoreInput[]): Promise<RiskScoreResult[]>;
}
