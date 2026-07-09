import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { redis, scanCacheKey } from '../../shared/redis.js';
import { computeScore } from '../../scoring/engine.js';
import { verdictFromScore, SCAN_CACHE_TTL_SECONDS } from '../../scoring/thresholds.js';

const scanBodySchema = z.object({
  destination: z.string().min(1),
  contractId: z.string().optional(),
  operationType: z.string().optional(),
});

/**
 * Pre-transaction scan — the extension's "money moment" hook. Latency budget ≤150ms: try
 * Redis first, only fall back to a live score computation on a miss.
 */
export function registerScanRoutes(app: FastifyInstance): void {
  app.post('/v1/scan', async (req) => {
    const body = scanBodySchema.parse(req.body);
    const subject = body.contractId ?? body.destination;

    const cached = await redis.get(scanCacheKey(subject));
    if (cached) return JSON.parse(cached);

    const result = await computeScore(subject);
    const verdict = verdictFromScore(result.score, result.hasConfirmedFlag);

    const reasons = Object.entries(result.signals)
      .filter(([, value]) => (value ?? 100) < 50)
      .map(([signal]) => signal);

    const body_ = { verdict, score: result.score, reasons };

    await redis.set(scanCacheKey(subject), JSON.stringify(body_), 'EX', SCAN_CACHE_TTL_SECONDS);
    return body_;
  });
}
