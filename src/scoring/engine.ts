import { db } from '../shared/db.js';
import { childLogger } from '../shared/logger.js';
import { getQueue, QUEUE_NAMES } from '../shared/queue.js';
import { SIGNAL_WEIGHTS, type SignalValues } from './signals.js';
import { latestScore, recordScore } from './history.js';
import { ALERT_SCORE_DROP_THRESHOLD } from './thresholds.js';
import { latestKycRecord, kycRecordToVerificationResult } from '../verification/kyc/index.js';
import type { VerificationResult } from '../verification/types.js';
import {
  accountAgeDaysToScore,
  fetchAccountCreatedAt,
  getCachedAccountAgeDays,
  recordAccountAge,
} from '../indexer/account-age.js';

const log = childLogger('scoring:engine');

const NEUTRAL_PRIOR = 50;

export interface ScoreResult {
  subjectAddress: string;
  score: number;
  signals: SignalValues;
  hasConfirmedFlag: boolean;
}

/** score field wins when a check reports a graded value (e.g. reserve ratio); otherwise pass/fail/inconclusive maps to 100/0/neutral. */
function outcomeToScore(result: VerificationResult | undefined, neutral = NEUTRAL_PRIOR): number {
  if (!result) return neutral;
  if (typeof result.score === 'number') return result.score;
  if (result.outcome === 'pass') return 100;
  if (result.outcome === 'fail') return 0;
  return neutral;
}

async function latestChecklist(projectId: string): Promise<VerificationResult[]> {
  const row = await db('certifications')
    .where({ project_id: projectId })
    .orderBy('submitted_at', 'desc')
    .first();

  if (!row) return [];
  return Array.isArray(row.checklist) ? (row.checklist as VerificationResult[]) : [];
}

/**
 * Gathers signal inputs for a subject from the DB — registry status, the most recent
 * certification checklist (static analysis, behavioral monitors, reserve ratio), and the most
 * recent KYC decision — and combines them into a single 0-100 score via a weighted sum.
 *
 * This is intentionally a simple, auditable v1 (no ML, no black-box model) — see signals.ts
 * for why the weights themselves are still provisional. A subject with no matching project (an
 * arbitrary payment destination, say) gets neutral priors on every signal it has no data for.
 */
export async function computeScore(subjectAddress: string): Promise<ScoreResult> {
  const [confirmedFlag, project] = await Promise.all([
    db('registry_reports').where({ target_address: subjectAddress, status: 'confirmed' }).first(),
    db('projects').where({ issuer_address: subjectAddress }).first(),
  ]);

  let byCheck = new Map<string, VerificationResult>();
  let kycResult: VerificationResult | undefined;

  if (project) {
    const [checklist, kycRecord] = await Promise.all([
      latestChecklist(project.id),
      latestKycRecord(project.id),
    ]);
    byCheck = new Map(checklist.map((r) => [r.check, r]));
    kycResult = kycRecordToVerificationResult(kycRecord);
  }

  // Fast local read only — never a live Horizon call here, this function is on the /v1/scan
  // request path (≤150ms budget). recomputeAndPersist below does the live lookup, off that path.
  const accountAgeDays = await getCachedAccountAgeDays(subjectAddress);

  const signals: SignalValues = {
    contractVerified: outcomeToScore(byCheck.get('static_analysis')),
    reserveRatio: outcomeToScore(byCheck.get('reserve_ratio')),
    kycStatus: outcomeToScore(kycResult),
    registryFlags: confirmedFlag ? 0 : 100,
    liquidityStability: outcomeToScore(byCheck.get('liquidity_drain'), 70),
    accountAge: accountAgeDaysToScore(accountAgeDays),
  };

  const score = SIGNAL_WEIGHTS.reduce((sum, { key, weight }) => {
    const value = signals[key] ?? 0;
    return sum + value * weight;
  }, 0);

  const rounded = Math.round(score * 100) / 100;

  return {
    subjectAddress,
    score: rounded,
    signals,
    hasConfirmedFlag: Boolean(confirmedFlag),
  };
}

export interface RecomputeOptions {
  reason: string;
}

/**
 * Recomputes, persists, and — if the score dropped sharply — fires an alert job. Called from the
 * score-recompute queue worker, i.e. always off the request path, which is why this (unlike
 * computeScore) is allowed to lazily fetch+cache account age from Horizon before scoring.
 */
export async function recomputeAndPersist(
  subjectAddress: string,
  opts: RecomputeOptions,
): Promise<ScoreResult> {
  const previous = await latestScore(subjectAddress);

  if ((await getCachedAccountAgeDays(subjectAddress)) == null) {
    const createdAt = await fetchAccountCreatedAt(subjectAddress);
    if (createdAt) await recordAccountAge(subjectAddress, createdAt);
  }

  const result = await computeScore(subjectAddress);

  await recordScore({ subjectAddress, score: result.score, signals: result.signals });

  log.info({ subjectAddress, score: result.score, reason: opts.reason }, 'score recomputed');

  if (previous && previous.score - result.score >= ALERT_SCORE_DROP_THRESHOLD) {
    await getQueue(QUEUE_NAMES.alertDispatch).add('score-drop', {
      subjectAddress,
      previousScore: previous.score,
      newScore: result.score,
    });
  }

  return result;
}
