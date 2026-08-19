const KEY = "resoUrl";
const input = document.getElementById("resoUrl");
const errEl = document.getElementById("err");
const savedEl = document.getElementById("saved");
const saveBtn = document.getElementById("save");
const clearBtn = document.getElementById("clear");

function normalize(raw) {
  if (!raw || !raw.trim()) return "";
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.protocol === "http:" && u.hostname !== "localhost" && !u.hostname.endsWith(".localhost")) {
      return null;
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

async function load() {
  try {
    const d = await chrome.storage.local.get(KEY);
    input.value = d[KEY] || "";
  } catch {
    input.value = "";
  }
}

saveBtn.addEventListener("click", async () => {
  errEl.hidden = true;
  savedEl.hidden = true;
  const norm = normalize(input.value);
  if (input.value.trim() && norm === null) {
    errEl.textContent = "URL tidak valid — harus https:// (atau http://localhost).";
    errEl.hidden = false;
    return;
  }
  try {
    if (norm) await chrome.storage.local.set({ [KEY]: norm });
    else await chrome.storage.local.remove(KEY);
    savedEl.hidden = false;
    setTimeout(() => (savedEl.hidden = true), 2000);
  } catch {
    errEl.textContent = "Gagal menyimpan.";
    errEl.hidden = false;
  }
});

clearBtn.addEventListener("click", async () => {
  input.value = "";
  try {
    await chrome.storage.local.remove(KEY);
    savedEl.textContent = "Dihapus";
    savedEl.hidden = false;
    setTimeout(() => (savedEl.hidden = true), 2000);
  } catch {}
});

load();
