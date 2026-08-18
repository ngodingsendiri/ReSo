#!/usr/bin/env node
/**
 * scripts/check-manifest-schema.mjs — validasi manifest ekstensi Chrome MV3
 * terhadap aturan yang BENAR-BENAR diperiksa Chrome saat load-unpacked.
 *
 * Kenapa bukan file skema resmi? Chromium modern tidak lagi menyediakan satu
 * JSON Schema untuk manifest top-level (penerapannya ada di C++
 * extensions/common/manifest_*.cc lewat ManifestHandlers), jadi validator
 * semantik ini meng-encode aturan load-unpacked yang relevan:
 *   - format version (1-4 integer dipisah titik)
 *   - match patterns (scheme://host/path) valid
 *   - permissions dikenal (nama tidak dikenal = DITOLAK Chrome)
 *   - run_at enum, background type module, keys ikon, suggested_key,
 *   - referensi file ada (popup/service worker/ikon/js/css),
 *   - kunci top-level tidak dikenal (guard kode mati seperti options_ui).
 *
 * Zero-dependensi (Node bawaan), pola sama dengan zip.mjs / check-yaml.mjs.
 *
 * Pemakaian:
 *   node scripts/check-manifest-schema.mjs [manifest.json ...]
 * Default: manifest.json + dist/manifest.json (yang ada). Error → exit 1.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url)) + "/..";

// =====================================================================
// Aturan — sumber: developer.chrome.com/docs/extensions/reference/manifest
// =====================================================================

/** Kunci top-level yang dikenal MV3 (Chrome mengabaikan yang tidak dikenal,
 *  tapi kita flag sebagai warning supaya kode mati tidak menyusup lagi). */
const KNOWN_TOP_LEVEL = new Set([
  "manifest_version",
  "name",
  "version",
  "version_name",
  "description",
  "minimum_chrome_version",
  "default_locale",
  "icons",
  "action",
  "browser_action", // MV2 — warning
  "page_action", // MV2 — warning
  "background",
  "permissions",
  "optional_permissions",
  "host_permissions",
  "optional_host_permissions",
  "content_scripts",
  "content_security_policy",
  "web_accessible_resources",
  "externally_connectable",
  "incognito",
  "commands",
  "options_page",
  "options_ui",
  "devtools_page",
  "chrome_url_overrides",
  "omnibox",
  "key",
  "author",
  "homepage_url",
  "offline_enabled",
  "short_name",
  "storage",
  "update_url",
  "sandbox",
  "content_capabilities", // deprecated
  "requirements", // deprecated
  "tts_engine",
  "transient_background",
  "user_scripts",
  "declarative_net_request",
  "cross_origin_embedder_policy",
  "cross_origin_opener_policy",
  "export", // deprecated
  "oauth2",
  "signature",
  "platforms",
  "file_browser_handlers",
  "file_system_provider_capabilities",
]);

/** Permission API yang dikenal MV3 — nama lain → DITOLAK Chrome. */
const KNOWN_PERMISSIONS = new Set([
  "activeTab",
  "alarms",
  "background",
  "bookmarks",
  "browsingData",
  "clipboardRead",
  "clipboardWrite",
  "contentSettings",
  "contextMenus",
  "cookies",
  "debugger",
  "declarativeContent",
  "declarativeNetRequest",
  "declarativeNetRequestFeedback",
  "declarativeNetRequestWithHostAccess",
  "dns",
  "downloads",
  "downloads.open",
  "downloads.shelf",
  "experimental",
  "fileBrowserHandler",
  "fileSystemProvider",
  "fontSettings",
  "gcm",
  "geolocation",
  "history",
  "identity",
  "idle",
  "management",
  "nativeMessaging",
  "notifications",
  "offscreen",
  "pageCapture",
  "platformKeys",
  "power",
  "printerProvider",
  "privacy",
  "proxy",
  "readingList",
  "scripting",
  "search",
  "sessions",
  "sidePanel",
  "storage",
  "system.cpu",
  "system.display",
  "system.memory",
  "system.storage",
  "tabCapture",
  "tabGroups",
  "tabs",
  "topSites",
  "tts",
  "ttsEngine",
  "unlimitedStorage",
  "vpnProvider",
  "wallpaper",
  "webNavigation",
  "webRequest",
  "webRequestAuthProvider",
  "windows",
]);

const RUN_AT = new Set(["document_start", "document_end", "document_idle"]);

const ICON_SIZES = new Set([16, 32, 48, 64, 96, 128, 256, 512]);

/** Validasi match pattern Chrome: <scheme>://<host><path>. */
function checkMatchPattern(pattern, path, errors) {
  if (pattern === "<all_urls>") return;
  const m = pattern.match(/^(\*|https?|file|ftp|urn):\/\/([^/]+)(\/.*)?$/);
  if (!m) {
    errors.push(`${path}: match pattern tidak valid — "${pattern}"`);
    return;
  }
  const [, , host, rest] = m;
  if (!host) {
    errors.push(`${path}: host kosong pada pattern "${pattern}"`);
    return;
  }
  if (host.includes("*") && host !== "*" && !/^(\*\.)?[^*]+$/.test(host)) {
    errors.push(`${path}: wildcard host hanya boleh di label kiri — "${pattern}"`);
    return;
  }
  if (/[ ()]/.test(host)) {
    errors.push(`${path}: host mengandung karakter ilegal — "${pattern}"`);
  }
  // Path wajib diawali "/" (atau kosong / "/*").
  if (rest !== undefined && rest !== "" && !rest.startsWith("/")) {
    errors.push(`${path}: path pattern harus diawali "/" — "${pattern}"`);
  }
}

/** Format suggested_key Chrome: satu atau lebih modifier + SATU tombol akhir.
 *  Tombol: A-Z, 0-9, atau nama khusus (Comma, Period, Home, End, PageUp,
 *  PageDown, Space, Insert, Delete, Up/Down/Left/Right, Media*).
 *  Contoh valid: "Ctrl+Shift+E", "Alt+Shift+C", "Ctrl+Y", "MacCtrl+Shift+P". */
function checkSuggestedKey(key, path, errors) {
  const MOD = "(?:Ctrl|Alt|Shift|MacCtrl)";
  const KEY =
    "(?:[A-Z0-9]|Comma|Period|Home|End|PageUp|PageDown|Space|Insert|Delete|" +
    "Up|Down|Left|Right|Media(?:NextTrack|PlayPause|PrevTrack|Stop))";
  if (!new RegExp(`^${MOD}(?:\\+${MOD})*\\+${KEY}$`).test(key)) {
    errors.push(`${path}: suggested_key tidak valid — "${key}"`);
  } else {
    const mods = key.split("+").slice(0, -1);
    if (new Set(mods).size !== mods.length) {
      errors.push(`${path}: suggested_key memuat modifier duplikat — "${key}"`);
    }
  }
}

// =====================================================================
// Validator utama
// =====================================================================

/**
 * Validasi satu manifest. `baseDir` dipakai untuk cek keberadaan file.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateManifest(manifest, baseDir, label) {
  const errors = [];
  const warnings = [];
  const P = (field) => `${label}: ${field}`;

  if (manifest.manifest_version !== 3) {
    errors.push(P("manifest_version harus 3 (MV3), ditemukan " + manifest.manifest_version));
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    errors.push(P("name wajib string non-kosong"));
  }
  if (typeof manifest.version !== "string" || !/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
    errors.push(P(`version tidak valid — "${manifest.version}" (1-4 integer dipisah titik)`));
  }
  if (
    manifest.description !== undefined &&
    (typeof manifest.description !== "string" || manifest.description.length > 132)
  ) {
    errors.push(P("description wajib string ≤ 132 karakter"));
  }
  if (
    manifest.minimum_chrome_version !== undefined &&
    typeof manifest.minimum_chrome_version !== "string"
  ) {
    errors.push(P("minimum_chrome_version wajib string"));
  }

  // Kunci top-level tidak dikenal (warning — Chrome abaikan, tapi kita awasi).
  for (const key of Object.keys(manifest)) {
    if (!KNOWN_TOP_LEVEL.has(key)) {
      warnings.push(P(`kunci top-level tidak dikenal: "${key}"`));
    }
  }
  if (manifest.manifest_version === 2 && manifest.browser_action) {
    warnings.push(P("browser_action adalah MV2 — pindah ke action"));
  }

  // Ikon
  for (const [owner, icons] of [
    ["icons", manifest.icons],
    ["action.default_icon", manifest.action && manifest.action.default_icon],
  ]) {
    if (icons === undefined) continue;
    if (typeof icons !== "object" || Array.isArray(icons)) {
      errors.push(P(`${owner} wajib objek`));
      continue;
    }
    for (const [size, file] of Object.entries(icons)) {
      const n = Number(size);
      if (!ICON_SIZES.has(n)) {
        errors.push(P(`${owner}: ukuran ikon tidak dikenal "${size}" (16/32/48/64/96/128/256/512)`));
      }
      if (typeof file !== "string" || !file.endsWith(".png") && !file.endsWith(".svg")) {
        errors.push(P(`${owner}: "${size}" wajib path file PNG/SVG`));
      }
    }
  }

  // Action
  if (manifest.action !== undefined) {
    if (typeof manifest.action !== "object" || Array.isArray(manifest.action)) {
      errors.push(P("action wajib objek"));
    } else {
      const popup = manifest.action.default_popup;
      if (popup !== undefined && (typeof popup !== "string" || !popup.endsWith(".html"))) {
        errors.push(P("action.default_popup wajib path file .html"));
      }
      if (popup !== undefined && baseDir && !existsSync(join(baseDir, popup))) {
        errors.push(P(`action.default_popup tidak ada di disk: "${popup}"`));
      }
      if (
        manifest.action.default_title !== undefined &&
        typeof manifest.action.default_title !== "string"
      ) {
        errors.push(P("action.default_title wajib string"));
      }
    }
  }

  // Background
  if (manifest.background !== undefined) {
    const bg = manifest.background;
    if (typeof bg !== "object" || Array.isArray(bg)) {
      errors.push(P("background wajib objek"));
    } else {
      if (typeof bg.service_worker !== "string" || !bg.service_worker.endsWith(".js")) {
        errors.push(P("background.service_worker wajib path file .js"));
      } else if (baseDir && !existsSync(join(baseDir, bg.service_worker))) {
        errors.push(P(`background.service_worker tidak ada di disk: "${bg.service_worker}"`));
      }
      if (bg.type !== undefined && bg.type !== "module") {
        errors.push(P(`background.type hanya boleh "module" (ditemukan "${bg.type}")`));
      }
      if (bg.persistent !== undefined && bg.persistent !== false) {
        errors.push(P("background.persistent hanya boleh false di MV3"));
      }
    }
  }

  // Permissions
  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions)) {
      errors.push(P("permissions wajib array"));
    } else {
      for (const p of manifest.permissions) {
        if (typeof p !== "string" || !KNOWN_PERMISSIONS.has(p)) {
          errors.push(P(`permission tidak dikenal (Chrome tolak load): "${p}"`));
        }
      }
      const hp = manifest.host_permissions || [];
      for (const dep of ["webRequest", "scripting"]) {
        if (manifest.permissions.includes(dep) && hp.length === 0) {
          errors.push(P(`${dep} butuh host_permissions (kosong)`));
        }
      }
    }
  }

  // Host permissions + content script matches
  const checkHosts = (arr, field) => {
    if (!Array.isArray(arr)) {
      errors.push(P(`${field} wajib array`));
      return;
    }
    for (const pat of arr) {
      if (typeof pat !== "string") {
        errors.push(P(`${field}: pattern wajib string`));
        continue;
      }
      checkMatchPattern(pat, P(field), errors);
    }
  };
  if (manifest.host_permissions !== undefined) {
    checkHosts(manifest.host_permissions, "host_permissions");
  }
  if (manifest.optional_host_permissions !== undefined) {
    checkHosts(manifest.optional_host_permissions, "optional_host_permissions");
  }

  // Content scripts
  if (manifest.content_scripts !== undefined) {
    if (!Array.isArray(manifest.content_scripts)) {
      errors.push(P("content_scripts wajib array"));
    } else {
      manifest.content_scripts.forEach((cs, i) => {
        const where = P(`content_scripts[${i}]`);
        if (typeof cs !== "object" || Array.isArray(cs)) {
          errors.push(`${where} wajib objek`);
          return;
        }
        if (!Array.isArray(cs.matches) || cs.matches.length === 0) {
          errors.push(`${where}: matches wajib array non-kosong`);
        } else {
          for (const pat of cs.matches) checkMatchPattern(pat, where, errors);
        }
        for (const f of ["js", "css"]) {
          if (cs[f] !== undefined) {
            if (!Array.isArray(cs[f]) || cs[f].some((v) => typeof v !== "string")) {
              errors.push(`${where}: ${f} wajib array string`);
            } else if (baseDir) {
              for (const file of cs[f]) {
                if (!existsSync(join(baseDir, file))) {
                  errors.push(`${where}: ${f} "${file}" tidak ada di disk`);
                }
              }
            }
          }
        }
        if (cs.run_at !== undefined && !RUN_AT.has(cs.run_at)) {
          errors.push(`${where}: run_at harus document_start/end/idle (ditemukan "${cs.run_at}")`);
        }
      });
    }
  }

  // Commands
  if (manifest.commands !== undefined) {
    if (typeof manifest.commands !== "object" || Array.isArray(manifest.commands)) {
      errors.push(P("commands wajib objek"));
    } else {
      for (const [name, cmd] of Object.entries(manifest.commands)) {
        const where = P(`commands.${name}`);
        if (typeof cmd !== "object" || Array.isArray(cmd)) {
          errors.push(`${where} wajib objek`);
          continue;
        }
        if (typeof cmd.description !== "string") {
          errors.push(`${where}: description wajib string`);
        }
        if (cmd.suggested_key) {
          for (const [ctx, key] of Object.entries(cmd.suggested_key)) {
            if (!["default", "mac", "chromeos", "linux", "windows"].includes(ctx)) {
              errors.push(`${where}: konteks suggested_key tidak dikenal "${ctx}"`);
            }
            checkSuggestedKey(key, where, errors);
          }
        }
      }
    }
  }

  // web_accessible_resources MV3: array berisi { resources, matches }
  if (manifest.web_accessible_resources !== undefined) {
    if (!Array.isArray(manifest.web_accessible_resources)) {
      errors.push(P("web_accessible_resources wajib array"));
    } else {
      for (const entry of manifest.web_accessible_resources) {
        if (
          typeof entry !== "object" ||
          !Array.isArray(entry.resources) ||
          !Array.isArray(entry.matches)
        ) {
          errors.push(P("web_accessible_resources entry wajib { resources[], matches[] }"));
        }
      }
    }
  }

  return { errors, warnings };
}

// =====================================================================
// CLI
// =====================================================================
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2);
  const candidates = args.length
    ? args
    : ["manifest.json", "dist/manifest.json"];
  const targets = candidates.filter((f) => existsSync(f));
  if (!targets.length) {
    console.error("check-manifest-schema: tidak ada manifest.json yang ditemukan untuk divalidasi.");
    process.exit(1);
  }

  let exitCode = 0;
  for (const target of targets) {
    const label = relative(ROOT, resolve(target)) || target;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(target, "utf8"));
    } catch (err) {
      console.error(`✗ ${label} — JSON tidak valid: ${err.message}`);
      exitCode = 1;
      continue;
    }
    const { errors, warnings } = validateManifest(manifest, dirname(resolve(target)), label);
    for (const w of warnings) console.log(`⚠ ${w}`);
    if (errors.length) {
      console.error(`✗ ${label} — ${errors.length} kesalahan skema MV3:`);
      for (const e of errors) console.error(`   - ${e}`);
      exitCode = 1;
    } else {
      console.log(`✓ ${label} — skema MV3 valid${warnings.length ? ` (${warnings.length} warning)` : ""}`);
    }
  }
  process.exit(exitCode);
}
