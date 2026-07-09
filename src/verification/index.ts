import { runStaticAnalysis } from './static/index.js';
import {
  checkAdminKeyAbuse,
  checkHoneypotPattern,
  checkLiquidityDrain,
  checkWashTrading,
} from './behavioral/index.js';
import { checkReserveRatio } from './reserves/index.js';
import type { VerificationResult } from './types.js';

export * from './types.js';
export { runStaticAnalysis } from './static/index.js';
export * from './behavioral/index.js';
export * from './reserves/index.js';
export * from './kyc/index.js';

export interface CertificationChecklistInput {
  projectId: string;
  contractId: string;
  wasmHash: string;
}

/** Runs the automatable half of the certification checklist (static + behavioral + reserves). KYC is manual/async. */
export async function runCertificationChecklist(
  input: CertificationChecklistInput,
): Promise<VerificationResult[]> {
  return Promise.all([
    runStaticAnalysis(input.contractId, input.wasmHash),
    checkLiquidityDrain(input.contractId),
    checkAdminKeyAbuse(input.contractId),
    checkWashTrading(input.contractId),
    checkHoneypotPattern(input.contractId),
    checkReserveRatio(input.projectId),
  ]);
}
