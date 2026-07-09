import { latestRatio } from '../../indexer/reserves.js';
import type { VerificationResult } from '../types.js';

const MIN_HEALTHY_RATIO = 1.0; // reserves must fully back issued supply

export async function checkReserveRatio(projectId: string): Promise<VerificationResult> {
  const ratio = await latestRatio(projectId);

  if (ratio == null) {
    return {
      check: 'reserve_ratio',
      outcome: 'inconclusive',
      details: 'No reserve attestation on file for this project',
      checkedAt: new Date(),
    };
  }

  return {
    check: 'reserve_ratio',
    outcome: ratio >= MIN_HEALTHY_RATIO ? 'pass' : 'fail',
    details: `Reserve ratio ${ratio.toFixed(3)} (minimum ${MIN_HEALTHY_RATIO})`,
    score: Math.max(0, Math.min(100, ratio * 100)),
    checkedAt: new Date(),
  };
}
