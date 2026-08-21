import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { 
  LayoutDashboard, 
  PlusCircle, 
  Users2,
  XCircle,
  X,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  History,
  Settings,
  Instagram,
  Facebook,
  FileText,
  Menu,
  Link as LinkIcon,
  RefreshCw,
  ExternalLink,
  PieChart,
  CheckCircle2
} from 'lucide-react';
import { TiktokIcon } from './icons/TiktokIcon';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { DailyEngagement, Employee, UnmatchedName } from '../types';
import { useAuth } from './FirebaseProvider';
import { useAppLogo } from '../hooks/useAppLogo';
import { logout, dinasCollection, dinasDoc } from '../lib/firebase';
import { onSnapshot, query, orderBy, setDoc, serverTimestamp, writeBatch, where, updateDoc, arrayUnion } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { getLocalISODate, parseLocalISODate, addLocalDays } from '../lib/date';
import { matchEmployeesToEngagement, matchEngagementDetail, engagedIdsEqual, mergeUniqueLines } from '../lib/matching';
import { collectUnverifiedAutoFilled } from '../lib/engagement-api';

import { DashboardTab } from './tabs/DashboardTab';
import { SettingsTab } from './tabs/SettingsTab';
import { DailyReportView } from './reports/DailyReportView';
import { WeeklyReportView } from './reports/WeeklyReportView';
import { MonthlyReportView } from './reports/MonthlyReportView';

const PLATFORM_LABEL: Record<UnmatchedName['platform'], string> = { ig: 'IG', fb: 'FB', tiktok: 'TikTok' };
const EmployeeManager = React.lazy(() => import('./EmployeeManager'));

const containerVariants: import('motion/react').Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.02
    }
  }
};

const itemVariants: import('motion/react').Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: {
      type: "tween",
      ease: "easeOut", duration: 0.18
    }
  }
};

export default function EngagementDashboard() {
  const { user, loading, db } = useAuth();
  const appLogo = useAppLogo();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [dailyEngagements, setDailyEngagements] = useState<DailyEngagement[]>([]);
  const [selectedDate, setSelectedDate] = useState(getLocalISODate(new Date()));
  const [igRawInput, setIgRawInput] = useState('');
  const [fbRawInput, setFbRawInput] = useState('');
  const [tiktokRawInput, setTiktokRawInput] = useState('');
  const [igLinks, setIgLinks] = useState<string[]>([]);
  const [fbLinks, setFbLinks] = useState<string[]>([]);
  const [tiktokLinks, setTiktokLinks] = useState<string[]>([]);
  const [isInputModalOpen, setIsInputModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [currentWeekDate, setCurrentWeekDate] = useState(new Date());
  const [currentMonthlyReportDate, setCurrentMonthlyReportDate] = useState(new Date());
  const [currentDailyDate, setCurrentDailyDate] = useState(new Date());
  const [weeklySortMode, setWeeklySortMode] = useState<'name' | 'bidang'>('bidang');
  const [monthlySortMode, setMonthlySortMode] = useState<'rank' | 'bidang' | 'name'>('rank');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [recalculateConfig, setRecalculateConfig] = useState<{
    mode: 'last_day' | 'last_week';
  }>({
    mode: 'last_day'
  });

  // Meta API State
  const [metaToken, setMetaToken] = useState('');
  const [isFetchingMeta, setIsFetchingMeta] = useState(false);
  const [isSavingToken, setIsSavingToken] = useState(false);

  // Load Meta Token from Firestore on mount
  useEffect(() => {
    if (loading || !user) return;

    const unsubscribe = onSnapshot(
      dinasDoc(db, user.uid, 'settings', 'meta_api'),
      (docSnap) => {
        if (docSnap.exists()) {
          setMetaToken(docSnap.data().value || '');
        }
      },
      (err) => {
        console.error('Gagal memuat token Meta:', err);
      }
    );

    return unsubscribe;
  }, [user, loading]);

  const handleSaveMetaToken = async () => {
    if (!user) return;
    setIsSavingToken(true);
    try {
      const trimmed = metaToken.trim();
      if (!trimmed) {
        toast.error('Token API Meta tidak boleh kosong');
        return;
      }
      await setDoc(dinasDoc(db, user.uid, 'settings', 'meta_api'), {
        value: trimmed,
        updatedAt: serverTimestamp()
      });
      setMetaToken(trimmed);
      toast.success("Token API Meta berhasil disimpan ke server");
    } catch (err) {
      console.error("Error saving meta token:", err);
      toast.error("Gagal menyimpan token ke server");
    } finally {
      setIsSavingToken(false);
    }
  };

  const printRef = useRef<HTMLDivElement>(null);
  const printMonthlyRef = useRef<HTMLDivElement>(null);
  const printDailyRef = useRef<HTMLDivElement>(null);

  // Load employees from Firestore
  useEffect(() => {
    if (loading || !user || !db) {
      setEmployees([]);
      return;
    }

    const q = query(dinasCollection(db, user.uid, 'employees'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const emps = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Employee));
        setEmployees(emps);
      },
      (err) => {
        console.error('Gagal memuat pegawai:', err);
        toast.error('Gagal memuat data pegawai');
      }
    );
    return unsubscribe;
  }, [user, loading, db]);

  // Calculate the oldest date we need to fetch based on current views
  const oldestRequiredDate = useMemo(() => {
    const dates = [
      currentMonthlyReportDate,
      currentWeekDate,
      new Date() // Today
    ];
    // Set to 1st of the month for each date to ensure we get the full month
    const oldest = new Date(Math.min(...dates.map(d => new Date(d.getFullYear(), d.getMonth(), 1).getTime())));
    // Subtract 7 days just to be safe with timezone issues and week overlaps
    oldest.setDate(oldest.getDate() - 7);
    return getLocalISODate(oldest);
  }, [currentMonthlyReportDate, currentWeekDate]);

  // Load daily engagements
  useEffect(() => {
    if (loading || !user || !db) {
      setDailyEngagements([]);
      return;
    }

    const q = query(
      dinasCollection(db, user.uid, 'dailyEngagement'), 
      where('date', '>=', oldestRequiredDate),
      orderBy('date', 'desc')
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DailyEngagement));
        setDailyEngagements(data);
      },
      (err) => {
        console.error('Gagal memuat rekap harian:', err);
        toast.error('Gagal memuat data rekap');
      }
    );
    return unsubscribe;
  }, [user, loading, oldestRequiredDate, db]);

  const dailyEngagementsMap = useMemo(() => {
    return dailyEngagements.reduce((acc, curr) => {
      acc[curr.id] = curr;
      return acc;
    }, {} as Record<string, DailyEngagement>);
  }, [dailyEngagements]);

  // Rekap otomatis dari ReSoEx yang belum diperiksa operator (autoFilledAt ada,
  // verifiedAt belum) — sumber tombol "Terima semua rekap otomatis".
  const unverifiedAutoFilledDates = useMemo(
    () => collectUnverifiedAutoFilled(dailyEngagementsMap),
    [dailyEngagementsMap]
  );
  const [isVerifyingAll, setIsVerifyingAll] = useState(false);

  const handleVerifyAllAutoFilled = async () => {
    if (!user) {
      toast.error('Anda harus login untuk menyimpan data');
      return;
    }
    if (!unverifiedAutoFilledDates.length) return;
    setIsVerifyingAll(true);
    try {
      const batch = writeBatch(db);
      for (const date of unverifiedAutoFilledDates) {
        batch.set(
          dinasDoc(db, user.uid, 'dailyEngagement', date),
          { date, verifiedAt: serverTimestamp() },
          { merge: true }
        );
      }
      await batch.commit();
      toast.success(`${unverifiedAutoFilledDates.length} rekap otomatis ditandai terverifikasi.`);
    } catch (error: unknown) {
      console.error('Error verifying auto-filled rekaps:', error);
      toast.error('Gagal menandai terverifikasi — coba lagi.');
    } finally {
      setIsVerifyingAll(false);
    }
  };

  // ---- Antrian nama belum terpetakan (review + pemetaan alias) ----
  const [isUnmatchedReviewOpen, setIsUnmatchedReviewOpen] = useState(false);
  const [mapSelections, setMapSelections] = useState<Record<string, string>>({});
  const [isMapping, setIsMapping] = useState(false);

  const selectedUnmatched = useMemo(() => {
    const eng = dailyEngagementsMap[selectedDate];
    return Array.isArray(eng?.unmatchedNames) ? (eng.unmatchedNames as UnmatchedName[]) : [];
  }, [dailyEngagementsMap, selectedDate]);
  // Waktu posting yang direkap otomatis dari ReSoEx (L3) — array, satu entry
  // per kiriman (satu hari bisa banyak post).
  const selectedPostedAt = useMemo(() => {
    const eng = dailyEngagementsMap[selectedDate];
    return Array.isArray(eng?.postedAt) ? (eng.postedAt as string[]) : [];
  }, [dailyEngagementsMap, selectedDate]);

  /** Hitung ulang matching ketiga platform untuk satu tanggal dari raw text-nya.
   *  empList bisa membawa alias baru yang belum masuk state (onSnapshot async). */
  const rematchDate = useCallback(
    async (date: string, empList?: Employee[]): Promise<UnmatchedName[]> => {
      const eng = dailyEngagementsMap[date];
      const list = empList ?? employees;
      const raw = (p: 'ig' | 'fb' | 'tiktok') =>
        (p === 'ig' ? eng?.igRawText : p === 'fb' ? eng?.fbRawText : eng?.tiktokRawText) || '';
      const ids = (p: 'ig' | 'fb' | 'tiktok') => matchEmployeesToEngagement(raw(p), list, p);
      const unmatched = (['ig', 'fb', 'tiktok'] as const).flatMap((p) =>
        matchEngagementDetail(raw(p), list, p).unmatched.map((name) => ({ name, platform: p }))
      );
      await setDoc(
        dinasDoc(db, user.uid, 'dailyEngagement', date),
        {
          igEngagedEmployeeIds: ids('ig'),
          fbEngagedEmployeeIds: ids('fb'),
          tiktokEngagedEmployeeIds: ids('tiktok'),
          unmatchedNames: unmatched,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      return unmatched;
    },
    [dailyEngagementsMap, employees]
  );

  const handleMapUnmatched = async () => {
    const entries = Object.entries(mapSelections).filter(([, empId]) => empId);
    if (!entries.length) return;
    setIsMapping(true);
    try {
      // Bangun daftar pegawai lokal yang sudah membawa alias baru, supaya match
      // ulang di bawah melihatnya walau onSnapshot pegawai belum selesai.
      const localEmployees = employees.map((e) => ({ ...e }));
      for (const [key, empId] of entries) {
        const name = key.slice(key.indexOf('|') + 1);
        const emp = localEmployees.find((e) => e.id === empId);
        if (!emp) continue;
        // isValidEmployee mewajibkan name+nip di data masuk → kirim field lengkap.
        await updateDoc(dinasDoc(db, user.uid, 'employees', empId), {
          name: emp.name,
          nip: emp.nip,
          bidang: emp.bidang || '',
          igUsername: emp.igUsername || '',
          igUsername2: emp.igUsername2 || '',
          fbName: emp.fbName || '',
          fbName2: emp.fbName2 || '',
          tiktokName: emp.tiktokName || '',
          tiktokName2: emp.tiktokName2 || '',
          aliases: arrayUnion(name),
          updatedAt: serverTimestamp(),
        });
        emp.aliases = [...(emp.aliases || []), name];
      }
      // Match ulang tanggal ini: nama yang baru dipetakan langsung keluar antrian.
      const remaining = await rematchDate(selectedDate, localEmployees);
      setMapSelections({});
      if (remaining.length === 0) {
        setIsUnmatchedReviewOpen(false);
        toast.success(`Semua nama tanggal ${selectedDate} sudah terpetakan.`);
      } else {
        toast.success(`${entries.length} nama dipetakan — ${remaining.length} belum terpetakan.`);
      }
    } catch (error: unknown) {
      console.error('Error mapping unmatched names:', error);
      toast.error('Gagal memetakan nama — coba lagi.');
    } finally {
      setIsMapping(false);
    }
  };

  const handleRematchOnly = async () => {
    setIsMapping(true);
    try {
      const remaining = await rematchDate(selectedDate);
      toast.info(`Match ulang selesai — ${remaining.length} nama belum terpetakan.`);
    } catch (error: unknown) {
      console.error('Error rematching:', error);
      toast.error('Gagal match ulang — coba lagi.');
    } finally {
      setIsMapping(false);
    }
  };

  const closeInputModal = () => {
    setIsInputModalOpen(false);
    if (window.history.state?.modal === 'input') {
      window.history.back();
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      if (isInputModalOpen) {
        setIsInputModalOpen(false);
      }
    };

    if (isInputModalOpen) {
      window.history.pushState({ modal: 'input' }, '');
      window.addEventListener('popstate', handlePopState);
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isInputModalOpen]);

  const [initialIgRawInput, setInitialIgRawInput] = useState('');
  const [initialFbRawInput, setInitialFbRawInput] = useState('');
  const [initialTiktokRawInput, setInitialTiktokRawInput] = useState('');
  const [initialIgLinks, setInitialIgLinks] = useState<string[]>([]);
  const [initialFbLinks, setInitialFbLinks] = useState<string[]>([]);
  const [initialTiktokLinks, setInitialTiktokLinks] = useState<string[]>([]);

  // Notifikasi pengisian otomatis dari ReSoEx — sekali per tanggal per sesi.
  const notifiedAutoFillRef = useRef<Set<string>>(new Set());

  // Load raw text and links for selected date if exists
  useEffect(() => {
    const existing = dailyEngagementsMap[selectedDate];
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
  }, [selectedDate, dailyEngagements]);

  // Data datang langsung dari ekstensi (API → Firestore). Real-time onSnapshot
  // sudah memuatnya; di sini beri tahu operator — data sudah tersimpan otomatis,
  // tinggal dicek (tidak wajib simpan).
  useEffect(() => {
    const eng = dailyEngagementsMap[selectedDate];
    if (eng?.autoFilledAt && !notifiedAutoFillRef.current.has(selectedDate)) {
      notifiedAutoFillRef.current.add(selectedDate);
      const count =
        typeof eng.autoFilledCount === 'number' && eng.autoFilledCount > 0
          ? ` (${eng.autoFilledCount} nama baru)`
          : '';
      toast.info(`Rekap ${selectedDate} diisi otomatis dari ReSoEx${count} — sudah tersimpan, cek rekapnya.`);
    }
  }, [selectedDate, dailyEngagementsMap]);

  const sortedEmployees = useMemo(() => {
    return employees.slice().sort((a, b) => {
      if (weeklySortMode === 'name') {
        return a.name.localeCompare(b.name);
      }
      return (a.bidang || '').localeCompare(b.bidang || '') || a.name.localeCompare(b.name);
    });
  }, [employees, weeklySortMode]);

  const handleFetchRecentMeta = async () => {
    setIsFetchingMeta(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      if (!metaToken) throw new Error("Token API Meta tidak boleh kosong.");

      // Window rekap resmi: 15:00 H-1 s/d 15:00 D (WIB) = UTC 08:00
      const isWithinCustomWindow = (postDateStr: string, targetDateStr: string) => {
        if (!postDateStr) return false;
        const postTime = new Date(postDateStr).getTime();
        if (Number.isNaN(postTime)) return false;
        const endDate = new Date(`${targetDateStr}T08:00:00Z`);
        const endTime = endDate.getTime();
        const startTime = endTime - (24 * 60 * 60 * 1000);
        return postTime >= startTime && postTime <= endTime;
      };

      type MetaPost = { id: string; created_time?: string; timestamp?: string; permalink_url?: string; permalink?: string };
      let fbPosts: MetaPost[] = [];
      let igPosts: MetaPost[] = [];
      let pageToken = metaToken;
      let pageId = "me";

      // Resolve Page Token
      try {
        const accRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${metaToken}`, { signal: controller.signal });
        const accData = await accRes.json();
        if (accData.data && accData.data.length > 0) {
          pageId = accData.data[0].id;
          pageToken = accData.data[0].access_token;
        } else {
          const debugRes = await fetch(`https://graph.facebook.com/v19.0/debug_token?input_token=${metaToken}&access_token=${metaToken}`, { signal: controller.signal });
          const debugData = await debugRes.json();
          if (debugData.data && debugData.data.granular_scopes) {
            const scope = debugData.data.granular_scopes.find((s: { scope: string; target_ids?: string[] }) =>
              s.scope === 'pages_show_list' || s.scope === 'pages_read_engagement' || s.scope === 'pages_manage_posts'
            );
            if (scope && scope.target_ids && scope.target_ids.length > 0) {
              pageId = scope.target_ids[0];
              const pageRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=access_token&access_token=${metaToken}`, { signal: controller.signal });
              const pageData = await pageRes.json();
              if (pageData.access_token) pageToken = pageData.access_token;
            }
          }
        }
      } catch {
        // Not a user token, continuing with original token
      }

      const fbPostsRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/posts?fields=id,created_time,permalink_url&access_token=${pageToken}&limit=50`, { signal: controller.signal });
      const fbPostsData = await fbPostsRes.json();
      let latestFbPostDate: string | null = null;

      if (!fbPostsData.error && fbPostsData.data) {
        if (fbPostsData.data.length > 0) latestFbPostDate = fbPostsData.data[0].created_time;
        fbPosts = fbPostsData.data.filter((p: MetaPost) => isWithinCustomWindow(p.created_time || '', selectedDate));
      }

      const igAccRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`, { signal: controller.signal });
      const igAccData = await igAccRes.json();
      const igAccountId = igAccData.instagram_business_account?.id as string | undefined;

      if (igAccountId) {
        const igPostsRes = await fetch(`https://graph.facebook.com/v19.0/${igAccountId}/media?fields=id,timestamp,permalink&access_token=${pageToken}&limit=50`, { signal: controller.signal });
        const igPostsData = await igPostsRes.json();
        if (!igPostsData.error && igPostsData.data) {
          igPosts = igPostsData.data.filter((p: MetaPost) => isWithinCustomWindow(p.timestamp || '', selectedDate));
        }
      }

      if (fbPostsData.error && !igAccountId) {
        throw new Error(fbPostsData.error?.message || "Gagal mengakses data Page/Instagram.");
      }

      const commenters: { platform: 'ig'; username: string; text?: string }[] = [];
      const newFbLinks = fbPosts.map((p) => p.permalink_url).filter((u): u is string => Boolean(u));
      const newIgLinks = igPosts.map((p) => p.permalink).filter((u): u is string => Boolean(u));

      for (const post of igPosts) {
        const commentsRes = await fetch(`https://graph.facebook.com/v19.0/${post.id}/comments?fields=id,text,username,timestamp&access_token=${pageToken}&limit=100`, { signal: controller.signal });
        const commentsData = await commentsRes.json();
        (commentsData.data || []).forEach((c: { username?: string; text?: string }) => {
          commenters.push({ platform: 'ig', username: c.username || "Unknown", text: c.text });
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
        let msg = `Tidak ada postingan pada tanggal ${selectedDate}.`;
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
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? 'Permintaan Meta API melebihi batas waktu (60 detik). Coba lagi.'
          : err instanceof Error
            ? err.message
            : 'Gagal menarik data Meta API';
      toast.error(message);
    } finally {
      clearTimeout(timeoutId);
      setIsFetchingMeta(false);
    }
  };

  const handleExportPDF = async (type: 'daily' | 'weekly' | 'monthly', filename: string) => {
    setIsLoading(true);
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageW = 210;
      const pageH = 297;
      const margin = 14;

      // ---- Logo (fetch SVG → canvas → PNG) ----
      const logoDataUrl = await fetchLogoDataUrl();

      // ---- Tentukan rentang tanggal & judul ----
      let title = '';
      let subtitle = '';
      const todayStr = getLocalISODate(new Date());
      let dates: string[] = [];
      if (type === 'daily') {
        dates = [getLocalISODate(currentDailyDate)];
        title = 'LAPORAN HARIAN';
        const d = parseLocalISODate(dates[0]);
        subtitle = `Rekapitulasi Engagement • ${d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
      } else if (type === 'weekly') {
        if (!weeklyReports[0]) return;
        dates = weeklyReports[0].dates;
        title = 'LAPORAN MINGGUAN';
        subtitle = `Rekapitulasi Engagement • Minggu ke-${weeklyReports[0].weekNumber} • ${weeklyReports[0].year}`;
      } else {
        if (!monthlyReports[0]) return;
        dates = monthlyReports[0].dates;
        title = 'LAPORAN BULANAN';
        subtitle = `Rekapitulasi Engagement • ${monthlyReports[0].monthName} ${monthlyReports[0].year}`;
      }

      // ---- Hitung total rate ----
      let totalActual = 0, totalPossible = 0;
      const daysPassed = dates.filter(d => d <= todayStr).length || 1;

      // ---- Bangun baris tabel ----
      const rows: { name: string; nip: string; bidang: string; ig: boolean; fb: boolean; tt: boolean }[] = [];
      sortedEmployees.forEach(emp => {
        if (type === 'daily' && dates[0]) {
          const e = dailyEngagementsMap[dates[0]];
          if (e) {
            totalActual += (e.igEngagedEmployeeIds?.includes(emp.id) ? 1 : 0) + (e.fbEngagedEmployeeIds?.includes(emp.id) ? 1 : 0) + (e.tiktokEngagedEmployeeIds?.includes(emp.id) ? 1 : 0);
          }
          totalPossible += 3;
          rows.push({
            name: emp.name,
            nip: emp.nip || '-',
            bidang: emp.bidang || '—',
            ig: e?.igEngagedEmployeeIds?.includes(emp.id) ?? false,
            fb: e?.fbEngagedEmployeeIds?.includes(emp.id) ?? false,
            tt: e?.tiktokEngagedEmployeeIds?.includes(emp.id) ?? false,
          });
        } else {
          let igC = 0, fbC = 0, ttC = 0;
          dates.forEach(d => {
            if (d > todayStr) return;
            const e = dailyEngagementsMap[d];
            if (e) {
              if (e.igEngagedEmployeeIds?.includes(emp.id)) igC++;
              if (e.fbEngagedEmployeeIds?.includes(emp.id)) fbC++;
              if (e.tiktokEngagedEmployeeIds?.includes(emp.id)) ttC++;
            }
          });
          totalActual += igC + fbC + ttC;
          totalPossible += daysPassed * 3;
          rows.push({
            name: emp.name,
            nip: emp.nip || '-',
            bidang: emp.bidang || '—',
            ig: igC > 0,
            fb: fbC > 0,
            tt: ttC > 0,
          });
        }
      });

      const rate = totalPossible > 0 ? Math.round((totalActual / totalPossible) * 100) : 0;

      // ---- Header & footer digambar di SEMUA halaman (didDrawPage) ----
      const HEADER_H = 32;
      let pageNum = 0;
      const drawHeaderFooter = () => {
        pageNum++;
        // Header: logo + judul + subtitle (kiri), rate (kanan)
        if (logoDataUrl) {
          pdf.addImage(logoDataUrl, 'PNG', margin, 8, 14, 14);
        }
        const txtX = margin + (logoDataUrl ? 19 : 0);
        pdf.setFontSize(13);
        pdf.setFont('helvetica', 'bold');
        pdf.text(title, txtX, 16);
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.text(subtitle, txtX, 22);
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`Rate: ${rate}%`, pageW - margin, 16, { align: 'right' });
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`ReSo • Gen: ${new Date().toLocaleDateString('id-ID')}`, pageW - margin, 22, { align: 'right' });
        // Footer
        pdf.setFontSize(7);
        pdf.text(`Hal. ${pageNum}`, pageW - margin, pageH - 8, { align: 'right' });
        pdf.text('ReSo — Rekap Engagement Sosmed', margin, pageH - 8);
      };

      // ---- Tabel autoTable (auto page break, header+footer tiap halaman) ----
      autoTable(pdf, {
        startY: HEADER_H,
        head: [['Nama Pegawai', 'NIP', 'Bidang', 'IG', 'FB', 'TT']],
        body: rows.map(r => [
          r.name,
          r.nip,
          r.bidang,
          r.ig ? 'Eng' : '—',
          r.fb ? 'Eng' : '—',
          r.tt ? 'Eng' : '—',
        ]),
        styles: { fontSize: 6, cellPadding: 1.5 },
        headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 56 },
          1: { cellWidth: 26 },
          2: { cellWidth: 16 },
          3: { cellWidth: 16, halign: 'center' },
          4: { cellWidth: 16, halign: 'center' },
          5: { cellWidth: 16, halign: 'center' },
        },
        margin: { left: margin, right: margin, top: HEADER_H, bottom: 12 },
        pageBreak: 'auto',
        didDrawPage: drawHeaderFooter,
      });

      pdf.save(`${filename}.pdf`);
      toast.success("PDF berhasil diunduh");
    } catch (error) {
      console.error(error);
      toast.error("Gagal membuat PDF");
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportImage = async (ref: React.RefObject<HTMLDivElement | null>, filename: string) => {
    // Batas data gambar: > 70 pegawai gambar terlalu tinggi → wajib PDF
    if (sortedEmployees.length > 70) {
      toast.error("Data terlalu banyak untuk export gambar (maks 70 pegawai). Gunakan export PDF.");
      return;
    }
    const el = ref.current;
    if (!el) return;
    setIsLoading(true);

    // ★ Paksa render mode cetak SINKRON (tabel desktop penuh tampil, bukan card list)
    // Tanpa flushSync, setTimeout tidak deterministik dan tabel bisa belum tampil saat capture.
    flushSync(() => setIsExporting(true));
    // Tunggu 2 frame agar layout benar-benar ter-render (w-max, tanpa max-h, card list hidden)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // Simpan style asli & set style temporer untuk export penuh (tanpa crop / scrollbar)
    const origOverflow = el.style.overflow;
    const origWidth = el.style.width;
    const origHeight = el.style.height;
    const origMaxW = el.style.maxWidth;
    const origMaxH = el.style.maxHeight;
    // Container tabel di dalam print (max-h-[60vh] / md:max-h-[600px])
    const tableWrapper = el.querySelector('[class*="max-h-"]') as HTMLElement | null;
    const origTblMaxH = tableWrapper?.style.maxHeight ?? null;
    const origTblOverflow = tableWrapper?.style.overflow ?? null;
    // Wrapper min-w-max di dalam tabel (bikin tabel lebih lebar dari viewport)
    const minWMax = el.querySelector('[class*="min-w-max"]') as HTMLElement | null;
    const origMinWMax = minWMax?.style.minWidth ?? null;

    try {
      // ★ Ukur dimensi penuh SETELAH mode cetak diterapkan (flushSync + 2 rAF)
      const w = el.scrollWidth;
      const h = el.scrollHeight;
      el.style.overflow = 'visible';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.style.maxWidth = 'none';
      el.style.maxHeight = 'none';
      // Buka batas tinggi tabel (biarkan seluruh baris terekam)
      if (tableWrapper) {
        tableWrapper.style.maxHeight = 'none';
        tableWrapper.style.overflow = 'visible';
      }
      // Paksa tabel selebar konten
      if (minWMax) minWMax.style.minWidth = w + 'px';

      await new Promise(r => requestAnimationFrame(r));

      const { domToPng } = await import('modern-screenshot');

      const imgData = await domToPng(el, {
        scale: 2,
        backgroundColor: '#ffffff',
      });
      const link = document.createElement('a');
      link.download = `${filename}.png`;
      link.href = imgData;
      link.click();
      toast.success("Gambar berhasil disimpan");
    } catch (error) {
      console.error(error);
      toast.error("Gagal menyimpan gambar");
    } finally {
      // Restore style
      el.style.overflow = origOverflow;
      el.style.width = origWidth;
      el.style.height = origHeight;
      el.style.maxWidth = origMaxW;
      el.style.maxHeight = origMaxH;
      if (tableWrapper) {
        tableWrapper.style.maxHeight = origTblMaxH;
        tableWrapper.style.overflow = origTblOverflow;
      }
      if (minWMax && origMinWMax !== null) minWMax.style.minWidth = origMinWMax;
      setIsExporting(false);
      setIsLoading(false);
    }
  };

  async function fetchLogoDataUrl(): Promise<string | null> {
    try {
      const resp = await fetch('/logo.svg');
      const svgText = await resp.text();
      const img = new Image();
      const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      img.src = url;
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(); });
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 64, 64);
      URL.revokeObjectURL(url);
      return c.toDataURL('image/png');
    } catch { return null; }
  }

  const chartData = useMemo(() => {
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return getLocalISODate(d);
    });

    return last7Days.map(date => {
      const engagement = dailyEngagementsMap[date];
      const igCount = engagement?.igEngagedEmployeeIds?.length || 0;
      const fbCount = engagement?.fbEngagedEmployeeIds?.length || 0;
      const tiktokCount = engagement?.tiktokEngagedEmployeeIds?.length || 0;
      // Parse as local date to avoid UTC weekday shift
      const [y, m, day] = date.split('-').map(Number);
      const localDate = new Date(y, m - 1, day);
      return {
        name: localDate.toLocaleDateString('id-ID', { weekday: 'short' }),
        ig: igCount,
        fb: fbCount,
        tiktok: tiktokCount,
        total: igCount + fbCount + tiktokCount
      };
    });
  }, [dailyEngagementsMap]);

  const stats = useMemo(() => {
    const totalEmployees = employees.length;
    // Use local date — UTC ISO breaks "today" stats after 07:00 WIB
    const today = getLocalISODate(new Date());
    const todayEng = dailyEngagements.find(d => d.id === today);
    const todayCount = (todayEng?.igEngagedEmployeeIds?.length || 0) + (todayEng?.fbEngagedEmployeeIds?.length || 0) + (todayEng?.tiktokEngagedEmployeeIds?.length || 0);
    const totalEngagements = dailyEngagements.reduce((acc, curr) => 
      acc + (curr.igEngagedEmployeeIds?.length || 0) + (curr.fbEngagedEmployeeIds?.length || 0) + (curr.tiktokEngagedEmployeeIds?.length || 0), 0
    );
    
    // Calculate unique engaged employees for the day
    const uniqueEngagedEmployeesToday = new Set([
      ...(todayEng?.igEngagedEmployeeIds || []),
      ...(todayEng?.fbEngagedEmployeeIds || []),
      ...(todayEng?.tiktokEngagedEmployeeIds || [])
    ]).size;

    return {
      totalEmployees,
      todayCount,
      totalEngagements,
      engagementRate: totalEmployees > 0 ? Math.round((uniqueEngagedEmployeesToday / totalEmployees) * 100) : 0
    };
  }, [employees, dailyEngagements]);

  const processEngagementInput = React.useCallback(
    (input: string, platform: 'ig' | 'fb' | 'tiktok') =>
      matchEmployeesToEngagement(input, employees, platform),
    [employees]
  );

  const matchPreview = useMemo(
    () => ({
      ig: matchEmployeesToEngagement(igRawInput, employees, 'ig').length,
      fb: matchEmployeesToEngagement(fbRawInput, employees, 'fb').length,
      tiktok: matchEmployeesToEngagement(tiktokRawInput, employees, 'tiktok').length,
    }),
    [igRawInput, fbRawInput, tiktokRawInput, employees]
  );

  // Lock body scroll when overlays open
  useEffect(() => {
    if (!isInputModalOpen && !isMoreOpen && !isSidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isInputModalOpen, isMoreOpen, isSidebarOpen]);

  // Escape closes topmost overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isInputModalOpen) {
        closeInputModal();
      } else if (isMoreOpen) {
        setIsMoreOpen(false);
      } else if (isSidebarOpen) {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isInputModalOpen, isMoreOpen, isSidebarOpen]);

  const handleSaveEngagement = async () => {
    if (!user) {
      toast.error('Anda harus login untuk menyimpan data');
      return;
    }
    
    setIsLoading(true);
    try {
      // Controlled inputs — state is source of truth (avoids stale defaultValue across dates)
      const currentIgRawInput = igRawInput;
      const currentFbRawInput = fbRawInput;
      const currentTiktokRawInput = tiktokRawInput;

      // Always rematch — master pegawai bisa berubah meski raw text sama
      const igEngagedIds = processEngagementInput(currentIgRawInput, 'ig');
      const fbEngagedIds = processEngagementInput(currentFbRawInput, 'fb');
      const tiktokEngagedIds = processEngagementInput(currentTiktokRawInput, 'tiktok');

      const docRef = dinasDoc(db, user.uid, 'dailyEngagement', selectedDate);
      const existing = dailyEngagementsMap[selectedDate];
      
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
        // Rekap otomatis dari ReSoEx sudah lengkap di DB — Simpan tanpa ubahan
        // cukup menandai terverifikasi (menghapus kesan "wajib simpan").
        if (existing?.autoFilledAt && !existing.verifiedAt) {
          await setDoc(docRef, { date: selectedDate, verifiedAt: serverTimestamp() }, { merge: true });
          toast.success('Rekap ditandai terverifikasi — data sudah lengkap dari ReSoEx.');
        } else {
          toast.info('Tidak ada perubahan untuk disimpan');
        }
        closeInputModal();
        return;
      }
      
      const updateData: Record<string, unknown> = {
        date: selectedDate,
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

      // Antrian nama belum terpetakan: platform yang berubah dihitung ulang,
      // platform lain dipertahankan dari dokumen (dedupe case-insensitive).
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

      await setDoc(docRef, updateData, { merge: true });

      toast.success(`Data rekap tanggal ${selectedDate} berhasil disimpan`);
      closeInputModal();
    } catch (error: unknown) {
      console.error('Error saving engagement:', error);
      const err = error as { code?: string; message?: string };
      if (err.code === 'permission-denied' || err.message?.includes('Missing or insufficient permissions')) {
        toast.error('Akses ditolak: Anda tidak memiliki izin untuk menyimpan data ini.');
      } else {
        toast.error(`Gagal menyimpan data: ${err.message || 'Kesalahan tidak diketahui'}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecalculateAll = async () => {
    if (!user) {
      toast.error('Anda harus login untuk melakukan kalkulasi ulang');
      return;
    }
    
    if (employees.length === 0) {
      toast.error('Data pegawai masih kosong. Tidak bisa kalkulasi ulang.');
      return;
    }

    // Client-side primary: works on Vercel free static (no Express). Same matching as save.
    toast.info('Memulai kalkulasi ulang data...');

    setIsLoading(true);
    try {
      const dateBoundaryStart = new Date();
      if (recalculateConfig.mode === 'last_day') {
        dateBoundaryStart.setDate(dateBoundaryStart.getDate() - 1);
      } else if (recalculateConfig.mode === 'last_week') {
        dateBoundaryStart.setDate(dateBoundaryStart.getDate() - 7);
      }
      const isoBoundaryStart = getLocalISODate(dateBoundaryStart);

      const engagementsToProcess = dailyEngagements.filter(e => e.date >= isoBoundaryStart);
      if (engagementsToProcess.length === 0) {
        toast.info('Tidak ada data rekap pada rentang yang dipilih.');
        return;
      }

      const updates: { id: string; ig: string[]; fb: string[]; tiktok: string[] }[] = [];

      for (const eng of engagementsToProcess) {
        const ig = matchEmployeesToEngagement(eng.igRawText || '', employees, 'ig');
        const fb = matchEmployeesToEngagement(eng.fbRawText || '', employees, 'fb');
        const tiktok = matchEmployeesToEngagement(eng.tiktokRawText || '', employees, 'tiktok');

        const igChanged = !engagedIdsEqual(eng.igEngagedEmployeeIds || [], ig);
        const fbChanged = !engagedIdsEqual(eng.fbEngagedEmployeeIds || [], fb);
        const tiktokChanged = !engagedIdsEqual(eng.tiktokEngagedEmployeeIds || [], tiktok);

        if (igChanged || fbChanged || tiktokChanged) {
          updates.push({ id: eng.id, ig, fb, tiktok });
        }
      }

      if (updates.length === 0) {
        toast.info('Tidak ada data baru yang perlu diperbaharui.');
        return;
      }

      // Firestore batch max 500 writes
      for (let i = 0; i < updates.length; i += 500) {
        const chunk = updates.slice(i, i + 500);
        const batch = writeBatch(db);
        for (const u of chunk) {
          batch.set(
            dinasDoc(db, user.uid, 'dailyEngagement', u.id),
            {
              igEngagedEmployeeIds: u.ig,
              fbEngagedEmployeeIds: u.fb,
              tiktokEngagedEmployeeIds: u.tiktok,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
        await batch.commit();
      }

      toast.success(`Kalkulasi ulang selesai. ${updates.length} data tanggal diperbarui.`);
    } catch (error: unknown) {
      console.error('Error recalculating data:', error);
      const message = error instanceof Error ? error.message : 'Kesalahan tidak diketahui';
      toast.error('Gagal melakukan kalkulasi ulang: ' + message);
    } finally {
      setIsLoading(false);
    }
  };

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const days = [];
    // Padding for start of month
    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push({ day: null, date: '', isCurrentMonth: false, isToday: false, isFilled: false, isFuture: false, isAutoFilled: false, isVerified: false, hasUnmatched: false });
    }
    
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      const dateStr = getLocalISODate(date);
      const engagement = dailyEngagementsMap[dateStr];
      days.push({
        day: d,
        date: dateStr,
        isCurrentMonth: true,
        isToday: dateStr === getLocalISODate(new Date()),
        isFilled: !!engagement && (
          (engagement.igEngagedEmployeeIds?.length || 0) > 0 ||
          (engagement.fbEngagedEmployeeIds?.length || 0) > 0 ||
          (engagement.tiktokEngagedEmployeeIds?.length || 0) > 0 ||
          !!(engagement.igRawText || engagement.fbRawText || engagement.tiktokRawText)
        ),
        isAutoFilled: !!engagement?.autoFilledAt,
        isVerified: !!engagement?.verifiedAt,
        hasUnmatched: !!engagement?.unmatchedNames?.length,
        isFuture: dateStr > getLocalISODate(new Date())
      });
    }
    return days;
  }, [currentMonth, dailyEngagementsMap]);

  const weeklyReports = useMemo(() => {
    if (employees.length === 0) return [];

    // Get Monday of the current week date
    const date = new Date(currentWeekDate);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    
    const weekDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      weekDates.push(getLocalISODate(d));
    }

    // Calculate ISO week number
    const target = new Date(monday.valueOf());
    const dayNr = (monday.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
      target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    const weekNum = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
    const todayStr = getLocalISODate(new Date());

    return [{
      weekNumber: weekNum,
      monthName: monday.toLocaleDateString('id-ID', { month: 'long' }),
      year: monday.getFullYear(),
      weekRange: `${parseLocalISODate(weekDates[0]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${parseLocalISODate(weekDates[6]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      dates: weekDates,
      isCurrentWeek: weekDates.includes(todayStr)
    }];
  }, [employees, currentWeekDate]);

  const weeklyDatesList = useMemo(() => weeklyReports.flatMap(w => w.dates), [weeklyReports]);

  const weeklyStats = useMemo(() => {
    if (weeklyReports.length === 0) return { employeeTotals: {} as Record<string, number>, maxEngagements: 3, top3Ids: [], bottom3Ids: [], bidangRates: [] as { bidang: string, rate: number }[] };
    
    const weekDates = weeklyReports[0].dates;
    const todayStr = getLocalISODate(new Date());
    
    let daysPassed = 0;
    weekDates.forEach(date => {
      if (date <= todayStr) daysPassed++;
    });
    if (daysPassed === 0) daysPassed = 1; // Prevent division by zero

    const maxEngagements = daysPassed * 3;
    
    const employeeTotals: Record<string, number> = {};
    const bidangStats: Record<string, { possible: number, actual: number }> = {};

    employees.forEach(emp => {
      let totalEngagements = 0;
      weekDates.forEach(date => {
        if (date > todayStr) return;
        const engagement = dailyEngagementsMap[date];
        const hasIg = engagement?.igEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        const hasFb = engagement?.fbEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        const hasTiktok = engagement?.tiktokEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        totalEngagements += (hasIg + hasFb + hasTiktok);
      });
      employeeTotals[emp.id] = totalEngagements;

      const bidang = emp.bidang || 'Lainnya';
      if (!bidangStats[bidang]) bidangStats[bidang] = { possible: 0, actual: 0 };
      bidangStats[bidang].possible += maxEngagements;
      bidangStats[bidang].actual += totalEngagements;
    });

    const uniqueScores = Array.from(new Set(Object.values(employeeTotals))).sort((a, b) => b - a);
    const top3Scores = uniqueScores.slice(0, 3);
    const bottom3Scores = [...uniqueScores].reverse().slice(0, 3);

    const top3Ids = employees.filter(e => top3Scores.includes(employeeTotals[e.id])).map(e => e.id);
    const bottom3Ids = employees.filter(e => bottom3Scores.includes(employeeTotals[e.id]) && !top3Ids.includes(e.id)).map(e => e.id);

    // Calculate rate per bidang
    const bidangRates = Object.entries(bidangStats).map(([bidang, stats]) => ({
      bidang,
      rate: stats.possible > 0 ? Math.round((stats.actual / stats.possible) * 100) : 0
    })).sort((a, b) => b.rate - a.rate);

    return { employeeTotals, maxEngagements, top3Ids, bottom3Ids, bidangRates };
  }, [weeklyReports, employees, dailyEngagementsMap]);

  const changeWeek = (offset: number) => {
    const newDate = new Date(currentWeekDate);
    newDate.setDate(newDate.getDate() + (offset * 7));
    setCurrentWeekDate(newDate);
  };

  const monthlyReports = useMemo(() => {
    if (employees.length === 0) return [];
    
    const year = currentMonthlyReportDate.getFullYear();
    const month = currentMonthlyReportDate.getMonth();
    
    // Get all days in the current month
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthDates: string[] = [];
    for (let i = 1; i <= daysInMonth; i++) {
        monthDates.push(getLocalISODate(new Date(year, month, i)));
    }
    
    const monthName = currentMonthlyReportDate.toLocaleDateString('id-ID', { month: 'long' });
    const todayStr = getLocalISODate(new Date());

    return [{
       monthName,
       year,
       monthRange: `${parseLocalISODate(monthDates[0]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${parseLocalISODate(monthDates[monthDates.length - 1]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`,
       dates: monthDates,
       isCurrentMonth: monthDates.includes(todayStr)
    }];
  }, [employees, currentMonthlyReportDate]);

  const monthlyStats = useMemo(() => {
    if (monthlyReports.length === 0) return { employeeTotals: {} as Record<string, number>, employeePlatformStats: {} as Record<string, { igPercent: number, fbPercent: number, tiktokPercent: number }>, maxEngagements: 3, top3Ids: [], bottom3Ids: [], bidangRates: [] as { bidang: string, rate: number }[] };
    
    const monthDates = monthlyReports[0].dates;
    const todayStr = getLocalISODate(new Date());
    
    let daysPassed = 0;
    monthDates.forEach(date => {
      if (date <= todayStr) daysPassed++;
    });
    if (daysPassed === 0) daysPassed = 1; // Prevent division by zero

    const maxEngagements = daysPassed * 3;
    
    const employeeTotals: Record<string, number> = {};
    const employeePlatformStats: Record<string, { igPercent: number, fbPercent: number, tiktokPercent: number }> = {};
    const bidangStats: Record<string, { possible: number, actual: number }> = {};

    employees.forEach(emp => {
      let totalIg = 0;
      let totalFb = 0;
      let totalTiktok = 0;
      let totalEngagements = 0;
      
      monthDates.forEach(date => {
        if (date > todayStr) return;
        const engagement = dailyEngagementsMap[date];
        const hasIg = engagement?.igEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        const hasFb = engagement?.fbEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        const hasTiktok = engagement?.tiktokEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        totalIg += hasIg;
        totalFb += hasFb;
        totalTiktok += hasTiktok;
        totalEngagements += (hasIg + hasFb + hasTiktok);
      });
      employeeTotals[emp.id] = totalEngagements;
      employeePlatformStats[emp.id] = {
        igPercent: daysPassed > 0 ? Math.round((totalIg / daysPassed) * 100) : 0,
        fbPercent: daysPassed > 0 ? Math.round((totalFb / daysPassed) * 100) : 0,
        tiktokPercent: daysPassed > 0 ? Math.round((totalTiktok / daysPassed) * 100) : 0,
      };

      const bidang = emp.bidang || 'Lainnya';
      if (!bidangStats[bidang]) bidangStats[bidang] = { possible: 0, actual: 0 };
      bidangStats[bidang].possible += maxEngagements;
      bidangStats[bidang].actual += totalEngagements;
    });

    const uniqueScores = Array.from(new Set(Object.values(employeeTotals))).sort((a, b) => b - a);
    const top3Scores = uniqueScores.slice(0, 3);
    const bottom3Scores = [...uniqueScores].reverse().slice(0, 3);

    const top3Ids = employees.filter(e => top3Scores.includes(employeeTotals[e.id])).map(e => e.id);
    const bottom3Ids = employees.filter(e => bottom3Scores.includes(employeeTotals[e.id]) && !top3Ids.includes(e.id)).map(e => e.id);

    // Calculate rate per bidang
    const bidangRates = Object.entries(bidangStats).map(([bidang, stats]) => ({
      bidang,
      rate: stats.possible > 0 ? Math.round((stats.actual / stats.possible) * 100) : 0
    })).sort((a, b) => b.rate - a.rate);

    return { employeeTotals, employeePlatformStats, maxEngagements, top3Ids, bottom3Ids, bidangRates };
  }, [monthlyReports, employees, dailyEngagementsMap]);

  const sortedMonthlyEmployees = useMemo(() => {
    return employees.slice().sort((a, b) => {
      if (monthlySortMode === 'rank') {
        const scoreA = monthlyStats.employeeTotals[a.id] || 0;
        const scoreB = monthlyStats.employeeTotals[b.id] || 0;
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
      } else if (monthlySortMode === 'name') {
        return a.name.localeCompare(b.name);
      }
      return (a.bidang || '').localeCompare(b.bidang || '') || a.name.localeCompare(b.name);
    });
  }, [employees, monthlySortMode, monthlyStats.employeeTotals]);

  const changeMonthlyReportDate = (offset: number) => {
    const newDate = new Date(currentMonthlyReportDate);
    newDate.setMonth(newDate.getMonth() + offset);
    setCurrentMonthlyReportDate(newDate);
  };

  const changeDailyDate = (offset: number) => {
    const newDate = new Date(currentDailyDate);
    newDate.setDate(newDate.getDate() + offset);
    setCurrentDailyDate(newDate);
  };

  const changeMonth = (offset: number) => {
    const newMonth = new Date(currentMonth);
    newMonth.setMonth(newMonth.getMonth() + offset);
    setCurrentMonth(newMonth);
  };

  const currentDailyDateStr = getLocalISODate(currentDailyDate);
  const currentDailyEngagementOptions = dailyEngagementsMap[currentDailyDateStr];
  let dailyPossible = 0;
  let dailyActual = 0;
  if (currentDailyDateStr <= getLocalISODate(new Date())) {
    employees.forEach(emp => {
      // Wajib 3 platform untuk semua pegawai (IG, FB, TikTok)
      dailyPossible += 3;
      if (currentDailyEngagementOptions?.igEngagedEmployeeIds?.includes(emp.id)) dailyActual++;
      if (currentDailyEngagementOptions?.fbEngagedEmployeeIds?.includes(emp.id)) dailyActual++;
      if (currentDailyEngagementOptions?.tiktokEngagedEmployeeIds?.includes(emp.id)) dailyActual++;
    });
  }
  const dailyEngagementRate = dailyPossible > 0 ? Math.round((dailyActual / dailyPossible) * 100) : 0;

  if (!db) return null;

  return (
    <div className="flex h-[100dvh] bg-slate-50 font-sans overflow-hidden relative">
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside 
        className={cn(
          "fixed inset-y-0 left-0 w-72 bg-white border-r border-slate-200 flex flex-col z-50 transition-transform duration-300 ease-in-out lg:static lg:translate-x-0",
          !isSidebarOpen ? "-translate-x-full" : "translate-x-0"
        )}
      >
        <div className="p-6 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <img src={appLogo} alt="ReSo" className="w-10 h-10 object-contain shrink-0" />
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 leading-none">ReSo</h1>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Rekap Engagement Sosmed</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="lg:hidden rounded-full" onClick={() => setIsSidebarOpen(false)}>
              <XCircle className="text-slate-400" size={24} />
            </Button>
          </div>

          <nav className="space-y-1.5">
            <NavItem 
              active={activeTab === 'dashboard'} 
              onClick={() => { setActiveTab('dashboard'); setIsSidebarOpen(false); }} 
              icon={<LayoutDashboard size={20} />} 
              label="Beranda" 
            />
            <NavItem 
              active={activeTab === 'overview'} 
              onClick={() => { setActiveTab('overview'); setIsSidebarOpen(false); }} 
              icon={<CalendarIcon size={20} />} 
              label="Input Rekap" 
            />
            <NavItem 
              active={activeTab === 'daily-report'} 
              onClick={() => { setActiveTab('daily-report'); setIsSidebarOpen(false); }} 
              icon={<FileText size={20} />} 
              label="Laporan Harian" 
            />
            <NavItem 
              active={activeTab === 'reports'} 
              onClick={() => { setActiveTab('reports'); setIsSidebarOpen(false); }} 
              icon={<History size={20} />} 
              label="Laporan Mingguan" 
            />
            <NavItem 
              active={activeTab === 'monthly-reports'} 
              onClick={() => { setActiveTab('monthly-reports'); setIsSidebarOpen(false); }} 
              icon={<PieChart size={20} />} 
              label="Laporan Bulanan" 
            />
            <NavItem 
              active={activeTab === 'employees'} 
              onClick={() => { setActiveTab('employees'); setIsSidebarOpen(false); }} 
              icon={<Users2 size={20} />} 
              label="Data Pegawai" 
            />
            <NavItem 
              active={activeTab === 'settings'} 
              onClick={() => { setActiveTab('settings'); setIsSidebarOpen(false); }} 
              icon={<Settings size={20} />} 
              label="Pengaturan" 
            />
          </nav>
        </div>

        <div className="p-5 mt-auto border-t border-slate-200 bg-slate-50/80">
          {user && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 px-1">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-9 h-9 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-sm">
                    {(user.email || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{user.displayName || user.email}</p>
                  <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
                </div>
              </div>
              <Button 
                onClick={logout} 
                variant="outline" 
                className="w-full border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-rose-600 rounded-xl font-bold text-xs h-10"
              >
                Keluar
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative pb-bottom-nav lg:pb-0">
        {/* Hamburger mobile — floating, tanpa top bar (halaman lebih luas) */}
        <Button 
          variant="ghost" 
          size="icon" 
          className="lg:hidden fixed top-3 left-3 z-40 rounded-lg h-10 w-10 bg-white/95 backdrop-blur-md border border-slate-200 text-slate-600 shadow-sm hover:bg-white" 
          onClick={() => setIsSidebarOpen(true)}
          title="Buka menu"
        >
          <Menu size={20} />
        </Button>

        <div className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth">
          <div className="px-4 py-5 md:px-6 lg:px-8 xl:px-10 max-w-[1800px] mx-auto w-full">
            <AnimatePresence mode="wait">
              {activeTab === 'dashboard' && (
                <DashboardTab 
                  stats={stats}
                  chartData={chartData}
                  dailyEngagements={dailyEngagements}
                  onGoInput={() => {
                    setSelectedDate(getLocalISODate(new Date()));
                    setActiveTab('overview');
                    setIsInputModalOpen(true);
                  }}
                  onGoDaily={() => setActiveTab('daily-report')}
                />
              )}
               {activeTab === 'overview' && (
                <motion.div 
                  key="overview"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  className="space-y-4 md:space-y-5"
                >
                  <motion.div variants={itemVariants} className="bg-white rounded-xl p-4 sm:p-5 md:p-6 border border-slate-200">
                    {/* Header: bulan nav + indikator + tombol terima */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-3 md:mb-4">
                      <div className="flex items-center gap-3 bg-slate-50 p-1 rounded-xl border border-slate-200 shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => changeMonth(-1)} className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0">
                          <ChevronLeft size={16} />
                        </Button>
                        <div className="text-center min-w-[130px]">
                          <h2 className="text-sm font-bold text-slate-900">
                            {currentMonth.toLocaleString('id-ID', { month: 'long', year: 'numeric' })}
                          </h2>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => changeMonth(1)} className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0">
                          <ChevronRight size={16} />
                        </Button>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-semibold text-slate-500 bg-slate-50 px-4 py-1.5 rounded-xl border border-slate-200">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-slate-900" /> Terisi
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Perlu review
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Terverifikasi
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-black text-amber-500 leading-none">!</span> Belum terpetakan
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-white border-2 border-slate-200" /> Kosong
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full border-2 border-emerald-500 bg-white" /> Hari ini
                        </div>
                      </div>

                      {unverifiedAutoFilledDates.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleVerifyAllAutoFilled}
                          disabled={isVerifyingAll}
                          className="text-[11px] font-bold border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 h-8 shrink-0 sm:ml-auto"
                        >
                          <CheckCircle2 size={13} className="mr-1.5" />
                          {isVerifyingAll
                            ? 'Menandai…'
                            : `Terima ${unverifiedAutoFilledDates.length} rekap otomatis`}
                        </Button>
                      )}
                    </div>

                    {/* Kalender */}
                    <div className="overflow-y-auto">
                      <div className="min-w-[280px] sm:min-w-[400px] h-[calc(100dvh-17rem)] md:h-[calc(100dvh-15rem)] lg:h-[calc(100dvh-14rem)] min-h-[340px]">
                        <div className="grid grid-cols-7 grid-rows-[repeat(7,minmax(0,1fr))] gap-1 sm:gap-1.5 h-full">
                          {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map(day => (
                            <div key={day} className="text-center py-0.5 md:py-1 text-[8px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest self-end">
                              {day}
                            </div>
                          ))}
                          {calendarDays.map((day, idx) => (
                            <div key={idx} className="h-full min-h-0">
                              {day.day ? (
                                <button
                                  onClick={() => {
                                    setSelectedDate(day.date);
                                    setIsInputModalOpen(true);
                                  }}
                                  disabled={day.isFuture}
                                  className={cn(
                                    "w-full h-full rounded-lg md:rounded-xl flex flex-col items-center justify-center gap-0.5 md:gap-1 transition-all relative group border",
                                    day.isFuture ? "bg-slate-50/50 cursor-not-allowed opacity-30 border-transparent" : 
                                    day.isToday && day.isFilled ? "bg-slate-900 text-white border-slate-900 ring-2 ring-emerald-400 ring-offset-1" :
                                    day.isFilled ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-800" :
                                    day.isToday ? "bg-white text-slate-900 border-emerald-500 border-2 hover:bg-emerald-50" :
                                    "bg-white text-slate-600 hover:bg-slate-50 border-slate-200"
                                  )}
                                >
                                  <span className="text-sm sm:text-base font-bold leading-none">{day.day}</span>
                                  {day.isToday && !day.isFilled && (
                                    <span className="text-[8px] font-bold text-emerald-600 leading-none">Hari ini</span>
                                  )}
                                  <div className="flex gap-0.5">
                                    {day.isAutoFilled && (
                                      <div className={cn("w-1 h-1 rounded-full", day.isVerified ? (day.isToday ? "bg-emerald-300" : "bg-emerald-400") : (day.isToday ? "bg-amber-300" : "bg-amber-400"))} />
                                    )}
                                    {day.hasUnmatched && (
                                      <span className="text-[8px] font-black text-amber-500 leading-none" title="Ada nama belum terpetakan">!</span>
                                    )}
                                    {day.isFilled && (
                                      <>
                                        <div className={cn("w-1 h-1 rounded-full", day.isToday ? "bg-pink-300" : "bg-pink-400")} />
                                        <div className={cn("w-1 h-1 rounded-full", day.isToday ? "bg-blue-300" : "bg-blue-400")} />
                                        <div className={cn("w-1 h-1 rounded-full", day.isToday ? "bg-slate-300" : "bg-slate-500")} />
                                      </>
                                    )}
                                  </div>
                                </button>
                              ) : (
                                <div className="w-full h-full" />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>

                  {/* Input Modal */}
                  <AnimatePresence>
                    {isInputModalOpen && (
                      <div
                        className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-0 sm:p-4"
                        onClick={closeInputModal}
                        role="presentation"
                      >
                        <motion.div
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 12 }}
                          transition={{ ease: "easeOut", duration: 0.2 }}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-white w-full max-w-xl rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col max-h-[88vh] sm:max-h-[82vh] shadow-2xl border border-slate-200"
                        >
                          <div className="p-5 sm:p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50/20 shrink-0">
                            <div>
                              <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">Input Rekapitulasi</h3>
                              <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                                {parseLocalISODate(selectedDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                                {dailyEngagementsMap[selectedDate]?.autoFilledAt && (
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      'ml-2 text-[9px] font-bold normal-case',
                                      dailyEngagementsMap[selectedDate]?.verifiedAt
                                        ? 'border-emerald-300 text-emerald-700 bg-emerald-50'
                                        : 'border-amber-300 text-amber-700 bg-amber-50'
                                    )}
                                  >
                                    {dailyEngagementsMap[selectedDate]?.verifiedAt
                                      ? 'Dari ReSoEx · Terverifikasi'
                                      : 'Dari ReSoEx · Perlu review'}
                                  </Badge>
                                )}
                                {selectedUnmatched.length > 0 && (
                                  <Badge
                                    variant="warning"
                                    className="ml-1.5 text-[9px] font-bold normal-case cursor-pointer hover:bg-amber-100"
                                    onClick={() => setIsUnmatchedReviewOpen(true)}
                                  >
                                    {selectedUnmatched.length} belum terpetakan
                                  </Badge>
                                )}
                                {selectedPostedAt.length > 0 && (
                                  <span className="block mt-1 text-[10px] font-semibold text-slate-500">
                                    Waktu posting:{' '}
                                    {selectedPostedAt.map((t) => t.slice(11)).join(' · ')}
                                  </span>
                                )}
                              </p>
                            </div>
                            <Button variant="ghost" size="icon" onClick={closeInputModal} className="rounded-full bg-slate-100 hover:bg-slate-200 h-9 w-9">
                              <X className="text-slate-600" size={18} />
                            </Button>
                          </div>
                          
                          <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto pb-safe">
                            {/* Meta fetch — token dikelola di Pengaturan */}
                            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <RefreshCw size={15} className="text-slate-600 shrink-0" />
                                  <h4 className="text-sm font-bold text-slate-800 truncate">Tarik via Meta API</h4>
                                </div>
                                <Badge variant="outline" className="text-[10px] font-semibold border-slate-200 text-slate-500 shrink-0">
                                  15:00 WIB
                                </Badge>
                              </div>
                              <Button 
                                onClick={handleFetchRecentMeta}
                                disabled={isFetchingMeta || !metaToken.trim()}
                                className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl"
                              >
                                {isFetchingMeta
                                  ? 'Menarik data…'
                                  : !metaToken.trim()
                                    ? 'Token belum diatur'
                                    : `Tarik post (${parseLocalISODate(addLocalDays(selectedDate, -1)).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} → ${parseLocalISODate(selectedDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })})`}
                              </Button>
                              {!metaToken.trim() ? (
                                <button
                                  type="button"
                                  onClick={() => { closeInputModal(); setActiveTab('settings'); }}
                                  className="text-[11px] font-semibold text-slate-600 underline underline-offset-2"
                                >
                                  Atur token Meta di Pengaturan
                                </button>
                              ) : (
                                <p className="text-[11px] text-slate-500 leading-snug">
                                  IG: komentar + link. FB: link post. Window 15:00 H−1 s/d 15:00 hari rekap (WIB).
                                </p>
                              )}
                            </div>

                            {/* Meta Links Section */}
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <LinkIcon size={16} className="text-slate-400" />
                                  <h4 className="text-sm font-bold text-slate-700">Link Postingan {parseLocalISODate(selectedDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</h4>
                                </div>
                              </div>
                              
                              <div className="space-y-3">
                                {/* Smart Link Input */}
                                <div>
                                  <textarea
                                    placeholder="Paste banyak link IG/FB sekaligus di sini (pisahkan dengan spasi atau enter)..."
                                    className="w-full h-16 p-2 rounded-lg border border-slate-200 bg-white focus:ring-slate-900/5 transition-all text-xs resize-none"
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
                                            if (url.includes('instagram.com')) {
                                              url = url.replace(/\/(?:reel|reels)\//i, '/p/');
                                              // Hanya cegah duplikat di tanggal yang sedang diedit (bukan seluruh history)
                                              if (!newIg.includes(url)) newIg.push(url);
                                            } else if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com')) {
                                              if (url.match(/facebook\.com\/reel\/(\d+)/i)) {
                                                url = url.replace(/facebook\.com\/reel\/(\d+)/i, 'facebook.com/p/$1');
                                              } else if (url.match(/facebook\.com\/share\/r\/([a-zA-Z0-9]+)/i)) {
                                                url = url.replace(/facebook\.com\/share\/r\/([a-zA-Z0-9]+)/i, 'facebook.com/share/p/$1');
                                              }
                                              if (!newFb.includes(url)) newFb.push(url);
                                            } else if (url.includes('tiktok.com')) {
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

                                {/* IG Links */}
                                <div className="flex flex-wrap gap-2 items-center">
                                  <Instagram size={14} className="text-pink-500" />
                                  {igLinks.length > 0 ? (
                                    igLinks.map((link, idx) => (
                                      <div key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-pink-50 text-pink-700 text-xs font-medium border border-pink-100">
                                        <a href={link} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1">
                                          Post IG {idx + 1}
                                          <ExternalLink size={10} />
                                        </a>
                                        <button 
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
                                </div>

                                {/* FB Links */}
                                <div className="flex flex-wrap gap-2 items-center">
                                  <Facebook size={14} className="text-blue-500" />
                                  {fbLinks.length > 0 ? (
                                    fbLinks.map((link, idx) => (
                                      <div key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-medium border border-blue-100">
                                        <a href={link} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1">
                                          Post FB {idx + 1}
                                          <ExternalLink size={10} />
                                        </a>
                                        <button 
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
                                </div>

                                {/* TikTok Links */}
                                <div className="flex flex-wrap gap-2 items-center">
                                  <span className="font-bold text-slate-800 text-sm italic pr-1 leading-none">t</span>
                                  {tiktokLinks.length > 0 ? (
                                    tiktokLinks.map((link, idx) => (
                                      <div key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 text-slate-800 text-xs font-medium border border-slate-200">
                                        <a href={link} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1">
                                          Post TikTok {idx + 1}
                                          <ExternalLink size={10} />
                                        </a>
                                        <button 
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
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-4">
                              <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-500 flex items-center gap-2">
                                  <Instagram size={12} className="text-pink-500" />
                                  List IG
                                </label>
                                <textarea
                                  value={igRawInput}
                                  onChange={(e) => setIgRawInput(e.target.value)}
                                  placeholder="Paste list nama atau username di sini..."
                                  className="w-full h-24 md:h-32 p-3 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 resize-none"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-500 flex items-center gap-2">
                                  <Facebook size={12} className="text-blue-500" />
                                  List FB
                                </label>
                                <textarea
                                  value={fbRawInput}
                                  onChange={(e) => setFbRawInput(e.target.value)}
                                  placeholder="Paste list nama atau username di sini..."
                                  className="w-full h-24 md:h-32 p-3 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 resize-none"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-500 flex items-center gap-2">
                                  <TiktokIcon size={16} className="text-slate-800" />
                                  List TikTok
                                </label>
                                <textarea
                                  value={tiktokRawInput}
                                  onChange={(e) => setTiktokRawInput(e.target.value)}
                                  placeholder="Paste list nama akun TikTok di sini..."
                                  className="w-full h-24 md:h-32 p-3 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 resize-none"
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

                          <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
                            <Button variant="ghost" onClick={closeInputModal} className="font-bold text-xs rounded-xl h-11 px-5">
                              Batal
                            </Button>
                            <Button 
                              onClick={handleSaveEngagement} 
                              disabled={isLoading}
                              className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl h-11 px-6 border-none"
                            >
                              {isLoading ? 'Menyimpan…' : 'Simpan Rekap'}
                            </Button>
                          </div>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>

                  {/* Modal review nama belum terpetakan */}
                  <AnimatePresence>
                    {isUnmatchedReviewOpen && (
                      <div
                        className="fixed inset-0 z-[65] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-0 sm:p-4"
                        onClick={() => setIsUnmatchedReviewOpen(false)}
                        role="presentation"
                      >
                        <motion.div
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 12 }}
                          transition={{ ease: "easeOut", duration: 0.2 }}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-white w-full max-w-xl rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col max-h-[88vh] sm:max-h-[82vh] shadow-2xl border border-slate-200"
                        >
                          <div className="p-5 sm:p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50/20 shrink-0">
                            <div>
                              <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">Petakan nama belum terpetakan</h3>
                              <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                                {parseLocalISODate(selectedDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                                {' · '}{selectedUnmatched.length} nama tanpa pegawai
                              </p>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => setIsUnmatchedReviewOpen(false)} className="rounded-full bg-slate-100 hover:bg-slate-200 h-9 w-9">
                              <X className="text-slate-600" size={18} />
                            </Button>
                          </div>

                          <div className="p-4 sm:p-6 space-y-3 overflow-y-auto pb-safe">
                            <p className="text-xs text-slate-500">
                              Pilih pegawai untuk tiap nama — nama tersimpan sebagai <b>alias</b> pegawai, jadi kiriman berikutnya otomatis cocok.
                            </p>
                            {selectedUnmatched.length === 0 ? (
                              <div className="text-center py-10 text-sm font-semibold text-emerald-600">
                                Semua nama sudah terpetakan 🎉
                              </div>
                            ) : (
                              selectedUnmatched.map((u) => {
                                const key = `${u.platform}|${u.name}`;
                                return (
                                  <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-2 bg-slate-50 rounded-xl border border-slate-200 p-3">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-900 text-white shrink-0">
                                        {PLATFORM_LABEL[u.platform]}
                                      </span>
                                      <span className="text-sm font-semibold text-slate-800 truncate">{u.name}</span>
                                    </div>
                                    <select
                                      className="w-full sm:w-56 h-9 rounded-lg border border-slate-300 text-sm px-2 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                                      value={mapSelections[key] || ''}
                                      onChange={(e) => setMapSelections((m) => ({ ...m, [key]: e.target.value }))}
                                    >
                                      <option value="">— Pilih pegawai —</option>
                                      {employees.map((emp) => (
                                        <option key={emp.id} value={emp.id}>{emp.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                );
                              })
                            )}
                          </div>

                          <div className="p-4 sm:p-6 border-t border-slate-100 flex flex-col sm:flex-row gap-2 justify-end shrink-0">
                            <Button variant="ghost" onClick={handleRematchOnly} disabled={isMapping} className="text-xs font-bold">
                              <RefreshCw size={14} className="mr-1.5" />
                              Match ulang
                            </Button>
                            <Button
                              onClick={handleMapUnmatched}
                              disabled={isMapping || selectedUnmatched.length === 0 || !Object.values(mapSelections).some(Boolean)}
                              className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl h-10 px-5 border-none"
                            >
                              {isMapping ? 'Menyimpan…' : 'Petakan & simpan'}
                            </Button>
                          </div>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
{activeTab === 'daily-report' && (
                <DailyReportView
                  currentDailyDate={currentDailyDate}
                  changeDailyDate={changeDailyDate}
                  weeklySortMode={weeklySortMode}
                  setWeeklySortMode={setWeeklySortMode}
                  handleExportPDF={handleExportPDF}
                  handleExportImage={handleExportImage}
                  printDailyRef={printDailyRef}
                  isLoading={isLoading}
                  isExporting={isExporting}
                  sortedEmployees={sortedEmployees}
                  dailyEngagementsMap={dailyEngagementsMap}
                  dailyEngagementRate={dailyEngagementRate}
                />
              )}

              {activeTab === 'reports' && (
                <WeeklyReportView
                  weeklyReports={weeklyReports}
                  weeklyStats={weeklyStats}
                  weeklyDatesList={weeklyDatesList}
                  changeWeek={changeWeek}
                  weeklySortMode={weeklySortMode}
                  setWeeklySortMode={setWeeklySortMode}
                  handleExportPDF={handleExportPDF}
                  handleExportImage={handleExportImage}
                  printRef={printRef}
                  isLoading={isLoading}
                  isExporting={isExporting}
                  sortedEmployees={sortedEmployees}
                  dailyEngagementsMap={dailyEngagementsMap}
                />
              )}

              {activeTab === 'monthly-reports' && (
                <MonthlyReportView
                  monthlyReports={monthlyReports}
                  monthlyStats={monthlyStats}
                  sortedMonthlyEmployees={sortedMonthlyEmployees}
                  changeMonthlyReportDate={changeMonthlyReportDate}
                  monthlySortMode={monthlySortMode}
                  setMonthlySortMode={setMonthlySortMode}
                  handleExportPDF={handleExportPDF}
                  handleExportImage={handleExportImage}
                  printMonthlyRef={printMonthlyRef}
                  isLoading={isLoading}
                  isExporting={isExporting}
                />
              )}

                        {activeTab === 'employees' && (
              <motion.div 
                key="employees"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
              >
                <React.Suspense fallback={<div className="w-full h-full flex mt-20 items-center justify-center text-slate-400 text-xs font-bold">Memuat Modul Data Pegawai...</div>}>
                  <EmployeeManager />
                </React.Suspense>
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <SettingsTab 
                recalculateConfig={recalculateConfig}
                setRecalculateConfig={setRecalculateConfig}
                handleRecalculateAll={handleRecalculateAll}
                isLoading={isLoading}
                containerVariants={containerVariants}
                metaToken={metaToken}
                setMetaToken={setMetaToken}
                handleSaveMetaToken={handleSaveMetaToken}
                isSavingToken={isSavingToken}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>

      {/* Mobile "Lainnya" sheet */}
      <AnimatePresence>
        {isMoreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 z-[55] bg-slate-900/40"
              onClick={() => setIsMoreOpen(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'tween', ease: 'easeOut', duration: 0.22 }}
              className="lg:hidden fixed left-0 right-0 z-[56] bg-white rounded-t-2xl border-t border-slate-200 shadow-2xl px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
              style={{ bottom: 'var(--bottom-nav-h)' }}
            >
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
              <p className="text-xs font-bold text-slate-400 mb-2 px-1">Menu lainnya</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'reports', label: 'Laporan Mingguan', icon: <History size={18} /> },
                  { id: 'monthly-reports', label: 'Laporan Bulanan', icon: <PieChart size={18} /> },
                  { id: 'employees', label: 'Data Pegawai', icon: <Users2 size={18} /> },
                  { id: 'settings', label: 'Pengaturan', icon: <Settings size={18} /> },
                ] as const).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setIsMoreOpen(false);
                    }}
                    className={cn(
                      'flex items-center gap-2.5 p-3.5 rounded-xl border text-left text-sm font-semibold transition-colors min-h-[48px]',
                      activeTab === item.id
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    )}
                  >
                    {item.icon}
                    <span className="leading-tight">{item.label}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bottom Navigation for Mobile */}
      <nav 
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-slate-200 px-1 h-[calc(5rem+env(safe-area-inset-bottom))] pb-safe flex items-center justify-around"
      >
        <BottomNavItem 
          active={activeTab === 'dashboard'} 
          onClick={() => { setActiveTab('dashboard'); setIsMoreOpen(false); }} 
          icon={<LayoutDashboard size={22} />} 
          label="Beranda" 
        />
        <BottomNavItem 
          active={activeTab === 'overview'} 
          onClick={() => { setActiveTab('overview'); setIsMoreOpen(false); }} 
          icon={<PlusCircle size={22} />} 
          label="Input" 
        />
        <BottomNavItem 
          active={activeTab === 'daily-report'} 
          onClick={() => { setActiveTab('daily-report'); setIsMoreOpen(false); }} 
          icon={<FileText size={22} />} 
          label="Harian" 
        />
        <BottomNavItem 
          active={['reports', 'monthly-reports', 'employees', 'settings'].includes(activeTab) || isMoreOpen} 
          onClick={() => setIsMoreOpen((v) => !v)} 
          icon={<Menu size={22} />} 
          label="Lainnya" 
        />
      </nav>

    </div>
  );
}

const BottomNavItem = React.memo(function BottomNavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1 w-full h-full min-h-[48px] transition-colors relative",
        active ? "text-slate-900" : "text-slate-400"
      )}
    >
      <div className={cn(active ? "scale-105" : "scale-100", "transition-transform duration-150")}>
        {icon}
      </div>
      <span className={cn("text-[10px] font-semibold leading-none text-center px-0.5", active ? "opacity-100" : "opacity-80")}>
        {label}
      </span>
      {active && (
        <motion.div 
          layoutId="bottom-nav-indicator"
          className="absolute top-0 left-1/2 -translate-x-1/2 w-7 h-0.5 bg-slate-900 rounded-b-full"
        />
      )}
    </button>
  );
});

const NavItem = React.memo(function NavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <Button 
      variant="ghost" 
      className={cn(
        'w-full justify-start gap-3 h-11 rounded-xl px-4 transition-colors',
        active 
          ? 'bg-slate-900 text-white hover:bg-slate-800 hover:text-white' 
          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
      )}
      onClick={onClick}
    >
      <span className={active ? 'text-white' : 'text-slate-400'}>{icon}</span>
      <span className="font-semibold text-sm tracking-tight">{label}</span>
      {active && <span className="ml-auto w-1.5 h-1.5 bg-white/80 rounded-full" />}
    </Button>
  );
});

const MatchPreview = React.memo(function MatchPreview({ ig, fb, tiktok }: { ig: number; fb: number; tiktok: number }) {
  return (
    <div className="flex flex-wrap gap-2 text-[11px] font-semibold items-center">
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-pink-50 text-pink-700 border border-pink-100">
        IG {ig}
      </span>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100">
        FB {fb}
      </span>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200">
        TT {tiktok}
      </span>
      <span className="text-slate-400 font-medium">pegawai terdeteksi</span>
    </div>
  );
});
