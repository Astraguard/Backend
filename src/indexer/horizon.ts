import { horizonServer } from '../shared/stellar.js';
import { childLogger } from '../shared/logger.js';
import { getQueue, QUEUE_NAMES } from '../shared/queue.js';
import { db } from '../shared/db.js';

const log = childLogger('indexer:horizon');

export interface HorizonCursorState {
  payments: string;
  accounts: string;
}

/**
 * Streams payments and account changes from Horizon and enqueues a score-recompute job for any
 * affected address. This is the "did money move" signal feeding scoring/engine.ts.
 */
export function startHorizonStream(cursor: string = 'now'): () => void {
  log.info({ cursor }, 'starting Horizon payment stream');

  const closePayments = horizonServer
    .payments()
    .cursor(cursor)
    .stream({
      onmessage: async (payment) => {
        await handlePayment(payment as unknown as Record<string, unknown>);
      },
      onerror: (err) => {
        log.error({ err }, 'Horizon payment stream error');
      },
    });

  return () => {
    closePayments();
    log.info('stopped Horizon payment stream');
  };
}

async function handlePayment(payment: Record<string, unknown>): Promise<void> {
  const to = payment['to'] as string | undefined;
  const from = payment['from'] as string | undefined;

  for (const address of [to, from].filter((a): a is string => Boolean(a))) {
    await getQueue(QUEUE_NAMES.scoreRecompute).add(
      'recompute',
      { subjectAddress: address, reason: 'horizon_payment' },
      { removeOnComplete: 1000, removeOnFail: 1000 },
    );
  }
}

/** Persists the last-processed Horizon cursor so a restart resumes instead of re-streaming history. */
export async function saveCursor(stream: keyof HorizonCursorState, cursor: string): Promise<void> {
  await db('indexer_cursors')
    .insert({ stream, cursor, updated_at: new Date() })
    .onConflict('stream')
    .merge();
}
