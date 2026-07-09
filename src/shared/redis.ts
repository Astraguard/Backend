import { Redis } from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

export async function closeRedis(): Promise<void> {
  await redis.quit();
}

/** Cache used by the /v1/scan hot path — see scoring/thresholds.ts for TTL policy. */
export const scanCacheKey = (assetOrContract: string): string => `scan:verdict:${assetOrContract}`;

export const scoreCacheKey = (assetOrContract: string): string => `score:${assetOrContract}`;
