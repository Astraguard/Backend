import { describe, expect, it } from 'vitest';
import { compileWasm, wasmExports, wasmImports, wasmCustomSections } from '../src/verification/static/wasm-runtime.js';

/**
 * Hand-assembled minimal WASM module (magic + version, one empty-signature type, one function
 * of that type, exported as "foo", with a trivial `end`-only body). Verified against Node's
 * native WebAssembly API before writing — see conversation notes — so this exercises the exact
 * runtime behavior fetchWasmStructure() relies on without needing network access to a real
 * deployed contract.
 */
const MINIMAL_WASM = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, // magic "\0asm"
  0x01, 0x00, 0x00, 0x00, // version 1
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type section: 1 type, () -> ()
  0x03, 0x02, 0x01, 0x00, // function section: 1 function, type index 0
  0x07, 0x07, 0x01, 0x03, 0x66, 0x6f, 0x6f, 0x00, 0x00, // export section: "foo" -> func 0
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b, // code section: 1 body, no locals, `end`
]);

describe('wasm-runtime', () => {
  it('compiles a minimal module and reports its exports', async () => {
    const mod = await compileWasm(MINIMAL_WASM);
    expect(wasmExports(mod)).toEqual([{ name: 'foo', kind: 'function' }]);
  });

  it('reports no imports for a module with none', async () => {
    const mod = await compileWasm(MINIMAL_WASM);
    expect(wasmImports(mod)).toEqual([]);
  });

  it('reports no contractspecv0 section when none is present', async () => {
    const mod = await compileWasm(MINIMAL_WASM);
    expect(wasmCustomSections(mod, 'contractspecv0')).toEqual([]);
  });

  it('rejects malformed bytes', async () => {
    await expect(compileWasm(Uint8Array.from([0x00, 0x01, 0x02]))).rejects.toThrow();
  });
});
