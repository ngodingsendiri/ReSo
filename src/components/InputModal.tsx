import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, ChevronDown, X, Instagram, Facebook, ExternalLink } from 'lucide-react';
import { setDoc, serverTimestamp, runTransaction } from 'firebase/firestore';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { TiktokIcon } from './icons/TiktokIcon';
import { cn } from '@/lib/utils';
import { useAuth } from './FirebaseProvider';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { dinasDoc } from '../lib/firebase';
import { parseLocalISODate, addLocalDays } from '../lib/date';
import { matchEmployeesToEngagement, matchEngagementDetail, engagedIdsEqual, mergeUniqueLines } from '../lib/matching';
import type { DailyEngagement, Employee, UnmatchedName } from '../types';

interface InputModalProps {
  open: boolean;
  date: string;
  /** Dokumen rekap tanggal ini dari snapshot parent (boleh undefined). */
  existing?: DailyEngagement;
  employees: Employee[];
  metaToken: string;
  postedAt: string[];
  unmatchedCount: number;
  onClose: () => void;
  onOpenUnmatched: () => void;
  onGoToSettings: () => void;
}

function MatchPreviewImpl({ ig, fb, tiktok }: { ig: number; fb: number; tiktok: number }) {
  const chip = (label: string, n: number, cls: string) => (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold', cls)}>
      {label} {n}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-400">
      {chip('IG', ig, 'bg-pink-50 text-pink-600')}
      {chip('FB', fb, 'bg-blue-50 text-blue-600')}
      {chip('TT', tiktok, 'bg-slate-100 text-slate-600')}
      <span>pegawai terdeteksi</span>
    </div>
  );
}

const MatchPreview = React.memo(MatchPreviewImpl);

export function InputModal({
  open,
  date,
  existing,
  employees,
  metaToken,
  postedAt,
  unmatchedCount,
  onClose,
  onOpenUnmatched,
  onGoToSettings,
}: InputModalProps) {
  const { user, db } = useAuth();
  const dialogRef = useDialogA11y<HTMLDivElement>(open);

  // ── State lokal: mengetik di sini TIDAK me-render ulang app shell ──
  const [igRawInput, setIgRawInput] = useState('');
  const [fbRawInput, setFbRawInput] = useState('');
  const [tiktokRawInput, setTiktokRawInput] = useState('');
  const [igLinks, setIgLinks] = useState<string[]>([]);
  const [fbLinks, setFbLinks] = useState<string[]>([]);
  const [tiktokLinks, setTiktokLinks] = useState<string[]>([]);
  const [activeLinkTab, setActiveLinkTab] = useState<'ig' | 'fb' | 'tiktok'>('ig');
  const [isMetaExpanded, setIsMetaExpanded] = useState(false);
  const [isFetchingMeta, setIsFetchingMeta] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [initialIgRawInput, setInitialIgRawInput] = useState('');
  const [initialFbRawInput, setInitialFbRawInput] = useState('');
  const [initialTiktokRawInput, setInitialTiktokRawInput] = useState('');
  const [initialIgLinks, setInitialIgLinks] = useState<string[]>([]);
  const [initialFbLinks, setInitialFbLinks] = useState<string[]>([]);
  const [initialTiktokLinks, setInitialTiktokLinks] = useState<string[]>([]);

  const prevDateRef = useRef(date);
  const notifiedDirtyRef = useRef<string | null>(null);
  // Tarikan Meta API yang sedang jalan (controller + timer) — dibatalkan saat
  // modal ditutup supaya fetch yang menggantung tidak berlanjut di balik layar.
  const metaFetchRef = useRef<{ controller: AbortController; timeoutId: ReturnType<typeof setTimeout> } | null>(null);

  // Modal ditutup → hentikan tarikan Meta yang masih berjalan (kalau ada).
  useEffect(() => {
    if (open) return;
    const cur = metaFetchRef.current;
    if (cur) {
      clearTimeout(cur.timeoutId);
      cur.controller.abort();
      metaFetchRef.current = null;
    }
  }, [open]);

  // Matching preview ditahan (debounce) — hanya dihitung selagi modal terbuka.
  const debouncedIgRawInput = useDebouncedValue(igRawInput);
  const debouncedFbRawInput = useDebouncedValue(fbRawInput);
  const debouncedTiktokRawInput = useDebouncedValue(tiktokRawInput);

  const matchPreview = useMemo(
    () => ({
      ig: matchEmployeesToEngagement(debouncedIgRawInput, employees, 'ig').length,
      fb: matchEmployeesToEngagement(debouncedFbRawInput, employees, 'fb').length,
      tiktok: matchEmployeesToEngagement(debouncedTiktokRawInput, employees, 'tiktok').length,
    }),
    [debouncedIgRawInput, debouncedFbRawInput, debouncedTiktokRawInput, employees]
  );

  // Muat isi dokumen saat modal dibuka / ganti tanggal. Guard "dirty"
  // mencegah data tarikan Meta/API yang belum disimpan tertimpa snapshot baru.
  useEffect(() => {
    if (!open) {
      notifiedDirtyRef.current = null;
      return;
    }

    const isDirty =
      igRawInput !== initialIgRawInput ||
      fbRawInput !== initialFbRawInput ||
      tiktokRawInput !== initialTiktokRawInput ||
      JSON.stringify(igLinks) !== JSON.stringify(initialIgLinks) ||
      JSON.stringify(fbLinks) !== JSON.stringify(initialFbLinks) ||
      JSON.stringify(tiktokLinks) !== JSON.stringify(initialTiktokLinks);

    const isDateChange = date !== prevDateRef.current;

    if (isDirty) {
      if (isDateChange) {
        const ok = window.confirm('Ada perubahan belum disimpan. Buang perubahan dan muat tanggal baru?');
        if (!ok) return;
      } else {
        if (notifiedDirtyRef.current !== date) {
          notifiedDirtyRef.current = date;
          toast.info('Ada perubahan yang belum disimpan. Simpan terlebih dahulu.');
        }
        return;
      }
    }
    notifiedDirtyRef.current = null;
    prevDateRef.current = date;

    if (existing) {
      setIgRawInput(existing.igRawText || '');
      setFbRawInput(existing.fbRawText || '');
      setTiktokRawInput(existing.tiktokRawText || '');
      setIgLinks(existing.igLinks || []);
      setFbLinks(existing.fbLinks || []);
      setTiktokLinks(existing.tiktokLinks || []);

      setInitialIgRawInput(existing.igRawText || '');
      setInitialFbRawInput(existing.fbRawText || '');
      setInitialTiktokRawInput(existing.tiktokRawText || '');
      setInitialIgLinks(existing.igLinks || []);
      setInitialFbLinks(existing.fbLinks || []);
      setInitialTiktokLinks(existing.tiktokLinks || []);
    } else {
      setIgRawInput('');
      setFbRawInput('');
      setTiktokRawInput('');
      setIgLinks([]);
      setFbLinks([]);
      setTiktokLinks([]);

      setInitialIgRawInput('');
      setInitialFbRawInput('');
      setInitialTiktokRawInput('');
      setInitialIgLinks([]);
      setInitialFbLinks([]);
      setInitialTiktokLinks([]);
    }
  }, [open, date, existing]);

  const handleFetchRecentMeta = async () => {
    setIsFetchingMeta(true);
    const controller = new AbortController();
    // timedOut membedakan abort karena timeout (pesan jelas) vs abort karena
    // modal ditutup (diam saja).
    let timedOut = false;
    const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, 60000);
    metaFetchRef.current = { controller, timeoutId };

    try {
      const token = metaToken.trim();
      if (!token) throw new Error("Token API Meta tidak boleh kosong.");

      // Window rekap resmi: 15:00 H-1 s/d 15:00 D (WIB) = UTC 08:00
      // Batas eksklusif di start (hindari double-count tepat 15:00), inklusif di end.
      const isWithinCustomWindow = (postDateStr: string, targetDateStr: string) => {
        if (!postDateStr) return false;
        const postTime = new Date(postDateStr).getTime();
        if (Number.isNaN(postTime)) return false;
        const endDate = new Date(`${targetDateStr}T08:00:00Z`);
        const endTime = endDate.getTime();
        const startTime = endTime - (24 * 60 * 60 * 1000);
        return postTime > startTime && postTime <= endTime;
      };

      type MetaPost = { id: string; created_time?: string; timestamp?: string; permalink_url?: string; permalink?: string };
      let fbPosts: MetaPost[] = [];
      let igPosts: MetaPost[] = [];
      let pageToken = token;
      let pageId = "me";

      // Resolve Page Token
      try {
        const accRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${token}`, { signal: controller.signal });
        const accData = await accRes.json();
        if (accData.data && accData.data.length > 0) {
          pageId = accData.data[0].id;
          pageToken = accData.data[0].access_token;
        } else {
          const debugRes = await fetch(`https://graph.facebook.com/v19.0/debug_token?input_token=${token}&access_token=${token}`, { signal: controller.signal });
          const debugData = await debugRes.json();
          if (debugData.data && debugData.data.granular_scopes) {
            const scope = debugData.data.granular_scopes.find((s: { scope: string; target_ids?: string[] }) =>
              s.scope === 'pages_show_list' || s.scope === 'pages_read_engagement' || s.scope === 'pages_manage_posts'
            );
            if (scope && scope.target_ids && scope.target_ids.length > 0) {
              pageId = scope.target_ids[0];
              const pageRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=access_token&access_token=${token}`, { signal: controller.signal });
              const pageData = await pageRes.json();
              if (pageData.access_token) pageToken = pageData.access_token;
            }
          }
        }
      } catch {
        // Bukan user token — lanjut dengan token asli
      }

      const fbPostsRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/posts?fields=id,created_time,permalink_url&access_token=${pageToken}&limit=50`, { signal: controller.signal });
      const fbPostsData = await fbPostsRes.json();
      let latestFbPostDate: string | null = null;

      if (!fbPostsData.error && fbPostsData.data) {
        if (fbPostsData.data.length > 0) latestFbPostDate = fbPostsData.data[0].created_time;
        fbPosts = fbPostsData.data.filter((p: MetaPost) => isWithinCustomWindow(p.created_time || '', date));
      }

      const igAccRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`, { signal: controller.signal });
      const igAccData = await igAccRes.json();
      const igAccountId = igAccData.instagram_business_account?.id as string | undefined;

      if (igAccountId) {
        const igPostsRes = await fetch(`https://graph.facebook.com/v19.0/${igAccountId}/media?fields=id,timestamp,permalink&access_token=${pageToken}&limit=50`, { signal: controller.signal });
        const igPostsData = await igPostsRes.json();
        if (!igPostsData.error && igPostsData.data) {
          igPosts = igPostsData.data.filter((p: MetaPost) => isWithinCustomWindow(p.timestamp || '', date));
        }
      }

      if (fbPostsData.error && !igAccountId) {
        throw new Error(fbPostsData.error?.message || "Gagal mengakses data Page/Instagram.");
      }

      const commenters: { platform: 'ig'; username: string; text?: string }[] = [];
      const newFbLinks = fbPosts.map((p) => p.permalink_url).filter((u): u is string => Boolean(u));
      const newIgLinks = igPosts.map((p) => p.permalink).filter((u): u is string => Boolean(u));

      // Paralel dengan batas concurrency 7 — N post selesai ±N/7× latensi.
      const CONCURRENCY = 7;
      type IgComment = { data?: { username?: string; text?: string }[] };
      for (let i = 0; i < igPosts.length; i += CONCURRENCY) {
        const batchPosts = igPosts.slice(i, i + CONCURRENCY);
        const commentsBatches = await Promise.all(
          batchPosts.map((post) =>
            fetch(`https://graph.facebook.com/v19.0/${post.id}/comments?fields=id,text,username,timestamp&access_token=${pageToken}&limit=100`, { signal: controller.signal })
              .then((res) => res.json() as Promise<IgComment>)
              .catch(() => ({ data: [] }) as IgComment)
          )
        );
        commentsBatches.forEach((commentsData) => {
          (commentsData.data || []).forEach((c) => {
            commenters.push({ platform: 'ig', username: c.username || "Unknown", text: c.text });
          });
        });
      }

      if (newIgLinks.length > 0) {
        setIgLinks(prev => Array.from(new Set([...prev, ...newIgLinks])));
      }
      if (newFbLinks.length > 0) {
        setFbLinks(prev => Array.from(new Set([...prev, ...newFbLinks])));
      }

      const igUsernames = commenters.map((c) => c.username).filter(Boolean);

      if (igUsernames.length > 0) {
        setIgRawInput(prev => mergeUniqueLines(prev, igUsernames));
      }

      const fbPostCount = fbPosts.length;
      const igPostCount = igPosts.length;

      if (fbPostCount === 0 && igPostCount === 0) {
        let msg = `Tidak ada postingan pada tanggal ${date}.`;
        if (latestFbPostDate) {
          const d = new Date(latestFbPostDate);
          msg += ` Postingan FB terakhir adalah tanggal ${d.toLocaleDateString('id-ID')}.`;
        }
        if (!igAccountId) {
          msg += ` (Akun Instagram Bisnis belum terhubung ke Halaman FB ini).`;
        }
        toast.warning(msg, { duration: 6000 });
      } else {
        toast.success(`Ditemukan ${igPostCount} post IG & ${fbPostCount} post FB. Berhasil menarik ${commenters.length} komentar IG ke dalam form.`);
      }
    } catch (err: unknown) {
      // Abort karena modal ditutup → bukan error; tunggu saja (finally tetap
      // membersihkan). Abort karena timeout → pesan batas waktu.
      if (err instanceof Error && err.name === 'AbortError' && !timedOut) return;
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? 'Permintaan Meta API melebihi batas waktu (60 detik). Coba lagi.'
          : err instanceof Error
            ? err.message
            : 'Gagal menarik data Meta API';
      toast.error(message);
    } finally {
      clearTimeout(timeoutId);
      if (metaFetchRef.current?.controller === controller) metaFetchRef.current = null;
      setIsFetchingMeta(false);
    }
  };

  const handleSave = async () => {
    if (!user || !db) {
      toast.error('Anda harus login untuk menyimpan data');
      return;
    }

    setIsSaving(true);
    try {
      const currentIgRawInput = igRawInput;
      const currentFbRawInput = fbRawInput;
      const currentTiktokRawInput = tiktokRawInput;

      // Selalu rematch — master pegawai bisa berubah meski raw text sama
      const igEngagedIds = matchEmployeesToEngagement(currentIgRawInput, employees, 'ig');
      const fbEngagedIds = matchEmployeesToEngagement(currentFbRawInput, employees, 'fb');
      const tiktokEngagedIds = matchEmployeesToEngagement(currentTiktokRawInput, employees, 'tiktok');

      const docRef = dinasDoc(db, user.uid, 'dailyEngagement', date);

      const igContentChanged = currentIgRawInput !== initialIgRawInput || JSON.stringify(igLinks) !== JSON.stringify(initialIgLinks);
      const fbContentChanged = currentFbRawInput !== initialFbRawInput || JSON.stringify(fbLinks) !== JSON.stringify(initialFbLinks);
      const tiktokContentChanged = currentTiktokRawInput !== initialTiktokRawInput || JSON.stringify(tiktokLinks) !== JSON.stringify(initialTiktokLinks);

      const igIdsChanged = !engagedIdsEqual(existing?.igEngagedEmployeeIds || [], igEngagedIds);
      const fbIdsChanged = !engagedIdsEqual(existing?.fbEngagedEmployeeIds || [], fbEngagedIds);
      const tiktokIdsChanged = !engagedIdsEqual(existing?.tiktokEngagedEmployeeIds || [], tiktokEngagedIds);

      const igChanged = igContentChanged || igIdsChanged;
      const fbChanged = fbContentChanged || fbIdsChanged;
      const tiktokChanged = tiktokContentChanged || tiktokIdsChanged;

      if (!igChanged && !fbChanged && !tiktokChanged) {
        // Rekap otomatis dari ReSoEx sudah lengkap di DB — simpan tanpa ubahan
        // cukup menandai terverifikasi. Gunakan transaction agar tidak race dengan extension.
        if (existing?.autoFilledAt && !existing.verifiedAt) {
          await runTransaction(db, async (tx) => {
            tx.set(docRef, { date, verifiedAt: serverTimestamp() }, { merge: true });
          });
          toast.success('Rekap ditandai terverifikasi — data sudah lengkap dari ReSoEx.');
        } else {
          toast.info('Tidak ada perubahan untuk disimpan');
        }
        onClose();
        return;
      }

      const updateData: Record<string, unknown> = {
        date,
        updatedAt: serverTimestamp(),
        // Menyimpan = operator sudah memeriksa rekap (termasuk yang auto-filled).
        verifiedAt: serverTimestamp()
      };

      if (igChanged) {
        updateData.igRawText = currentIgRawInput;
        updateData.igEngagedEmployeeIds = igEngagedIds;
        updateData.igLinks = igLinks;
      }
      if (fbChanged) {
        updateData.fbRawText = currentFbRawInput;
        updateData.fbEngagedEmployeeIds = fbEngagedIds;
        updateData.fbLinks = fbLinks;
      }
      if (tiktokChanged) {
        updateData.tiktokRawText = currentTiktokRawInput;
        updateData.tiktokEngagedEmployeeIds = tiktokEngagedIds;
        updateData.tiktokLinks = tiktokLinks;
      }

      // Antrian nama belum terpetakan: platform berubah dihitung ulang, lainnya
      // dipertahankan dari dokumen (dedupe case-insensitive).
      const prevUnmatched = Array.isArray(existing?.unmatchedNames)
        ? (existing.unmatchedNames as UnmatchedName[])
        : [];
      const seenU = new Set<string>();
      const unmatchedNames: UnmatchedName[] = [];
      const pushU = (u: UnmatchedName) => {
        const key = `${u.name.trim().toLowerCase()}|${u.platform}`;
        if (seenU.has(key)) return;
        seenU.add(key);
        unmatchedNames.push(u);
      };
      for (const p of ['ig', 'fb', 'tiktok'] as const) {
        const changed = p === 'ig' ? igChanged : p === 'fb' ? fbChanged : tiktokChanged;
        if (changed) {
          const raw = p === 'ig' ? currentIgRawInput : p === 'fb' ? currentFbRawInput : currentTiktokRawInput;
          for (const name of matchEngagementDetail(raw, employees, p).unmatched) pushU({ name, platform: p });
        } else {
          for (const u of prevUnmatched) if (u.platform === p) pushU(u);
        }
      }
      updateData.unmatchedNames = unmatchedNames;

      await runTransaction(db, async (tx) => {
        // Baca snapshot terbaru untuk hindari last-write-wins dengan extension
        const snap = await tx.get(docRef);
        const latest = snap.exists() ? (snap.data() as DailyEngagement) : undefined;
        // Jika ekstensi baru saja menulis rawText untuk platform yang tidak kita ubah,
        // jangan timpa — merge dengan data terbaru untuk platform tersebut
        const merged: Record<string, unknown> = { ...updateData };
        if (!igChanged && latest?.igRawText !== undefined) {
          merged.igRawText = latest.igRawText;
          merged.igEngagedEmployeeIds = latest.igEngagedEmployeeIds;
          merged.igLinks = latest.igLinks;
        }
        if (!fbChanged && latest?.fbRawText !== undefined) {
          merged.fbRawText = latest.fbRawText;
          merged.fbEngagedEmployeeIds = latest.fbEngagedEmployeeIds;
          merged.fbLinks = latest.fbLinks;
        }
        if (!tiktokChanged && latest?.tiktokRawText !== undefined) {
          merged.tiktokRawText = latest.tiktokRawText;
          merged.tiktokEngagedEmployeeIds = latest.tiktokEngagedEmployeeIds;
          merged.tiktokLinks = latest.tiktokLinks;
        }
        tx.set(docRef, merged, { merge: true });
      });

      // Sinkronkan baseline agar dirty-check menganggap tersimpan.
      setInitialIgRawInput(currentIgRawInput);
      setInitialFbRawInput(currentFbRawInput);
      setInitialTiktokRawInput(currentTiktokRawInput);
      setInitialIgLinks(igLinks);
      setInitialFbLinks(fbLinks);
      setInitialTiktokLinks(tiktokLinks);

      toast.success(`Data rekap tanggal ${date} berhasil disimpan`);
      onClose();
    } catch (error: unknown) {
      console.error('Error saving engagement:', error);
      const err = error as { code?: string; message?: string };
      if (err.code === 'permission-denied' || err.message?.includes('Missing or insufficient permissions')) {
        toast.error('Akses ditolak: Anda tidak memiliki izin untuk menyimpan data ini.');
      } else {
        toast.error(`Gagal menyimpan data: ${err.message || 'Kesalahan tidak diketahui'}`);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-0 sm:p-4"
          onClick={isSaving || isFetchingMeta ? undefined : onClose}
          aria-hidden={isSaving || isFetchingMeta ? 'true' : undefined}
          role="presentation"
        >
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="input-rekap-title"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ ease: "easeOut", duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full max-w-2xl rounded-t-2xl sm:rounded-xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[85vh] shadow-lg border border-slate-200"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 shrink-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 id="input-rekap-title" className="text-sm font-bold tracking-tight text-slate-900">Input Rekapitulasi</h3>
                  {existing?.autoFilledAt && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[9px] font-bold',
                        existing?.verifiedAt
                          ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                          : 'border-amber-200 text-amber-700 bg-amber-50'
                      )}
                    >
                      {existing?.verifiedAt ? 'ReSoEx · Terverifikasi' : 'ReSoEx · Perlu review'}
                    </Badge>
                  )}
                  {unmatchedCount > 0 && (
                    <button
                      type="button"
                      onClick={onOpenUnmatched}
                      aria-label={`${unmatchedCount} nama belum terpetakan — buka panel pemetaan`}
                      className="inline-flex rounded-md focus:outline-none focus:ring-1 focus:ring-slate-900"
                    >
                      <Badge variant="warning" className="text-[9px] font-bold cursor-pointer hover:bg-amber-100">
                        {unmatchedCount} belum terpetakan
                      </Badge>
                    </button>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">
                  {parseLocalISODate(date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  {postedAt.length > 0 && (
                    <span className="ml-2 text-slate-300">•</span>
                  )}
                  {postedAt.length > 0 && (
                    <span className="ml-2">Posting {postedAt.map((t) => t.slice(11)).join(' · ')}</span>
                  )}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} disabled={isSaving || isFetchingMeta} aria-label="Tutup" className="h-8 w-8 shrink-0 rounded-lg hover:bg-slate-100 disabled:opacity-50">
                <X className="text-slate-500" size={16} />
              </Button>
            </div>

            <div className="space-y-3 overflow-y-auto px-4 py-3 pb-safe">
              {/* Meta fetch — token dikelola di Pengaturan */}
              <div className="rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsMetaExpanded((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-slate-50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <RefreshCw size={13} className="shrink-0 text-slate-500" />
                    <span className="truncate text-xs font-bold text-slate-700">Tarik via Meta API</span>
                    <span className="hidden text-[10px] font-semibold text-slate-400 sm:inline">15:00 WIB</span>
                  </span>
                  <ChevronDown
                    size={14}
                    className={cn('shrink-0 text-slate-400 transition-transform', isMetaExpanded && 'rotate-180')}
                  />
                </button>
                {isMetaExpanded && (
                  <div className="space-y-1.5 border-t border-slate-100 px-3 py-2.5">
                    <Button
                      onClick={handleFetchRecentMeta}
                      disabled={isFetchingMeta || !metaToken.trim()}
                      className="h-8 w-full rounded-lg bg-slate-900 text-[11px] font-bold text-white hover:bg-slate-800"
                    >
                      {isFetchingMeta
                        ? 'Menarik data…'
                        : !metaToken.trim()
                          ? 'Token belum diatur'
                          : `Tarik post (${parseLocalISODate(addLocalDays(date, -1)).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} → ${parseLocalISODate(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })})`}
                    </Button>
                    {!metaToken.trim() ? (
                      <button
                        type="button"
                        onClick={() => { onClose(); onGoToSettings(); }}
                        className="text-[10px] font-semibold text-slate-500 underline underline-offset-2 hover:text-slate-700"
                      >
                        Atur token Meta di Pengaturan
                      </button>
                    ) : (
                      <p className="text-[10px] leading-snug text-slate-400">
                        IG: komentar + link · FB: link post · Window 15:00 H−1 s/d 15:00 (WIB).
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Meta Links Section */}
              <div className="rounded-lg border border-slate-200">
                <div className="flex items-center justify-between px-3 pt-2.5">
                  <div className="flex items-center gap-1.5">
                    <Instagram size={13} className="text-slate-400" />
                    <h4 className="text-xs font-bold text-slate-700">Link Postingan</h4>
                    <span className="text-[10px] font-semibold text-slate-400">
                      {parseLocalISODate(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                </div>

                {/* Tab platform */}
                <div className="flex items-center gap-1 px-3 pt-2">
                  {(['ig', 'fb', 'tiktok'] as const).map((p) => {
                    const counts = { ig: igLinks.length, fb: fbLinks.length, tiktok: tiktokLinks.length }[p];
                    const active = activeLinkTab === p;
                    const label = p === 'ig' ? 'IG' : p === 'fb' ? 'FB' : 'TikTok';
                    const Icon = p === 'ig' ? Instagram : p === 'fb' ? Facebook : TiktokIcon;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setActiveLinkTab(p)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold transition-colors',
                          active ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
                        )}
                      >
                        <Icon size={11} className={active ? '' : p === 'ig' ? 'text-pink-500' : p === 'fb' ? 'text-blue-500' : 'text-slate-700'} />
                        {label}
                        <span className={cn('px-1 text-[9px] font-bold', active ? 'text-white/70' : 'text-slate-400')}>
                          {counts}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="p-3 pt-2">
                  {/* Smart Link Input */}
                  <div>
                    <textarea
                      placeholder="Paste link (pisahkan spasi/enter) — Enter untuk tambah…"
                      className="h-11 w-full resize-none rounded-lg border border-slate-200 bg-white p-2 text-[11px] transition-all focus:ring-slate-900/5"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          const val = e.currentTarget.value;
                          if (val) {
                            const urls = val.split(/[\s,\n]+/).filter(url => url.trim() !== '');
                            const newIg = [...igLinks];
                            const newFb = [...fbLinks];
                            const newTiktok = [...tiktokLinks];
                            urls.forEach(rawUrl => {
                              let url = rawUrl.trim();
                              if (!url) return;
                              // Validasi host — hanya izinkan domain sosmed resmi
                              let host = '';
                              try {
                                const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
                                host = parsed.hostname.toLowerCase();
                              } catch { return; }
                              const isIg = host === 'instagram.com' || host.endsWith('.instagram.com');
                              const isFb = host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch' || host.endsWith('.fb.watch') || host === 'fb.com' || host.endsWith('.fb.com');
                              const isTt = host === 'tiktok.com' || host.endsWith('.tiktok.com');
                              if (isIg) {
                                url = url.replace(/\/(?:reel|reels)\//i, '/p/');
                                if (!newIg.includes(url)) newIg.push(url);
                              } else if (isFb) {
                                if (url.match(/facebook\.com\/reel\/(\d+)/i)) {
                                  url = url.replace(/facebook\.com\/reel\/(\d+)/i, 'facebook.com/p/$1');
                                } else if (url.match(/facebook\.com\/share\/r\/([a-zA-Z0-9]+)/i)) {
                                  url = url.replace(/facebook\.com\/share\/r\/([a-zA-Z0-9]+)/i, 'facebook.com/share/p/$1');
                                }
                                if (!newFb.includes(url)) newFb.push(url);
                              } else if (isTt) {
                                if (!newTiktok.includes(url)) newTiktok.push(url);
                              }
                            });
                            setIgLinks(newIg);
                            setFbLinks(newFb);
                            setTiktokLinks(newTiktok);
                            e.currentTarget.value = '';
                          }
                        }
                      }}
                    />
                    <p className="text-[9px] text-slate-400 mt-1">Tekan Enter untuk menambahkan. Sistem otomatis memisahkan link IG dan FB.</p>
                  </div>

                  {/* Active platform links */}
                  <div className="flex flex-wrap gap-2 items-center mt-2.5">
                    {activeLinkTab === 'ig' && (
                      <>
                        <Instagram size={14} className="text-pink-500" />
                        {igLinks.length > 0 ? (
                          igLinks.map((link, idx) => (
                            <div key={idx} className="inline-flex items-center gap-1 rounded-md bg-pink-50 px-2 py-0.5 text-[11px] font-medium text-pink-700">
                              <a href={link} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1">
                                Post IG {idx + 1}
                                <ExternalLink size={10} />
                              </a>
                              <button
                                type="button"
                                aria-label={`Hapus Post IG ${idx + 1}`}
                                onClick={() => {
                                  const newLinks = [...igLinks];
                                  newLinks.splice(idx, 1);
                                  setIgLinks(newLinks);
                                }}
                                className="ml-1 p-0.5 hover:bg-pink-200 rounded-full transition-colors"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400 italic">Belum ada postingan IG</span>
                        )}
                      </>
                    )}
                    {activeLinkTab === 'fb' && (
                      <>
                        <Facebook size={14} className="text-blue-500" />
                        {fbLinks.length > 0 ? (
                          fbLinks.map((link, idx) => (
                            <div key={idx} className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                              <a href={link} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1">
                                Post FB {idx + 1}
                                <ExternalLink size={10} />
                              </a>
                              <button
                                type="button"
                                aria-label={`Hapus Post FB ${idx + 1}`}
                                onClick={() => {
                                  const newLinks = [...fbLinks];
                                  newLinks.splice(idx, 1);
                                  setFbLinks(newLinks);
                                }}
                                className="ml-1 p-0.5 hover:bg-blue-200 rounded-full transition-colors"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400 italic">Belum ada postingan FB</span>
                        )}
                      </>
                    )}
                    {activeLinkTab === 'tiktok' && (
                      <>
                        <span className="font-bold text-slate-800 text-sm italic pr-1 leading-none">t</span>
                        {tiktokLinks.length > 0 ? (
                          tiktokLinks.map((link, idx) => (
                            <div key={idx} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800">
                              <a href={link} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1">
                                Post TikTok {idx + 1}
                                <ExternalLink size={10} />
                              </a>
                              <button
                                type="button"
                                aria-label={`Hapus Post TikTok ${idx + 1}`}
                                onClick={() => {
                                  const newLinks = [...tiktokLinks];
                                  newLinks.splice(idx, 1);
                                  setTiktokLinks(newLinks);
                                }}
                                className="ml-1 p-0.5 hover:bg-slate-300 rounded-full transition-colors"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400 italic">Belum ada postingan TikTok</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <div>
                  <label className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <Instagram size={11} className="text-pink-500" />
                    List IG
                  </label>
                  <textarea
                    value={igRawInput}
                    onChange={(e) => setIgRawInput(e.target.value)}
                    placeholder="Paste username / nama…"
                    className="h-24 w-full resize-none rounded-lg border border-slate-200 bg-white p-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 md:h-32"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <Facebook size={11} className="text-blue-500" />
                    List FB
                  </label>
                  <textarea
                    value={fbRawInput}
                    onChange={(e) => setFbRawInput(e.target.value)}
                    placeholder="Paste nama / profil…"
                    className="h-24 w-full resize-none rounded-lg border border-slate-200 bg-white p-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 md:h-32"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <TiktokIcon size={13} className="text-slate-800" />
                    List TikTok
                  </label>
                  <textarea
                    value={tiktokRawInput}
                    onChange={(e) => setTiktokRawInput(e.target.value)}
                    placeholder="Paste nama akun TikTok…"
                    className="h-24 w-full resize-none rounded-lg border border-slate-200 bg-white p-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 md:h-32"
                  />
                </div>
              </div>

              {/* Live match preview */}
              <MatchPreview
                ig={matchPreview.ig}
                fb={matchPreview.fb}
                tiktok={matchPreview.tiktok}
              />
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <Button variant="ghost" onClick={onClose} disabled={isSaving || isFetchingMeta} className="h-8 rounded-lg px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50">
                Batal
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || isFetchingMeta}
                className="h-8 rounded-lg bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isSaving ? 'Menyimpan…' : 'Simpan Rekap'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}