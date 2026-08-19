/**
 * Popup — mode ekstensi (toggle on/off) + status koneksi ke ReSo.
 * ON → FAB & panel muncul di halaman FB/TikTok/IG; OFF → disembunyikan.
 * Status ReSo: auth tersedia? API terjangkau? Ada antrian kiriman tertunda?
 */
const KEY = "rsx_enabled";
const RESO_PENDING_KEY = "resoPending";
const toggle = document.getElementById("modeToggle");
const hint = document.getElementById("modeHint");
const resoStatus = document.getElementById("resoStatus");
const resoRetry = document.getElementById("resoRetry");

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
      return;
    }
    const bits = [];
    if (r.pending > 0) bits.push(`${r.pending} kiriman antri`);
    if (r.connected) bits.push("Terhubung");
    else if (r.authenticated) bits.push("Terhubung — API tak terjangkau");
    else bits.push("Belum tersambung — buka ReSo untuk login");
    resoStatus.textContent = `ReSo: ${bits.join(" · ")}`;
    resoStatus.hidden = false;
    resoRetry.hidden = !(r.pending > 0);
  } catch {
    resoStatus.hidden = true;
    resoRetry.hidden = true;
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
  if (area === "local" && changes[RESO_PENDING_KEY] !== undefined) {
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
