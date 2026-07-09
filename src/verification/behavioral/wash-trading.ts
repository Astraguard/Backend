export interface PaymentLike {
  from: string;
  to: string;
  amount: string;
  createdAt: string; // ISO
}

const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_TOLERANCE_PCT = 5;

function amountsMatch(a: string, b: string, tolerancePct: number): boolean {
  const numA = Number(a);
  const numB = Number(b);
  if (!Number.isFinite(numA) || !Number.isFinite(numB) || numA === 0) return false;
  return Math.abs(numA - numB) / numA <= tolerancePct / 100;
}

/**
 * Counts circular payment pairs: the subject sends to X, then X sends a similar amount back
 * within the window. A hallmark of wash trading — inflating apparent volume without a real
 * transfer of value. Pure function over already-fetched records so it's unit-testable without
 * a live Horizon call — see behavioral/index.ts for the fetch wrapper.
 */
export function countCircularPayments(
  payments: PaymentLike[],
  subjectAddress: string,
  opts: { windowMs?: number; tolerancePct?: number } = {},
): number {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const tolerancePct = opts.tolerancePct ?? DEFAULT_TOLERANCE_PCT;

  const outgoing = payments.filter((p) => p.from === subjectAddress);
  const incoming = payments.filter((p) => p.to === subjectAddress);

  let count = 0;
  for (const out of outgoing) {
    const outTime = new Date(out.createdAt).getTime();
    const matched = incoming.some(
      (inc) =>
        inc.from === out.to &&
        amountsMatch(inc.amount, out.amount, tolerancePct) &&
        Math.abs(new Date(inc.createdAt).getTime() - outTime) <= windowMs,
    );
    if (matched) count += 1;
  }
  return count;
}

export { DEFAULT_WINDOW_MS, DEFAULT_TOLERANCE_PCT };
