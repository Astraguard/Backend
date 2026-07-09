import { describe, expect, it } from 'vitest';
import { countCircularPayments } from '../src/verification/behavioral/wash-trading.js';
import { countRecentSignerChanges } from '../src/verification/behavioral/admin-key.js';

describe('countCircularPayments', () => {
  const SUBJECT = 'GSUBJECT';
  const COUNTERPARTY = 'GCOUNTERPARTY';
  const now = new Date('2026-01-01T12:00:00Z').getTime();

  it('counts a matching send-then-return pair within the window', () => {
    const payments = [
      { from: SUBJECT, to: COUNTERPARTY, amount: '100', createdAt: new Date(now).toISOString() },
      {
        from: COUNTERPARTY,
        to: SUBJECT,
        amount: '99.5',
        createdAt: new Date(now + 5 * 60_000).toISOString(),
      },
    ];
    expect(countCircularPayments(payments, SUBJECT, { windowMs: 60 * 60_000, tolerancePct: 5 })).toBe(1);
  });

  it('does not count a return outside the tolerance', () => {
    const payments = [
      { from: SUBJECT, to: COUNTERPARTY, amount: '100', createdAt: new Date(now).toISOString() },
      {
        from: COUNTERPARTY,
        to: SUBJECT,
        amount: '50', // 50% off, well outside 5% tolerance
        createdAt: new Date(now + 5 * 60_000).toISOString(),
      },
    ];
    expect(countCircularPayments(payments, SUBJECT, { windowMs: 60 * 60_000, tolerancePct: 5 })).toBe(0);
  });

  it('does not count a return outside the time window', () => {
    const payments = [
      { from: SUBJECT, to: COUNTERPARTY, amount: '100', createdAt: new Date(now).toISOString() },
      {
        from: COUNTERPARTY,
        to: SUBJECT,
        amount: '100',
        createdAt: new Date(now + 2 * 60 * 60_000).toISOString(), // 2h later
      },
    ];
    expect(countCircularPayments(payments, SUBJECT, { windowMs: 60 * 60_000, tolerancePct: 5 })).toBe(0);
  });

  it('does not count one-directional payments', () => {
    const payments = [
      { from: SUBJECT, to: COUNTERPARTY, amount: '100', createdAt: new Date(now).toISOString() },
      { from: SUBJECT, to: 'GOTHER', amount: '50', createdAt: new Date(now + 60_000).toISOString() },
    ];
    expect(countCircularPayments(payments, SUBJECT)).toBe(0);
  });
});

describe('countRecentSignerChanges', () => {
  const now = Date.now();

  it('counts signer/threshold effects within the window', () => {
    const effects = [
      { type: 'signer_created', createdAt: new Date(now - 60_000).toISOString() },
      { type: 'account_thresholds_updated', createdAt: new Date(now - 120_000).toISOString() },
      { type: 'account_credited', createdAt: new Date(now - 60_000).toISOString() }, // not a signer effect
    ];
    expect(countRecentSignerChanges(effects, 24 * 60 * 60_000)).toBe(2);
  });

  it('excludes effects outside the window', () => {
    const effects = [
      { type: 'signer_removed', createdAt: new Date(now - 48 * 60 * 60_000).toISOString() },
    ];
    expect(countRecentSignerChanges(effects, 24 * 60 * 60_000)).toBe(0);
  });

  it('returns 0 for an account with no signer history', () => {
    expect(countRecentSignerChanges([], 24 * 60 * 60_000)).toBe(0);
  });
});
