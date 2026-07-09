import { sorobanServer } from '../shared/stellar.js';
import { childLogger } from '../shared/logger.js';
import { getQueue, QUEUE_NAMES } from '../shared/queue.js';

const log = childLogger('indexer:soroban');

export interface ContractEvent {
  contractId: string;
  type: string;
  ledger: number;
  topics: unknown[];
  value: unknown;
}

/**
 * Polls Soroban RPC getEvents for contract invocations/events. Soroban RPC has no long-lived
 * stream (unlike Horizon), so this runs as an interval poll — see backfill.ts for catch-up.
 */
export function startSorobanPoller(
  contractIds: string[],
  pollIntervalMs = 5000,
): () => void {
  let cursor: string | undefined;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const latest = await sorobanServer.getLatestLedger();
      const startLedger = cursor ? undefined : Math.max(latest.sequence - 100, 1);

      const response = await sorobanServer.getEvents({
        ...(startLedger ? { startLedger } : {}),
        ...(cursor ? { cursor } : {}),
        filters: contractIds.map((contractId) => ({
          type: 'contract',
          contractIds: [contractId],
        })),
      } as Parameters<typeof sorobanServer.getEvents>[0]);

      for (const event of response.events) {
        await handleContractEvent(event as unknown as Record<string, unknown>);
      }
      const last = response.events[response.events.length - 1];
      cursor = (last?.pagingToken as string | undefined) ?? cursor;
    } catch (err) {
      log.error({ err }, 'soroban event poll failed');
    } finally {
      if (!stopped) setTimeout(tick, pollIntervalMs);
    }
  };

  void tick();

  return () => {
    stopped = true;
    log.info('stopped Soroban poller');
  };
}

async function handleContractEvent(event: Record<string, unknown>): Promise<void> {
  // event.contractId is a stellar-sdk Contract instance, not a raw string — normalize via
  // toString() (its strkey representation) rather than assuming the SDK's shape.
  const raw = event['contractId'];
  const contractId = raw == null ? undefined : String(raw);
  log.debug({ contractId }, 'soroban contract event received');
  if (!contractId) return;

  await getQueue(QUEUE_NAMES.scoreRecompute).add(
    'recompute',
    { subjectAddress: contractId, reason: 'soroban_event' },
    { removeOnComplete: 1000, removeOnFail: 1000 },
  );
}
