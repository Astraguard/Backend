import { horizonServer } from '../shared/stellar.js';
import { db } from '../shared/db.js';
import { childLogger } from '../shared/logger.js';

const log = childLogger('safetynet:tracing');

export interface TraceHop {
  hop: number;
  from: string;
  to: string;
  amount: string;
  assetCode: string;
  txHash: string;
  ledgerCloseTime: string;
}

/**
 * Traces stolen funds forward from the victim's payment, hop by hop, by following outgoing
 * payments from each receiving account. Depth-limited breadth-first walk over Horizon payment
 * history — good enough for early hops; a real investigation still needs an analyst.
 */
export async function traceFunds(
  startAddress: string,
  opts: { maxHops?: number; perHopLimit?: number } = {},
): Promise<TraceHop[]> {
  const maxHops = opts.maxHops ?? 5;
  const perHopLimit = opts.perHopLimit ?? 10;

  const hops: TraceHop[] = [];
  let frontier = [startAddress];
  const visited = new Set<string>([startAddress]);

  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
    const next: string[] = [];

    for (const address of frontier) {
      const page = await horizonServer
        .payments()
        .forAccount(address)
        .order('asc')
        .limit(perHopLimit)
        .call();

      for (const record of page.records as unknown as Record<string, unknown>[]) {
        if (record['type'] !== 'payment' || record['from'] !== address) continue;
        const to = record['to'] as string;
        if (visited.has(to)) continue;

        hops.push({
          hop,
          from: address,
          to,
          amount: record['amount'] as string,
          assetCode: (record['asset_code'] as string) ?? 'XLM',
          txHash: record['transaction_hash'] as string,
          ledgerCloseTime: record['created_at'] as string,
        });

        visited.add(to);
        next.push(to);
      }
    }

    frontier = next;
  }

  log.info({ startAddress, hopsFound: hops.length }, 'fund trace complete');
  return hops;
}

export async function saveTrace(claimId: string, hops: TraceHop[]): Promise<void> {
  await db('claims').where({ id: claimId }).update({ trace: JSON.stringify(hops) });
}
