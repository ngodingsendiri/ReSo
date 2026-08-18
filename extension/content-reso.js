/**
 * Content script untuk aplikasi ReSo.
 *
 * Opsi C (API → database): ekstensi meminta token sesi Firebase operator
 * (`GET_AUTH_TOKEN`) → diteruskan sebagai CustomEvent `reso:get-token`,
 * aplikasi membalas via event unik per permintaan → dikembalikan ke ekstensi.
 *
 * Mitigasi paparan token:
 *  - saluran balasan UNIK per permintaan (`respondTo`) — skrip halaman yang
 *    sekadar mendengarkan nama event tetap ("reso:token-response") tidak akan
 *    menerima apa pun;
 *  - guard sekali-pakai (`settled`) — satu permintaan dibalas tepat sekali,
 *    respons kedua/duplikat diabaikan;
 *  - cek origin — respons wajib mengembalikan `origin` yang sama dengan
 *    halaman ini, selain itu diabaikan (defense-in-depth; skrip jahat di
 *    realm yang sama tetap bisa membaca `location.origin`);
 *  - validasi bentuk — hanya field yang dikenal yang diteruskan, nilai
 *    di-koersi ke tipe aman.
 *
 * Standalone (tanpa shared.js): hanya meneruskan pesan, tidak butuh helper
 * ekstraksi apa pun.
 */
(() => {
  if (window.__resoBridgeInjected) return;
  window.__resoBridgeInjected = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;

    // Hanya konteks ekstensi sendiri yang boleh memicu handoff (sender.id =
    // id ekstensi). Halaman web tidak bisa mengirim pesan runtime tanpa
    // `externally_connectable`; cek ini defense-in-depth terhadap pesan dari
    // konteks ekstensi lain.
    if (!sender || typeof sender.id !== "string" || sender.id !== chrome.runtime.id) {
      return;
    }

    // Opsi C — handoff token sesi ReSo (login sudah ada di tab ReSo).
    if (msg.type === "GET_AUTH_TOKEN") {
      const requestId = `t${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const origin =
        window.location && typeof window.location.origin === "string"
          ? window.location.origin
          : "";
      // Saluran balasan unik per permintaan — listener pasif pada nama event
      // tetap tidak akan menerima apa pun.
      const respondTo = `reso:token-response-${requestId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

      let settled = false;
      const onResponse = (e) => {
        const d = (e && e.detail) || {};
        // Guard sekali-pakai + cek requestId & origin: respons yang tidak
        // cocok diabaikan (permintaan tetap menunggu respons sah).
        if (d.requestId !== requestId) return;
        if (typeof d.origin !== "string" || d.origin !== origin) return;
        if (d.error) {
          // Respons error sah: string non-kosong → settle sekali.
          if (typeof d.error === "string" && d.error.trim()) {
            settled = true;
            window.removeEventListener(respondTo, onResponse);
            sendResponse({ error: d.error.trim().slice(0, 200) });
          }
          return;
        }
        // Validasi bentuk sukses: idToken wajib string non-kosong;
        // refreshToken string (boleh kosong = mode idToken-only, ekstensi
        // akan handoff ulang saat kedaluwarsa).
        if (
          typeof d.idToken !== "string" ||
          !d.idToken ||
          typeof d.refreshToken !== "string"
        ) {
          return;
        }
        settled = true;
        window.removeEventListener(respondTo, onResponse);
        sendResponse({
          idToken: d.idToken,
          refreshToken: d.refreshToken,
          uid: typeof d.uid === "string" ? d.uid : null,
          email: typeof d.email === "string" ? d.email : null,
          error: null,
        });
      };

      window.addEventListener(respondTo, onResponse);
      window.dispatchEvent(
        new CustomEvent("reso:get-token", {
          detail: { requestId, origin, respondTo },
        })
      );
      // Keamanan: jangan gantung selamanya kalau aplikasi tidak membalas.
      setTimeout(() => {
        window.removeEventListener(respondTo, onResponse);
        if (!settled) sendResponse({ error: "timeout" });
      }, 8000);
      return true; // async sendResponse
    }
  });
})();
