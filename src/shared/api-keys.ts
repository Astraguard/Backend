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
