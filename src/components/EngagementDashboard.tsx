import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
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
  FileText,
  Menu,
  PieChart,
  CheckCircle2,
  Check,
  LogOut,
  RefreshCw
} from 'lucide-react';
import { TiktokIcon } from './icons/TiktokIcon';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { DailyEngagement, Employee, UnmatchedName } from '../types';
import { useAuth } from './FirebaseProvider';
import { useAppLogo } from '../hooks/useAppLogo';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { logout, dinasCollection, dinasDoc } from '../lib/firebase';
import { onSnapshot, query, orderBy, setDoc, serverTimestamp, writeBatch, where, updateDoc, arrayUnion } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { getLocalISODate, parseLocalISODate } from '../lib/date';
import { matchEmployeesToEngagement, matchEngagementDetail, engagedIdsEqual } from '../lib/matching';
import { collectUnverifiedAutoFilled } from '../lib/engagement-api';
import { APP_VERSION } from '../lib/version';

import { DashboardTab } from './tabs/DashboardTab';
import { InputModal } from './InputModal';
import { SettingsTab } from './tabs/SettingsTab';
import { DailyReportView } from './reports/DailyReportView';
import { WeeklyReportView } from './reports/WeeklyReportView';
import { MonthlyReportView } from './reports/MonthlyReportView';

const PLATFORM_LABEL: Record<UnmatchedName['platform'], string> = { ig: 'IG', fb: 'FB', tiktok: 'TikTok' };
const EmployeeManager = React.lazy(() => import('./EmployeeManager'));

// Batas pegawai untuk export gambar — satu lembar gambar, lebih dari ini wajib PDF/Excel.
const IMAGE_EXPORT_LIMIT = 60;

// Cache hasil konversi logo SVG→PNG dataURL: konversi cukup mahal dan identik
// untuk seluruh sesi, tak ada alasan mengulang tiap export PDF.
let logoDataUrlCache: Promise<string | null> | null = null;

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

  const [recalculateConfig, setRecalculateConfig] = useState<{
    mode: 'last_day' | 'last_week';
  }>({
    mode: 'last_day'
  });
  const [recalcResult, setRecalcResult] = useState<string | null>(null);

  // Meta API State
  const [metaToken, setMetaToken] = useState('');
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

  const handleClearMetaToken = async () => {
    if (!user) return;
    try {
      await setDoc(dinasDoc(db, user.uid, 'settings', 'meta_api'), {
        value: '',
        updatedAt: serverTimestamp()
      });
      setMetaToken('');
      toast.success('Token Meta API dihapus');
    } catch (err) {
      console.error('Error clearing meta token:', err);
      toast.error('Gagal menghapus token Meta API');
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

  // Window riwayat STATIS: ±4 bulan ke belakang dari sesi login.
  // Sengaja tidak mengikuti navigasi bulan/minggu — snapshot tidak perlu
  // re-subscribe + re-download seluruh riwayat hanya karena pindah bulan.
  const HISTORY_LOOKBACK_DAYS = 120;
  const historyWindowStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - HISTORY_LOOKBACK_DAYS);
    return getLocalISODate(d);
  }, []);

  /** Apakah tanggal berada di luar jendela riwayat yang dimuat? */
  const isOutsideHistoryWindow = useCallback((d: Date) => {
    const earliest = parseLocalISODate(historyWindowStart);
    earliest.setHours(0, 0, 0, 0);
    return d < earliest;
  }, [historyWindowStart]);

  const notifyHistoryLimit = () =>
    toast.info('Riwayat rekap tersedia sekitar 4 bulan terakhir.');

  // Load daily engagements
  useEffect(() => {
    if (loading || !user || !db) {
      setDailyEngagements([]);
      return;
    }

    const q = query(
      dinasCollection(db, user.uid, 'dailyEngagement'), 
      where('date', '>=', historyWindowStart),
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
  }, [user, loading, db, historyWindowStart]);

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
      // Tanpa read di dalamnya, batch cukup (setara transaksi). Di-chunk 500
      // per batch — batas tulis per transaksi/batch Firestore — supaya ratusan
      // tanggal tidak gagal total karena satu transaksi raksasa.
      const CHUNK = 500;
      for (let i = 0; i < unverifiedAutoFilledDates.length; i += CHUNK) {
        const batch = writeBatch(db);
        for (const date of unverifiedAutoFilledDates.slice(i, i + CHUNK)) {
          const ref = dinasDoc(db, user.uid, 'dailyEngagement', date);
          batch.set(ref, { date, verifiedAt: serverTimestamp() }, { merge: true });
        }
        await batch.commit();
      }
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

  // Aksesibilitas modal: fokus masuk saat buka, Tab dipagarkan, kembali ke pemicu.
  const unmatchedModalRef = useDialogA11y<HTMLDivElement>(isUnmatchedReviewOpen);

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

  // Notifikasi pengisian otomatis dari ReSoEx — sekali per tanggal per sesi.
  const notifiedAutoFillRef = useRef<Set<string>>(new Set());

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

  // ---- Bangun data laporan (title, subtitle, rows, rate) — dipakai PDF & Gambar ----
  const buildReportData = (type: 'daily' | 'weekly' | 'monthly') => {
    const todayStr = getLocalISODate(new Date());
    let title = '';
    let subtitle = '';
    let dates: string[] = [];
    if (type === 'daily') {
      dates = [getLocalISODate(currentDailyDate)];
      title = 'LAPORAN HARIAN';
      const d = parseLocalISODate(dates[0]);
      subtitle = `Rekapitulasi Engagement • ${d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
    } else if (type === 'weekly') {
      if (!weeklyReports[0]) return null;
      dates = weeklyReports[0].dates;
      title = 'LAPORAN MINGGUAN';
      subtitle = `Rekapitulasi Engagement • Minggu ke-${weeklyReports[0].weekNumber} • ${weeklyReports[0].year}`;
    } else {
      if (!monthlyReports[0]) return null;
      dates = monthlyReports[0].dates;
      title = 'LAPORAN BULANAN';
      subtitle = `Rekapitulasi Engagement • ${monthlyReports[0].monthName} ${monthlyReports[0].year}`;
    }

    let totalActual = 0, totalPossible = 0;
    const daysPassed = dates.filter(d => d <= todayStr).length || 1;
    const rows: { _empId: string; name: string; nip: string; bidang: string; ig: boolean; fb: boolean; tt: boolean }[] = [];
    sortedEmployees.forEach(emp => {
      if (type === 'daily' && dates[0]) {
        const e = dailyEngagementsMap[dates[0]];
        if (e) {
          totalActual += (e.igEngagedEmployeeIds?.includes(emp.id) ? 1 : 0) + (e.fbEngagedEmployeeIds?.includes(emp.id) ? 1 : 0) + (e.tiktokEngagedEmployeeIds?.includes(emp.id) ? 1 : 0);
        }
        totalPossible += 3;
        rows.push({
          _empId: emp.id,
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
          _empId: emp.id,
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
    return { title, subtitle, dates, rows, rate, todayStr };
  };

  const handleExportPDF = async (type: 'daily' | 'weekly' | 'monthly', filename: string) => {
    setIsLoading(true);
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const report = buildReportData(type);
      if (!report) return;
      const { title, subtitle, rows, rate, dates, todayStr } = report;

      // Bulanan punya banyak kolom tanggal (28–31) → landscape agar 1 baris
      // pegawai muat; mingguan (7 hari) cukup portrait dengan kolom maksimal.
      const landscape = type === 'monthly';
      const pageW = landscape ? 297 : 210;
      const pageH = landscape ? 210 : 297;
      const margin = 12;
      const pdf = new jsPDF({ orientation: landscape ? 'l' : 'p', unit: 'mm', format: 'a4' });

      // ---- Logo (fetch SVG → canvas → PNG) ----
      const logoDataUrl = await fetchLogoDataUrl();

      // ---- Hitung per-tanggal (0–3 platform) untuk weekly/monthly ----
      const daysPassed = dates.filter((d) => d <= todayStr).length || 1;
      const perEmp = new Map<string, { perDay: number[]; total: number }>();
      for (const r of rows) {
        const perDay = dates.map((d) => {
          if (d > todayStr) return 0;
          const e = dailyEngagementsMap[d];
          let c = 0;
          if (e) {
            if (e.igEngagedEmployeeIds?.includes(r._empId)) c++;
            if (e.fbEngagedEmployeeIds?.includes(r._empId)) c++;
            if (e.tiktokEngagedEmployeeIds?.includes(r._empId)) c++;
          }
          return c;
        });
        perEmp.set(r._empId, {
          perDay,
          total: perDay.reduce((a, b) => a + b, 0),
        });
      }

      // ---- Header & footer digambar di SEMUA halaman (didDrawPage) ----
      const HEADER_H = 32;
      let pageNum = 0;
      const drawHeaderFooter = () => {
        pageNum++;
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
        pdf.setFontSize(7);
        pdf.text(`Hal. ${pageNum}`, pageW - margin, pageH - 8, { align: 'right' });
        pdf.text('ReSo — Rekap Engagement Sosmed', margin, pageH - 8);
      };

      // ---- Susun head & body ----
      // Bulanan: judul sudah memuat bulan → header tanggal cukup ANGKA HARI
      // (hemat ruang untuk kolom yang sempit); mingguan tetap "1 Agu".
      const dateLabels = dates.map((d) => {
        const p = parseLocalISODate(d);
        return type === 'monthly'
          ? String(p.getDate())
          : p.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      });
      let head: string[];
      let body: (string | number)[][];
      let colWidths: number[];

      if (type === 'daily') {
        head = ['Nama Pegawai', 'NIP', 'Bidang', 'IG', 'FB', 'TT'];
        body = rows.map((r) => [
          r.name, r.nip, r.bidang,
          r.ig ? 'Eng' : 'x', r.fb ? 'Eng' : 'x', r.tt ? 'Eng' : 'x',
        ]);
        colWidths = [74, 34, 42, 12, 12, 12];
      } else {
        head = ['Nama Pegawai', 'NIP', 'Bidang', ...dateLabels, 'Total', '% ENG'];
        body = rows.map((r) => {
          const { perDay, total } = perEmp.get(r._empId) || { perDay: dates.map(() => 0), total: 0 };
          return [
            r.name, r.nip, r.bidang,
            ...perDay,
            total,
            Math.round((total / (daysPassed * 3)) * 100),
          ];
        });
        // Lebar tabel = pageW − margin×2; nama/nip/bidang tetap, sisanya untuk tanggal.
        // Mingguan portrait: 186mm untuk 7 tanggal + Total + %ENG.
        // Bulanan landscape: 273mm untuk 28–31 tanggal + Total + %ENG.
        // NIP bulanan dibuat sempit + font khusus (di didParseCell) agar 18
        // digit tetap 1 baris, sisa ruang diberikan ke kolom tanggal.
        const fixed = type === 'weekly' ? [42, 20, 18, 12, 14] : [34, 13, 13, 8, 10];
        const fixedTotal = fixed[0] + fixed[1] + fixed[2] + fixed[3] + fixed[4];
        const avail = pageW - margin * 2 - fixedTotal;
        const dateW = Math.floor((avail / dates.length) * 10) / 10;
        colWidths = [...fixed.slice(0, 3), ...dates.map(() => dateW), fixed[3], fixed[4]];
      }

      // ---- Tabel autoTable (auto page break, header+footer tiap halaman) ----
      const isDense = type === 'monthly';
      autoTable(pdf, {
        startY: HEADER_H,
        head: [head],
        body,
        styles: {
          fontSize: type === 'daily' ? 8 : isDense ? 5 : 7,
          cellPadding: type === 'daily' ? 2.2 : 1.2,
          overflow: 'linebreak',
          valign: 'middle',
        },
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
          fontSize: type === 'daily' ? 9 : isDense ? 5.5 : 7.5,
        },
        columnStyles: Object.fromEntries(
          colWidths.map((w, i) => [i, { cellWidth: w, ...(i >= 3 ? { halign: 'center' as const } : {}) }])
        ),
        didParseCell: (data) => {
          // NIP bulanan: kolom sempit (13mm) → font khusus agar 18 digit
          // tetap 1 baris, tanpa melipat ke 2 baris.
          if (isDense && data.section === 'body' && data.column.index === 1) {
            data.cell.styles.fontSize = 4;
            data.cell.styles.overflow = 'hidden';
            data.cell.styles.cellPadding = { top: 0.5, right: 0.8, bottom: 0.5, left: 0.8 };
            data.cell.styles.halign = 'center';
          }
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

  const handleExportImage = async (type: 'daily' | 'weekly' | 'monthly', filename: string) => {
    const report = buildReportData(type);
    if (!report) return;
    if (report.rows.length > IMAGE_EXPORT_LIMIT) {
      toast.error(`Data terlalu banyak untuk export gambar (maks ${IMAGE_EXPORT_LIMIT} pegawai). Gunakan export PDF atau Excel.`);
      return;
    }
    const ref = { daily: printDailyRef, weekly: printRef, monthly: printMonthlyRef }[type];
    const source = ref.current;
    if (!source) return;
    setIsLoading(true);

    // Host off-screen — bebas dari ancestor overflow-hidden, animasi motion,
    // dan media query responsif. Clone report di sini lalu paksa gaya cetak.
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;pointer-events:none;';
    let clone: HTMLElement | null = null;
    try {
      clone = source.cloneNode(true) as HTMLElement;
      host.appendChild(clone);
      document.body.appendChild(host);
      // Tunggu font/layout clone benar-benar siap.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      // ★ Paksa gaya cetak inline pada clone (menang atas class responsif):
      // - lepas transform/opacity animasi motion
      // - tabel melebar ke max-content (semua kolom), tanpa max-h/overflow
      // - card list mobile disembunyikan, wrapper tabel dipaksa tampil penuh
      clone.style.transform = 'none';
      clone.style.opacity = '1';
      clone.style.width = 'max-content';
      clone.style.maxWidth = 'none';
      clone.style.overflow = 'visible';
      const mobileCardList = clone.querySelector('[class*="md:hidden"]') as HTMLElement | null;
      if (mobileCardList) mobileCardList.style.display = 'none';
      const tableWrapper = clone.querySelector('[class*="max-h-"]') as HTMLElement | null;
      if (tableWrapper) {
        tableWrapper.style.display = 'block';
        tableWrapper.style.maxHeight = 'none';
        tableWrapper.style.overflow = 'visible';
      }
      const table = clone.querySelector('table') as HTMLElement | null;
      if (table) {
        table.style.width = 'max-content';
      }

      // ★ Padatkan spasi gambar (inline override class responsif layar):
      // - padding container kecil, tanpa min-h (tidak ada ruang kosong di bawah)
      // - jarak judul↔tabel rapat, subtitle lebih ramping
      // - rate box dipadatkan
      clone.style.padding = '12px';
      clone.style.minHeight = '0';
      const header = clone.firstElementChild as HTMLElement | null;
      if (header) {
        header.style.marginBottom = '10px';
        header.style.paddingBottom = '10px';
        const subtitle = header.querySelector('h3 + p') as HTMLElement | null;
        if (subtitle) {
          subtitle.style.fontSize = '11px';
          subtitle.style.marginTop = '2px';
        }
        const rateBox = header.querySelector('[class*="rounded-lg"][class*="bg-slate-50"]') as HTMLElement | null;
        if (rateBox) rateBox.style.padding = '6px 10px';
      }
      await new Promise(r => requestAnimationFrame(r));

      // ★ Lebar/tinggi konten penuh — dioper EKSPLISIT ke domToPng supaya canvas
      // selebar konten (bukan getBoundingClientRect yang terkunci max-h).
      const w = clone.scrollWidth;
      const h = clone.scrollHeight;
      const { domToPng } = await import('modern-screenshot');
      const imgData = await domToPng(clone, {
        scale: 2,
        backgroundColor: '#ffffff',
        width: w,
        height: h,
        style: { overflow: 'visible', maxHeight: 'none' },
      });
      const link = document.createElement('a');
      link.download = `${filename}.png`;
      link.href = imgData;
      link.click();
      toast.success("Gambar berhasil disimpan");
    } catch (error) {
      console.error(error);
      toast.error("Gagal membuat gambar");
    } finally {
      host.remove();
      setIsLoading(false);
    }
  };

  const handleExportExcel = async (type: 'daily' | 'weekly' | 'monthly', filename: string) => {
    const report = buildReportData(type);
    if (!report) return;
    const { title, subtitle, rows, rate, dates, todayStr } = report;
    setIsLoading(true);
    try {
      // Kolom per tanggal untuk mingguan/bulanan: nilai 0–3 (jumlah platform aktif).
      // Tambahkan tahun bila rentang lintas tahun (mis. Des 2026 → Jan 2027).
      const years = new Set(dates.map((d) => parseLocalISODate(d).getFullYear()));
      const showYear = years.size > 1;
      const dateLabels = dates.map((d) =>
        parseLocalISODate(d).toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'short',
          ...(showYear ? { year: 'numeric' } : {}),
        })
      );
      const daysPassed = dates.filter((d) => d <= todayStr).length || 1;

      const header: string[] =
        type === 'daily'
          ? ['Nama Pegawai', 'NIP', 'Bidang', 'IG', 'FB', 'TT']
          : ['Nama Pegawai', 'NIP', 'Bidang', ...dateLabels, 'Total', '% ENG'];

      const body: (string | number)[][] = rows.map((r) => {
        if (type === 'daily') {
          return [r.name, r.nip, r.bidang, r.ig ? 'Eng' : 'x', r.fb ? 'Eng' : 'x', r.tt ? 'Eng' : 'x'];
        }
        // Mingguan/bulanan: hitung per tanggal (0–3) dari dailyEngagementsMap.
        let total = 0;
        const perDay = dates.map((d) => {
          const e = dailyEngagementsMap[d];
          let count = 0;
          if (d <= todayStr && e) {
            if (e.igEngagedEmployeeIds?.includes(r._empId)) count++;
            if (e.fbEngagedEmployeeIds?.includes(r._empId)) count++;
            if (e.tiktokEngagedEmployeeIds?.includes(r._empId)) count++;
          }
          total += count;
          return count;
        });
        return [r.name, r.nip, r.bidang, ...perDay, total, Math.round((total / (daysPassed * 3)) * 100)];
      });

      const aoa: (string | number)[][] = [
        [title],
        [subtitle],
        ['Rate', `${rate}%`],
        [],
        header,
        ...body,
      ];

      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.aoa_to_sheet(aoa);
      worksheet['!cols'] = header.map((h, i) => ({
        wch: h === 'Nama Pegawai' ? 32 : h === 'NIP' ? 20 : h === 'Bidang' ? 14 : h.includes('ENG') || h === 'Total' ? 8 : 7,
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, type === 'daily' ? 'Harian' : type === 'weekly' ? 'Mingguan' : 'Bulanan');
      XLSX.writeFile(workbook, `${filename}.xlsx`);
      toast.success("Excel berhasil diunduh");
    } catch (error) {
      console.error(error);
      toast.error("Gagal membuat Excel");
    } finally {
      setIsLoading(false);
    }
  };

  async function fetchLogoDataUrl(): Promise<string | null> {
    if (logoDataUrlCache) {
      const prev = await logoDataUrlCache.catch(() => null);
      if (prev !== null) return prev;
      logoDataUrlCache = null;
    }
    logoDataUrlCache = (async (): Promise<string | null> => {
      try {
        const resp = await fetch('/logo.svg');
        if (!resp.ok) throw new Error(`logo fetch ${resp.status}`);
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
      } catch {
        logoDataUrlCache = null;
        return null;
      }
    })();
    return logoDataUrlCache;
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

      const updates: { id: string; ig: string[]; fb: string[]; tiktok: string[]; unmatchedNames: UnmatchedName[] }[] = [];

      for (const eng of engagementsToProcess) {
        const ig = matchEmployeesToEngagement(eng.igRawText || '', employees, 'ig');
        const fb = matchEmployeesToEngagement(eng.fbRawText || '', employees, 'fb');
        const tiktok = matchEmployeesToEngagement(eng.tiktokRawText || '', employees, 'tiktok');
        const unmatchedNames: UnmatchedName[] = (['ig', 'fb', 'tiktok'] as const).flatMap((p) => {
          const rawKey = `${p}RawText` as keyof DailyEngagement;
          const raw = (eng[rawKey] as string) || '';
          return matchEngagementDetail(raw, employees, p).unmatched.map((name) => ({ name, platform: p }));
        });

        const igChanged = !engagedIdsEqual(eng.igEngagedEmployeeIds || [], ig);
        const fbChanged = !engagedIdsEqual(eng.fbEngagedEmployeeIds || [], fb);
        const tiktokChanged = !engagedIdsEqual(eng.tiktokEngagedEmployeeIds || [], tiktok);
        const existingUnmatched = eng.unmatchedNames || [];
        const unmatchedChanged = JSON.stringify([...existingUnmatched].sort((a, b) => a.name.localeCompare(b.name) || a.platform.localeCompare(b.platform))) !== JSON.stringify([...unmatchedNames].sort((a, b) => a.name.localeCompare(b.name) || a.platform.localeCompare(b.platform)));

        if (igChanged || fbChanged || tiktokChanged || unmatchedChanged) {
          updates.push({ id: eng.id, ig, fb, tiktok, unmatchedNames });
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
              unmatchedNames: u.unmatchedNames,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
        await batch.commit();
      }

      toast.success(`Kalkulasi ulang selesai. ${updates.length} data tanggal diperbarui.`);
      setRecalcResult(`Terakhir: ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} — ${updates.length} data diperbarui`);
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
      days.push({
        day: null, date: '', isCurrentMonth: false, isToday: false, isFilled: false,
        isFuture: false, isAutoFilled: false, isVerified: false, hasUnmatched: false,
        hasIgData: false, hasFbData: false, hasTtData: false, unmatchedCount: 0,
      });
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
        // Platform yang benar-benar punya catatan pada tanggal itu (id cocok
        // atau raw text) — sumber dot IG/FB/TT di sel kalender.
        hasIgData: !!engagement && ((engagement.igEngagedEmployeeIds?.length || 0) > 0 || !!engagement.igRawText),
        hasFbData: !!engagement && ((engagement.fbEngagedEmployeeIds?.length || 0) > 0 || !!engagement.fbRawText),
        hasTtData: !!engagement && ((engagement.tiktokEngagedEmployeeIds?.length || 0) > 0 || !!engagement.tiktokRawText),
        unmatchedCount: engagement?.unmatchedNames?.length || 0,
        isFuture: dateStr > getLocalISODate(new Date())
      });
    }
    return days;
  }, [currentMonth, dailyEngagementsMap]);

  const monthSummary = useMemo(() => {
    const filled = calendarDays.filter(d => d.isFilled).length;
    const needReview = calendarDays.filter(d => d.isAutoFilled && !d.isVerified).length;
    const verified = calendarDays.filter(d => d.isVerified).length;
    const unmatched = calendarDays.filter(d => d.hasUnmatched).length;
    return { filled, needReview, verified, unmatched };
  }, [calendarDays]);

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
    if (isOutsideHistoryWindow(newDate)) {
      notifyHistoryLimit();
      return;
    }
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
    if (isOutsideHistoryWindow(newDate)) {
      notifyHistoryLimit();
      return;
    }
    setCurrentMonthlyReportDate(newDate);
  };

  const changeDailyDate = (offset: number) => {
    const newDate = new Date(currentDailyDate);
    newDate.setDate(newDate.getDate() + offset);
    if (isOutsideHistoryWindow(newDate)) {
      notifyHistoryLimit();
      return;
    }
    setCurrentDailyDate(newDate);
  };

  const changeMonth = (offset: number) => {
    const newMonth = new Date(currentMonth);
    // Normalisasi ke tanggal-1 agar pembanding tidak salah karena ujung bulan.
    newMonth.setDate(1);
    newMonth.setMonth(newMonth.getMonth() + offset);
    if (isOutsideHistoryWindow(newMonth)) {
      notifyHistoryLimit();
      return;
    }
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

  // Export gambar dibatasi satu lembar (maks IMAGE_EXPORT_LIMIT pegawai);
  // lewat batas → tombol Gambar dinonaktifkan, fokus PDF/Excel.
  const canExportImage = employees.length <= IMAGE_EXPORT_LIMIT;

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
        aria-label="Navigasi utama"
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
            <Button variant="ghost" size="icon" className="lg:hidden rounded-full" onClick={() => setIsSidebarOpen(false)} aria-label="Tutup menu">
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

        <div className="p-4 mt-auto border-t border-slate-200 bg-slate-50/80">
          {user && (
            <div className="flex items-center gap-3 mb-3">
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
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-medium text-slate-400">
              ReSo v{APP_VERSION}
            </p>
            {user && (
              <Button
                onClick={logout}
                variant="ghost"
                size="icon"
                title="Keluar"
                aria-label="Keluar"
                className="h-8 w-8 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600"
              >
                <LogOut size={16} />
              </Button>
            )}
          </div>
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
          aria-label="Buka menu navigasi"
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
                    <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2.5 mb-3">
                      <div className="flex items-center justify-between lg:justify-start gap-2">
                        <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200 shrink-0">
                          <Button variant="ghost" size="icon" onClick={() => changeMonth(-1)} className="rounded-lg h-7 w-7 text-slate-600 hover:bg-white shrink-0">
                            <ChevronLeft size={14} />
                          </Button>
                          <div className="text-center min-w-[128px]">
                            <h2 className="text-sm font-bold text-slate-900">
                              {currentMonth.toLocaleString('id-ID', { month: 'long', year: 'numeric' })}
                            </h2>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => changeMonth(1)} className="rounded-lg h-7 w-7 text-slate-600 hover:bg-white shrink-0">
                            <ChevronRight size={14} />
                          </Button>
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedDate(getLocalISODate(new Date()))}
                          className="text-[11px] font-bold border-slate-200 text-slate-600 hover:bg-slate-100 h-8 shrink-0 lg:hidden"
                        >
                          Hari ini
                        </Button>
                      </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-semibold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full bg-slate-900" /> Terisi
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full bg-amber-400" /> Otomatis · perlu review
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Check size={10} strokeWidth={3.5} className="text-emerald-600 shrink-0" aria-hidden /> Terverifikasi
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="flex items-center gap-0.5" aria-hidden>
                                <span className="w-1.5 h-1.5 rounded-full bg-pink-400" />
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                              </span>
                              IG/FB/TT ada data
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] font-black text-amber-500 leading-none">!</span> Belum terpetakan
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full bg-white border-2 border-slate-200" /> Kosong
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full border-2 border-emerald-500 bg-white" /> Hari ini
                            </div>
                          </div>

                        {unverifiedAutoFilledDates.length > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleVerifyAllAutoFilled}
                            disabled={isVerifyingAll}
                            className="text-[11px] font-bold border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 h-8 shrink-0"
                          >
                            <CheckCircle2 size={13} className="mr-1.5" />
                            {isVerifyingAll
                              ? 'Menandai…'
                              : `Terima ${unverifiedAutoFilledDates.length} rekap otomatis`}
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
                      {/* Kalender */}
                      <div className="overflow-y-auto min-w-0">
                        <div className="min-w-[280px] sm:min-w-[400px] h-[calc(100dvh-14.5rem)] md:h-[calc(100dvh-12rem)] lg:h-[calc(100dvh-10.5rem)] min-h-[340px]">
                          <div className="grid grid-cols-7 grid-rows-[repeat(7,minmax(0,1fr))] gap-0.5 sm:gap-1 h-full">
                            {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map(day => (
                              <div key={day} className="text-center py-0.5 md:py-1 text-[8px] sm:text-[9px] font-bold text-slate-400 uppercase tracking-widest self-end">
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
                                    aria-label={[
                                      `${day.day} ${currentMonth.toLocaleString('id-ID', { month: 'long', year: 'numeric' })}`,
                                      day.isFuture ? 'belum bisa diisi' : day.isFilled ? 'rekap terisi' : 'belum ada rekap',
                                      day.isToday ? 'hari ini' : null,
                                      day.isVerified ? 'terverifikasi' : null,
                                      day.unmatchedCount > 0 ? `${day.unmatchedCount} nama belum terpetakan` : null,
                                    ].filter(Boolean).join(', ')}
                                    className={cn(
                                      "w-full h-full rounded-md md:rounded-lg flex flex-col items-center justify-center gap-0.5 md:gap-1 transition-all relative group border",
                                      day.isFuture ? "bg-slate-50/50 cursor-not-allowed opacity-30 border-transparent" :
                                      day.isToday && day.isFilled ? "bg-slate-900 text-white border-slate-900 ring-1 ring-inset ring-emerald-300" :
                                      day.isFilled ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-800" :
                                      day.isToday ? "bg-white text-slate-900 border-emerald-500 border-2 hover:bg-emerald-50" :
                                      "bg-white text-slate-600 hover:bg-slate-50 border-slate-200"
                                    )}
                                  >
                                    <span className="text-sm sm:text-base font-bold leading-none">{day.day}</span>
                                    {day.isToday && !day.isFilled && (
                                      <span className="text-[7px] font-bold text-emerald-600 leading-none">Hari ini</span>
                                    )}
                                    <div className="flex gap-0.5 items-center">
                                      {/* Dot amber = kiriman otomatis ReSoEx yang belum direview operator */}
                                      {day.isAutoFilled && !day.isVerified && (
                                        <div className={cn("w-1 h-1 rounded-full", day.isToday ? "bg-amber-300" : "bg-amber-400")} />
                                      )}
                                      {day.hasUnmatched && (
                                        <span className="text-[8px] font-black text-amber-500 leading-none" title="Ada nama belum terpetakan">!</span>
                                      )}
                                      {/* Dot platform hanya muncul untuk platform yang benar-benar ada datanya */}
                                      {day.hasIgData && (
                                        <div className={cn("w-1 h-1 rounded-full", day.isToday ? "bg-pink-300" : "bg-pink-400")} />
                                      )}
                                      {day.hasFbData && (
                                        <div className={cn("w-1 h-1 rounded-full", day.isToday ? "bg-blue-300" : "bg-blue-400")} />
                                      )}
                                      {day.hasTtData && (
                                        <div className={cn("w-1 h-1 rounded-full", day.isToday ? "bg-slate-300" : "bg-slate-500")} />
                                      )}
                                    </div>
                                    {/* Tanda terverifikasi — berlaku untuk rekap manual maupun otomatis */}
                                    {day.isVerified && (
                                      <Check
                                        size={9}
                                        strokeWidth={3.5}
                                        aria-hidden
                                        className={cn(
                                          "absolute right-[3px] top-[3px]",
                                          day.isFilled ? (day.isToday ? "text-emerald-300" : "text-emerald-400") : "text-emerald-600"
                                        )}
                                      />
                                    )}
                                  </button>
                                ) : (
                                  <div className="w-full h-full" />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Ringkasan bulan */}
                      <div className="hidden lg:flex flex-col gap-3 min-w-0">
                        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                            Ringkasan bulan
                          </h4>
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                                <div className="w-2 h-2 rounded-full bg-slate-900" />
                                Hari terisi
                              </div>
                              <span className="text-sm font-bold text-slate-900">{monthSummary.filled}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                                <div className="w-2 h-2 rounded-full bg-amber-400" />
                                Perlu review
                              </div>
                              <span className="text-sm font-bold text-amber-600">{monthSummary.needReview}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                                <Check size={11} strokeWidth={3.5} className="text-emerald-600 shrink-0" aria-hidden />
                                Terverifikasi
                              </div>
                              <span className="text-sm font-bold text-emerald-600">{monthSummary.verified}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                                <span className="w-2 h-2 rounded-full bg-amber-200 flex items-center justify-center text-[8px] font-black text-amber-600 leading-none">!</span>
                                Belum terpetakan
                              </div>
                              <span className="text-sm font-bold text-amber-600">{monthSummary.unmatched}</span>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                            Aksi cepat
                          </h4>
                          <div className="space-y-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedDate(getLocalISODate(new Date()));
                                setIsInputModalOpen(true);
                              }}
                              className="w-full justify-start text-[11px] font-bold text-slate-600 h-9 rounded-lg"
                            >
                              <PlusCircle size={14} className="mr-1.5" />
                              Input rekap hari ini
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setActiveTab('employees')}
                              className="w-full justify-start text-[11px] font-bold text-slate-600 h-9 rounded-lg"
                            >
                              <Users2 size={14} className="mr-1.5" />
                              Kelola pegawai
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>

                  <InputModal
                    open={isInputModalOpen}
                    date={selectedDate}
                    existing={dailyEngagementsMap[selectedDate]}
                    employees={employees}
                    metaToken={metaToken}
                    postedAt={selectedPostedAt}
                    unmatchedCount={selectedUnmatched.length}
                    onClose={closeInputModal}
                    onOpenUnmatched={() => setIsUnmatchedReviewOpen(true)}
                    onGoToSettings={() => setActiveTab('settings')}
                  />

                  {/* Modal review nama belum terpetakan */}
                  <AnimatePresence>
                    {isUnmatchedReviewOpen && (
                      <div
                        className="fixed inset-0 z-[65] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-0 sm:p-4"
                        onClick={() => setIsUnmatchedReviewOpen(false)}
                        role="presentation"
                      >
                        <motion.div
                          ref={unmatchedModalRef}
                          tabIndex={-1}
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="unmatched-review-title"
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 12 }}
                          transition={{ ease: "easeOut", duration: 0.2 }}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-white w-full max-w-xl rounded-t-2xl sm:rounded-xl overflow-hidden flex flex-col max-h-[88vh] sm:max-h-[82vh] shadow-2xl border border-slate-200"
                        >
                          <div className="p-5 sm:p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50/20 shrink-0">
                            <div>
                              <h3 id="unmatched-review-title" className="text-base sm:text-lg font-black text-slate-900 leading-tight">Petakan nama belum terpetakan</h3>
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
                  handleExportExcel={handleExportExcel}
                  canExportImage={canExportImage}
                  printDailyRef={printDailyRef}
                  isLoading={isLoading}
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
                  handleExportExcel={handleExportExcel}
                  canExportImage={canExportImage}
                  printRef={printRef}
                  isLoading={isLoading}
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
                  handleExportExcel={handleExportExcel}
                  canExportImage={canExportImage}
                  printMonthlyRef={printMonthlyRef}
                  isLoading={isLoading}
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
                  <EmployeeManager employees={employees} />
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
                handleClearMetaToken={handleClearMetaToken}
                isSavingToken={isSavingToken}
                recalcResult={recalcResult}
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


