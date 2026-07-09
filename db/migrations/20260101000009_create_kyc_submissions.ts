import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('kyc_submissions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('team_member_name').notNullable();
    // Pointer into encrypted storage — never the raw document. KYC data needs the strictest
    // access isolation, which is why this table (and not a generic evidence/jsonb blob) exists
    // as its own schema surface.
    t.string('document_ref').notNullable();
    t.string('status').notNullable().defaultTo('pending'); // pending | verified | rejected
    t.string('decided_by').nullable();
    t.timestamp('submitted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('decided_at', { useTz: true }).nullable();
  });

  await knex.schema.alterTable('kyc_submissions', (t) => {
    t.index(['project_id', 'submitted_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('kyc_submissions');
}
