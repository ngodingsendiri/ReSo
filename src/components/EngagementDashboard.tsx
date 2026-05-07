import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  PlusCircle, 
  Download,
  Trash2,
  BarChart3,
  Edit,
  Users2,
  CheckCircle2,
  XCircle,
  X,
  Calendar as CalendarIcon,
  ClipboardPaste,
  ChevronLeft,
  ChevronRight,
  History,
  Settings,
  Instagram,
  Facebook,
  Heart,
  ThumbsUp,
  FileText,
  Image as ImageIcon,
  TrendingUp,
  Activity,
  Menu,
  Link as LinkIcon,
  RefreshCw,
  ExternalLink,
  PieChart
} from 'lucide-react';
import { TiktokIcon } from './icons/TiktokIcon';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Toaster } from './ui/sonner';
import { toast } from 'sonner';
import { DailyEngagement, Employee } from '../types';
import { useAuth } from './FirebaseProvider';
import { db, signIn, logout } from '../lib/firebase';
import { collection, onSnapshot, query, orderBy, doc, setDoc, serverTimestamp, limit } from 'firebase/firestore';
import { cn, getBidangColor } from '@/lib/utils';
import { ErrorBoundary } from './ErrorBoundary';

const EngagementChart = React.lazy(() => import('./EngagementChart'));
const EmployeeManager = React.lazy(() => import('./EmployeeManager'));

const getLocalISODate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const containerVariants: import('motion/react').Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.05
    }
  }
};

const itemVariants: import('motion/react').Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 24
    }
  }
};

export default function EngagementDashboard() {
  const { user, loading } = useAuth();
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Meta API State
  const [metaToken, setMetaToken] = useState('');
  const [isFetchingMeta, setIsFetchingMeta] = useState(false);
  const [isSavingToken, setIsSavingToken] = useState(false);

  // Load Meta Token from Firestore on mount
  useEffect(() => {
    if (loading || !user) return;

    const unsubscribe = onSnapshot(doc(db, 'settings', 'meta_api'), (docSnap) => {
      if (docSnap.exists()) {
        setMetaToken(docSnap.data().value || '');
      }
    });

    return unsubscribe;
  }, [user, loading]);

  const handleSaveMetaToken = async () => {
    if (!user) return;
    setIsSavingToken(true);
    try {
      await setDoc(doc(db, 'settings', 'meta_api'), {
        value: metaToken,
        updatedAt: serverTimestamp()
      });
      toast.success("Token API Meta berhasil disimpan ke server");
    } catch (err) {
      console.error("Error saving meta token:", err);
      toast.error("Gagal menyimpan token ke server");
    } finally {
      setIsSavingToken(false);
    }
  };

  const igInputRef = useRef<HTMLTextAreaElement>(null);
  const fbInputRef = useRef<HTMLTextAreaElement>(null);
  const tiktokInputRef = useRef<HTMLTextAreaElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const printMonthlyRef = useRef<HTMLDivElement>(null);
  const printDailyRef = useRef<HTMLDivElement>(null);

  // Load employees from Firestore
  useEffect(() => {
    if (loading || !user) {
      setEmployees([]);
      return;
    }

    const q = query(collection(db, 'employees'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const emps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      setEmployees(emps);
    });
    return unsubscribe;
  }, [user, loading]);

  // Load all daily engagements
  useEffect(() => {
    if (loading || !user) {
      setDailyEngagements([]);
      return;
    }

    // Optimization: Only fetch the last 60 days to prevent excessive payload size
    // The previous setup fetched ALL time history, including massive raw texts, 
    // which exponentially bloated initial load times.
    const q = query(
      collection(db, 'dailyEngagement'), 
      orderBy('date', 'desc'),
      limit(60) 
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DailyEngagement));
      setDailyEngagements(data);
    });
    return unsubscribe;
  }, [user, loading]);

  const dailyEngagementsMap = useMemo(() => {
    return dailyEngagements.reduce((acc, curr) => {
      acc[curr.id] = curr;
      return acc;
    }, {} as Record<string, DailyEngagement>);
  }, [dailyEngagements]);

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

      // Helper function for date matching (15:00 H-1 to 15:00 D-Day WIB)
      const isWithinCustomWindow = (postDateStr: string, targetDateStr: string) => {
        if (!postDateStr) return false;
        const postTime = new Date(postDateStr).getTime();
        const endDate = new Date(`${targetDateStr}T08:00:00Z`);
        const endTime = endDate.getTime();
        const startTime = endTime - (24 * 60 * 60 * 1000);
        return postTime >= startTime && postTime <= endTime;
      };

      let fbPosts: any[] = [];
      let igPosts: any[] = [];
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
            const scope = debugData.data.granular_scopes.find((s: any) => s.scope === 'pages_show_list' || s.scope === 'pages_read_engagement' || s.scope === 'pages_manage_posts');
            if (scope && scope.target_ids && scope.target_ids.length > 0) {
              pageId = scope.target_ids[0];
              const pageRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=access_token&access_token=${metaToken}`, { signal: controller.signal });
              const pageData = await pageRes.json();
              if (pageData.access_token) pageToken = pageData.access_token;
            }
          }
        }
      } catch (e) {
        console.log("Not a user token, continuing with original token.");
      }

      // Fetch FB Posts
      const fbPostsRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/posts?fields=id,created_time,permalink_url&access_token=${pageToken}&limit=50`, { signal: controller.signal });
      const fbPostsData = await fbPostsRes.json();
      let latestFbPostDate = null;

      if (!fbPostsData.error && fbPostsData.data) {
        if (fbPostsData.data.length > 0) latestFbPostDate = fbPostsData.data[0].created_time;
        fbPosts = fbPostsData.data.filter((p: any) => isWithinCustomWindow(p.created_time, selectedDate));
      }

      // Fetch IG Account ID
      const igAccRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`, { signal: controller.signal });
      const igAccData = await igAccRes.json();
      const igAccountId = igAccData.instagram_business_account?.id;

      if (igAccountId) {
        // Fetch IG Posts
        const igPostsRes = await fetch(`https://graph.facebook.com/v19.0/${igAccountId}/media?fields=id,timestamp,permalink&access_token=${pageToken}&limit=50`, { signal: controller.signal });
        const igPostsData = await igPostsRes.json();
        if (!igPostsData.error && igPostsData.data) {
          igPosts = igPostsData.data.filter((p: any) => isWithinCustomWindow(p.timestamp, selectedDate));
        }
      }

      if (fbPostsData.error && !igAccountId) {
        throw new Error(fbPostsData.error?.message || "Gagal mengakses data Page/Instagram.");
      }

      const commenters: any[] = [];
      const newFbLinks = fbPosts.map((p: any) => p.permalink_url).filter(Boolean);
      const newIgLinks = igPosts.map((p: any) => p.permalink).filter(Boolean);

      // Fetch IG comments
      for (const post of igPosts) {
        const commentsRes = await fetch(`https://graph.facebook.com/v19.0/${post.id}/comments?fields=id,text,username,timestamp&access_token=${pageToken}&limit=100`, { signal: controller.signal });
        const commentsData = await commentsRes.json();
        (commentsData.data || []).forEach((c: any) => {
          commenters.push({ platform: 'ig', username: c.username || "Unknown", text: c.text });
        });
      }

      clearTimeout(timeoutId);

      const fbPostCount = fbPosts.length;
      const igPostCount = igPosts.length;
      const debug = { igLinked: !!igAccountId, latestFbPostDate };
      
      // Update Links

      if (newIgLinks && newIgLinks.length > 0) {
        setIgLinks(prev => Array.from(new Set([...prev, ...newIgLinks])));
      }
      if (newFbLinks && newFbLinks.length > 0) {
        setFbLinks(prev => Array.from(new Set([...prev, ...newFbLinks])));
      }

      // Pisahkan username berdasarkan platform (hanya IG yang ditarik komentarnya)
      const igUsernames = (commenters || []).filter((c: any) => c.platform === 'ig').map((c: any) => c.username);

      // Masukkan raw username ke dalam text area secara otomatis
      if (igUsernames.length > 0) {
        setIgRawInput(prev => {
          const newVal = prev ? prev + '\n' + igUsernames.join('\n') : igUsernames.join('\n');
          if (igInputRef.current) igInputRef.current.value = newVal;
          return newVal;
        });
      }

      if (fbPostCount === 0 && igPostCount === 0) {
        let msg = `Tidak ada postingan pada tanggal ${selectedDate}.`;
        if (debug?.latestFbPostDate) {
          const d = new Date(debug.latestFbPostDate);
          msg += ` Postingan FB terakhir adalah tanggal ${d.toLocaleDateString('id-ID')}.`;
        }
        if (!debug?.igLinked) {
          msg += ` (Akun Instagram Bisnis belum terhubung ke Halaman FB ini).`;
        }
        toast.warning(msg, { duration: 6000 });
      } else {
        toast.success(`Ditemukan ${igPostCount} post IG & ${fbPostCount} post FB. Berhasil menarik ${commenters.length} komentar IG ke dalam form.`);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsFetchingMeta(false);
    }
  };

  const handleExportPDF = async (ref: React.RefObject<HTMLDivElement>, filename: string) => {
    if (!ref.current) return;
    setIsLoading(true);
    setIsExporting(true);
    // Wait for state to apply and DOM to update
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      const { domToPng } = await import('modern-screenshot');
      const { jsPDF } = await import('jspdf');

      const imgData = await domToPng(ref.current, {
        scale: 2,
        backgroundColor: '#ffffff',
      });
      
      // Calculate dimensions
      const img = new Image();
      img.src = imgData;
      await new Promise(resolve => { img.onload = resolve; });
      
      const pdf = new jsPDF({
        orientation: img.width > img.height ? 'l' : 'p',
        unit: 'px',
        format: [img.width, img.height]
      });
      
      pdf.addImage(imgData, 'PNG', 0, 0, img.width, img.height);
      pdf.save(`${filename}.pdf`);
      toast.success("PDF berhasil diunduh");
    } catch (error) {
      console.error(error);
      toast.error("Gagal membuat PDF");
    } finally {
      setIsExporting(false);
      setIsLoading(false);
    }
  };

  const handleExportImage = async (ref: React.RefObject<HTMLDivElement>, filename: string) => {
    if (!ref.current) return;
    setIsLoading(true);
    setIsExporting(true);
    // Wait for state to apply and DOM to update
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      const { domToPng } = await import('modern-screenshot');
      
      const imgData = await domToPng(ref.current, {
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
      setIsExporting(false);
      setIsLoading(false);
    }
  };

  const chartData = useMemo(() => {
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().split('T')[0];
    });

    return last7Days.map(date => {
      const engagement = dailyEngagementsMap[date];
      const igCount = engagement?.igEngagedEmployeeIds?.length || 0;
      const fbCount = engagement?.fbEngagedEmployeeIds?.length || 0;
      const tiktokCount = engagement?.tiktokEngagedEmployeeIds?.length || 0;
      return {
        name: new Date(date).toLocaleDateString('id-ID', { weekday: 'short' }),
        ig: igCount,
        fb: fbCount,
        tiktok: tiktokCount,
        total: igCount + fbCount + tiktokCount
      };
    });
  }, [dailyEngagements]);

  const stats = useMemo(() => {
    const totalEmployees = employees.length;
    const today = new Date().toISOString().split('T')[0];
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

  const handleSaveEngagement = async () => {
    if (!user) {
      toast.error('Anda harus login untuk menyimpan data');
      return;
    }
    
    setIsLoading(true);
    try {
      const processInput = (input: string, platform: 'ig' | 'fb' | 'tiktok') => {
        const lowerInput = input.toLowerCase();
        
        // Memecah input menjadi baris-baris mengatasi nama yang di-copy dari sosmed
        const inputLines = lowerInput.split(/[\n,;]+/).map(line => line.trim()).filter(line => line.length > 2);
        
        const matchedIds = new Set<string>();

        const isLineInText = (text: string, searchLine: string) => {
          if (!text || !searchLine) return false;
          if (text === searchLine) return true;
          if (text.startsWith(searchLine + ' ')) return true;
          if (text.endsWith(' ' + searchLine)) return true;
          if (text.includes(' ' + searchLine + ' ')) return true;
          // toleransi karakter agak panjang yang merupakan awalan/akhiran
          if (text.includes(' ' + searchLine) && searchLine.length >= 5) return true;
          if (text.startsWith(searchLine) && searchLine.length >= 5) return true;
          return false;
        };
        
        employees.forEach(emp => {
          // Cek apakah akun untuk platform ini tersedia, jika tidak lewati
          if (platform === 'ig' && !emp.igUsername) return;
          if (platform === 'fb' && !emp.fbName) return;
          if (platform === 'tiktok' && !emp.tiktokName) return;

          const nameMatch = emp.name.toLowerCase().trim();
          const igMatch = emp.igUsername?.replace('@', '').toLowerCase().trim() || '';
          const fbMatch = emp.fbName?.toLowerCase().trim() || '';
          const tiktokMatch = emp.tiktokName?.toLowerCase().trim() || '';
          
          let isMatch = false;

          // 1. Pengecekan eksak berdasarkan pencarian lengkap (semua text direkam)
          if (nameMatch && lowerInput.includes(nameMatch)) isMatch = true;
          if (platform === 'ig' && igMatch && lowerInput.includes(igMatch)) isMatch = true;
          if (platform === 'fb' && fbMatch && lowerInput.includes(fbMatch)) isMatch = true;
          if (platform === 'tiktok' && tiktokMatch && lowerInput.includes(tiktokMatch)) isMatch = true;

          // 2. Pengecekan baris per baris (Jika input dicopy per nama/disingkat pas di FB/IG)
          if (!isMatch) {
            for (const line of inputLines) {
              if (isLineInText(nameMatch, line)) {
                isMatch = true; break;
              }
              if (platform === 'ig' && isLineInText(igMatch, line)) {
                isMatch = true; break;
              }
              if (platform === 'fb' && isLineInText(fbMatch, line)) {
                isMatch = true; break;
              }
              if (platform === 'tiktok' && isLineInText(tiktokMatch, line)) {
                isMatch = true; break;
              }
            }
          }

          if (isMatch) {
            matchedIds.add(emp.id);
          }
        });

        return Array.from(matchedIds);
      };

      const currentIgRawInput = igInputRef.current ? igInputRef.current.value : igRawInput;
      const currentFbRawInput = fbInputRef.current ? fbInputRef.current.value : fbRawInput;
      const currentTiktokRawInput = tiktokInputRef.current ? tiktokInputRef.current.value : tiktokRawInput;

      const igEngagedIds = processInput(currentIgRawInput, 'ig');
      const fbEngagedIds = processInput(currentFbRawInput, 'fb');
      const tiktokEngagedIds = processInput(currentTiktokRawInput, 'tiktok');

      const docRef = doc(db, 'dailyEngagement', selectedDate);
      
      // Check if user actually modified IG, FB, or TikTok data
      const igChanged = currentIgRawInput !== initialIgRawInput || JSON.stringify(igLinks) !== JSON.stringify(initialIgLinks);
      const fbChanged = currentFbRawInput !== initialFbRawInput || JSON.stringify(fbLinks) !== JSON.stringify(initialFbLinks);
      const tiktokChanged = currentTiktokRawInput !== initialTiktokRawInput || JSON.stringify(tiktokLinks) !== JSON.stringify(initialTiktokLinks);
      
      const updateData: any = {
        date: selectedDate,
        updatedAt: serverTimestamp()
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

      await setDoc(docRef, updateData, { merge: true });

      toast.success(`Data rekap tanggal ${selectedDate} berhasil disimpan`);
      closeInputModal();
    } catch (error: any) {
      console.error('Error saving engagement:', error);
      if (error.code === 'permission-denied' || error.message?.includes('Missing or insufficient permissions')) {
        toast.error('Akses ditolak: Anda tidak memiliki izin untuk menyimpan data ini.');
      } else {
        toast.error(`Gagal menyimpan data: ${error.message || 'Kesalahan tidak diketahui'}`);
      }
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
      days.push({ day: null, date: '', isCurrentMonth: false, isToday: false, isFilled: false, isFuture: false });
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
        isFilled: !!engagement && ((engagement.igEngagedEmployeeIds?.length || 0) > 0 || (engagement.fbEngagedEmployeeIds?.length || 0) > 0),
        isFuture: date > new Date()
      });
    }
    return days;
  }, [currentMonth, dailyEngagements]);

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
      weekRange: `${new Date(weekDates[0]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${new Date(weekDates[6]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      dates: weekDates,
      isCurrentWeek: weekDates.includes(todayStr)
    }];
  }, [employees, currentWeekDate]);

  const weeklyDatesList = useMemo(() => weeklyReports.flatMap(w => w.dates), [weeklyReports]);

  const weeklyStats = useMemo(() => {
    if (weeklyReports.length === 0) return { employeeTotals: {} as Record<string, number>, maxEngagements: 3 };
    
    const weekDates = weeklyReports[0].dates;
    const todayStr = getLocalISODate(new Date());
    
    let daysPassed = 0;
    weekDates.forEach(date => {
      if (date <= todayStr) daysPassed++;
    });
    if (daysPassed === 0) daysPassed = 1; // Prevent division by zero

    const maxEngagements = daysPassed * 3;
    
    const employeeTotals: Record<string, number> = {};

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
    });

    const uniqueScores = Array.from(new Set(Object.values(employeeTotals))).sort((a, b) => b - a);
    const top3Scores = uniqueScores.slice(0, 3);
    const bottom3Scores = [...uniqueScores].reverse().slice(0, 3);

    const top3Ids = employees.filter(e => top3Scores.includes(employeeTotals[e.id])).map(e => e.id);
    const bottom3Ids = employees.filter(e => bottom3Scores.includes(employeeTotals[e.id]) && !top3Ids.includes(e.id)).map(e => e.id);

    return { employeeTotals, maxEngagements, top3Ids, bottom3Ids };
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
       monthRange: `${new Date(monthDates[0]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${new Date(monthDates[monthDates.length - 1]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`,
       dates: monthDates,
       isCurrentMonth: monthDates.includes(todayStr)
    }];
  }, [employees, currentMonthlyReportDate]);

  const monthlyStats = useMemo(() => {
    if (monthlyReports.length === 0) return { employeeTotals: {} as Record<string, number>, maxEngagements: 3 };
    
    const monthDates = monthlyReports[0].dates;
    const todayStr = getLocalISODate(new Date());
    
    let daysPassed = 0;
    monthDates.forEach(date => {
      if (date <= todayStr) daysPassed++;
    });
    if (daysPassed === 0) daysPassed = 1; // Prevent division by zero

    const maxEngagements = daysPassed * 3;
    
    const employeeTotals: Record<string, number> = {};

    employees.forEach(emp => {
      let totalEngagements = 0;
      monthDates.forEach(date => {
        if (date > todayStr) return;
        const engagement = dailyEngagementsMap[date];
        const hasIg = engagement?.igEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        const hasFb = engagement?.fbEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        const hasTiktok = engagement?.tiktokEngagedEmployeeIds?.includes(emp.id) ? 1 : 0;
        totalEngagements += (hasIg + hasFb + hasTiktok);
      });
      employeeTotals[emp.id] = totalEngagements;
    });

    const uniqueScores = Array.from(new Set(Object.values(employeeTotals))).sort((a, b) => b - a);
    const top3Scores = uniqueScores.slice(0, 3);
    const bottom3Scores = [...uniqueScores].reverse().slice(0, 3);

    const top3Ids = employees.filter(e => top3Scores.includes(employeeTotals[e.id])).map(e => e.id);
    const bottom3Ids = employees.filter(e => bottom3Scores.includes(employeeTotals[e.id]) && !top3Ids.includes(e.id)).map(e => e.id);

    return { employeeTotals, maxEngagements, top3Ids, bottom3Ids };
  }, [monthlyReports, employees, dailyEngagementsMap]);

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

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex h-[100dvh] bg-[#fafafa] bg-grid-pattern font-sans overflow-hidden relative">
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
          "fixed inset-y-0 left-0 w-72 bg-white border-r border-slate-100 flex flex-col shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-50 transition-transform duration-300 ease-in-out lg:static lg:translate-x-0",
          !isSidebarOpen ? "-translate-x-full" : "translate-x-0"
        )}
      >
        <div className="p-6 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <motion.div 
                className="w-10 h-10 bg-rose-600 rounded-[14px] flex items-center justify-center shadow-lg shadow-rose-200"
                whileHover={{ rotate: 12, scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <Edit className="text-white" size={22} strokeWidth={2.5} />
              </motion.div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 leading-none">RecapLink</h1>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Smart Engine</p>
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
              label="Dashboard" 
            />
            <NavItem 
              active={activeTab === 'overview'} 
              onClick={() => { setActiveTab('overview'); setIsSidebarOpen(false); }} 
              icon={<CalendarIcon size={20} />} 
              label="Input Rekap Harian" 
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
          </nav>
        </div>

        {/* Login/Logout Button at bottom of sidebar */}
        <div className="p-6 mt-auto border-t border-slate-100 bg-slate-50/50">
          {!user ? (
            <Button 
              onClick={signIn} 
              className="w-full bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-md font-bold text-sm h-12 transition-all active:scale-95"
            >
              Login dengan Google
            </Button>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 px-2">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Profile" className="w-10 h-10 rounded-full border-2 border-white shadow-sm" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 font-bold text-sm shadow-sm border-2 border-white">
                    {user.email?.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{user.displayName || user.email}</p>
                  <p className="text-[10px] text-slate-500 truncate font-medium">{user.email}</p>
                </div>
              </div>
              <Button 
                onClick={logout} 
                variant="outline" 
                className="w-full border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-rose-600 rounded-xl font-bold text-xs h-10 transition-colors"
              >
                Logout
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
        {/* Sticky App Header - Modern Mobile Style */}
        <header className="sticky top-0 pt-safe z-30 bg-white/80 backdrop-blur-md border-b border-slate-100 px-4 h-[calc(4rem+env(safe-area-inset-top))] flex items-center justify-between lg:px-8 lg:h-20 lg:pt-0">
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="icon" 
              className="lg:hidden rounded-lg h-9 w-9 text-slate-500 hover:bg-slate-50" 
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu size={20} />
            </Button>
            <div className="flex flex-col">
              <h2 className="text-base lg:text-xl font-bold text-slate-900 tracking-tight leading-none">
                {activeTab === 'dashboard' && 'Beranda'}
                {activeTab === 'overview' && 'Input Rekap'}
                {activeTab === 'daily-report' && 'Laporan Harian'}
                {activeTab === 'reports' && 'Laporan Mingguan'}
                {activeTab === 'monthly-reports' && 'Laporan Bulanan'}
                {activeTab === 'employees' && 'Data Pegawai'}
                {activeTab === 'settings' && 'Pengaturan'}
              </h2>
              <span className="lg:hidden text-[9px] font-bold text-rose-500 uppercase tracking-widest mt-1">RecapLink Smart</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex flex-col items-end mr-2">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Status</p>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[9px] font-bold text-slate-600">Online</span>
              </div>
            </div>
            {user && (
              <div className="flex items-center gap-2 bg-slate-50 p-1 pr-3 rounded-full border border-slate-100">
                <img 
                  src={user.photoURL || ''} 
                  alt="Profile" 
                  className="w-7 h-7 lg:w-9 lg:h-9 rounded-full border-2 border-white shadow-sm" 
                  referrerPolicy="no-referrer" 
                />
                <span className="hidden md:block text-xs font-bold text-slate-700">{user.displayName?.split(' ')[0]}</span>
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth">
          <div className="px-4 py-6 md:p-8 lg:p-12 max-w-[1600px] mx-auto w-full">
            <AnimatePresence mode="wait">
              {activeTab === 'dashboard' && (
                <motion.div
                  key="dashboard"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  className="space-y-6 md:space-y-10"
                >
                  <motion.div variants={itemVariants} className="lg:hidden flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <div className="space-y-0.5">
                      <h2 className="text-xl font-bold tracking-tight text-slate-900">Dashboard Utama</h2>
                      <p className="text-slate-500 text-xs">Ringkasan statistik dan tren engagement pegawai</p>
                    </div>
                  </motion.div>

                  <motion.div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6" variants={itemVariants}>
                    <StatCard 
                      title="Total Pegawai" 
                      value={stats.totalEmployees.toString()} 
                      icon={<Users2 size={20} />} 
                      color="violet" 
                    />
                    <StatCard 
                      title="Rekap Hari Ini" 
                      value={stats.todayCount.toString()} 
                      icon={<Activity size={20} />} 
                      color="emerald" 
                    />
                    <StatCard 
                      title="Total Interaksi (2 Bln)" 
                      value={stats.totalEngagements.toString()} 
                      icon={<TrendingUp size={20} />} 
                      color="sky" 
                    />
                    <StatCard 
                      title="Engagement Rate" 
                      value={`${stats.engagementRate}%`} 
                      icon={<CheckCircle2 size={20} />} 
                      color="rose" 
                    />
                  </motion.div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
                    <motion.div variants={itemVariants} className="lg:col-span-2">
                      <Card className="h-full border-slate-100/50 shadow-sm rounded-2xl overflow-hidden bg-white/80 backdrop-blur-sm">
                        <CardHeader className="p-6 border-b border-slate-50">
                          <CardTitle className="text-base font-bold">Tren Engagement (7 Hari Terakhir)</CardTitle>
                          <CardDescription className="text-xs">Perbandingan interaksi harian Instagram, Facebook & TikTok</CardDescription>
                        </CardHeader>
                        <CardContent className="p-6 h-[300px] min-h-[300px]">
                          <React.Suspense fallback={<div className="w-full h-full flex items-center justify-center bg-slate-50/50 rounded-xl text-slate-400 text-xs font-bold">Memuat Grafik...</div>}>
                            <EngagementChart data={chartData} />
                          </React.Suspense>
                        </CardContent>
                      </Card>
                    </motion.div>

                    <motion.div variants={itemVariants} className="lg:col-span-1">
                      <Card className="h-full border-slate-100/50 shadow-sm rounded-2xl overflow-hidden bg-white/80 backdrop-blur-sm">
                        <CardHeader className="p-6 border-b border-slate-50">
                          <CardTitle className="text-base font-bold">Aktivitas Terakhir</CardTitle>
                          <CardDescription className="text-xs">Riwayat pembaruan data rekap</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                          <ScrollArea className="h-[300px]">
                            <div className="divide-y divide-slate-50">
                              {dailyEngagements.slice(0, 5).map((eng, i) => (
                                <div key={i} className="p-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
                                      <CalendarIcon size={14} />
                                    </div>
                                    <div>
                                      <p className="text-xs font-bold text-slate-900">{new Date(eng.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })}</p>
                                      <p className="text-[10px] text-slate-400">{(eng.igEngagedEmployeeIds?.length || 0) + (eng.fbEngagedEmployeeIds?.length || 0)} Interaksi</p>
                                    </div>
                                  </div>
                                  <Badge variant="outline" className="text-[9px] font-bold border-slate-100 text-slate-400">Selesai</Badge>
                                </div>
                              ))}
                              {dailyEngagements.length === 0 && (
                                <div className="p-8 text-center text-slate-400 text-xs italic">Belum ada aktivitas.</div>
                              )}
                            </div>
                          </ScrollArea>
                        </CardContent>
                      </Card>
                    </motion.div>
                  </div>
                </motion.div>
              )}
               {activeTab === 'overview' && (
                <motion.div 
                  key="overview"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  className="space-y-6 md:space-y-8"
                >
                  <motion.div variants={itemVariants} className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <div className="lg:hidden space-y-0.5">
                      <h2 className="text-xl font-bold tracking-tight text-slate-900">Rekap Harian</h2>
                      <p className="text-slate-500 text-xs">Pilih tanggal pada kalender untuk mengisi atau melihat data rekapitulasi</p>
                    </div>
                    
                    <div className="flex items-center gap-4 bg-slate-50 p-1.5 rounded-xl border border-slate-100 w-full md:w-auto justify-between lg:ml-auto">
                      <Button variant="ghost" size="icon" onClick={() => changeMonth(-1)} className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0 shadow-sm">
                        <ChevronLeft size={16} />
                      </Button>
                      <div className="text-center px-4 min-w-[140px]">
                        <h2 className="text-sm font-bold text-slate-900">
                          {currentMonth.toLocaleString('id-ID', { month: 'long', year: 'numeric' })}
                        </h2>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => changeMonth(1)} className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0 shadow-sm">
                        <ChevronRight size={16} />
                      </Button>
                    </div>
                  </motion.div>

                  <motion.div variants={itemVariants} className="bg-white rounded-2xl p-4 sm:p-6 md:p-10 shadow-sm border border-slate-100">
                    <div className="flex justify-end mb-4 md:mb-6">
                      <div className="flex gap-3 md:gap-6 text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-50/50 px-3 md:px-6 py-2 md:py-3 rounded-2xl border border-slate-100 w-full md:w-auto justify-center">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full bg-slate-900 shadow-sm" /> Terisi
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full bg-white border-2 border-slate-200" /> Kosong
                        </div>
                      </div>
                    </div>

                    <div className="overflow-auto max-h-[60vh] md:max-h-[500px] pb-4">
                      <div className="min-w-[280px] sm:min-w-[500px]">
                        <div className="grid grid-cols-7 gap-1 sm:gap-2 md:gap-3">
                          {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map(day => (
                            <div key={day} className="text-center py-1 md:py-2 text-[8px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                              {day}
                            </div>
                          ))}
                          {calendarDays.map((day, idx) => (
                            <div key={idx} className="aspect-square">
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
                                    day.isFilled ? "bg-slate-900 text-white shadow-sm border-slate-900 hover:bg-slate-800" : 
                                    "bg-white text-slate-600 hover:bg-slate-50 border-slate-100"
                                  )}
                                >
                                  <span className="text-sm sm:text-base font-bold">{day.day}</span>
                                  <div className="flex gap-0.5">
                                    {day.isFilled && (
                                      <>
                                        <div className="w-1 h-1 rounded-full bg-pink-400" />
                                        <div className="w-1 h-1 rounded-full bg-blue-400" />
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
                      <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4">
                        <motion.div
                          initial={{ opacity: 0, y: '100%' }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: '100%' }}
                          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                          className="bg-white w-full max-w-xl rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[80vh]"
                        >
                          <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/20 shrink-0">
                            <div>
                              <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">Input Rekapitulasi</h3>
                              <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">{new Date(selectedDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                            </div>
                            <Button variant="ghost" size="icon" onClick={closeInputModal} className="rounded-full bg-slate-100 hover:bg-slate-200 h-9 w-9">
                              <X className="text-slate-600" size={18} />
                            </Button>
                          </div>
                          
                          <div className="p-4 sm:p-6 space-y-5 sm:space-y-6 overflow-y-auto pb-safe">
                            {/* Meta API Fetch Section */}
                            <div className="bg-rose-50/50 p-4 rounded-xl border border-rose-100 space-y-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <RefreshCw size={16} className="text-rose-500" />
                                  <h4 className="text-sm font-bold text-rose-900">Tarik Komentar via Meta API</h4>
                                </div>
                                <Badge variant="outline" className="bg-rose-100 text-rose-700 border-rose-200 text-[9px]">Otomatis</Badge>
                              </div>

                              <div className="space-y-2 relative">
                                <label className="text-[10px] font-bold text-rose-400 uppercase tracking-widest">Access Token Meta API</label>
                                <textarea 
                                  value={metaToken}
                                  onChange={(e) => setMetaToken(e.target.value)}
                                  placeholder="Paste token Meta API di sini..."
                                  className="w-full h-16 sm:h-12 px-3 pb-8 rounded-lg border border-rose-200 bg-white text-xs focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none resize-none pt-2.5"
                                />
                                <Button 
                                  onClick={handleSaveMetaToken}
                                  disabled={isSavingToken || !metaToken}
                                  variant="outline"
                                  className="absolute right-1 bottom-1 h-7 sm:h-6 px-3 sm:px-2 text-[10px] sm:text-[9px] font-bold border-rose-200 text-rose-600 hover:bg-rose-50 bg-white rounded-lg shadow-sm"
                                >
                                  {isSavingToken ? 'Saving...' : 'Simpan ke Server'}
                                </Button>
                              </div>
                              
                              <div className="flex flex-col gap-3">
                                <Button 
                                  onClick={handleFetchRecentMeta}
                                  disabled={isFetchingMeta}
                                  className="w-full h-10 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 rounded-lg shadow-sm"
                                >
                                  {isFetchingMeta ? 'Menarik...' : 'Tarik Postingan (15:00 H-1 s/d 15:00 Hari Ini)'}
                                </Button>
                              </div>
                              <p className="text-[10px] text-rose-400/80 leading-relaxed mt-3">
                                Sistem akan otomatis menarik semua komentar dari postingan Instagram yang diunggah antara jam 15:00 WIB kemarin hingga 15:00 WIB hari ini. Untuk Facebook, sistem hanya akan menarik link postingannya saja (karena batasan privasi API Meta).
                              </p>
                            </div>

                            {/* Meta Links Section */}
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <LinkIcon size={16} className="text-slate-400" />
                                  <h4 className="text-sm font-bold text-slate-700">Link Postingan Hari Ini</h4>
                                </div>
                              </div>
                              
                              <div className="space-y-3">
                                {/* Smart Link Input */}
                                <div>
                                  <textarea
                                    placeholder="Paste banyak link IG/FB sekaligus di sini (pisahkan dengan spasi atau enter)..."
                                    className="w-full h-16 p-2 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-slate-900/5 focus:border-slate-900 transition-all text-xs resize-none"
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
                                            let url = rawUrl;
                                            if (url.includes('instagram.com')) {
                                              // Ubah format reel IG menjadi format post biasa (/p/)
                                              url = url.replace(/\/(?:reel|reels)\//i, '/p/');
                                              const isDuplicate = dailyEngagements.some(d => d.igLinks?.includes(url));
                                              if (!newIg.includes(url) && !isDuplicate) newIg.push(url);
                                            } else if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com')) {
                                              // Ubah format reel FB menjadi format post biasa (/p/)
                                              if (url.match(/facebook\.com\/reel\/(\d+)/i)) {
                                                url = url.replace(/facebook\.com\/reel\/(\d+)/i, 'facebook.com/p/$1');
                                              } else if (url.match(/facebook\.com\/share\/r\/([a-zA-Z0-9]+)/i)) {
                                                url = url.replace(/facebook\.com\/share\/r\/([a-zA-Z0-9]+)/i, 'facebook.com/share/p/$1');
                                              }
                                              const isDuplicate = dailyEngagements.some(d => d.fbLinks?.includes(url));
                                              if (!newFb.includes(url) && !isDuplicate) newFb.push(url);
                                            } else if (url.includes('tiktok.com')) {
                                              const isDuplicate = dailyEngagements.some(d => d.tiktokLinks?.includes(url));
                                              if (!newTiktok.includes(url) && !isDuplicate) newTiktok.push(url);
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
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                  <Instagram size={12} className="text-pink-500" />
                                  List IG
                                </label>
                                <textarea
                                  ref={igInputRef}
                                  defaultValue={igRawInput}
                                  placeholder="Paste list nama atau username di sini..."
                                  className="w-full h-24 md:h-32 p-3 text-xs rounded-xl border border-slate-200 bg-slate-50/30 focus:ring-2 focus:ring-slate-900/5 focus:border-slate-900 transition-all resize-none"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                  <Facebook size={12} className="text-blue-500" />
                                  List FB
                                </label>
                                <textarea
                                  ref={fbInputRef}
                                  defaultValue={fbRawInput}
                                  placeholder="Paste list nama atau username di sini..."
                                  className="w-full h-24 md:h-32 p-3 text-xs rounded-xl border border-slate-200 bg-slate-50/30 focus:ring-2 focus:ring-slate-900/5 focus:border-slate-900 transition-all resize-none"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                  <TiktokIcon size={16} className="text-slate-800" />
                                  List TikTok
                                </label>
                                <textarea
                                  ref={tiktokInputRef}
                                  defaultValue={tiktokRawInput}
                                  placeholder="Paste list nama akun TikTok di sini..."
                                  className="w-full h-24 md:h-32 p-3 text-xs rounded-xl border border-slate-200 bg-slate-50/30 focus:ring-2 focus:ring-slate-900/5 focus:border-slate-900 transition-all resize-none"
                                />
                              </div>
                            </div>

                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                              <p className="text-[10px] text-slate-500 leading-relaxed">
                                <span className="font-bold text-slate-900">Tips:</span> Sistem akan otomatis mendeteksi nama atau username yang sesuai dengan database pegawai. Anda bisa langsung menempelkan (paste) data dari sumber manapun.
                              </p>
                            </div>
                          </div>

                          <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
                            <Button variant="ghost" onClick={closeInputModal} className="font-bold text-xs rounded-xl h-11 px-6">
                              Batal
                            </Button>
                            <Button 
                              onClick={handleSaveEngagement} 
                              disabled={isLoading}
                              className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl h-11 px-8 shadow-lg shadow-rose-100 border-none"
                            >
                              {isLoading ? 'Menyimpan...' : 'Simpan Data Rekap'}
                            </Button>
                          </div>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
              {activeTab === 'daily-report' && (
                <motion.div 
                  key="daily-report"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  className="space-y-6 md:space-y-8"
                >
                  <motion.div variants={itemVariants} className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-100">
                    <div className="lg:hidden space-y-0.5">
                      <h2 className="text-xl font-bold tracking-tight text-slate-900">Laporan Harian</h2>
                      <p className="text-slate-500 text-xs">Unduh dan lihat rekapitulasi engagement harian</p>
                    </div>
                    
                    <div className="flex flex-col xl:flex-row items-start xl:items-center gap-4 w-full lg:w-auto lg:ml-auto">
                      <div className="flex items-center gap-2 md:gap-4 bg-slate-50 p-1.5 rounded-xl border border-slate-100 w-full xl:w-auto justify-between">
                        <Button variant="ghost" size="icon" onClick={() => changeDailyDate(-1)} className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0 shadow-sm">
                          <ChevronLeft size={16} />
                        </Button>
                        <div className="text-center px-2 md:px-4 min-w-[160px] md:min-w-[200px]">
                          <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
                            <h2 className="text-xs sm:text-sm font-bold text-slate-900">
                              {currentDailyDate.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                            </h2>
                            {getLocalISODate(currentDailyDate) === getLocalISODate(new Date()) && (
                              <Badge variant="outline" className="bg-rose-50 text-rose-600 border-rose-200 text-[9px] px-1.5 py-0">Hari Ini</Badge>
                            )}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => changeDailyDate(1)} className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0 shadow-sm">
                          <ChevronRight size={16} />
                        </Button>
                      </div>
                              <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
                                <div className="flex bg-slate-100 p-1.5 rounded-xl w-full sm:w-auto justify-center sm:justify-start">
                                  <button 
                                    onClick={() => setWeeklySortMode('bidang')}
                                    className={cn("flex-1 sm:flex-none px-4 py-2 text-[10px] font-bold rounded-lg transition-all uppercase tracking-widest", weeklySortMode === 'bidang' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
                                  >
                                    Bidang
                                  </button>
                                  <button 
                                    onClick={() => setWeeklySortMode('name')}
                                    className={cn("flex-1 sm:flex-none px-4 py-2 text-[10px] font-bold rounded-lg transition-all uppercase tracking-widest", weeklySortMode === 'name' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
                                  >
                                    Nama
                                  </button>
                                </div>
                                <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
                                  <Button onClick={() => handleExportPDF(printDailyRef, `recaplink-harian-${getLocalISODate(currentDailyDate)}`)} disabled={isLoading} className="gap-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl h-12 shadow-lg shadow-rose-100 font-bold text-[10px] uppercase tracking-widest border-none">
                                    <FileText size={14} />
                                    PDF
                                  </Button>
                                  <Button onClick={() => handleExportImage(printDailyRef, `recaplink-harian-${getLocalISODate(currentDailyDate)}`)} disabled={isLoading} variant="outline" className="gap-2 border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl h-12 font-bold text-[10px] uppercase tracking-widest">
                                    <ImageIcon size={14} />
                                    IMG
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </motion.div>

                  <motion.div variants={itemVariants} ref={printDailyRef} className={cn("bg-white rounded-2xl shadow-sm border border-slate-100 min-h-[400px] md:min-h-[600px] flex flex-col", isExporting ? "p-3 w-max" : "p-4 sm:p-6 md:p-10")}>
                    <div className={cn("flex justify-between border-b border-slate-100 gap-2", isExporting ? "flex-row items-end mb-2 pb-2" : "flex-col md:flex-row items-start md:items-center mb-8 pb-6")}>
                      <div className={cn(isExporting ? "space-y-0 flex flex-col justify-end" : "space-y-0.5")}>
                        <h3 className={cn("font-black text-slate-900 tracking-tight uppercase", isExporting ? "text-[16px] leading-[1]" : "text-2xl")}>Laporan Harian</h3>
                        <p className={cn("font-bold text-slate-500 uppercase tracking-widest", isExporting ? "text-[8px] leading-[1] mt-1" : "text-sm")}>Rekapitulasi Engagement • {currentDailyDate.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                      </div>
                      <div className={cn("bg-slate-50 rounded-lg border border-slate-100 flex flex-col justify-center", isExporting ? "text-right p-1.5" : "text-left md:text-right p-3")}>
                        <p className={cn("font-bold text-slate-900 uppercase tracking-widest leading-none", isExporting ? "text-[8px]" : "text-[10px]")}>RecapLink</p>
                        <p className={cn("text-slate-500 leading-none", isExporting ? "text-[7px] mt-0.5" : "text-[8px] mt-1")}>Generated: {new Date().toLocaleDateString('id-ID')}</p>
                      </div>
                    </div>

                    <div className={cn("flex-1 rounded-xl border border-slate-100", !isExporting && "overflow-auto max-h-[60vh] md:max-h-[600px]")}>
                      <div className="min-w-max">
                        <Table className={cn("border-collapse", isExporting ? "w-max" : "w-full")}>
                          <TableHeader>
                            <TableRow className="bg-slate-50/50 border-b border-slate-100">
                              <TableHead className="sticky left-0 z-20 bg-slate-50 border-r border-slate-100 px-1.5 py-1 font-bold text-slate-900 whitespace-nowrap text-[10px] uppercase tracking-wider h-auto">
                                Nama Pegawai
                              </TableHead>
                              <TableHead className="border-r border-slate-100 px-1.5 py-1 font-bold text-slate-900 w-[1%] whitespace-nowrap text-[10px] uppercase tracking-wider h-auto">
                                NIP
                              </TableHead>
                              <TableHead className="border-r border-slate-100 px-1.5 py-1 font-bold text-slate-900 w-[1%] whitespace-nowrap text-[10px] uppercase tracking-wider h-auto">
                                Bidang
                              </TableHead>
                              <TableHead className="border-r border-slate-100 text-center px-1.5 py-1 text-[10px] font-bold text-slate-900 uppercase tracking-wider h-auto w-[1%] whitespace-nowrap">
                                Instagram
                              </TableHead>
                              <TableHead className="text-center px-1.5 py-1 text-[10px] font-bold text-slate-900 uppercase tracking-wider h-auto w-[1%] whitespace-nowrap">
                                Facebook
                              </TableHead>
                              <TableHead className="border-l border-slate-100 text-center px-1.5 py-1 text-[10px] font-bold text-slate-900 uppercase tracking-wider h-auto w-[1%] whitespace-nowrap">
                                TikTok
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sortedEmployees.map((emp) => {
                              const dateStr = getLocalISODate(currentDailyDate);
                              const engagement = dailyEngagementsMap[dateStr];
                              const hasIg = engagement?.igEngagedEmployeeIds?.includes(emp.id);
                              const hasFb = engagement?.fbEngagedEmployeeIds?.includes(emp.id);
                              
                              const hasIgAccount = !!emp.igUsername;
                              const hasFbAccount = !!emp.fbName;
                              const hasTiktokAccount = !!emp.tiktokName;
                              const isFuture = dateStr > getLocalISODate(new Date());
                              
                              const hasTiktok = engagement?.tiktokEngagedEmployeeIds?.includes(emp.id);
                              
                              return (
                                <TableRow key={emp.id} className="hover:bg-slate-50/30 transition-colors border-b border-slate-50">
                                  <TableCell className="sticky left-0 z-10 bg-white border-r border-slate-100 px-1.5 py-0.5 whitespace-nowrap">
                                    <div className="flex items-center gap-1.5">
                                      <p className="font-bold text-slate-800 text-[11px] whitespace-nowrap">{emp.name}</p>
                                      <div className="flex items-center gap-0.5">
                                        {hasIgAccount && <Instagram size={10} className="text-pink-500/50" />}
                                        {hasFbAccount && <Facebook size={10} className="text-blue-500/50" />}
                                        {hasTiktokAccount && <TiktokIcon size={10} className="text-slate-800/50" />}
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="border-r border-slate-100 px-1.5 py-0.5 w-[1%] whitespace-nowrap">
                                    <p className="text-slate-500 text-[11px] font-mono">{emp.nip || '-'}</p>
                                  </TableCell>
                                  <TableCell className="border-r border-slate-100 px-1.5 py-0.5 w-[1%] whitespace-nowrap">
                                    <span className={cn("text-[9px] font-mono font-bold px-1 py-0 rounded uppercase tracking-wider", getBidangColor(emp.bidang))}>
                                      {emp.bidang || '---'}
                                    </span>
                                  </TableCell>
                                  <TableCell className="border-r border-slate-50 text-center p-0 w-[1%] whitespace-nowrap">
                                    <div className="flex items-center justify-center py-0.5">
                                      {!isFuture ? (
                                        hasIg ? (
                                          <Heart size={14} className="text-pink-500" fill="currentColor" />
                                        ) : (
                                          <X size={14} className="text-red-500" strokeWidth={3} />
                                        )
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell className="border-r border-slate-50 text-center p-0 w-[1%] whitespace-nowrap">
                                    <div className="flex items-center justify-center py-0.5">
                                      {!isFuture ? (
                                        hasFb ? (
                                          <ThumbsUp size={14} className="text-blue-500" fill="currentColor" />
                                        ) : (
                                          <X size={14} className="text-red-500" strokeWidth={3} />
                                        )
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-center p-0 w-[1%] whitespace-nowrap">
                                    <div className="flex items-center justify-center py-0.5">
                                      {!isFuture ? (
                                        hasTiktok ? (
                                          <TiktokIcon size={14} className="text-slate-800" fill="currentColor" />
                                        ) : (
                                          <X size={14} className="text-red-500" strokeWidth={3} />
                                        )
                                      ) : null}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                    {isExporting && (
                      <div className="mt-2 text-[8px] text-slate-500 font-medium italic">
                        * Note : Pencatatan dilakukan setiap pukul 15.00 WIB dan hanya mencakup komentar pada postingan 24 jam terakhir.
                      </div>
                    )}
                  </motion.div>
                </motion.div>
              )}

               {activeTab === 'reports' && (
                <motion.div 
                  key="reports"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  className="space-y-6 md:space-y-8"
                >
                  <motion.div variants={itemVariants} className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-100">
                    <div className="lg:hidden space-y-0.5">
                      <h2 className="text-xl font-bold tracking-tight text-slate-900">Laporan Mingguan</h2>
                      <p className="text-slate-500 text-xs">Unduh dan lihat rekapitulasi engagement mingguan</p>
                    </div>
                    
                    <div className="flex flex-col xl:flex-row items-start xl:items-center gap-4 w-full lg:w-auto lg:ml-auto">
                      <div className="flex items-center gap-2 md:gap-4 bg-slate-50 p-1.5 rounded-xl border border-slate-100 w-full xl:w-auto justify-between">
                        <Button variant="ghost" size="icon" onClick={() => changeWeek(-1)} className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0 shadow-sm">
                          <ChevronLeft size={16} />
                        </Button>
                        <div className="text-center px-2 md:px-4 min-w-[160px] md:min-w-[200px]">
                          <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
                            <h2 className="text-xs sm:text-sm font-bold text-slate-900">Minggu ke-{weeklyReports[0]?.weekNumber}</h2>
                            {weeklyReports[0]?.isCurrentWeek && (
                              <Badge variant="outline" className="bg-rose-50 text-rose-600 border-rose-200 text-[9px] px-1.5 py-0">Sekarang</Badge>
                            )}
                          </div>
                          <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{weeklyReports[0]?.monthName} {weeklyReports[0]?.year}</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => changeWeek(1)} className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0 shadow-sm">
                          <ChevronRight size={16} />
                        </Button>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
                        <div className="flex bg-slate-100 p-1.5 rounded-xl w-full sm:w-auto justify-center sm:justify-start">
                          <button 
                            onClick={() => setWeeklySortMode('bidang')}
                            className={cn("flex-1 sm:flex-none px-4 py-2 text-[10px] font-bold rounded-lg transition-all uppercase tracking-widest", weeklySortMode === 'bidang' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
                          >
                            Bidang
                          </button>
                          <button 
                            onClick={() => setWeeklySortMode('name')}
                            className={cn("flex-1 sm:flex-none px-4 py-2 text-[10px] font-bold rounded-lg transition-all uppercase tracking-widest", weeklySortMode === 'name' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
                          >
                            Nama
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
                          <Button onClick={() => handleExportPDF(printRef, `recaplink-mingguan-${new Date().toISOString().split('T')[0]}`)} disabled={isLoading} className="gap-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl h-12 shadow-lg shadow-rose-100 font-bold text-[10px] uppercase tracking-widest border-none">
                            <FileText size={14} />
                            PDF
                          </Button>
                          <Button onClick={() => handleExportImage(printRef, `recaplink-mingguan-${new Date().toISOString().split('T')[0]}`)} disabled={isLoading} variant="outline" className="gap-2 border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl h-12 font-bold text-[10px] uppercase tracking-widest">
                            <ImageIcon size={14} />
                            IMG
                          </Button>
                        </div>
                      </div>
                    </div>
                  </motion.div>

                  <motion.div variants={itemVariants} ref={printRef} className={cn("bg-white rounded-2xl shadow-sm border border-slate-100 min-h-[400px] md:min-h-[600px] flex flex-col", isExporting ? "p-3 w-max" : "p-4 sm:p-6 md:p-10")}>
                    <div className={cn("flex justify-between border-b border-slate-100 gap-2", isExporting ? "flex-row items-end mb-2 pb-2" : "flex-col md:flex-row items-start md:items-center mb-8 pb-6")}>
                      <div className={cn(isExporting ? "space-y-0 flex flex-col justify-end" : "space-y-0.5")}>
                        <h3 className={cn("font-black text-slate-900 tracking-tight uppercase", isExporting ? "text-[16px] leading-[1]" : "text-2xl")}>Laporan Mingguan</h3>
                        <p className={cn("font-bold text-slate-500 uppercase tracking-widest", isExporting ? "text-[8px] leading-[1] mt-1" : "text-sm")}>Rekapitulasi Engagement • Minggu ke-{weeklyReports[0]?.weekNumber} • {weeklyReports[0]?.year}</p>
                      </div>
                      <div className={cn("bg-slate-50 rounded-lg border border-slate-100 flex flex-col justify-center", isExporting ? "text-right p-1.5" : "text-left md:text-right p-3")}>
                        <p className={cn("font-bold text-slate-900 uppercase tracking-widest leading-none", isExporting ? "text-[8px]" : "text-[10px]")}>RecapLink</p>
                        <p className={cn("text-slate-500 leading-none", isExporting ? "text-[7px] mt-0.5" : "text-[8px] mt-1")}>Generated: {new Date().toLocaleDateString('id-ID')}</p>
                      </div>
                    </div>

                    <div className={cn("flex-1 rounded-xl border border-slate-100", !isExporting && "overflow-auto max-h-[60vh] md:max-h-[600px]")}>
                      <div className="min-w-max">
                        <Table id="engagement-table" className={cn("border-collapse", isExporting ? "w-max" : "w-full")}>
                          <TableHeader>
                            <TableRow className="bg-slate-50/50 border-b border-slate-100">
                              <TableHead className="sticky left-0 z-20 bg-slate-50 border-r border-slate-100 px-3 py-2 font-bold text-slate-900 whitespace-nowrap text-[10px] uppercase tracking-wider">
                                Nama Pegawai
                              </TableHead>
                              {weeklyDatesList.map((date, dIdx) => (
                                <TableHead key={dIdx} className={cn(
                                  "border-r border-slate-100 text-center px-2 py-2 text-[10px] font-bold w-[1%] whitespace-nowrap",
                                  date === getLocalISODate(new Date()) ? "text-slate-900 bg-slate-100/50" : "text-slate-400"
                                )}>
                                  <div className="flex flex-col items-center">
                                    <span className="opacity-50 text-[8px]">{new Date(date).toLocaleDateString('id-ID', { weekday: 'short' })}</span>
                                    <span className="text-sm leading-tight">{new Date(date).getDate()}</span>
                                    <span className="opacity-50 text-[8px]">{new Date(date).toLocaleDateString('id-ID', { month: 'short' })}</span>
                                  </div>
                                </TableHead>
                              ))}
                              <TableHead className="border-l border-slate-100 text-center px-3 py-2 text-[10px] font-bold text-slate-900 bg-slate-50 uppercase tracking-wider w-[1%] whitespace-nowrap">
                                % ENG
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sortedEmployees.map((emp) => {
                              const isTop = weeklyStats.top3Ids?.includes(emp.id);
                              const isBottom = weeklyStats.bottom3Ids?.includes(emp.id);
                              const rowClass = isTop 
                                ? "bg-emerald-50/80 border-b border-emerald-100" 
                                : isBottom 
                                  ? "bg-red-50/80 border-b border-red-100" 
                                  : "hover:bg-slate-50/30 transition-colors border-b border-slate-50";

                              return (
                              <TableRow key={emp.id} className={rowClass}>
                                <TableCell className={cn("sticky left-0 z-10 border-r px-2 py-1 w-[1%] whitespace-nowrap",
                                  isTop ? "bg-emerald-50/80 border-emerald-100" : isBottom ? "bg-red-50/80 border-red-100" : "bg-white border-slate-100"
                                )}>
                                  <div className="flex items-center gap-2">
                                    <span className={cn("text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0", 
                                      isTop ? "bg-emerald-100 text-emerald-700" : isBottom ? "bg-red-100 text-red-700" : getBidangColor(emp.bidang)
                                    )}>
                                      {emp.bidang ? emp.bidang.substring(0, 3) : '---'}
                                    </span>
                                    <p className={cn("font-bold text-xs whitespace-nowrap shrink-0",
                                      isTop ? "text-emerald-900" : isBottom ? "text-red-900" : "text-slate-800"
                                    )}>{emp.name}</p>
                                    <div className="flex items-center gap-2 ml-2">
                                      {emp.igUsername && (
                                        <div className={cn("flex items-center gap-1 text-[9px] font-medium whitespace-nowrap", isTop ? "text-emerald-700/80" : isBottom ? "text-red-700/80" : "text-slate-500")}>
                                          <Instagram size={10} className={isTop ? "text-emerald-600" : isBottom ? "text-red-600" : "text-pink-500"} /> {emp.igUsername.length > 8 ? emp.igUsername.substring(0, 8) + '...' : emp.igUsername}
                                        </div>
                                      )}
                                      {emp.fbName && (
                                        <div className={cn("flex items-center gap-1 text-[9px] font-medium whitespace-nowrap", isTop ? "text-emerald-700/80" : isBottom ? "text-red-700/80" : "text-slate-500")}>
                                          <Facebook size={10} className={isTop ? "text-emerald-600" : isBottom ? "text-red-600" : "text-blue-500"} /> {emp.fbName.length > 8 ? emp.fbName.substring(0, 8) + '...' : emp.fbName}
                                        </div>
                                      )}
                                      {emp.tiktokName && (
                                        <div className={cn("flex items-center gap-1 text-[9px] font-medium whitespace-nowrap", isTop ? "text-emerald-700/80" : isBottom ? "text-red-700/80" : "text-slate-500")}>
                                          <TiktokIcon size={10} className={isTop ? "text-emerald-600" : isBottom ? "text-red-600" : "text-slate-800"} /> {emp.tiktokName.length > 8 ? emp.tiktokName.substring(0, 8) + '...' : emp.tiktokName}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </TableCell>
                                {weeklyDatesList.map((date, dIdx) => {
                                  const engagement = dailyEngagementsMap[date];
                                  const hasIg = engagement?.igEngagedEmployeeIds?.includes(emp.id);
                                  const hasFb = engagement?.fbEngagedEmployeeIds?.includes(emp.id);
                                  const hasTiktok = engagement?.tiktokEngagedEmployeeIds?.includes(emp.id);
                                  
                                  const todayStr = getLocalISODate(new Date());
                                  const isFuture = date > todayStr;
                                  const hasIgAccount = !!emp.igUsername;
                                  const hasFbAccount = !!emp.fbName;
                                  const hasTiktokAccount = !!emp.tiktokName;

                                  return (
                                    <TableCell key={dIdx} className="border-r border-slate-50 text-center px-1.5 py-0 w-[1%] whitespace-nowrap">
                                      <div className="flex items-center justify-center gap-1.5 py-1">
                                        {/* Instagram Indicator */}
                                        {!isFuture ? (
                                          hasIg ? <Heart size={12} className="text-pink-500" fill="currentColor" /> : <X size={12} className="text-red-500" strokeWidth={3} />
                                        ) : (
                                          <div className="w-3 h-3" />
                                        )}

                                        {/* Facebook Indicator */}
                                        {!isFuture ? (
                                          hasFb ? <ThumbsUp size={12} className="text-blue-500" fill="currentColor" /> : <X size={12} className="text-red-500" strokeWidth={3} />
                                        ) : (
                                          <div className="w-3 h-3" />
                                        )}

                                        {/* TikTok Indicator */}
                                        {!isFuture ? (
                                          hasTiktok ? <TiktokIcon size={12} className="text-slate-800" fill="currentColor" /> : <X size={12} className="text-red-500" strokeWidth={3} />
                                        ) : (
                                          <div className="w-3 h-3" />
                                        )}
                                      </div>
                                    </TableCell>
                                  );
                                })}
                                <TableCell className={cn("border-l text-center px-3 py-1 w-[1%] whitespace-nowrap",
                                  isTop ? "border-emerald-100 bg-emerald-50/50" : isBottom ? "border-red-100 bg-red-50/50" : "border-slate-100 bg-slate-50/30"
                                )}>
                                  <div className="flex flex-col items-center justify-center">
                                    <span className={cn("text-xs font-medium",
                                      isTop ? "text-emerald-600 font-bold" : isBottom ? "text-red-600 font-bold" : "text-slate-600"
                                    )}>
                                      {Math.round(((weeklyStats.employeeTotals[emp.id] || 0) / weeklyStats.maxEngagements) * 100)}%
                                    </span>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )})}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                    {isExporting && (
                      <div className="mt-2 text-[8px] text-slate-500 font-medium italic">
                        * Note : Pencatatan dilakukan setiap pukul 15.00 WIB dan hanya mencakup komentar pada postingan 24 jam terakhir.
                      </div>
                    )}
                  </motion.div>
                </motion.div>
              )}

              {activeTab === 'monthly-reports' && (
                <motion.div 
                  key="monthly-reports"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  className="space-y-6 md:space-y-8"
                >
                  <motion.div variants={itemVariants} className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-100">
                    <div className="lg:hidden space-y-0.5">
                      <h2 className="text-xl font-bold tracking-tight text-slate-900">Laporan Bulanan</h2>
                      <p className="text-slate-500 text-xs">Unduh dan lihat rekapitulasi engagement bulanan</p>
                    </div>
                    
                    <div className="flex flex-col xl:flex-row items-start xl:items-center gap-4 w-full lg:w-auto lg:ml-auto">
                      <div className="flex items-center gap-2 md:gap-4 bg-slate-50 p-1.5 rounded-xl border border-slate-100 w-full xl:w-auto justify-between">
                        <Button variant="ghost" size="icon" onClick={() => changeMonthlyReportDate(-1)} className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0 shadow-sm">
                          <ChevronLeft size={16} />
                        </Button>
                        <div className="text-center px-2 md:px-4 min-w-[160px] md:min-w-[200px]">
                          <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
                            <h2 className="text-xs sm:text-sm font-bold text-slate-900">{monthlyReports[0]?.monthName} {monthlyReports[0]?.year}</h2>
                            {monthlyReports[0]?.isCurrentMonth && (
                              <Badge variant="outline" className="bg-rose-50 text-rose-600 border-rose-200 text-[9px] px-1.5 py-0">Bulan Ini</Badge>
                            )}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => changeMonthlyReportDate(1)} className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0 shadow-sm">
                          <ChevronRight size={16} />
                        </Button>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
                        <div className="flex bg-slate-100 p-1.5 rounded-xl w-full sm:w-auto justify-center sm:justify-start">
                          <button 
                            onClick={() => setWeeklySortMode('bidang')}
                            className={cn("flex-1 sm:flex-none px-4 py-2 text-[10px] font-bold rounded-lg transition-all uppercase tracking-widest", weeklySortMode === 'bidang' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
                          >
                            Bidang
                          </button>
                          <button 
                            onClick={() => setWeeklySortMode('name')}
                            className={cn("flex-1 sm:flex-none px-4 py-2 text-[10px] font-bold rounded-lg transition-all uppercase tracking-widest", weeklySortMode === 'name' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
                          >
                            Nama
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
                          <Button onClick={() => handleExportPDF(printMonthlyRef, `recaplink-bulanan-${new Date().toISOString().split('T')[0]}`)} disabled={isLoading} className="gap-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl h-12 shadow-lg shadow-rose-100 font-bold text-[10px] uppercase tracking-widest border-none">
                            <FileText size={14} />
                            PDF
                          </Button>
                          <Button onClick={() => handleExportImage(printMonthlyRef, `recaplink-bulanan-${new Date().toISOString().split('T')[0]}`)} disabled={isLoading} variant="outline" className="gap-2 border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl h-12 font-bold text-[10px] uppercase tracking-widest">
                            <ImageIcon size={14} />
                            IMG
                          </Button>
                        </div>
                      </div>
                    </div>
                  </motion.div>

                  <motion.div variants={itemVariants} ref={printMonthlyRef} className={cn("bg-white rounded-2xl shadow-sm border border-slate-100 min-h-[400px] md:min-h-[600px] flex flex-col", isExporting ? "p-3 w-max" : "p-4 sm:p-6 md:p-10")}>
                    <div className={cn("flex justify-between border-b border-slate-100 gap-2", isExporting ? "flex-row items-end mb-2 pb-2" : "flex-col md:flex-row items-start md:items-center mb-8 pb-6")}>
                      <div className={cn(isExporting ? "space-y-0 flex flex-col justify-end" : "space-y-0.5")}>
                        <h3 className={cn("font-black text-slate-900 tracking-tight uppercase", isExporting ? "text-[16px] leading-[1]" : "text-2xl")}>Laporan Bulanan</h3>
                        <p className={cn("font-bold text-slate-500 uppercase tracking-widest", isExporting ? "text-[8px] leading-[1] mt-1" : "text-sm")}>Rekapitulasi Engagement • {monthlyReports[0]?.monthName} {monthlyReports[0]?.year}</p>
                      </div>
                      <div className={cn("bg-slate-50 rounded-lg border border-slate-100 flex flex-col justify-center", isExporting ? "text-right p-1.5" : "text-left md:text-right p-3")}>
                        <p className={cn("font-bold text-slate-900 uppercase tracking-widest leading-none", isExporting ? "text-[8px]" : "text-[10px]")}>RecapLink</p>
                        <p className={cn("text-slate-500 leading-none", isExporting ? "text-[7px] mt-0.5" : "text-[8px] mt-1")}>Generated: {new Date().toLocaleDateString('id-ID')}</p>
                      </div>
                    </div>

                    <div className={cn("flex-1 rounded-xl border border-slate-100", !isExporting && "overflow-auto max-h-[60vh] md:max-h-[600px]")}>
                      <div className="min-w-max">
                        <Table id="engagement-monthly-table" className={cn("border-collapse", isExporting ? "w-max" : "w-full")}>
                          <TableHeader>
                            <TableRow className="bg-slate-50/50 border-b border-slate-100">
                              <TableHead className="sticky left-0 z-20 bg-slate-50 border-r border-slate-100 px-3 py-3 font-bold text-slate-900 whitespace-nowrap text-xs uppercase tracking-wider">
                                Nama Pegawai
                              </TableHead>
                              <TableHead className="text-center px-4 py-3 text-xs font-bold text-slate-900 bg-slate-50 uppercase tracking-wider w-[10%] whitespace-nowrap">
                                % ENG
                              </TableHead>
                              <TableHead className="border-l border-slate-100 text-center px-4 py-3 text-xs font-bold text-slate-900 bg-slate-50 uppercase tracking-wider w-[10%] whitespace-nowrap">
                                TOTAL
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sortedEmployees.map((emp) => {
                              const isTop = monthlyStats.top3Ids?.includes(emp.id);
                              const isBottom = monthlyStats.bottom3Ids?.includes(emp.id);
                              const rowClass = isTop 
                                ? "bg-emerald-50/80 border-b border-emerald-100" 
                                : isBottom 
                                  ? "bg-red-50/80 border-b border-red-100" 
                                  : "hover:bg-slate-50/30 transition-colors border-b border-slate-50";
                                  
                              return (
                              <TableRow key={emp.id} className={rowClass}>
                                <TableCell className={cn("sticky left-0 z-10 border-r px-4 py-3 whitespace-nowrap",
                                  isTop ? "bg-emerald-50/80 border-emerald-100" : isBottom ? "bg-red-50/80 border-red-100" : "bg-white border-slate-100"
                                )}>
                                  <div className="flex items-center gap-3">
                                    <span className={cn("text-[10px] font-mono font-bold px-2 py-1 rounded uppercase tracking-wider shrink-0", 
                                      isTop ? "bg-emerald-100 text-emerald-700" : isBottom ? "bg-red-100 text-red-700" : getBidangColor(emp.bidang)
                                    )}>
                                      {emp.bidang ? emp.bidang.substring(0, 3) : '---'}
                                    </span>
                                    <p className={cn("font-bold text-sm whitespace-nowrap shrink-0",
                                      isTop ? "text-emerald-900" : isBottom ? "text-red-900" : "text-slate-800"
                                    )}>{emp.name}</p>
                                    <div className="flex items-center gap-2 ml-2">
                                      {emp.igUsername && (
                                        <div className={cn("flex items-center gap-1 text-[9px] font-medium whitespace-nowrap", isTop ? "text-emerald-700/80" : isBottom ? "text-red-700/80" : "text-slate-500")}>
                                          <Instagram size={10} className={isTop ? "text-emerald-600" : isBottom ? "text-red-600" : "text-pink-500"} /> {emp.igUsername.length > 8 ? emp.igUsername.substring(0, 8) + '...' : emp.igUsername}
                                        </div>
                                      )}
                                      {emp.fbName && (
                                        <div className={cn("flex items-center gap-1 text-[9px] font-medium whitespace-nowrap", isTop ? "text-emerald-700/80" : isBottom ? "text-red-700/80" : "text-slate-500")}>
                                          <Facebook size={10} className={isTop ? "text-emerald-600" : isBottom ? "text-red-600" : "text-blue-500"} /> {emp.fbName.length > 8 ? emp.fbName.substring(0, 8) + '...' : emp.fbName}
                                        </div>
                                      )}
                                      {emp.tiktokName && (
                                        <div className={cn("flex items-center gap-1 text-[9px] font-medium whitespace-nowrap", isTop ? "text-emerald-700/80" : isBottom ? "text-red-700/80" : "text-slate-500")}>
                                          <TiktokIcon size={10} className={isTop ? "text-emerald-600" : isBottom ? "text-red-600" : "text-slate-800"} /> {emp.tiktokName.length > 8 ? emp.tiktokName.substring(0, 8) + '...' : emp.tiktokName}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="text-center px-4 py-3 whitespace-nowrap">
                                  <div className="flex flex-col items-center justify-center">
                                    <span className={cn("font-bold text-sm",
                                      isTop ? "text-emerald-700" : isBottom ? "text-red-700" : "text-slate-600"
                                    )}>
                                      {Math.round(((monthlyStats.employeeTotals[emp.id] || 0) / monthlyStats.maxEngagements) * 100)}%
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className={cn("border-l text-center px-4 py-3 whitespace-nowrap",
                                  isTop ? "border-emerald-100" : isBottom ? "border-red-100" : "border-slate-100 bg-slate-50/30"
                                )}>
                                  <div className="flex flex-col items-center justify-center">
                                    <span className={cn("font-black text-base",
                                      isTop ? "text-emerald-600" : isBottom ? "text-red-600" : "text-slate-900"
                                    )}>
                                      {monthlyStats.employeeTotals[emp.id] || 0}
                                    </span>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )})}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                    {isExporting && (
                      <div className="mt-2 text-[8px] text-slate-500 font-medium italic">
                        * Note : Pencatatan dilakukan setiap pukul 15.00 WIB dan hanya mencakup komentar pada postingan 24 jam terakhir.
                      </div>
                    )}
                  </motion.div>
                </motion.div>
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
              <motion.div 
                key="settings"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                className="space-y-8"
              >
                <div className="bg-white rounded-[2.5rem] p-4 sm:p-10 border border-slate-100 shadow-sm">
                  <div className="lg:hidden flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center">
                      <Settings className="text-rose-600" size={24} />
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-slate-800">Pengaturan Sistem</h2>
                      <p className="text-slate-500 text-sm">Konfigurasi tambahan untuk sistem rekapitulasi.</p>
                    </div>
                  </div>
                  <p className="text-slate-400 italic">Fitur pengaturan tambahan akan segera hadir.</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
      {/* Bottom Navigation for Mobile */}
      <motion.nav 
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 25 }}
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-t border-slate-100 px-4 h-[calc(5rem+env(safe-area-inset-bottom))] pb-safe flex items-center justify-around shadow-[0_-4px_24px_rgba(0,0,0,0.02)]"
      >
        <BottomNavItem 
          active={activeTab === 'dashboard'} 
          onClick={() => setActiveTab('dashboard')} 
          icon={<LayoutDashboard size={22} />} 
          label="Home" 
        />
        <BottomNavItem 
          active={activeTab === 'overview'} 
          onClick={() => setActiveTab('overview')} 
          icon={<PlusCircle size={22} />} 
          label="Input" 
        />
        <BottomNavItem 
          active={activeTab === 'daily-report'} 
          onClick={() => setActiveTab('daily-report')} 
          icon={<FileText size={22} />} 
          label="Harian" 
        />
        <BottomNavItem 
          active={activeTab === 'reports'} 
          onClick={() => setActiveTab('reports')} 
          icon={<History size={22} />} 
          label="Mingguan" 
        />
        <BottomNavItem 
          active={activeTab === 'monthly-reports'} 
          onClick={() => setActiveTab('monthly-reports')} 
          icon={<PieChart size={22} />} 
          label="Bulanan" 
        />
      </motion.nav>

      <Toaster position="bottom-center" duration={2000} />
    </div>
  );
}

const BottomNavItem = React.memo(function BottomNavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1 w-full h-full transition-all duration-200 relative",
        active ? "text-rose-600" : "text-slate-400"
      )}
    >
      <div className={cn(
        "transition-transform duration-200",
        active ? "scale-110 -translate-y-0.5" : "scale-100"
      )}>
        {React.cloneElement(icon as React.ReactElement<any>, { size: active ? 22 : 20 })}
      </div>
      <span className={cn("text-[9px] font-bold uppercase tracking-widest line-clamp-1 leading-none text-center px-1", active ? "opacity-100" : "opacity-70")}>{label}</span>
      {active && (
        <motion.div 
          layoutId="bottom-nav-indicator"
          className="absolute -top-[1px] left-1/2 -translate-x-1/2 w-8 h-1 bg-rose-600 rounded-b-full shadow-[0_4px_12px_rgba(79,70,229,0.3)]"
        />
      )}
    </button>
  );
});

const StatCard = React.memo(function StatCard({ title, value, icon, color }: { title: string, value: string, icon: React.ReactNode, color: string }) {
  const colorMap: Record<string, string> = {
    rose: 'bg-rose-50 text-rose-500 border-rose-100/50',
    sky: 'bg-sky-50 text-sky-500 border-sky-100/50',
    violet: 'bg-violet-50 text-violet-500 border-violet-100/50',
    emerald: 'bg-emerald-50 text-emerald-500 border-emerald-100/50'
  };

  return (
    <motion.div
      whileHover={{ y: -5, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
    >
      <Card className="border-slate-100/50 shadow-sm rounded-2xl overflow-hidden group hover:shadow-md transition-all bg-white relative h-full">
        <CardContent className="p-4 md:p-6">
          <div className="flex items-center justify-between mb-3 md:mb-4">
            <motion.div 
              className={`p-2 md:p-2.5 rounded-xl ${colorMap[color]} border shrink-0 shadow-sm`}
              whileHover={{ rotate: [0, -10, 10, 0] }}
            >
              {React.cloneElement(icon as React.ReactElement<any>, { size: 18 })}
            </motion.div>
            <div className="w-1.5 h-1.5 rounded-full bg-slate-200 absolute top-4 right-4" />
          </div>
          <div className="space-y-0.5">
            <div className="text-xl md:text-2xl font-black text-slate-900 tracking-tight leading-tight">{value}</div>
            <div className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-tighter sm:tracking-wider">{title}</div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
});

const NavItem = React.memo(function NavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <motion.div
      whileTap={{ scale: 0.96 }}
    >
      <Button 
        variant="ghost" 
        className={`w-full justify-start gap-3 h-11 rounded-xl px-4 transition-all duration-300 relative overflow-hidden ${
          active 
            ? 'bg-rose-600 text-white shadow-lg shadow-rose-100' 
            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
        }`}
        onClick={onClick}
      >
        <div className={`${active ? 'text-white' : 'text-slate-400'}`}>
          {icon}
        </div>
        <span className="font-semibold text-sm tracking-tight">{label}</span>
        {active && (
          <motion.div 
            layoutId="nav-pill" 
            className="ml-auto w-1 h-1 bg-white rounded-full"
            transition={{ type: "spring", bounce: 0.4, duration: 0.6 }}
          />
        )}
      </Button>
    </motion.div>
  );
});
