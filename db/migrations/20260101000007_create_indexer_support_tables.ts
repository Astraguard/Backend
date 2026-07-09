import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('indexer_cursors', (t) => {
    t.string('stream').primary(); // 'payments' | 'accounts' | ...
    t.string('cursor').notNullable();
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('reserve_attestations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.decimal('issued_supply', 24, 7).notNullable();
    t.decimal('attested_reserves', 24, 7).notNullable();
    t.decimal('ratio', 10, 6).notNullable();
    t.string('source').notNullable();
    t.timestamp('attested_at', { useTz: true }).notNullable();
  });

  await knex.schema.alterTable('reserve_attestations', (t) => {
    t.index(['project_id', 'attested_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('reserve_attestations');
  await knex.schema.dropTableIfExists('indexer_cursors');
}
