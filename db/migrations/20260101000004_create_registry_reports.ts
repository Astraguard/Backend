import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('registry_reports', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('target_address').notNullable();
    t.string('category').notNullable(); // phishing | rug_pull | honeypot | impersonation | other
    // Evidence may contain victim data — access-logged, never exposed via the public API.
    t.jsonb('evidence').notNullable().defaultTo('{}');
    t.string('status').notNullable().defaultTo('pending'); // pending | endorsed | confirmed | rejected
    t.uuid('reporter_id').nullable().references('id').inTable('users');
    t.uuid('endorsed_by').nullable().references('id').inTable('users');
    t.uuid('confirmed_by').nullable().references('id').inTable('users');
    t.string('anchor_tx_hash').nullable(); // set once propagation.ts anchors the confirmed flag
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('resolved_at', { useTz: true }).nullable();
  });

  await knex.schema.alterTable('registry_reports', (t) => {
    t.index(['target_address']);
    t.index(['status']);
    // The two-person rule requires distinct endorsing/confirming analysts — enforced in
    // registry/review.ts application logic (a CHECK constraint can't compare against reporter_id
    // easily across nullable columns, so this stays app-level).
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('registry_reports');
}
