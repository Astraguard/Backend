import { db, closeDb } from '../src/shared/db.js';
import { ensureUser, issueApiKey } from '../src/shared/api-keys.js';

/**
 * Bootstraps a local/dev environment with one admin user + API key. There's no self-serve
 * signup in this product (registry analysts and partners are provisioned internally per
 * ARCHITECTURE.md), so this script — not a public endpoint — is the intended way to get a
 * first usable key.
 */
async function main(): Promise<void> {
  const email = process.argv[2] ?? 'admin@astraguard.dev';

  const ownerId = await ensureUser(email, 'admin');
  const { rawKey, keyId } = await issueApiKey(ownerId, {
    label: 'seed-admin',
    scopes: ['registry:review', 'certification:decide', 'claims:review'],
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
