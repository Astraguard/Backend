import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('certifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('status').notNullable().defaultTo('pending'); // pending | approved | rejected
    t.jsonb('checklist').notNullable().defaultTo('{}'); // static / behavioral / reserves / kyc results
    t.string('decided_by').nullable();
    t.timestamp('submitted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('decided_at', { useTz: true }).nullable();
  });

  await knex.schema.alterTable('certifications', (t) => {
    t.index(['project_id']);
    t.index(['status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('certifications');
}
