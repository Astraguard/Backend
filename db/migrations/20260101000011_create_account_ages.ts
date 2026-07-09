import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('account_ages', (t) => {
    t.string('subject_address').primary();
    // Earliest operation's created_at is Horizon's closest proxy for account creation — not
    // exact (e.g. a merged-then-recreated account) but the best data available. Populated by
    // indexer/backfill.ts, off the request path — see scoring/engine.ts for why.
    t.timestamp('first_seen_at', { useTz: true }).notNullable();
    t.timestamp('fetched_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('account_ages');
}
