import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('audit_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('method').notNullable();
    t.string('path').notNullable();
    t.integer('status_code').notNullable();
    t.uuid('api_key_id').nullable();
    t.string('ip').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('audit_logs', (t) => {
    t.index(['created_at']);
    t.index(['api_key_id']);
  });

  await knex.schema.createTable('partner_webhooks', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('owner_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('url').notNullable();
    t.specificType('events', 'text[]').notNullable().defaultTo('{}'); // score_change | registry_flag | claim_decision
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('partner_webhooks', (t) => {
    t.index(['owner_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('partner_webhooks');
  await knex.schema.dropTableIfExists('audit_logs');
}
