import path from 'node:path';
import knex, { type Knex } from 'knex';
import { config } from './config.js';

export const db: Knex = knex({
  client: 'pg',
  connection: config.database.url,
  pool: { min: 2, max: 10 },
  migrations: {
    directory: path.resolve(process.cwd(), 'db/migrations'),
    extension: 'ts',
    loadExtensions: ['.ts'],
  },
});

export async function closeDb(): Promise<void> {
  await db.destroy();
}

export async function checkDbConnection(): Promise<boolean> {
  try {
    await db.raw('select 1');
    return true;
  } catch {
    return false;
  }
}
