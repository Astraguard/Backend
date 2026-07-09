import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from '../shared/config.js';
import { checkDbConnection } from '../shared/db.js';
import { redis } from '../shared/redis.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { registerAuditLog } from './middleware/audit-log.js';
import { registerAuthResolution } from './middleware/auth.js';
import { registerScoreRoutes } from './routes/scores.js';
import { registerScanRoutes } from './routes/scan.js';
import { registerRegistryRoutes } from './routes/registry.js';
import { registerCertificationRoutes } from './routes/certification.js';
import { registerClaimRoutes } from './routes/claims.js';
import { registerWebhookRoutes } from './routes/webhooks.js';

/**
 * Per-key rate limit tiers (api_keys.rate_limit_tier). Keys with no match, and anonymous
 * callers, fall back to 'standard'. The public API is rate-limited per key; the scanner
 * endpoint stays anonymous-capable but abuse-throttled.
 */
const STANDARD_TIER = { max: 100, timeWindow: '1 minute' };
const RATE_LIMIT_TIERS: Record<string, { max: number; timeWindow: string }> = {
  standard: STANDARD_TIER,
  partner: { max: 500, timeWindow: '1 minute' },
  internal: { max: 1000, timeWindow: '1 minute' },
};

function maxForRequest(req: FastifyRequest): number {
  const tier = req.apiKey?.rateLimitTier ?? 'standard';
  return (RATE_LIMIT_TIERS[tier] ?? STANDARD_TIER).max;
}

// Fastify creates its own pino instance from these options (rather than reusing shared/logger's
// instance directly) — passing an already-built pino instance narrows FastifyInstance's logger
// generic and breaks route registration types across files.
const loggerOptions = config.isProduction
  ? { level: config.logLevel }
  : {
      level: config.logLevel,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    };

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions });

  await app.register(sensible);
  await app.register(cors, { origin: config.isProduction ? config.cors.origins : true });

  // Must run before rate-limit registers its own onRequest hook, so max() below can read
  // req.apiKey.rateLimitTier (Fastify runs same-named hooks in registration order).
  registerAuthResolution(app);

  await app.register(rateLimit, {
    max: maxForRequest,
    timeWindow: '1 minute',
    keyGenerator: (req) => (req.apiKey?.id ? `key:${req.apiKey.id}` : `ip:${req.ip}`),
  });

  registerErrorHandler(app);
  registerAuditLog(app);

  app.get('/health', async () => {
    const [dbOk, redisOk] = await Promise.all([
      checkDbConnection(),
      redis.ping().then(() => true).catch(() => false),
    ]);
    return { status: dbOk && redisOk ? 'ok' : 'degraded', db: dbOk, redis: redisOk };
  });

  registerScoreRoutes(app);
  registerScanRoutes(app);
  registerRegistryRoutes(app);
  registerCertificationRoutes(app);
  registerClaimRoutes(app);
  registerWebhookRoutes(app);

  return app;
}

export { config };
