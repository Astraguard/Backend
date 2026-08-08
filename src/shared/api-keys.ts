import { randomBytes, createHash } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(`${rawKey}${config.auth.apiKeySalt}`).digest('hex');
}

export async function ensureUser(email: string, role = 'analyst'): Promise<string> {
  const existing = await db('users').where({ email }).first();
  if (existing) return existing.id;

  const [row] = await db('users').insert({ email, role }).returning('id');
  return row.id;
}

export interface IssueApiKeyOptions {
  label?: string;
  scopes?: string[];
  rateLimitTier?: string;
}

export interface IssuedApiKey {
  rawKey: string;
  keyId: string;
  ownerId: string;
}

/** Returns the raw key exactly once — only the hash is ever persisted. */
export async function issueApiKey(
  ownerId: string,
  opts: IssueApiKeyOptions = {},
): Promise<IssuedApiKey> {
  const rawKey = randomBytes(24).toString('hex');

  const [row] = await db('api_keys')
    .insert({
      owner_id: ownerId,
      key_hash: hashApiKey(rawKey),
      label: opts.label ?? 'default',
      scopes: opts.scopes ?? [],
      rate_limit_tier: opts.rateLimitTier ?? 'standard',
    })
    .returning('id');

  return { rawKey, keyId: row.id, ownerId };
}

/**
 * Soft-deletes an API key by setting revoked_at. Returns true if the key existed and was
 * revoked, false if it was already revoked or did not exist.
 */
export async function revokeApiKey(keyId: string): Promise<boolean> {
  const updated = await db('api_keys')
    .where({ id: keyId })
    .whereNull('revoked_at')
    .update({ revoked_at: new Date() });

  return updated > 0;
}

/** Returns all non-revoked (or all) API keys for a given owner, omitting the key_hash. */
export async function listApiKeysForOwner(
  ownerId: string,
  opts: { includeRevoked?: boolean } = {},
): Promise<
  Array<{
    id: string;
    ownerId: string;
    label: string;
    scopes: string[];
    rateLimitTier: string;
    createdAt: Date;
    revokedAt: Date | null;
  }>
> {
  let query = db('api_keys')
    .where({ owner_id: ownerId })
    .select('id', 'owner_id', 'label', 'scopes', 'rate_limit_tier', 'created_at', 'revoked_at')
    .orderBy('created_at', 'desc');

  if (!opts.includeRevoked) {
    query = query.whereNull('revoked_at');
  }

  const rows = await query;
  return rows.map((r) => ({
    id: r.id,
    ownerId: r.owner_id,
    label: r.label,
    scopes: r.scopes,
    rateLimitTier: r.rate_limit_tier,
    createdAt: r.created_at,
    revokedAt: r.revoked_at ?? null,
  }));
}

/** Lists all API keys across all owners (admin view), excluding key_hash. */
export async function listAllApiKeys(opts: {
  includeRevoked?: boolean;
  limit?: number;
  offset?: number;
}): Promise<
  Array<{
    id: string;
    ownerId: string;
    label: string;
    scopes: string[];
    rateLimitTier: string;
    createdAt: Date;
    revokedAt: Date | null;
  }>
> {
  let query = db('api_keys')
    .select('id', 'owner_id', 'label', 'scopes', 'rate_limit_tier', 'created_at', 'revoked_at')
    .orderBy('created_at', 'desc')
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);

  if (!opts.includeRevoked) {
    query = query.whereNull('revoked_at');
  }

  const rows = await query;
  return rows.map((r) => ({
    id: r.id,
    ownerId: r.owner_id,
    label: r.label,
    scopes: r.scopes,
    rateLimitTier: r.rate_limit_tier,
    createdAt: r.created_at,
    revokedAt: r.revoked_at ?? null,
  }));
}
