/**
 * GET /api/health — probe konektivitas untuk ekstensi ReSoEx.
 *
 * Ekstensi memakai endpoint ini untuk tahu apakah API ReSo terjangkau
 * (indikator "ReSo: Terhubung" di popup + keputusan flush antrian).
 * Ringan: tidak menyentuh Firestore, nol env var.
 */

function cors(res: unknown) {
  const r = res as { setHeader?: (k: string, v: string) => void };
  r.setHeader?.('Access-Control-Allow-Origin', '*');
  r.setHeader?.('Access-Control-Allow-Methods', 'GET, OPTIONS');
  r.setHeader?.('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: unknown, res: unknown) {
  const r = req as { method?: string };
  const raw = res as { status: (s: number) => { json: (d: unknown) => void } };
  cors(res);
  if (r.method === 'OPTIONS') {
    raw.status(204).json({});
    return;
  }
  if (r.method !== 'GET') {
    raw.status(405).json({ ok: false, error: 'Metode tidak diizinkan.' });
    return;
  }
  raw.status(200).json({
    ok: true,
    status: 'ok',
    service: 'reso-api',
    time: new Date().toISOString(),
  });
}
