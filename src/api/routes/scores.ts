import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { redis, scoreCacheKey } from '../../shared/redis.js';
import { computeScore } from '../../scoring/engine.js';
import { scoreSeries } from '../../scoring/history.js';
import { verdictFromScore } from '../../scoring/thresholds.js';

const paramsSchema = z.object({ assetOrContract: z.string().min(1) });
const SCORE_CACHE_TTL_SECONDS = 60;

export function registerScoreRoutes(app: FastifyInstance): void {
  app.get('/v1/scores/:assetOrContract', async (req) => {
    const { assetOrContract } = paramsSchema.parse(req.params);

    const cached = await redis.get(scoreCacheKey(assetOrContract));
    if (cached) return JSON.parse(cached);

    const result = await computeScore(assetOrContract);
    const body = {
      subjectAddress: result.subjectAddress,
      score: result.score,
      verdict: verdictFromScore(result.score, result.hasConfirmedFlag),
      signals: result.signals,
    };

    await redis.set(scoreCacheKey(assetOrContract), JSON.stringify(body), 'EX', SCORE_CACHE_TTL_SECONDS);
    return body;
  });

  app.get('/v1/scores/:assetOrContract/history', async (req) => {
    const { assetOrContract } = paramsSchema.parse(req.params);
    const { since } = z
      .object({ since: z.coerce.date().default(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) })
      .parse(req.query);

    const series = await scoreSeries(assetOrContract, since);
    return { subjectAddress: assetOrContract, points: series };
  });
}
