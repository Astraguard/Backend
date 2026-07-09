import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('claims', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').notNullable().references('id').inTable('projects');
    t.string('victim_address').notNullable();
    t.decimal('amount', 20, 7).notNullable();
    t.string('asset_code').notNullable();
    t.string('evidence_hash').notNullable(); // hash of off-chain evidence bundle
    t.string('status').notNullable().defaultTo('filed'); // filed | in_review | approved | rejected | paid
    t.jsonb('trace').notNullable().defaultTo('[]'); // safetynet/tracing.ts hop-by-hop trail
    t.string('payout_tx_hash').nullable();
    t.timestamp('filed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('decided_at', { useTz: true }).nullable();
  });

  await knex.schema.alterTable('claims', (t) => {
    t.index(['project_id']);
    t.index(['status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('claims');
}
