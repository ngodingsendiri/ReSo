/**
 * Fixture DOM minimal (subset CSS) untuk menguji scraper DOM fallback
 * (scrapeDomNicknames / scrapeDomUsernames) dengan struktur halaman nyata.
 * Zero deps — matcher CSS hanya mendukung grammar yang dipakai scraper:
 * tag (`main`), `[attr]`, `[attr="v"]`, `[attr*="sub"]`, kombinasi descendant
 * (spasi, mis. `[data-e2e="comment-item"] a[href*="/@"]`), dan grup koma
 * (untuk closest `nav, header`).
 */

function parseCompound(part) {
  const out = { tag: null, attr: null, op: null, value: null };
  let rest = part;
  const tagM = /^[a-z][a-z0-9]*/i.exec(rest);
  if (tagM) {
    out.tag = tagM[0].toLowerCase();
    rest = rest.slice(tagM[0].length);
  }
  if (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    const inner = rest.slice(1, end);
    const am = inner.match(/^([\w-]+)(\*)?=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))?$/);
    if (am) {
      out.attr = am[1];
      out.op = am[2] ? "contains" : "eq";
      out.value = am[3] ?? am[4] ?? am[5] ?? "";
    } else if (/^[\w-]+$/.test(inner)) {
      out.attr = inner;
      out.op = "has";
    }
  }
  return out;
}

function matchCompound(node, c) {
  if (c.tag && node.tagName.toLowerCase() !== c.tag) return false;
  if (!c.attr) return true;
  const v = node.attrs[c.attr] ?? null;
  if (v == null) return false;
  if (c.op === "has") return true;
  if (c.op === "eq") return v === c.value;
  if (c.op === "contains") return String(v).includes(c.value);
  return false;
}

/** comps terurut root→leaf; node harus cocok dengan comps terakhir, ancestor harus punya comps sebelumnya secara berurutan (leaf-side dulu). */
function matchFull(node, comps) {
  if (!matchCompound(node, comps[comps.length - 1])) return false;
  if (comps.length === 1) return true;
  let cur = node.parent;
  for (let i = comps.length - 2; i >= 0; i--) {
    let found = false;
    while (cur) {
      if (matchCompound(cur, comps[i])) {
        found = true;
        cur = cur.parent;
        break;
      }
      cur = cur.parent;
    }
    if (!found) return false;
  }
  return true;
}

function qsa(root, sel) {
  const groups = sel
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const parsed = groups.map((g) => g.split(/\s+/).map(parseCompound));
  const out = [];
  const walk = (node) => {
    for (const c of node.children) {
      // querySelectorAll mengembalikan tiap elemen SEKALI walau cocok dengan
      // beberapa grup (mis. [role="button"], [aria-label]) — break setelah
      // match pertama mencegah duplikasi.
      for (const comps of parsed) {
        if (matchFull(c, comps)) {
          out.push(c);
          break;
        }
      }
      walk(c);
    }
  };
  walk(root);
  return out;
}

function closest(node, sel) {
  const parsed = sel
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((g) => g.split(/\s+/).map(parseCompound))
    .filter((comps) => comps.length === 1)
    .map((comps) => comps[0]);
  let cur = node;
  while (cur) {
    for (const c of parsed) {
      if (c && matchCompound(cur, c)) return cur;
    }
    cur = cur.parent;
  }
  return null;
}

/**
 * Buat elemen fixture. `text` mengisi innerText & textContent (untuk
 * scraper yang membaca label visible / aria-label).
 */
export function el(tag, attrs = {}, children = [], text = "") {
  const node = {
    tagName: tag.toUpperCase(),
    attrs: { ...attrs },
    children,
    parent: null,
    innerText: text,
    textContent: text,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name)
        ? this.attrs[name]
        : null;
    },
    closest(sel) {
      return closest(node, sel);
    },
    querySelectorAll(sel) {
      return qsa(node, sel);
    },
    // API tambahan untuk scraper Facebook (scrapeDomNames, tryOpenComments) —
    // aditif, tidak mengubah perilaku scraper TT/IG.
    querySelector(sel) {
      return qsa(node, sel)[0] ?? null;
    },
    getBoundingClientRect() {
      return { width: 10, height: 10 }; // terlihat secara default
    },
    // Interaksi — dicatat di node supaya test bisa memverifikasi apa yang
    // benar-benar diklik. V1.0.85: tryOpenComments klik TANPA scrollIntoView
    // (scrollIntoView menggeser semua ancestor); stub tetap ada agar regresi
    // scroll bisa dideteksi via el._scrolled === 0.
    click() {
      this._clickCount = (this._clickCount || 0) + 1;
    },
    scrollIntoView() {
      this._scrolled = (this._scrolled || 0) + 1;
    },
  };
  Object.defineProperty(node, "href", {
    get: () => node.attrs.href ?? "",
    enumerable: true,
  });
  Object.defineProperty(node, "parentElement", {
    get: () => node.parent,
    enumerable: true,
  });
  for (const c of children) c.parent = node;
  return node;
}

/** Stub document untuk scraper (`document.querySelectorAll(sel)` di root). */
export function makeDocument(root) {
  return {
    querySelectorAll(sel) {
      return qsa(root, sel);
    },
    querySelector(sel) {
      return qsa(root, sel)[0] ?? null;
    },
  };
}
