/**
 * TypeScript's Node-facing lib configs (ES2022 etc.) don't declare the `WebAssembly` global as a
 * value — only "DOM"/"webworker" libs do, even though it's a real Node global. Pulling in "DOM"
 * for one API would leak browser globals across the whole project, so this is a thin typed
 * wrapper around the actual runtime global instead.
 */
export interface WasmExportEntry {
  name: string;
  kind: string;
}

export interface WasmImportEntry {
  module: string;
  name: string;
  kind: string;
}

interface WebAssemblyGlobal {
  compile(bytes: Uint8Array): Promise<unknown>;
  Module: {
    exports(module: unknown): WasmExportEntry[];
    imports(module: unknown): WasmImportEntry[];
    customSections(module: unknown, sectionName: string): ArrayBuffer[];
  };
}

const wasm = (globalThis as unknown as { WebAssembly: WebAssemblyGlobal }).WebAssembly;

export async function compileWasm(bytes: Uint8Array): Promise<unknown> {
  return wasm.compile(bytes);
}

export function wasmExports(module: unknown): WasmExportEntry[] {
  return wasm.Module.exports(module);
}

export function wasmImports(module: unknown): WasmImportEntry[] {
  return wasm.Module.imports(module);
}

export function wasmCustomSections(module: unknown, sectionName: string): ArrayBuffer[] {
  return wasm.Module.customSections(module, sectionName);
}
