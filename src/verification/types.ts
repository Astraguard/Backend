export type VerificationOutcome = 'pass' | 'fail' | 'inconclusive';

export interface VerificationResult {
  check: string;
  outcome: VerificationOutcome;
  details: string;
  score?: number; // 0-100 contribution, when applicable — see scoring/signals.ts
  checkedAt: Date;
}
