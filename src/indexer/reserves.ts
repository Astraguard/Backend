import { childLogger } from '../shared/logger.js';
import { db } from '../shared/db.js';

const log = childLogger('indexer:reserves');

export interface ReserveAttestation {
  projectId: string;
  issuedSupply: string;
  attestedReserves: string;
  source: string;
  attestedAt: Date;
}

/**
 * Reserve ratio = attestedReserves / issuedSupply. Feeds the "reserves" signal in
 * scoring/signals.ts and the certification checklist in verification/reserves.
 *
 * The attestation source (custodian API, proof-of-reserves oracle, manual upload) is
 * project-specific and not yet standardized — this ingests whatever is fetched upstream.
 */
export async function recordAttestation(attestation: ReserveAttestation): Promise<void> {
  const ratio =
    Number(attestation.attestedReserves) / Math.max(Number(attestation.issuedSupply), 1);

  log.info({ projectId: attestation.projectId, ratio }, 'recorded reserve attestation');

  await db('reserve_attestations').insert({
    project_id: attestation.projectId,
    issued_supply: attestation.issuedSupply,
    attested_reserves: attestation.attestedReserves,
    ratio,
    source: attestation.source,
    attested_at: attestation.attestedAt,
  });
}

export async function latestRatio(projectId: string): Promise<number | null> {
  const row = await db('reserve_attestations')
    .where({ project_id: projectId })
    .orderBy('attested_at', 'desc')
    .first();
  return row ? Number(row.ratio) : null;
}
