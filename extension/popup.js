/**
 * Popup — mode ekstensi (toggle on/off) + status koneksi ke ReSo.
 * ON → FAB & panel muncul di halaman FB/TikTok/IG; OFF → disembunyikan.
 * Status ReSo: auth tersedia? API terjangkau? Ada antrian kiriman tertunda?
 */
const KEY = "rsx_enabled";
const RESO_PENDING_KEY = "resoPending";
const RESO_URL_KEY = "resoUrl";
// Fallback bila user belum pin domain di Options (sama dengan RESO_URL di shared.js).
const RESO_URL_FALLBACK = "https://reso.vercel.app";
const toggle = document.getElementById("modeToggle");
const hint = document.getElementById("modeHint");
const resoStatus = document.getElementById("resoStatus");
const resoLogin = document.getElementById("resoLogin");
const resoRetry = document.getElementById("resoRetry");
const resoOpen = document.getElementById("resoOpen");
const resoReset = document.getElementById("resoReset");

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
  hint.textContent =
    state === false
      ? "Nonaktif — ikon mengambang disembunyikan dari Facebook, TikTok & Instagram."
      : "Aktif → ikon mengambang muncul di Facebook, TikTok & Instagram.";
}

async function refreshResoStatus() {
  try {
    const r = await chrome.runtime.sendMessage({ type: "RESO_CONN_STATUS" });
    if (!r || typeof r.connected !== "boolean") {
      resoStatus.hidden = true;
      resoRetry.hidden = true;
      resoOpen.hidden = true;
      resoReset.hidden = true;
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
    resoStatus.hidden = true;
    resoRetry.hidden = true;
    resoOpen.hidden = true;
    resoReset.hidden = true;
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
  const url = (await getResoUrlStored()) || RESO_URL_FALLBACK;
  try {
    await chrome.tabs.create({ url });
  } catch {
    /* abaikan */
  }
  await refreshResoStatus();
});

resoReset.addEventListener("click", async () => {
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

(async () => {
  try {
    const d = await chrome.storage.local.get(KEY);
    apply(d[KEY] !== false);
  } catch {
    apply(true);
  }
  await refreshResoStatus();
})();
