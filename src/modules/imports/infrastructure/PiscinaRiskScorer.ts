import Piscina from "piscina";
import * as path from "path";
import { RiskScorer, RiskScoreResult } from "../domain/ports/RiskScorer";
import { RiskScoreInput } from "../domain/transaction/riskScore";

// Worker threads spawned by Piscina don't inherit the parent process's
// ts-node registration, so under `ts-node --transpile-only` (dev/this
// project's runtime) the worker file must be loaded through ts-node
// explicitly via execArgv. Once compiled to build/, the worker is plain JS
// and needs neither.
const isTsNode = __filename.endsWith(".ts");

export class PiscinaRiskScorer implements RiskScorer {
  private readonly pool: Piscina;

  constructor(maxThreads?: number) {
    this.pool = new Piscina({
      filename: path.resolve(__dirname, isTsNode ? "riskScoreWorker.ts" : "riskScoreWorker.js"),
      execArgv: isTsNode ? ["--require", "ts-node/register/transpile-only"] : [],
      maxThreads,
    });
  }

  async scoreBatch(inputs: RiskScoreInput[]): Promise<RiskScoreResult[]> {
    return this.pool.run(inputs);
  }

  async close(): Promise<void> {
    await this.pool.destroy();
  }
}
