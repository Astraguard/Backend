import type { Knex } from 'knex';

/**
 * score_history is a TimescaleDB hypertable. The extension/hypertable calls are best-effort:
 * local dev without the timescaledb image (see docker-compose.yml) still gets a plain Postgres
 * table, just without automatic time-partitioning.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('score_history', (t) => {
    t.string('subject_address').notNullable();
    t.decimal('score', 5, 2).notNullable();
    t.jsonb('signals').notNullable().defaultTo('{}'); // per-signal breakdown, see scoring/signals.ts
    t.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('score_history', (t) => {
    t.index(['subject_address', 'recorded_at']);
  });

  try {
    await knex.raw('CREATE EXTENSION IF NOT EXISTS timescaledb');
    await knex.raw(
      "SELECT create_hypertable('score_history', 'recorded_at', if_not_exists => TRUE)",
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[migration] timescaledb extension unavailable — score_history stays a regular table:',
      (err as Error).message,
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('score_history');
}
