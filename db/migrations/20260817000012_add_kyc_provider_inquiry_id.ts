import type { Knex } from 'knex';

/**
 * Add provider_inquiry_id to kyc_submissions.
 *
 * Stores the KYC provider's (Persona) inquiry ID so:
 *  - Inbound webhooks can be correlated to a submission without scanning PII
 *  - The analyst UI can link directly to the Persona dashboard inquiry
 *  - The column is nullable — older/manual-review records stay unaffected
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('kyc_submissions', (t) => {
    t.string('provider_inquiry_id').nullable().after('document_ref');
    t.index(['provider_inquiry_id'], 'kyc_submissions_provider_inquiry_id_idx');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('kyc_submissions', (t) => {
    t.dropIndex([], 'kyc_submissions_provider_inquiry_id_idx');
    t.dropColumn('provider_inquiry_id');
  });
}
