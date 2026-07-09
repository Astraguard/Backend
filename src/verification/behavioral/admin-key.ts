export interface EffectLike {
  type: string;
  createdAt: string; // ISO
}

/** Signer/threshold changes — the mechanism behind a classic signer-takeover rug: attacker adds
 * themselves as a signer, strips the original owner's weight, then drains the account. */
export const SIGNER_EFFECT_TYPES = new Set([
  'signer_created',
  'signer_removed',
  'signer_updated',
  'account_thresholds_updated',
]);

/**
 * Counts signer/threshold-changing effects within the trailing window. Pure function over
 * already-fetched records so it's unit-testable without a live Horizon call — see
 * behavioral/index.ts for the fetch wrapper.
 */
export function countRecentSignerChanges(effects: EffectLike[], windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  return effects.filter(
    (e) => SIGNER_EFFECT_TYPES.has(e.type) && new Date(e.createdAt).getTime() >= cutoff,
  ).length;
}
