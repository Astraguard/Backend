#!/usr/bin/env node
/**
 * Route-vs-spec drift checker
 *
 * Compares every HTTP route registered in src/api/routes/*.ts against the paths
 * declared in src/api/openapi.yaml.  Exits non-zero if any Fastify route is missing
 * from the spec, so drift is caught in CI before it reaches the frontend build.
 *
 * Normalisation rules applied to both sides before comparison:
 *   Fastify  :param  →  {param}    (Fastify colon-style → OpenAPI brace-style)
 *   Trailing slashes are stripped.
 *
 * Usage:
 *   node scripts/check-routes-drift.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 1.  Parse spec paths from openapi.yaml
//     We avoid a full YAML parser on purpose — the paths block is simple enough
//     for a targeted regex, and it keeps the script dependency-free at runtime.
// ---------------------------------------------------------------------------

const specText = readFileSync(resolve(ROOT, 'src/api/openapi.yaml'), 'utf8');

const specPaths = new Set();
// Match top-level path keys: lines that start with "  /..." inside the paths: block.
let inPaths = false;
for (const line of specText.split('\n')) {
  if (/^paths:/.test(line)) { inPaths = true; continue; }
  if (inPaths && /^\S/.test(line) && !/^paths:/.test(line)) { inPaths = false; }
  if (inPaths) {
    const m = line.match(/^  (\/[^\s:]+):/);
    if (m) specPaths.add(normalisePath(m[1]));
  }
}

// ---------------------------------------------------------------------------
// 2.  Extract Fastify route registrations from source files
//     Scans every .ts under src/api/routes/ and src/api/app.ts for:
//       app.get('/...',    app.post('/...',   app.delete('/...',  etc.
// ---------------------------------------------------------------------------

import { readdirSync } from 'fs';

const routeFiles = [
  resolve(ROOT, 'src/api/app.ts'),
  ...readdirSync(resolve(ROOT, 'src/api/routes'))
    .filter(f => f.endsWith('.ts'))
    .map(f => resolve(ROOT, 'src/api/routes', f)),
];

const registeredRoutes = [];   // { method, path, file }

const ROUTE_RE = /app\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`](\/[^'"`]+)['"`]/g;

for (const file of routeFiles) {
  const src = readFileSync(file, 'utf8');
  let m;
  while ((m = ROUTE_RE.exec(src)) !== null) {
    registeredRoutes.push({
      method: m[1].toUpperCase(),
      path: normalisePath(m[2]),
      file: file.replace(ROOT + '/', ''),
    });
  }
}

// ---------------------------------------------------------------------------
// 3.  Diff: every Fastify path must exist in the spec paths set
// ---------------------------------------------------------------------------

const missing = registeredRoutes.filter(r => !specPaths.has(r.path));

// ---------------------------------------------------------------------------
// 4.  Report
// ---------------------------------------------------------------------------

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET  = '\x1b[0m';

console.log('\n── OpenAPI route-vs-spec drift check ─────────────────────────────────\n');
console.log(`  Spec paths found   : ${specPaths.size}`);
console.log(`  Fastify routes found: ${registeredRoutes.length}`);
console.log();

if (missing.length === 0) {
  console.log(`${GREEN}✓ No drift detected — all Fastify routes are present in openapi.yaml${RESET}\n`);
  process.exit(0);
} else {
  console.error(`${RED}✗ ${missing.length} Fastify route(s) are missing from openapi.yaml:${RESET}\n`);
  for (const r of missing) {
    console.error(`  ${YELLOW}${r.method.padEnd(7)}${RESET} ${r.path}  ${YELLOW}(${r.file})${RESET}`);
  }
  console.error(
    `\n  Add the missing path(s) to src/api/openapi.yaml, then re-run this check.\n`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert Fastify :param notation to OpenAPI {param}, strip trailing slash. */
function normalisePath(p) {
  return p
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')  // :id → {id}
    .replace(/\/+$/, '');                              // strip trailing slash
}
