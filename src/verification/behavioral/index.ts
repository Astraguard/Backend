import { db } from '../../shared/db.js';
import { horizonServer } from '../../shared/stellar.js';
import { childLogger } from '../../shared/logger.js';
import type { VerificationResult } from '../types.js';
import { countCircularPayments, DEFAULT_WINDOW_MS as WASH_WINDOW_MS } from './wash-trading.js';
import { countRecentSignerChanges } from './admin-key.js';

const log = childLogger('verification:behavioral');

const LIQUIDITY_DRAIN_THRESHOLD_PCT = 30; // % drop in a single window trips this monitor
const MONITOR_WINDOW_MINUTES = 10;

/**
 * Live monitor: flags a sudden liquidity drop for a project's pool address, sourced from
 * score_history signal snapshots recorded by the indexer. Real drain detection needs a
 * dedicated liquidity-pool balance feed; this checks the closest proxy currently indexed.
 */
export async function checkLiquidityDrain(subjectAddress: string): Promise<VerificationResult> {
  const windowStart = new Date(Date.now() - MONITOR_WINDOW_MINUTES * 60_000);

  const rows = await db('score_history')
    .where({ subject_address: subjectAddress })
    .where('recorded_at', '>=', windowStart)
    .orderBy('recorded_at', 'asc');

  if (rows.length < 2) {
    return {
      check: 'liquidity_drain',
      outcome: 'inconclusive',
      details: 'Not enough recent history to evaluate liquidity drain',
      checkedAt: new Date(),
    };
  }

  const first = rows[0].signals?.liquidity as number | undefined;
  const last = rows[rows.length - 1].signals?.liquidity as number | undefined;

  if (first == null || last == null || first === 0) {
    return {
      check: 'liquidity_drain',
      outcome: 'inconclusive',
      details: 'Liquidity signal not present in recent snapshots',
      checkedAt: new Date(),
    };
  }

  const dropPct = ((first - last) / first) * 100;
  const tripped = dropPct >= LIQUIDITY_DRAIN_THRESHOLD_PCT;

  if (tripped) {
    log.warn({ subjectAddress, dropPct }, 'liquidity drain threshold tripped');
  }

  return {
    check: 'liquidity_drain',
    outcome: tripped ? 'fail' : 'pass',
    details: `Liquidity moved ${dropPct.toFixed(1)}% over ${MONITOR_WINDOW_MINUTES}m (threshold ${LIQUIDITY_DRAIN_THRESHOLD_PCT}%)`,
    checkedAt: new Date(),
  };
}

const SIGNER_CHURN_WINDOW_HOURS = 24;
const SIGNER_CHURN_THRESHOLD = 2; // 2+ signer/threshold changes in the window trips this

/**
 * Flags recent signer/threshold churn — the mechanism behind a signer-takeover rug (attacker
 * adds themselves as a co-signer, strips the original owner's weight, then drains the account).
 * An account with zero signer history isn't suspicious by omission, so a clean history passes.
 */
export async function checkAdminKeyAbuse(subjectAddress: string): Promise<VerificationResult> {
  let effects: { type: string; createdAt: string }[];
  try {
    const page = await horizonServer.effects().forAccount(subjectAddress).order('desc').limit(50).call();
    effects = (page.records as unknown as { type: string; created_at: string }[]).map((e) => ({
      type: e.type,
      createdAt: e.created_at,
    }));
  } catch (err) {
    log.warn({ err, subjectAddress }, 'could not fetch effects for admin-key-abuse check');
    return {
      check: 'admin_key_abuse',
      outcome: 'inconclusive',
      details: `Could not fetch account effects: ${(err as Error).message}`,
      checkedAt: new Date(),
    };
  }

  const windowMs = SIGNER_CHURN_WINDOW_HOURS * 60 * 60 * 1000;
  const churnCount = countRecentSignerChanges(effects, windowMs);
  const tripped = churnCount >= SIGNER_CHURN_THRESHOLD;

  if (tripped) log.warn({ subjectAddress, churnCount }, 'signer churn threshold tripped');

  return {
    check: 'admin_key_abuse',
    outcome: tripped ? 'fail' : 'pass',
    details: `${churnCount} signer/threshold change(s) in the last ${SIGNER_CHURN_WINDOW_HOURS}h (threshold ${SIGNER_CHURN_THRESHOLD})`,
    checkedAt: new Date(),
  };
}

const WASH_TRADE_CIRCULAR_PAIR_THRESHOLD = 3;

/**
 * Flags circular payment patterns (subject → X → subject, similar amount, short window) among
 * the subject's most recent payments — inflated volume without real economic transfer.
 */
export async function checkWashTrading(subjectAddress: string): Promise<VerificationResult> {
  let payments: { from: string; to: string; amount: string; createdAt: string }[];
  try {
    const page = await horizonServer.payments().forAccount(subjectAddress).order('desc').limit(200).call();
    payments = (page.records as unknown as Record<string, unknown>[])
      .filter((r) => r.type === 'payment')
      .map((r) => ({
        from: r.from as string,
        to: r.to as string,
        amount: r.amount as string,
        createdAt: r.created_at as string,
      }));
  } catch (err) {
    log.warn({ err, subjectAddress }, 'could not fetch payments for wash-trading check');
    return {
      check: 'wash_trading',
      outcome: 'inconclusive',
      details: `Could not fetch payment history: ${(err as Error).message}`,
      checkedAt: new Date(),
    };
  }

  if (payments.length === 0) {
    return {
      check: 'wash_trading',
      outcome: 'inconclusive',
      details: 'No payment history to evaluate',
      checkedAt: new Date(),
    };
  }

  const circularCount = countCircularPayments(payments, subjectAddress, { windowMs: WASH_WINDOW_MS });
  const tripped = circularCount >= WASH_TRADE_CIRCULAR_PAIR_THRESHOLD;

  if (tripped) log.warn({ subjectAddress, circularCount }, 'wash trading threshold tripped');

  return {
    check: 'wash_trading',
    outcome: tripped ? 'fail' : 'pass',
    details: `${circularCount} circular payment pair(s) among the last ${payments.length} payments (threshold ${WASH_TRADE_CIRCULAR_PAIR_THRESHOLD})`,
    checkedAt: new Date(),
  };
}

const DEAUTH_EFFECT_TYPES = new Set(['trustline_deauthorized', 'claimable_balance_clawed_back']);
const HONEYPOT_LOOKBACK_DAYS = 30;

/**
 * Checks for the classic Stellar "freeze rug": an issuer sets AUTH_REVOCABLE (or clawback) so
 * holders can buy freely, then revokes trustline authorization or claws back funds so they
 * can't sell. auth_immutable with no clawback structurally can't do this — a clean pass, not
 * just an absence of evidence. Revocable/clawback-enabled with no observed deauth activity is
 * a real capability worth flagging without claiming abuse that hasn't happened.
 */
export async function checkHoneypotPattern(subjectAddress: string): Promise<VerificationResult> {
  let flags: { auth_immutable: boolean; auth_revocable: boolean; auth_clawback_enabled: boolean };
  try {
    const account = await horizonServer.loadAccount(subjectAddress);
    flags = account.flags;
  } catch (err) {
    log.warn({ err, subjectAddress }, 'could not load account for honeypot check');
    return {
      check: 'honeypot_pattern',
      outcome: 'inconclusive',
      details: `Could not load account (not a funded classic account, or a Soroban contract address): ${(err as Error).message}`,
      checkedAt: new Date(),
    };
  }

  const canFreezeOrClaw = flags.auth_revocable || flags.auth_clawback_enabled;
  if (!canFreezeOrClaw) {
    return {
      check: 'honeypot_pattern',
      outcome: 'pass',
      details: 'Issuer cannot revoke trustline authorization or claw back funds (auth_immutable, no clawback)',
      checkedAt: new Date(),
    };
  }

  let deauthEvents = 0;
  try {
    const page = await horizonServer.effects().forAccount(subjectAddress).order('desc').limit(50).call();
    const cutoff = Date.now() - HONEYPOT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    deauthEvents = (page.records as unknown as { type: string; created_at: string }[]).filter(
      (e) => DEAUTH_EFFECT_TYPES.has(e.type) && new Date(e.created_at).getTime() >= cutoff,
    ).length;
  } catch (err) {
    log.warn({ err, subjectAddress }, 'could not fetch effects for honeypot check');
  }

  if (deauthEvents > 0) {
    log.warn({ subjectAddress, deauthEvents }, 'trustline deauthorization/clawback activity detected');
    return {
      check: 'honeypot_pattern',
      outcome: 'fail',
      details: `Issuer can freeze/claw back holder funds and has done so ${deauthEvents} time(s) in the last ${HONEYPOT_LOOKBACK_DAYS} days`,
      checkedAt: new Date(),
    };
  }

  return {
    check: 'honeypot_pattern',
    outcome: 'inconclusive',
    details: 'Issuer retains the ability to revoke trustline authorization or claw back funds; no recent activity observed',
    checkedAt: new Date(),
  };
}
