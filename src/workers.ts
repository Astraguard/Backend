import { createWorker } from './shared/queue.js';
import { QUEUE_NAMES } from './shared/queue.js';
import { logger } from './shared/logger.js';
import { closeDb } from './shared/db.js';
import { closeRedis } from './shared/redis.js';
import { closeQueues } from './shared/queue.js';
import { recomputeAndPersist } from './scoring/engine.js';
import { propagateConfirmedFlag } from './registry/propagation.js';
import { traceFunds, saveTrace } from './safetynet/tracing.js';
import { notifyExchanges } from './safetynet/exchange-alerts.js';
import { getClaim } from './safetynet/claims.js';
import { db } from './shared/db.js';
import { signWebhookPayload } from './shared/webhook-signing.js';

/**
 * Background job workers for the queues declared in shared/queue.ts. Run as a separate process
 * from the API server (`npm run workers`) so ingestion/scoring load doesn't compete with request
 * latency — see src/index.ts.
 */

// Maps alert-dispatch job names to the partner_webhooks.events a hook must be subscribed to.
const JOB_TO_WEBHOOK_EVENT: Record<string, string> = {
  'score-drop': 'score_change',
  'registry-flag': 'registry_flag',
};

const scoreWorker = createWorker<{ subjectAddress: string; reason: string }>(
  QUEUE_NAMES.scoreRecompute,
  async (job) => {
    await recomputeAndPersist(job.data.subjectAddress, { reason: job.data.reason });
  },
);

const registryWorker = createWorker<{ reportId: string }>(
  QUEUE_NAMES.registryPropagation,
  async (job) => {
    await propagateConfirmedFlag(job.data.reportId);
  },
);

const alertWorker = createWorker<Record<string, unknown>>(QUEUE_NAMES.alertDispatch, async (job) => {
  const targetAddress = (job.data.targetAddress ?? job.data.subjectAddress) as string | undefined;
  if (!targetAddress) return;

  const eventName = JOB_TO_WEBHOOK_EVENT[job.name];
  const webhooks = eventName
    ? await db('partner_webhooks').where({ active: true }).whereRaw('? = ANY(events)', [eventName])
    : [];

  const payload = JSON.stringify({ event: eventName, jobName: job.name, ...job.data });

  await Promise.all(
    webhooks.map((hook) =>
      fetch(hook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-astraguard-signature': signWebhookPayload(hook.secret, payload),
        },
        body: payload,
      }).catch((err) => logger.error({ err, webhookId: hook.id }, 'partner webhook dispatch failed')),
    ),
  );

  if (job.name === 'registry-flag') {
    await notifyExchanges({ targetAddress, reason: `registry:${job.data.category}` }).catch((err) =>
      logger.error({ err }, 'exchange alert dispatch failed'),
    );
  }
});

const claimTracingWorker = createWorker<{ claimId: string }>(QUEUE_NAMES.claimTracing, async (job) => {
  const claim = await getClaim(job.data.claimId);
  const hops = await traceFunds(claim.victimAddress);
  await saveTrace(job.data.claimId, hops);
});

for (const worker of [scoreWorker, registryWorker, alertWorker, claimTracingWorker]) {
  worker.on('failed', (job, err) => logger.error({ err, jobId: job?.id, queue: worker.name }, 'job failed'));
}

logger.info('workers started');

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'workers shutting down');
  await Promise.all([scoreWorker.close(), registryWorker.close(), alertWorker.close(), claimTracingWorker.close()]);
  await Promise.all([closeDb(), closeRedis(), closeQueues()]);
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
