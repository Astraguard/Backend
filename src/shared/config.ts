import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres://')),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  STELLAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  HORIZON_URL: z.string().url(),
  SOROBAN_RPC_URL: z.string().url(),

  ORACLE_PUBLIC_KEY: z.string().optional().default(''),
  ORACLE_SECRET_KEY: z.string().optional().default(''),

  API_KEY_SALT: z.string().min(1),

  KYC_PROVIDER_API_KEY: z.string().optional().default(''),

  // astraguard-contracts deployment IDs (see that repo's deployments/ per network).
  // Left blank until contracts are deployed — oracle calls no-op with a warning until set.
  REGISTRY_ANCHOR_CONTRACT_ID: z.string().optional().default(''),
  INSURANCE_POOL_CONTRACT_ID: z.string().optional().default(''),

  EXCHANGE_ALERT_WEBHOOK_URL: z.string().url().optional().or(z.literal('')).default(''),

  // Comma-separated allowed origins for the dashboard/extension in production. In non-production
  // the dev server reflects any origin (see api/app.ts) so this is unused outside prod.
  CORS_ORIGINS: z.string().optional().default(''),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}

export const env = loadEnv();

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  database: {
    url: env.DATABASE_URL,
  },
  redis: {
    url: env.REDIS_URL,
  },
  stellar: {
    network: env.STELLAR_NETWORK,
    horizonUrl: env.HORIZON_URL,
    sorobanRpcUrl: env.SOROBAN_RPC_URL,
  },
  oracle: {
    publicKey: env.ORACLE_PUBLIC_KEY,
    secretKey: env.ORACLE_SECRET_KEY,
  },
  auth: {
    apiKeySalt: env.API_KEY_SALT,
  },
  kyc: {
    providerApiKey: env.KYC_PROVIDER_API_KEY,
  },
  contracts: {
    registryAnchorId: env.REGISTRY_ANCHOR_CONTRACT_ID,
    insurancePoolId: env.INSURANCE_POOL_CONTRACT_ID,
  },
  alerts: {
    exchangeWebhookUrl: env.EXCHANGE_ALERT_WEBHOOK_URL,
  },
  cors: {
    origins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  },
} as const;
