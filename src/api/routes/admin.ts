import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db.js';
import { ensureUser, issueApiKey, revokeApiKey } from '../../shared/api-keys.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { requireApiKey } from '../middleware/auth.js';

const VALID_SCOPES = [
  'admin:api-keys',
  'registry:review',
  'certification:decide',
  'claims:review',
] as const;

const VALID_TIERS = ['standard', 'partner', 'internal'] as const;

const issueKeySchema = z.object({
  /** Email of the user to issue the key for. Created if it doesn't exist. */
  ownerEmail: z.string().email(),
  /** Human-readable label for the key (e.g. "prod-partner-acme"). */
  label: z.string().min(1).max(100).default('admin-issued'),
  /** Scopes to grant. Must be a subset of the known scope list. */
  scopes: z
    .array(z.enum(VALID_SCOPES))
    .min(1, 'At least one scope is required'),
  /** Rate-limit tier for this key. */
  rateLimitTier: z.enum(VALID_TIERS).default('standard'),
  /** Optional role to assign when creating a new user (ignored for existing users). */
  role: z.enum(['analyst', 'admin', 'partner']).default('analyst'),
});

const listQuerySchema = z.object({
  includeRevoked: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  ownerId: z.string().uuid().optional(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Admin routes for API key management.
 * All routes require the `admin:api-keys` scope — only keys seeded via `npm run seed`
 * (or previously issued admin keys) can access these endpoints.
 */
export function registerAdminRoutes(app: FastifyInstance): void {
  /**
   * POST /v1/admin/api-keys
   * Issue a new API key for a user (by email). The user is created if they don't exist.
   * The raw key is returned exactly once and never stored.
   */
  app.post(
    '/v1/admin/api-keys',
    { preHandler: requireApiKey('admin:api-keys') },
    async (req, reply) => {
      const input = issueKeySchema.parse(req.body);

      // Ensure the target user exists (creates with given role if new).
      const ownerId = await ensureUser(input.ownerEmail, input.role);

      const issued = await issueApiKey(ownerId, {
        label: input.label,
        scopes: input.scopes as string[],
        rateLimitTier: input.rateLimitTier,
      });

      reply.status(201);
      return {
        apiKey: {
          id: issued.keyId,
          ownerId: issued.ownerId,
          ownerEmail: input.ownerEmail,
          label: input.label,
          scopes: input.scopes,
          rateLimitTier: input.rateLimitTier,
          // Returned exactly once — not stored, never retrievable again.
          rawKey: issued.rawKey,
        },
      };
    },
  );

  /**
   * GET /v1/admin/api-keys
   * List all API keys (admin-wide view). Supports filtering by owner and including revoked keys.
   * The key_hash is never returned.
   */
  app.get(
    '/v1/admin/api-keys',
    { preHandler: requireApiKey('admin:api-keys') },
    async (req) => {
      const { includeRevoked, limit, offset, ownerId } = listQuerySchema.parse(req.query);

      // If filtering by a specific owner, verify that owner exists.
      if (ownerId) {
        const user = await db('users').where({ id: ownerId }).first();
        if (!user) throw new NotFoundError('User');
      }

      let query = db('api_keys')
        .join('users', 'api_keys.owner_id', 'users.id')
        .select(
          'api_keys.id',
          'api_keys.owner_id',
          'users.email as owner_email',
          'api_keys.label',
          'api_keys.scopes',
          'api_keys.rate_limit_tier',
          'api_keys.created_at',
          'api_keys.revoked_at',
        )
        .orderBy('api_keys.created_at', 'desc')
        .limit(limit)
        .offset(offset);

      if (!includeRevoked) {
        query = query.whereNull('api_keys.revoked_at');
      }

      if (ownerId) {
        query = query.where('api_keys.owner_id', ownerId);
      }

      const rows = await query;

      return {
        apiKeys: rows.map((r) => ({
          id: r.id,
          ownerId: r.owner_id,
          ownerEmail: r.owner_email,
          label: r.label,
          scopes: r.scopes,
          rateLimitTier: r.rate_limit_tier,
          createdAt: r.created_at,
          revokedAt: r.revoked_at ?? null,
        })),
        pagination: { limit, offset },
      };
    },
  );

  /**
   * DELETE /v1/admin/api-keys/:id
   * Revoke an API key by ID (soft-delete via revoked_at). Idempotent — revoking an already-
   * revoked key returns 409 so callers can distinguish "was active, now revoked" from
   * "already revoked".
   */
  app.delete(
    '/v1/admin/api-keys/:id',
    { preHandler: requireApiKey('admin:api-keys') },
    async (req) => {
      const { id } = idParamsSchema.parse(req.params);

      // Verify the key exists before attempting revocation.
      const key = await db('api_keys').where({ id }).first();
      if (!key) throw new NotFoundError('API key');

      if (key.revoked_at) {
        throw new ValidationError('API key is already revoked');
      }

      const revoked = await revokeApiKey(id);
      if (!revoked) {
        // Race condition: key was revoked between the check and the update.
        throw new ValidationError('API key is already revoked');
      }

      return { revoked: true, id };
    },
  );
}
