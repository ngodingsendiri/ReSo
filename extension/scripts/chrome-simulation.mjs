#!/usr/bin/env node
/**
 * Chrome simulation — IG/FB/TT rekap end-to-end di Chrome asli (Playwright)
 * Tanpa login real: pakai halaman fake + intercept API, tapi jalankan engine
 * ASLI (inject-*.js) di V8 Chrome, bukan Node mock.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const sharedJs = readFileSync(join(ROOT, "shared.js"), "utf8");
const injectTT = readFileSync(join(ROOT, "inject-tiktok.js"), "utf8");
const injectIG = readFileSync(join(ROOT, "inject-ig.js"), "utf8");
const injectFB = readFileSync(join(ROOT, "inject-fb.js"), "utf8");

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (e) {
  console.error("Gagal launch Chromium via Playwright:", e.message);
  process.exit(1);
}
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on("console", (m) => {
  const t = m.type();
  if (t === "error") console.log("[Chrome console.error]", m.text());
});

// Helper: run engine in page
async function runTT() {
  // Fake TikTok page: rehydration + comment API mock via page.route
  await page.route("**/api/comment/list**", async (route) => {
    const url = route.request().url();
    const u = new URL(url);
    const cursor = Number(u.searchParams.get("cursor") || 0);
    const has_more = cursor < 60;
    const body = JSON.stringify({
      comments: has_more
        ? [{ user: { nickname: `TT_User_${cursor}` }, cid: String(cursor) }]
        : [],
      has_more: has_more ? 1 : 0,
      cursor: cursor + 30,
      total: 90,
    });
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });

  await page.setContent(`
    <html><body>
      <div data-e2e="comment-list"><div data-e2e="comment-username-1">ExistingDom</div></div>
      <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{"__DEFAULT_SCOPE__":{"webapp.video-detail":{"itemInfo":{"itemStruct":{"createTime": 1714000000}}}}}</script>
    </body></html>
  `, { waitUntil: "domcontentloaded" });

  await page.addScriptTag({ content: sharedJs });
  // Inject TikTok engine
  await page.addScriptTag({ content: injectTT });

  const ready = await page.evaluate(() => {
    return !!window.__RESO_TNK__ && typeof window.__RESO_TNK__.start === "function";
  });
  if (!ready) throw new Error("TT engine not injected");

  const result = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("TT timeout 12s")), 12000);
      const handler = (e) => {
        if (e.source !== window) return;
        const d = e.data;
        if (!d || d.source !== "tt-nama-komentar-inject") return;
        if (d.type === "DONE") {
          clearTimeout(timer);
          window.removeEventListener("message", handler);
          resolve({ names: d.names, stopReason: d.stopReason });
        }
        if (d.type === "ERROR") {
          clearTimeout(timer);
          window.removeEventListener("message", handler);
          reject(new Error(d.message));
        }
      };
      window.addEventListener("message", handler);
      // start via MAIN world API
      window.__RESO_TNK__.start({ awemeId: "6912345678901234567", runId: "test-tt-1", maxMs: 8000, includeReplies: false });
    });
  });
  await page.unroute("**/api/comment/list**");
  return result;
}

async function runIG() {
  await page.route("**/api/v1/media/*/comments/**", async (route) => {
    const body = JSON.stringify({
      comments: [{ user: { username: "ig_user_1" } }, { user: { username: "ig_user_2" } }],
      has_more_comments: false,
      next_max_id: null,
    });
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });

  // IG needs real URL origin for shortcode extraction → pakai route dokumen
  const igHtml = `
    <html><head></head><body>
      <main><a href="/ig_user_1/">ig_user_1</a></main>
      <div role="dialog"><a href="/ig_user_1/">ig_user_1</a><a href="/ig_user_2/">ig_user_2</a></div>
      <script>var data = {"shortcode":"ABC123","id":"17841404557200000","comment_count":2};</script>
      <script>window._sharedData = {"entry_data":{"PostPage":[{"graphql":{"shortcode_media":{"shortcode":"ABC123","id":"17841404557200000"}}}]}};</script>
    </body></html>
  `;
  await page.route("https://www.instagram.com/p/ABC123/", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: igHtml });
  });
  await page.goto("https://www.instagram.com/p/ABC123/", { waitUntil: "domcontentloaded" });
  await page.unroute("https://www.instagram.com/p/ABC123/");

  await page.addScriptTag({ content: sharedJs });
  await page.addScriptTag({ content: injectIG });

  const ready = await page.evaluate(() => !!window.__RESO_ING__);
  if (!ready) throw new Error("IG engine not injected");

  const result = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("IG timeout 12s")), 12000);
      const handler = (e) => {
        if (e.source !== window) return;
        const d = e.data;
        if (!d || d.source !== "ig-nama-komentar-inject") return;
        if (d.type === "DONE") {
          clearTimeout(timer);
          window.removeEventListener("message", handler);
          resolve({ names: d.names, stopReason: d.stopReason });
        }
        if (d.type === "ERROR") {
          clearTimeout(timer);
          window.removeEventListener("message", handler);
          reject(new Error(d.message));
        }
      };
      window.addEventListener("message", handler);
      window.__RESO_ING__.start({ mediaId: "17841404557200000", runId: "test-ig-1", maxMs: 8000, includeReplies: false });
    });
  });
  await page.unroute("**/api/v1/media/*/comments/**");
  return result;
}

async function runFB() {
  // FB GraphQL mock: return page_info + names
  await page.route("**/api/graphql/**", async (route) => {
    const body = `for(;;);` + JSON.stringify({
      data: {
        feedback: {
          id: "feedback:123",
          comments: {
            edges: [{ node: { __typename: "Comment", author: { name: "FB_User_1", __typename: "User" } } }],
            page_info: { has_next_page: false, end_cursor: null },
          },
        },
      },
    });
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });

  const fbHtml = `
    <html><body>
      <div role="article" data-pagelet="FeedUnit"><div>Test Post FB</div></div>
      <script>var DTSGInitialData = {token:"fake_dtsg_1234567890"};</script>
    </body></html>
  `;
  await page.route("https://www.facebook.com/test/posts/1234567890123456", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: fbHtml });
  });
  await page.goto("https://www.facebook.com/test/posts/1234567890123456", { waitUntil: "domcontentloaded" });
  await page.unroute("https://www.facebook.com/test/posts/1234567890123456");

  await page.addScriptTag({ content: sharedJs });
  await page.addScriptTag({ content: injectFB });

  const ready = await page.evaluate(() => !!window.__RESO_FNK__);
  if (!ready) throw new Error("FB engine not injected");

  const result = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("FB timeout 15s")), 15000);
      const handler = (e) => {
        if (e.source !== window) return;
        const d = e.data;
        if (!d || d.source !== "fb-nama-komentar-inject") return;
        if (d.type === "DONE") {
          clearTimeout(timer);
          window.removeEventListener("message", handler);
          resolve({ names: d.names, stopReason: d.stopReason });
        }
        if (d.type === "ERROR") {
          clearTimeout(timer);
          window.removeEventListener("message", handler);
          reject(new Error(d.message));
        }
      };
      window.addEventListener("message", handler);
      // FB start needs runId, includeReplies
      window.__RESO_FNK__.start({ runId: "test-fb-1", maxMs: 10000, includeReplies: true });
    });
  });
  await page.unroute("**/api/graphql/**");
  return result;
}

console.log("=== Chrome Simulation v1.0.61 — IG/FB/TT ===");
console.log("Chrome:", await page.evaluate(() => navigator.userAgent.slice(0,80)));

let ok = 0;
let fail = 0;

for (const [label, fn] of [
  ["TikTok", runTT],
  ["Instagram", runIG],
  ["Facebook", runFB],
]) {
  try {
    const r = await fn();
    const cnt = r.names?.length || 0;
    const reason = r.stopReason || "unknown";
    const status = cnt > 0 ? "OK" : "EMPTY";
    console.log(`✓ ${label}: ${cnt} nama/username, stopReason=${reason} [${status}]`, r.names.slice(0,3));
    if (cnt > 0) ok++; else fail++;
  } catch (e) {
    console.log(`✗ ${label} GAGAL:`, e.message);
    fail++;
  }
  await page.evaluate(() => {
    try { window.__RESO_TNK__?.stop(); } catch {}
    try { window.__RESO_ING__?.stop(); } catch {}
    try { window.__RESO_FNK__?.stop(); } catch {}
  });
  await new Promise((r) => setTimeout(r, 800));
}

console.log(`\n=== Hasil: ${ok} OK, ${fail} FAIL ===`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
