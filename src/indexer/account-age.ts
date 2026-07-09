import { horizonServer } from '../shared/stellar.js';
import { db } from '../shared/db.js';
import { childLogger } from '../shared/logger.js';

const log = childLogger('indexer:account-age');

// Provisional cutoff — score reaches 100 once an account is this many days old. Not calibrated
// against real scam-vs-legitimate data yet, same caveat as scoring/signals.ts weights.
const MATURE_ACCOUNT_DAYS = 180;

/**
 * Live Horizon lookup — an account's earliest operation approximates its creation date (Horizon
 * has no direct "created at" field). Only call this from background jobs (indexer/backfill.ts,
 * scoring/engine.ts's recomputeAndPersist), never the live request path — see the ≤150ms /v1/scan
 * budget in ARCHITECTURE.md §2.3.
 */
export async function fetchAccountCreatedAt(address: string): Promise<Date | null> {
  try {
    const page = await horizonServer.operations().forAccount(address).order('asc').limit(1).call();
    const earliest = page.records[0] as unknown as { created_at?: string } | undefined;
    return earliest?.created_at ? new Date(earliest.created_at) : null;
  } catch (err) {
    log.warn({ err, address }, 'could not determine account age from Horizon');
    return null;
  }
}

export async function recordAccountAge(address: string, firstSeenAt: Date): Promise<void> {
  await db('account_ages')
    .insert({ subject_address: address, first_seen_at: firstSeenAt })
    .onConflict('subject_address')
    .merge({ first_seen_at: firstSeenAt, fetched_at: new Date() });
}

/** Fast local read — safe to call from computeScore's request path. */
export async function getCachedAccountAgeDays(address: string): Promise<number | null> {
  const row = await db('account_ages').where({ subject_address: address }).first();
  if (!row) return null;
  return (Date.now() - new Date(row.first_seen_at).getTime()) / (1000 * 60 * 60 * 24);
}

export function accountAgeDaysToScore(ageDays: number | null): number {
  if (ageDays == null) return 50; // no data cached yet — neutral prior, not "young"
  return Math.max(0, Math.min(100, (ageDays / MATURE_ACCOUNT_DAYS) * 100));
}
