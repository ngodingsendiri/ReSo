#!/usr/bin/env node
/**
 * scripts/check-yaml.mjs — validasi sintaks YAML workflow GitHub Actions.
 *
 * Zero-dependensi (hanya Node bawaan), pola yang sama dengan scripts/zip.mjs.
 *
 * Kenapa ada: workflow YAML yang rusak tidak terlihat sampai di-push — GitHub
 * langsung menggagalkan run-nya dengan 0 job (persis yang terjadi di
 * release.yml v1.0.47: baris lanjutan --notes di kolom 0 memutus literal
 * block `run: |` dan menjadi key YAML tak dikenal di level root). Checker ini
 * dijalankan dari `npm run check`, sehingga CI (tiap push/PR) menolak file
 * workflow yang rusak SEBELUM push.
 *
 * Yang diperiksa:
 *   1. Tab di indentasi, indentasi tidak konsisten
 *   2. Block scalar (`|` / `>`) — konten wajib lebih dalam dari key-nya;
 *      baris yang tidak ter-indentasi MENGENTIKAN block dan diproses sebagai
 *      node baru (akar dari bug v1.0.47)
 *   3. Kutip tunggal/ganda tidak seimbang di luar block scalar
 *   4. Ekspresi ${{ }} tidak seimbang (dievaluasi GitHub di mana pun, termasuk
 *      di dalam `run:`)
 *   5. Baris bukan key/sequence-item di dalam mapping
 *   6. Key duplikat (warning — beberapa parser YAML membiarkannya, GitHub
 *      menolaknya; dilaporkan agar aman)
 *   7. Skema workflow GitHub: key root hanya dari set yang dikenal, `on` +
 *      `jobs` wajib, tiap job punya runs-on (atau uses reusable) + steps,
 *      tiap step punya name/uses/run
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const WORKFLOWS_DIR = join(ROOT, ".github", "workflows");

const ALLOWED_ROOT_KEYS = new Set([
  "name",
  "on",
  "permissions",
  "concurrency",
  "env",
  "defaults",
  "jobs",
  "run-name",
]);

// ---- util kecil ----
const isBlank = (s) => s.trim() === "";
const indentOf = (s) => (s.match(/^ */) || [""])[0].length;
const isKeyLine = (t) => /^[^:#][^:]*:(\s|$)/.test(t) && !t.startsWith("- ");
const keyOf = (t) => t.slice(0, t.indexOf(":")).trim();
const isBlockScalarMark = (v) => /^[|>][+-]?\d*$/.test((v || "").trim());
const countToken = (s, tok) => (s.match(new RegExp(tok.replace(/[$]/, "\\$&"), "g")) || []).length;
// dipakai di pesan error — jangan tulis ${{ }} langsung di template literal (ter-interpolasi!)
const EXPR_TAG = "${{ }}";

// =====================================================================
// Parse struktural — bangun pohon context map/seq, deteksi kesalahan
// indentasi, block scalar, kutip, dan ${{ }}.
// =====================================================================
function parseYaml(src, file) {
  const errors = [];
  const warnings = [];
  const rootKeys = [];

  const content = [];
  for (const [idx, raw] of src.split(/\r?\n/).entries()) {
    if (isBlank(raw)) continue;
    if (raw.trimStart().startsWith("#")) continue;
    content.push({ raw, no: idx + 1, indent: indentOf(raw), trimmed: raw.trim() });
  }
  if (content.length === 0) return { errors, warnings, rootKeys };

  // stack context: { kind: "map" | "seq", indent, keys:Set, attributed }.
  // root map indent = -2 (key-nya di indent >= 0). Map baru di-push tiap key;
  // seq di-push saat baris dash; item map di-push untuk key di dalam seq.
  const stack = [{ kind: "map", indent: -2, keys: new Set(), attributed: null }];
  const pushMap = (indent, attributed) => {
    const ctx = { kind: "map", indent, keys: new Set(), attributed };
    stack.push(ctx);
    return ctx;
  };
  const addKey = (ctx, key) => {
    if (ctx.keys.has(key)) warnings.push(`key duplikat "${key}"`);
    ctx.keys.add(key);
  };

  let blockScalar = null; // indent key block scalar yang sedang aktif
  let i = 0;
  const n = content.length;

  for (; i < n; i++) {
    const { raw, no, indent, trimmed: t } = content[i];

    if (/^\t/.test(raw)) {
      errors.push(`baris ${no}: TAB di indentasi — YAML menolak tab`);
      continue;
    }

    // konten block scalar: abaikan semuanya kecuali keseimbangan ${{ }}
    if (blockScalar !== null) {
      if (indent > blockScalar) {
        const o = countToken(raw, "${{");
        const c = countToken(raw, "}}");
        if (o !== c) errors.push(`baris ${no}: ${EXPR_TAG} tidak seimbang (${o} buka, ${c} tutup)`);
        continue;
      }
      blockScalar = null; // baris kurang dalam dari key → block berakhir
    }

    // keluar dari context yang lebih dalam dari baris ini
    while (stack.length > 1 && stack[stack.length - 1].indent > indent) stack.pop();
    while (stack.length > 1 && stack[stack.length - 1].indent === indent && stack[stack.length - 1].kind !== "seq") stack.pop();

    const top = stack[stack.length - 1];

    // ---- baris sequence item (dash) ----
    if (t === "-" || t.startsWith("- ")) {
      const item = t === "-" ? "" : t.slice(2).trim();
      if (top.kind === "map" && indent > top.indent) {
        // seq baru sebagai nilai key saat ini
        stack.push({ kind: "seq", indent, keys: new Set(), attributed: null });
      } else if (top.kind === "seq" && indent === top.indent) {
        // dash saudara — lanjutkan seq yang sama
      } else {
        errors.push(`baris ${no}: dash di posisi tidak valid (indent ${indent})`);
        continue;
      }
      if (item && isKeyLine(item)) {
        // item berbentuk `- key: value` → map implisit
        const itemCtx = pushMap(indent, "item");
        const key = keyOf(item);
        const value = item.slice(item.indexOf(":") + 1).trim();
        addKey(itemCtx, key);
        if (!isBlockScalarMark(value)) {
          if (countToken(value, '"') % 2 !== 0) errors.push(`baris ${no}: kutip ganda tidak seimbang di nilai "${key}"`);
          if (countToken(value, "'") % 2 !== 0) errors.push(`baris ${no}: kutip tunggal tidak seimbang di nilai "${key}"`);
        }
        const ob = countToken(value, "${{");
        const cb = countToken(value, "}}");
        if (ob !== cb) errors.push(`baris ${no}: ${EXPR_TAG} tidak seimbang di nilai "${key}" (${ob} buka, ${cb} tutup)`);
        if (isBlockScalarMark(value)) blockScalar = indent;
      }
      continue;
    }

    // ---- baris key mapping ----
    if (isKeyLine(t)) {
      const key = keyOf(t);
      const value = t.slice(t.indexOf(":") + 1).trim();
      if (top.kind !== "map" || indent <= top.indent) {
        errors.push(`baris ${no}: key "${key}" di posisi tidak valid (indent ${indent}, konteks ${top.kind})`);
        continue;
      }
      addKey(top, key);
      if (stack[0] === top) rootKeys.push(key);

      // kutip seimbang di nilai scalar (bukan block scalar)
      if (!isBlockScalarMark(value)) {
        const dq = countToken(value, '"');
        const sq = countToken(value, "'");
        if (dq % 2 !== 0) errors.push(`baris ${no}: kutip ganda tidak seimbang di nilai "${key}"`);
        if (sq % 2 !== 0) errors.push(`baris ${no}: kutip tunggal tidak seimbang di nilai "${key}"`);
      }
      const ob = countToken(value, "${{");
      const cb = countToken(value, "}}");
      if (ob !== cb) errors.push(`baris ${no}: ${EXPR_TAG} tidak seimbang di nilai "${key}" (${ob} buka, ${cb} tutup)`);

      if (isBlockScalarMark(value)) blockScalar = indent;
      else pushMap(indent, key); // nilai ini bisa punya konten lebih dalam
      continue;
    }

    // ---- baris lain: bukan key, bukan dash ----
    errors.push(
      `baris ${no}: baris tidak dikenal — bukan "key: value" maupun "- item" (untuk nilai multi-baris gunakan block scalar "|")`,
    );
  }

  return { errors, warnings, rootKeys: [...new Set(rootKeys)] };
}

// =====================================================================
// Cek skema workflow GitHub — struktur level atas + job/step wajib.
// =====================================================================
function schemaCheck(content, errors) {
  const n = content.length;
  const rootKeys = [];
  for (const l of content) {
    if (l.indent === 0 && isKeyLine(l.trimmed)) rootKeys.push(keyOf(l.trimmed));
  }
  for (const k of rootKeys) {
    if (!ALLOWED_ROOT_KEYS.has(k)) {
      errors.push(`key root tidak dikenal: "${k}" — GitHub menolak workflow dengan key ini`);
    }
  }
  if (!rootKeys.includes("on")) errors.push("wajib ada key root: on");
  if (!rootKeys.includes("jobs")) errors.push("wajib ada key root: jobs");
  if (!rootKeys.includes("jobs")) return;

  const jobsIdx = content.findIndex((l) => l.indent === 0 && keyOf(l.trimmed) === "jobs");
  for (let i = jobsIdx + 1; i < n; i++) {
    const l = content[i];
    if (l.indent < 2) break; // keluar dari blok jobs
    if (l.indent !== 2 || !isKeyLine(l.trimmed)) continue;
    const job = keyOf(l.trimmed);

    // properti job: key di indent 4, sampai baris indent <= 2
    const props = new Set();
    let j = i + 1;
    while (j < n && content[j].indent > 2) {
      const ll = content[j];
      if (ll.indent === 4 && isKeyLine(ll.trimmed)) props.add(keyOf(ll.trimmed));
      j++;
    }

    if (!props.has("runs-on") && !props.has("uses")) {
      errors.push(`job "${job}": wajib punya runs-on (atau uses untuk reusable workflow)`);
    }
    if (props.has("runs-on") && !props.has("steps") && !props.has("uses")) {
      errors.push(`job "${job}": wajib punya steps`);
    }

    // step: dash di indent 6, key item di indent 8
    if (props.has("steps")) {
      const stepsIdx = content.findIndex(
        (ll, k) => k > i && k < j && ll.indent === 4 && keyOf(ll.trimmed) === "steps",
      );
      if (stepsIdx >= 0) {
        for (let k = stepsIdx + 1; k < j; k++) {
          const sl = content[k];
          if (sl.indent !== 6 || !sl.trimmed.startsWith("- ")) continue;
          const itemKeys = new Set();
          let m = k + 1;
          while (m < j && content[m].indent > 6) {
            const ml = content[m];
            if (ml.indent === 8 && isKeyLine(ml.trimmed)) itemKeys.add(keyOf(ml.trimmed));
            m++;
          }
          const hasAny = itemKeys.has("name") || itemKeys.has("uses") || itemKeys.has("run");
          if (!hasAny) {
            errors.push(`job "${job}": step tanpa name/uses/run — GitHub menolak`);
          }
        }
      }
    }
  }
}

// =====================================================================
// API publik
// =====================================================================
export function checkYamlContent(src, file = "workflow.yml") {
  const { errors, warnings, rootKeys } = parseYaml(src, file);
  const content = [];
  for (const [idx, raw] of src.split(/\r?\n/).entries()) {
    if (isBlank(raw)) continue;
    if (raw.trimStart().startsWith("#")) continue;
    content.push({ raw, no: idx + 1, indent: indentOf(raw), trimmed: raw.trim() });
  }
  if (content.length > 0) schemaCheck(content, errors);
  return { errors, warnings, rootKeys };
}

export function checkWorkflowsDir(dir = WORKFLOWS_DIR) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  } catch {
    return { files: [], results: [] };
  }
  files.sort();
  const results = [];
  for (const f of files) {
    const p = join(dir, f);
    if (!statSync(p).isFile()) continue;
    results.push({ file: f, ...checkYamlContent(readFileSync(p, "utf8"), f) });
  }
  return { files, results };
}

// =====================================================================
// CLI
// =====================================================================
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { files, results } = checkWorkflowsDir();
  if (files.length === 0) {
    console.log(`ℹ tidak ada file workflow di ${WORKFLOWS_DIR} — dilewati`);
    process.exit(0);
  }
  let fail = 0;
  for (const r of results) {
    if (r.errors.length === 0) {
      console.log(`✓ ${r.file} — YAML & skema OK`);
    } else {
      fail++;
      console.log(`✗ ${r.file} — ${r.errors.length} masalah:`);
      for (const e of r.errors) console.log(`   - ${e}`);
    }
    for (const w of r.warnings) console.log(`  ⚠ ${r.file}: ${w}`);
  }
  if (fail > 0) {
    console.error(`✗ ${fail} file workflow bermasalah — perbaiki sebelum push.`);
    process.exit(1);
  }
  console.log(`✓ ${results.length} file workflow valid (${files.join(", ")})`);
}
