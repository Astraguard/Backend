import { horizonServer } from '../shared/stellar.js';
import { childLogger } from '../shared/logger.js';
import { getQueue, QUEUE_NAMES } from '../shared/queue.js';
import { fetchAccountCreatedAt, recordAccountAge } from './account-age.js';

const log = childLogger('indexer:backfill');

/**
 * One-shot historical sync for a newly-registered address/contract, so its trust score
 * isn't computed from zero history. Run via a job, not on the request path.
 */
export async function backfillAddress(address: string, opts: { pageLimit?: number } = {}): Promise<number> {
  const pageLimit = opts.pageLimit ?? 5;
  log.info({ address, pageLimit }, 'starting backfill');

  let page = await horizonServer.payments().forAccount(address).limit(200).order('desc').call();
  let processed = 0;
  let pagesFetched = 0;

  while (pagesFetched < pageLimit) {
    processed += page.records.length;
    pagesFetched += 1;
    if (page.records.length === 0) break;
    page = await page.next();
  }

  const createdAt = await fetchAccountCreatedAt(address);
  if (createdAt) await recordAccountAge(address, createdAt);

  await getQueue(QUEUE_NAMES.scoreRecompute).add('recompute', {
    subjectAddress: address,
    reason: 'backfill_complete',
  });

  log.info({ address, processed, createdAt }, 'backfill complete');
  return processed;
}
