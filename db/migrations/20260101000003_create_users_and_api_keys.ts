import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('email').notNullable().unique();
    t.string('role').notNullable().defaultTo('analyst'); // analyst | admin | partner
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('api_keys', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('owner_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('key_hash').notNullable().unique(); // sha256(key + API_KEY_SALT), never store raw keys
    t.string('label').notNullable().defaultTo('default');
    t.specificType('scopes', 'text[]').notNullable().defaultTo('{}');
    t.string('rate_limit_tier').notNullable().defaultTo('standard');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('revoked_at', { useTz: true }).nullable();
  });

  await knex.schema.alterTable('api_keys', (t) => {
    t.index(['owner_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('api_keys');
  await knex.schema.dropTableIfExists('users');
}
