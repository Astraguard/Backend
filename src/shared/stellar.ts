import { Horizon, rpc as SorobanRpc, Keypair } from '@stellar/stellar-sdk';
import { config } from './config.js';

export const horizonServer = new Horizon.Server(config.stellar.horizonUrl);
export const sorobanServer = new SorobanRpc.Server(config.stellar.sorobanRpcUrl);

/**
 * Loads the oracle keypair used for privileged contract calls (set_coverage, anchor_flag, ...).
 * In production this must be replaced with a KMS/HSM-backed signer per ARCHITECTURE.md §2.4 —
 * this env-based loader is dev/testnet only.
 */
export function loadOracleKeypair(): Keypair | null {
  if (!config.oracle.secretKey) return null;
  return Keypair.fromSecret(config.oracle.secretKey);
}

export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address) || /^C[A-Z2-7]{55}$/.test(address);
}
