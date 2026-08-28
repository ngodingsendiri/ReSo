/**
 * Popup — mode ekstensi (toggle on/off) + status koneksi ke ReSo.
 * ON → FAB & panel muncul di halaman FB/TikTok/IG; OFF → disembunyikan.
 * Status ReSo: auth tersedia? API terjangkau? Ada antrian kiriman tertunda?
 */
const KEY = "rsx_enabled";
const RESO_PENDING_KEY = "resoPending";
const RESO_URL_KEY = "resoUrl";
// Domain default satu-sumber dari shared.js (via shared-module) — jangan
// duplikasi literal di sini (bibit bug hardcode-domain lama).
import { RESO_URL } from "./shared-module.js";
const toggle = document.getElementById("modeToggle");
const hint = document.getElementById("modeHint");
const modeBadge = document.getElementById("modeBadge");
const resoStatus = document.getElementById("resoStatus");
const resoLogin = document.getElementById("resoLogin");
const resoRetry = document.getElementById("resoRetry");
const resoOpen = document.getElementById("resoOpen");
const resoReset = document.getElementById("resoReset");
const extVersion = document.getElementById("extVersion");

// Versi ekstensi = manifest.json (dist/sinkron via stamp-version saat build).
if (extVersion) {
  extVersion.textContent = `ReSo Ekstensi v${chrome.runtime.getManifest().version}`;
}

async function getResoUrlStored() {
  try {
    const d = await chrome.storage.local.get(RESO_URL_KEY);
    return typeof d[RESO_URL_KEY] === "string" ? d[RESO_URL_KEY] : null;
  } catch {
    return null;
  }
}

function apply(state) {
  toggle.checked = state !== false;
  const on = state !== false;
  hint.textContent = on
    ? "FAB & panel tersedia di Facebook, TikTok & Instagram."
    : "FAB & panel disembunyikan dari Facebook, TikTok & Instagram.";
  if (modeBadge) {
    modeBadge.textContent = on ? "Aktif" : "Nonaktif";
    modeBadge.classList.toggle("on", on);
    modeBadge.classList.toggle("off", !on);
  }
}

async function refreshResoStatus() {
  const showUnavailable = () => {
    // Jangan diam total — user harus tahu kenapa statusnya kosong.
    resoStatus.textContent = "Status ReSo tidak tersedia — coba buka popup lagi.";
    resoStatus.hidden = false;
    resoRetry.hidden = true;
    resoOpen.hidden = true;
    resoReset.hidden = true;
    resoLogin.hidden = true;
  };
  try {
    const r = await chrome.runtime.sendMessage({ type: "RESO_CONN_STATUS" });
    if (!r || typeof r.connected !== "boolean") {
      showUnavailable();
      return;
    }
    const url = await getResoUrlStored();
    const bits = [];
    if (r.connected) bits.push("Terhubung");
    else if (r.authenticated) bits.push("Terhubung — API tak terjangkau");
    else bits.push("Belum tersambung");
    let text = `ReSo: ${bits.join(" · ")}`;
    if (url) text += ` · ${url}`;
    else if (!r.connected) text += " · buka ReSo kamu & login";
    if (r.pending > 0) text += ` · ${r.pending} kiriman antri`;
    resoStatus.textContent = text;
    resoStatus.hidden = false;
    resoOpen.hidden = !url;
    resoLogin.hidden = r.connected;
    resoRetry.hidden = !(r.pending > 0);
    resoReset.hidden = !url && !r.authenticated;
  } catch {
    showUnavailable();
  }
}

resoRetry.addEventListener("click", async () => {
  try {
    await chrome.runtime.sendMessage({ type: "RESO_FLUSH_NOW" });
  } catch {
    /* background tak membalas — status tetap diperbarui */
  }
  await refreshResoStatus();
});

resoOpen.addEventListener("click", async () => {
  const url = await getResoUrlStored();
  if (url) {
    try {
      await chrome.tabs.create({ url });
    } catch {
      /* abaikan */
    }
  }
});

// Login delegasi: buka halaman login ReSo (domain ter-pin / default) di tab
// baru. Setelah user login, app mendorong RESO_CONNECT (push) → extension
// terhubung otomatis; bila tak ada push, handoff dari tab terbuka tetap jalan
// (asalkan content-reso.js ter-inject via pin + izin host).
resoLogin.addEventListener("click", async () => {
  const url = (await getResoUrlStored()) || RESO_URL;
  try {
    await chrome.tabs.create({ url });
  } catch {
    /* abaikan */
  }
  await refreshResoStatus();
});

// "Putuskan" destruktif (hapus domain ter-pin + sesi) → pola konfirmasi
// dua-klik: klik pertama mengubah label jadi "Yakin putuskan?" 3 dtk.
let resetArmed = false;
let resetArmTimer = null;
resoReset.addEventListener("click", async () => {
  if (!resetArmed) {
    resetArmed = true;
    resoReset.textContent = "Yakin putuskan?";
    if (resetArmTimer) clearTimeout(resetArmTimer);
    resetArmTimer = setTimeout(() => {
      resetArmed = false;
      resoReset.textContent = "Putuskan";
      resetArmTimer = null;
    }, 3000);
    return;
  }
  if (resetArmTimer) clearTimeout(resetArmTimer);
  resetArmTimer = null;
  resetArmed = false;
  resoReset.textContent = "Putuskan";
  try {
    await chrome.storage.local.remove([RESO_URL_KEY, "resoAuth"]);
  } catch {
    /* abaikan */
  }
  await refreshResoStatus();
});

toggle.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({ [KEY]: toggle.checked });
  } catch {
    /* storage tak tersedia — abaikan */
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[KEY] !== undefined) {
    apply(changes[KEY].newValue);
  }
  if (
    area === "local" &&
    (changes[RESO_PENDING_KEY] !== undefined ||
      changes[RESO_URL_KEY] !== undefined ||
      changes.resoAuth !== undefined)
  ) {
    refreshResoStatus();
  }
});

// Popup unload → clear armed timer agar buka lagi tidak stuck di state armed (audit).
window.addEventListener("pagehide", () => {
  if (resetArmTimer) clearTimeout(resetArmTimer);
  resetArmTimer = null;
});
window.addEventListener("beforeunload", () => {
  if (resetArmTimer) clearTimeout(resetArmTimer);
  resetArmTimer = null;
});

(async () => {
  try {
    const d = await chrome.storage.local.get(KEY);
    apply(d[KEY] !== false);
  } catch {
    apply(true);
  }
  await refreshResoStatus();
})();
