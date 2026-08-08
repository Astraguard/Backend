import { db, closeDb } from '../src/shared/db.js';
import { ensureUser, issueApiKey } from '../src/shared/api-keys.js';

/**
 * Bootstraps a local/dev environment with one admin user + API key. This creates the initial
 * key that can then be used to provision additional keys via POST /v1/admin/api-keys.
 */
async function main(): Promise<void> {
  const email = process.argv[2] ?? 'admin@astraguard.dev';

  const ownerId = await ensureUser(email, 'admin');
  const { rawKey, keyId } = await issueApiKey(ownerId, {
    label: 'seed-admin',
    scopes: ['admin:api-keys', 'registry:review', 'certification:decide', 'claims:review'],
    rateLimitTier: 'internal',
  });

  console.log(`User:    ${email} (${ownerId})`);
  console.log(`Key ID:  ${keyId}`);
  console.log(`API key (shown once — store it now):`);
  console.log(rawKey);
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exitCode = 1;
  });
