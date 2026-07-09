import type { Verdict } from '../shared/types.js';

/**
 * Score → verdict/coverage mapping. Placeholder cutoffs pending real calibration against
 * labeled outcomes (confirmed scams vs. legitimate projects).
 */
export const VERDICT_THRESHOLDS = {
  safe: 70, // score >= 70
  caution: 40, // 40 <= score < 70
  // score < 40 => danger
} as const;

export const COVERAGE_ELIGIBILITY_THRESHOLD = 75;

/** A confirmed registry flag against the subject forces "danger" regardless of score. */
export function verdictFromScore(score: number, hasConfirmedFlag: boolean): Verdict {
  if (hasConfirmedFlag) return 'danger';
  if (score >= VERDICT_THRESHOLDS.safe) return 'safe';
  if (score >= VERDICT_THRESHOLDS.caution) return 'caution';
  return 'danger';
}

export function isCoverageEligible(score: number, hasConfirmedFlag: boolean): boolean {
  return !hasConfirmedFlag && score >= COVERAGE_ELIGIBILITY_THRESHOLD;
}

/** Score delta (vs. previous recorded score) that fires an alert per ARCHITECTURE.md §2.3. */
export const ALERT_SCORE_DROP_THRESHOLD = 20;

/** Cache TTL for the /v1/scan hot path — favors freshness over the <50ms target from the doc. */
export const SCAN_CACHE_TTL_SECONDS = 30;
