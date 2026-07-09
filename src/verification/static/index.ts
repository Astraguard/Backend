import { Client } from '@stellar/stellar-sdk/contract';
import { Networks } from '@stellar/stellar-sdk';
import { config } from '../../shared/config.js';
import { sorobanServer } from '../../shared/stellar.js';
import { childLogger } from '../../shared/logger.js';
import type { VerificationResult } from '../types.js';
import { compileWasm, wasmExports, wasmImports } from './wasm-runtime.js';

const log = childLogger('verification:static');

/**
 * Name substrings that are an unambiguous red flag regardless of context — a real audit still
 * requires reading the code, but a contract exporting a function literally named like this is
 * a hard fail on its face.
 */
const KNOWN_RISK_PATTERNS = [
  /unchecked_admin_transfer/i,
  /self_destruct/i,
  /unbounded_mint/i,
  /backdoor/i,
];

/** Functions worth a human's attention, without claiming anything is wrong with them. */
const PRIVILEGED_NAME_PATTERNS = [
  /^set_admin/i,
  /^upgrade/i,
  /^withdraw/i,
  /^pause/i,
  /^unpause/i,
  /^mint/i,
  /^burn/i,
  /^set_/i,
];

export interface WasmStructure {
  functionNames: string[];
  hasContractSpec: boolean;
  importCount: number;
  exportCount: number;
}

function toStr(v: string | Buffer): string {
  return typeof v === 'string' ? v : v.toString('utf8');
}

/**
 * Fetches the deployed WASM and extracts real structural facts: exported function names (via
 * the Soroban contract spec custom section when present, falling back to raw WASM exports when
 * it's absent — `stellar contract optimize` strips it by design, so a missing spec section is
 * not itself suspicious), plus import/export counts.
 */
export async function fetchWasmStructure(contractId: string): Promise<WasmStructure> {
  const wasm = await sorobanServer.getContractWasmByContractId(contractId);
  const wasmModule = await compileWasm(wasm);

  const exports = wasmExports(wasmModule);
  const imports = wasmImports(wasmModule);

  let functionNames: string[];
  let hasContractSpec = false;

  try {
    const networkPassphrase = config.stellar.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
    const client = await Client.fromWasm(wasm, {
      contractId,
      networkPassphrase,
      rpcUrl: config.stellar.sorobanRpcUrl,
    });
    functionNames = client.spec.funcs().map((f) => toStr(f.name()));
    hasContractSpec = true;
  } catch {
    functionNames = exports.filter((e) => e.kind === 'function').map((e) => e.name);
  }

  return {
    functionNames,
    hasContractSpec,
    importCount: imports.length,
    exportCount: exports.length,
  };
}

export async function runStaticAnalysis(
  contractId: string,
  wasmHash: string,
): Promise<VerificationResult> {
  log.info({ contractId, wasmHash }, 'running static analysis');

  let structure: WasmStructure;
  try {
    structure = await fetchWasmStructure(contractId);
  } catch (err) {
    log.warn({ err, contractId }, 'could not fetch/parse contract WASM');
    return {
      check: 'static_analysis',
      outcome: 'inconclusive',
      details: `Could not fetch or parse WASM for ${contractId}: ${(err as Error).message}`,
      checkedAt: new Date(),
    };
  }

  const riskHits = structure.functionNames.filter((name) =>
    KNOWN_RISK_PATTERNS.some((pattern) => pattern.test(name)),
  );

  if (riskHits.length > 0) {
    return {
      check: 'static_analysis',
      outcome: 'fail',
      details: `Exported function name(s) match known risk patterns: ${riskHits.join(', ')}`,
      checkedAt: new Date(),
    };
  }

  const privileged = structure.functionNames.filter((name) =>
    PRIVILEGED_NAME_PATTERNS.some((pattern) => pattern.test(name)),
  );

  // Name-matching alone can't prove a privileged function is safe or unsafe — that needs a
  // human reading the actual logic (this doesn't attempt decompilation). This stays
  // inconclusive even on a clean pass; it surfaces real facts for review rather than
  // rubber-stamping "verified".
  return {
    check: 'static_analysis',
    outcome: 'inconclusive',
    details:
      `Fetched real WASM (${structure.hasContractSpec ? 'contract spec present' : 'no contract spec — likely an optimized build'}), ` +
      `${structure.exportCount} exports / ${structure.importCount} imports. ` +
      (privileged.length > 0
        ? `Privileged-sounding functions for manual review: ${privileged.join(', ')}.`
        : 'No privileged-sounding function names found.'),
    checkedAt: new Date(),
  };
}

export { KNOWN_RISK_PATTERNS, PRIVILEGED_NAME_PATTERNS };
