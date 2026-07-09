/**
 * Signal definitions and weights for the trust score engine.
 *
 * These weights are a v1 placeholder, not a finalized methodology — ARCHITECTURE.md calls the
 * scoring engine "the secret sauce" and explicitly leaves weighting undefined. Treat any change
 * here as a scoring-methodology change (should be reviewed, not just merged).
 */
export type SignalKey =
  | 'contractVerified'
  | 'reserveRatio'
  | 'kycStatus'
  | 'registryFlags'
  | 'liquidityStability'
  | 'accountAge';

export interface SignalWeight {
  key: SignalKey;
  weight: number; // fraction of total score, all weights must sum to 1
  description: string;
}

export const SIGNAL_WEIGHTS: SignalWeight[] = [
  { key: 'contractVerified', weight: 0.2, description: 'Static analysis / source match result' },
  { key: 'reserveRatio', weight: 0.2, description: 'Attested reserves vs. issued supply' },
  { key: 'kycStatus', weight: 0.15, description: 'Team identity verification outcome' },
  { key: 'registryFlags', weight: 0.25, description: 'Confirmed community scam reports (negative)' },
  { key: 'liquidityStability', weight: 0.1, description: 'Behavioral monitor: liquidity drain check' },
  { key: 'accountAge', weight: 0.1, description: 'On-chain account/contract age as a weak prior' },
];

const totalWeight = SIGNAL_WEIGHTS.reduce((sum, s) => sum + s.weight, 0);
if (Math.abs(totalWeight - 1) > 1e-6) {
  throw new Error(`SIGNAL_WEIGHTS must sum to 1, got ${totalWeight}`);
}

export type SignalValues = Partial<Record<SignalKey, number>>; // each value 0-100

export function weightFor(key: SignalKey): number {
  const entry = SIGNAL_WEIGHTS.find((s) => s.key === key);
  if (!entry) throw new Error(`Unknown signal key: ${key}`);
  return entry.weight;
}
