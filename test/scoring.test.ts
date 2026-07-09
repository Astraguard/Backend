import { describe, expect, it } from 'vitest';
import { SIGNAL_WEIGHTS, weightFor } from '../src/scoring/signals.js';
import {
  verdictFromScore,
  isCoverageEligible,
  COVERAGE_ELIGIBILITY_THRESHOLD,
} from '../src/scoring/thresholds.js';

describe('signals', () => {
  it('weights sum to 1', () => {
    const total = SIGNAL_WEIGHTS.reduce((sum, s) => sum + s.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('weightFor throws on an unknown key', () => {
    // @ts-expect-error deliberate bad input
    expect(() => weightFor('not_a_signal')).toThrow();
  });
});

describe('thresholds', () => {
  it('maps high scores to safe', () => {
    expect(verdictFromScore(85, false)).toBe('safe');
  });

  it('maps mid scores to caution', () => {
    expect(verdictFromScore(55, false)).toBe('caution');
  });

  it('maps low scores to danger', () => {
    expect(verdictFromScore(10, false)).toBe('danger');
  });

  it('a confirmed flag forces danger regardless of score', () => {
    expect(verdictFromScore(99, true)).toBe('danger');
  });

  it('coverage eligibility requires both a high score and no confirmed flag', () => {
    expect(isCoverageEligible(COVERAGE_ELIGIBILITY_THRESHOLD, false)).toBe(true);
    expect(isCoverageEligible(COVERAGE_ELIGIBILITY_THRESHOLD, true)).toBe(false);
    expect(isCoverageEligible(COVERAGE_ELIGIBILITY_THRESHOLD - 1, false)).toBe(false);
  });
});
