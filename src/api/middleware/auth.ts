import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../../shared/db.js';
import { hashApiKey } from '../../shared/api-keys.js';
import { UnauthorizedError } from '../../shared/errors.js';

export interface ApiKeyContext {
  id: string;
  ownerId: string;
  scopes: string[];
  rateLimitTier: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKeyContext;
  }
}

async function resolveApiKey(rawKey: string): Promise<ApiKeyContext | null> {
  const row = await db('api_keys')
    .where({ key_hash: hashApiKey(rawKey) })
    .whereNull('revoked_at')
    .first();

  if (!row) return null;

  return {
    id: row.id,
    ownerId: row.owner_id,
    scopes: row.scopes ?? [],
    rateLimitTier: row.rate_limit_tier,
  };
}

/**
 * Resolves req.apiKey for every request (not just auth-required routes) as a global onRequest
 * hook. This must run before the rate-limit plugin registers its own onRequest hook so that
 * rate-limit's per-tier max() can read req.apiKey.rateLimitTier — see app.ts registration order.
 */
export function registerAuthResolution(app: FastifyInstance): void {
  app.addHook('onRequest', async (req) => {
    const raw = req.headers['x-api-key'];
    if (typeof raw !== 'string' || !raw) return;
    const key = await resolveApiKey(raw);
    if (key) req.apiKey = key;
  });
}

export function requireApiKey(scope?: string) {
  return async function requireApiKeyHandler(req: FastifyRequest): Promise<void> {
    if (!req.apiKey) throw new UnauthorizedError('Missing or invalid API key');
    if (scope && !req.apiKey.scopes.includes(scope)) {
      throw new UnauthorizedError(`API key missing required scope: ${scope}`);
    }
  };
}
