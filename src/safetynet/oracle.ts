import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  nativeToScVal,
  rpc as SorobanRpc,
} from '@stellar/stellar-sdk';
import { config } from '../shared/config.js';
import { loadOracleKeypair, sorobanServer, horizonServer } from '../shared/stellar.js';
import { childLogger } from '../shared/logger.js';

const log = childLogger('safetynet:oracle');

/**
 * Signs and submits the oracle's privileged transactions to astraguard-contracts.
 *
 * The oracle key must live in a KMS/HSM in production — loadOracleKeypair() currently reads
 * from env, which is dev/testnet-only. Swap that loader for a KMS-backed signer before this
 * ever points at mainnet.
 */
async function submitContractCall(
  contractId: string,
  method: string,
  args: unknown[],
): Promise<string> {
  const keypair = loadOracleKeypair();
  if (!keypair) {
    log.warn({ contractId, method }, 'oracle key not configured — skipping on-chain submission');
    return 'dev-noop-tx';
  }

  const source = await horizonServer.loadAccount(keypair.publicKey());
  const contract = new Contract(contractId);
  const networkPassphrase =
    config.stellar.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase })
    .addOperation(contract.call(method, ...args.map((a) => nativeToScVal(a))))
    .setTimeout(30)
    .build();

  const prepared = await sorobanServer.prepareTransaction(tx);
  prepared.sign(keypair);

  const result = await sorobanServer.sendTransaction(prepared);
  if (result.status === 'ERROR') {
    throw new Error(`Oracle transaction failed: ${JSON.stringify(result.errorResult)}`);
  }

  log.info({ contractId, method, hash: result.hash }, 'oracle transaction submitted');
  return await pollUntilFinal(result.hash);
}

async function pollUntilFinal(hash: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await sorobanServer.getTransaction(hash);
    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return hash;
    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Oracle transaction ${hash} failed on-chain`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Oracle transaction ${hash} did not finalize within ${timeoutMs}ms`);
}

export interface AnchorFlagInput {
  recordHash: string;
  category: string;
  timestamp: number;
}

export async function anchorRegistryFlag(input: AnchorFlagInput): Promise<string> {
  if (!config.contracts.registryAnchorId) {
    log.warn('REGISTRY_ANCHOR_CONTRACT_ID not set — returning dev no-op tx hash');
    return 'dev-noop-tx';
  }
  return submitContractCall(config.contracts.registryAnchorId, 'anchor_flag', [
    input.recordHash,
    input.category,
    input.timestamp,
  ]);
}

export type CoverageStatusCall = 'ineligible' | 'eligible' | 'active' | 'paused' | 'revoked';

export async function setCoverageStatus(
  projectId: string,
  status: CoverageStatusCall,
): Promise<string> {
  if (!config.contracts.insurancePoolId) {
    log.warn('INSURANCE_POOL_CONTRACT_ID not set — returning dev no-op tx hash');
    return 'dev-noop-tx';
  }
  return submitContractCall(config.contracts.insurancePoolId, 'set_coverage', [projectId, status]);
}
