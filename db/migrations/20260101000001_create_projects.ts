import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  await knex.schema.createTable('projects', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name').notNullable();
    t.string('issuer_address').notNullable().unique();
    t.string('category').notNullable().defaultTo('unknown');
    t.string('coverage_status').notNullable().defaultTo('ineligible');
    // Denormalized latest score for fast reads; source of truth is score_history.
    t.decimal('latest_score', 5, 2).nullable();
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('projects', (t) => {
    t.index(['category']);
    t.index(['coverage_status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('projects');
}
