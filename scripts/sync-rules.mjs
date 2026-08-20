#!/usr/bin/env node
/**
 * scripts/sync-rules.mjs — Generate api/provision-rules.ts dari firestore.rules.
 *
 * SUMBER TUNGGAL keamanan Firestore = firestore.rules. Vercel function
 * (api/provision.ts) butuh isinya sebagai string TS — file ini dipakai oleh
 * GitHub Actions (dan manual) agar tidak ada duplikasi yang drift.
 *
 * Run: node scripts/sync-rules.mjs
 * Output: api/provision-rules.ts (AUTO-GENERATED, jangan edit manual)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const rulesPath = join(root, 'firestore.rules');
const outPath = join(root, 'api', 'provision-rules.ts');

const rules = readFileSync(rulesPath, 'utf8');
const content = JSON.stringify(rules);

const ts =
  '// AUTO-GENERATED dari firestore.rules (jangan edit manual).\n' +
  "// Jalankan: node scripts/sync-rules.mjs\n" +
  'export const FIRESTORE_RULES: string = ' +
  content +
  ';\n';

writeFileSync(outPath, ts, 'utf8');
console.log(`✓ ${outPath} (${rules.length} chars) dari firestore.rules`);
