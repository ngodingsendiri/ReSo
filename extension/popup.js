/**
 * Popup — mode ekstensi (toggle on/off).
 * ON → FAB & panel muncul di halaman FB/TikTok/IG; OFF → disembunyikan.
 */
const KEY = "rsx_enabled";
const toggle = document.getElementById("modeToggle");
const hint = document.getElementById("modeHint");

function apply(state) {
  toggle.checked = state !== false;
  hint.textContent =
    state === false
      ? "Nonaktif — ikon mengambang disembunyikan dari Facebook, TikTok & Instagram."
      : "Aktif → ikon mengambang muncul di Facebook, TikTok & Instagram.";
}

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
});

(async () => {
  try {
    const d = await chrome.storage.local.get(KEY);
    apply(d[KEY] !== false);
  } catch {
    apply(true);
  }
})();
