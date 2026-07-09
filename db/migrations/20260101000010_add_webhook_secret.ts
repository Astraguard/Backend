import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('partner_webhooks', (t) => {
    // HMAC-SHA256 signing secret, shown once at registration. Lets a partner verify a payload
    // actually came from us — see safetynet dispatch in src/workers.ts.
    t.string('secret').notNullable().defaultTo('');
  });

  await knex('partner_webhooks').update({
    secret: knex.raw("encode(gen_random_bytes(32), 'hex')"),
  });

  await knex.schema.alterTable('partner_webhooks', (t) => {
    t.string('secret').notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('partner_webhooks', (t) => {
    t.dropColumn('secret');
  });
}
