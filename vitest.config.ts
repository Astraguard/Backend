import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      // Matches docker-compose.yml's POSTGRES_DB — integration tests run against the same local
      // dev database, scoped by randomized emails/addresses per test rather than a separate DB.
      DATABASE_URL: 'postgres://astraguard:astraguard@localhost:5432/astraguard',
      REDIS_URL: 'redis://localhost:6379',
      HORIZON_URL: 'https://horizon-testnet.stellar.org',
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      API_KEY_SALT: 'test-salt',
    },
  },
});
