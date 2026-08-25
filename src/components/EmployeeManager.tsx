import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { addDoc, deleteDoc, doc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Employee } from '../types';
import { Button, buttonVariants } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Table, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Trash2, UserPlus, Save, X, Download, Upload, FileSpreadsheet, Users, Instagram, Facebook, User, CreditCard, UserCircle, Search, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { TiktokIcon } from './icons/TiktokIcon';
import { toast } from 'sonner';
import { useAuth } from './FirebaseProvider';
import { motion, AnimatePresence, type Variants } from 'motion/react';
import { cn, getBidangColor } from '@/lib/utils';
import { auth, dinasCollection, dinasDoc } from '../lib/firebase';
import { useDialogA11y } from '../hooks/useDialogA11y';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  toast.error(`Gagal: ${errInfo.error}`);
  throw new Error(JSON.stringify(errInfo));
}

const EmployeeRow = React.memo(({ emp, index, onEdit, onDelete }: { emp: Employee, index: number, onEdit: (e: Employee) => void, onDelete: (id: string) => void }) => {
  return (
    <tr className="group transition-colors border-b border-slate-50 hover:bg-slate-50/40">
      <TableCell className="pl-6 py-3">
        <div className="flex items-center gap-3">
          <motion.div 
            className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 font-mono font-bold text-[10px]"
          >
            {index + 1}
          </motion.div>
          <div className="font-bold text-slate-900 text-sm whitespace-nowrap">{emp.name}</div>
        </div>
      </TableCell>
      <TableCell>
        <span className={cn("text-[10px] font-mono font-bold px-2 py-0.5 rounded-full uppercase tracking-wider", getBidangColor(emp.bidang))}>
          {emp.bidang || 'N/A'}
        </span>
      </TableCell>
      <TableCell>
        <code className="text-[10px] bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200 text-slate-500 font-mono">{emp.nip}</code>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-3">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 w-24">
              <Instagram size={12} className={emp.igUsername ? "text-pink-500 shrink-0" : "text-slate-300 shrink-0"} />
              <span className="truncate">{emp.igUsername || '-'}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 w-24">
              <Facebook size={12} className={emp.fbName ? "text-blue-500 shrink-0" : "text-slate-300 shrink-0"} />
              <span className="truncate">{emp.fbName || '-'}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
            <TiktokIcon size={12} className={emp.tiktokName ? "text-slate-800 shrink-0" : "text-slate-300 shrink-0"} />
            <span className="truncate">{emp.tiktokName || '-'}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right pr-6">
        <div className="flex justify-end gap-1">
          <Button 
            variant="secondary" 
            size="icon" 
            onClick={() => onEdit(emp)} 
            className="bg-white border border-slate-200 text-slate-400 hover:text-slate-900 h-8 w-8 rounded-xl transition-all "
            title="Edit"
          >
            <UserCircle size={14} />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => onDelete(emp.id)} 
            className="h-8 w-8 rounded-xl hover:bg-red-50 text-slate-400 hover:text-red-600 transition-all"
            title="Hapus"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </TableCell>
    </tr>
  );
});

EmployeeRow.displayName = 'EmployeeRow';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.02
    }
  }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: {
      type: "tween",
      duration: 0.15
    }
  }
};

interface EmployeeManagerProps {
  /** Master pegawai dari listener tunggal di EngagementDashboard (anti listener ganda). */
  employees: Employee[];
}

export default function EmployeeManager({ employees }: EmployeeManagerProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({ name: '', nip: '', bidang: '', igUsername: '', igUsername2: '', fbName: '', fbName2: '', tiktokName: '', tiktokName2: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { user, db } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  type SortField = 'name' | 'bidang' | 'nip';
  const [sortConfig, setSortConfig] = useState<{ field: SortField, direction: 'asc' | 'desc' } | null>({ field: 'name', direction: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filteredAndSortedEmployees = React.useMemo(() => {
    let result = [...employees];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(emp =>
        emp.name.toLowerCase().includes(q) ||
        (emp.nip || '').toLowerCase().includes(q) ||
        (emp.bidang || '').toLowerCase().includes(q) ||
        (emp.igUsername || '').toLowerCase().includes(q) ||
        (emp.igUsername2 || '').toLowerCase().includes(q) ||
        (emp.fbName || '').toLowerCase().includes(q) ||
        (emp.fbName2 || '').toLowerCase().includes(q) ||
        (emp.tiktokName || '').toLowerCase().includes(q) ||
        (emp.tiktokName2 || '').toLowerCase().includes(q)
      );
    }
    if (sortConfig) {
      result.sort((a, b) => {
        const valA = (a[sortConfig.field] || '').toLowerCase();
        const valB = (b[sortConfig.field] || '').toLowerCase();
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [employees, searchQuery, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedEmployees.length / pageSize));
  const paginatedEmployees = React.useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredAndSortedEmployees.slice(start, start + pageSize);
  }, [filteredAndSortedEmployees, page, pageSize]);

  // Reset ke halaman 1 saat pencarian/sortir berubah.
  React.useEffect(() => {
    setPage(1);
  }, [searchQuery, sortConfig]);

  // Daftar bidang yang sudah ada (autocomplete form).
  const bidangOptions = React.useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => { if (e.bidang?.trim()) set.add(e.bidang.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'id'));
  }, [employees]);

  const handleSort = (field: SortField) => {
    setSortConfig(current => {
      if (current?.field === field) {
        return { field, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { field, direction: 'asc' };
    });
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortConfig?.field !== field) return <ArrowUpDown size={12} className="ml-1 opacity-20" />;
    return sortConfig.direction === 'asc' ? <ArrowUp size={12} className="ml-1 text-slate-900" /> : <ArrowDown size={12} className="ml-1 text-slate-900" />;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.nip) {
      toast.error("Nama dan NIP wajib diisi");
      return;
    }

    const nipTaken = employees.some(
      (emp) => emp.nip === formData.nip.trim() && emp.id !== editingId
    );
    if (nipTaken) {
      toast.error("NIP sudah terdaftar pada pegawai lain");
      return;
    }

    try {
      if (editingId) {
        await updateDoc(dinasDoc(db, user.uid, 'employees', editingId), {
          ...formData,
          name: formData.name.trim(),
          nip: formData.nip.trim(),
          updatedAt: serverTimestamp()
        });
        toast.success("Data pegawai diperbarui");
      } else {
        await addDoc(dinasCollection(db, user.uid, 'employees'), {
          ...formData,
          name: formData.name.trim(),
          nip: formData.nip.trim(),
          createdAt: serverTimestamp()
        });
        toast.success("Pegawai ditambahkan");
      }
      resetForm();
    } catch (error) {
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, 'employees');
    }
  };

  const resetForm = () => {
    setFormData({ name: '', nip: '', bidang: '', igUsername: '', igUsername2: '', fbName: '', fbName2: '', tiktokName: '', tiktokName2: '' });
    setIsAdding(false);
    setEditingId(null);
  };

  const confirmDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  const executeDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteDoc(dinasDoc(db, user.uid, 'employees', deleteConfirmId));
      toast.success("Pegawai dihapus");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'employees');
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirmId(null);
  };

  // Escape menutup konfirmasi hapus (modal di-portal, di luar jangkauan
  // handler Escape overlay di EngagementDashboard).
  React.useEffect(() => {
    if (!deleteConfirmId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDeleteConfirmId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteConfirmId]);

  const deleteModalRef = useDialogA11y<HTMLDivElement>(!!deleteConfirmId);

  const startEdit = (emp: Employee) => {
    setFormData({ 
      name: emp.name, 
      nip: emp.nip, 
      bidang: emp.bidang || '',
      igUsername: emp.igUsername || '', 
      igUsername2: emp.igUsername2 || '',
      fbName: emp.fbName || '',
      fbName2: emp.fbName2 || '',
      tiktokName: emp.tiktokName || '',
      tiktokName2: emp.tiktokName2 || ''
    });
    setEditingId(emp.id);
    setIsAdding(true);
    
    // Smooth scroll to form on mobile/desktop
    setTimeout(() => {
      const element = document.getElementById('employee-form');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 100);
  };

  const downloadTemplate = async () => {
    // Create Excel Template
    const templateData = [
      { 
        'Nama Lengkap': 'Dr. John Doe, M.Sc.', 
        'NIP': '198XXXXXXXXXXXXX', 
        'Bidang / Unit Kerja': 'Bidang Aspirasi', 
        'Username Instagram': '@username', 
        'Username Instagram 2': '@username2',
        'Nama Profil Facebook': 'Nama Facebook',
        'Nama Profil Facebook 2': 'Nama Facebook 2',
        'Nama Profil TikTok': 'Nama Akun TikTok',
        'Nama Profil TikTok 2': 'Nama Akun TikTok 2'
      }
    ];

    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template Pegawai");
    
    // Generate buffer and download
    XLSX.writeFile(workbook, "template_pegawai.xlsx");
    toast.success("Template Excel berhasil didownload");
  };

  const exportData = async () => {
    if (employees.length === 0) {
      toast.error("Tidak ada data pegawai untuk diexport");
      return;
    }

    const dataToExport = employees.slice().sort((a, b) => a.name.localeCompare(b.name)).map(emp => ({
      'Nama Lengkap': emp.name,
      'NIP': emp.nip,
      'Bidang / Unit Kerja': emp.bidang || '',
      'Username Instagram': emp.igUsername || '',
      'Username Instagram 2': emp.igUsername2 || '',
      'Nama Profil Facebook': emp.fbName || '',
      'Nama Profil Facebook 2': emp.fbName2 || '',
      'Nama Profil TikTok': emp.tiktokName || '',
      'Nama Profil TikTok 2': emp.tiktokName2 || ''
    }));

    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data Pegawai");
    
    // Generate buffer and download
    XLSX.writeFile(workbook, "data_pegawai.xlsx");
    toast.success("Data pegawai berhasil diexport");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    setIsUploading(true);

    if (fileExtension === 'csv') {
      import('papaparse').then((Papa) => {
        Papa.default.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: async (results) => {
            await processUploadedData(results.data);
            e.target.value = '';
          },
          error: () => {
            setIsUploading(false);
            toast.error("Gagal membaca file CSV");
          }
        });
      });
    } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const data = evt.target?.result;
          const XLSX = await import('xlsx');
          const wb = XLSX.read(data, { type: 'array' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const jsonData = XLSX.utils.sheet_to_json(ws);
          await processUploadedData(jsonData);
        } catch (err) {
          console.error("Excel parse error:", err);
          setIsUploading(false);
          toast.error("Gagal membaca file Excel");
        }
        e.target.value = '';
      };
      reader.readAsArrayBuffer(file);
    } else {
      setIsUploading(false);
      toast.error("Format file tidak didukung. Gunakan .csv, .xlsx, atau .xls");
    }
  };

  const processUploadedData = async (data: any[]) => {
    if (!auth.currentUser) {
      toast.error("Anda harus login untuk mengupload data");
      return;
    }

    let successCount = 0;
    let updatedCount = 0;
    let newCount = 0;
    let invalidNipCount = 0;
    setIsUploading(true);
    
    try {
      // Split into chunks of 500 (Firestore batch limit)
      const chunks = [];
      for (let i = 0; i < data.length; i += 500) {
        chunks.push(data.slice(i, i + 500));
      }

      // Track newly added NIPs in this session to prevent duplicates inside the uploaded file itself
      const newlyAddedNips = new Map<string, any>();

      for (const chunk of chunks) {
        const batch = writeBatch(db);
        const employeesRef = dinasCollection(db, user.uid, 'employees');
        let chunkCount = 0;

        // Deduplikasi NIP dalam chunk (hindari multiple writes ke doc sama dalam 1 batch)
        const uniqueByNip = new Map<string, any>();
        for (const r of chunk) {
          const n = String((r as any).nip || (r as any)['NIP'] || (r as any)['Nomor Induk Pegawai'] || '').trim();
          if (n) {
            uniqueByNip.set(n, r);
          } else {
            // Baris tanpa NIP tetap diproses terpisah (akan gagal validasi name&&nip)
            uniqueByNip.set(`__nonip_${Math.random().toString(36).slice(2)}`, r);
          }
        }

        for (const row of uniqueByNip.values()) {
          // Map potential column names (Indonesian/English)
          const name = String(row.name || row['Nama Lengkap'] || row['Nama'] || '').trim();
          const nip = String(row.nip || row['NIP'] || row['Nomor Induk Pegawai'] || '').trim();
          const bidang = String(row.bidang || row['Bidang / Unit Kerja'] || row['Bidang'] || row['Unit Kerja'] || '').trim();
          const igUsername = String(row.igUsername || row['Username Instagram'] || row['Instagram'] || '').trim();
          const igUsername2 = String(row.igUsername2 || row['Username Instagram 2'] || row['Instagram 2'] || '').trim();
          const fbName = String(row.fbName || row['Nama Profil Facebook'] || row['Facebook'] || '').trim();
          const fbName2 = String(row.fbName2 || row['Nama Profil Facebook 2'] || row['Facebook 2'] || '').trim();
          const tiktokName = String(row.tiktokName || row['Nama Profil TikTok'] || row['TikTok'] || '').trim();
          const tiktokName2 = String(row.tiktokName2 || row['Nama Profil TikTok 2'] || row['TikTok 2'] || '').trim();

          if (name && nip) {
            // Validasi format NIP (18 digit numerik) — bukan blokir, hanya warning
            // karena NIP lama/asing bisa berbeda format.
            if (!/^\d{18}$/.test(nip)) {
              invalidNipCount++;
            }
            // Optional fields: on update, skip empty so import partial tidak mengosongkan handle yang sudah ada
            const optionalFields: Record<string, string> = {};
            if (bidang) optionalFields.bidang = bidang;
            if (igUsername) optionalFields.igUsername = igUsername;
            if (igUsername2) optionalFields.igUsername2 = igUsername2;
            if (fbName) optionalFields.fbName = fbName;
            if (fbName2) optionalFields.fbName2 = fbName2;
            if (tiktokName) optionalFields.tiktokName = tiktokName;
            if (tiktokName2) optionalFields.tiktokName2 = tiktokName2;

            // Check if it exists in the current database (hanya NIP, bukan nama)
            const existingEmployee = employees.find(
              emp => emp.nip === nip
            );

            if (existingEmployee) {
              const docRef = dinasDoc(db, user.uid, 'employees', existingEmployee.id);
              batch.set(docRef, {
                name,
                nip,
                ...optionalFields,
                updatedAt: serverTimestamp()
              }, { merge: true });
              updatedCount++;
            } else if (newlyAddedNips.has(nip)) {
              const newDocRef = newlyAddedNips.get(nip);
              batch.set(newDocRef, {
                name,
                nip,
                ...optionalFields,
                updatedAt: serverTimestamp()
              }, { merge: true });
            } else {
              const newDocRef = doc(employeesRef);
              batch.set(newDocRef, {
                name,
                nip,
                bidang: bidang || '',
                igUsername: igUsername || '',
                igUsername2: igUsername2 || '',
                fbName: fbName || '',
                fbName2: fbName2 || '',
                tiktokName: tiktokName || '',
                tiktokName2: tiktokName2 || '',
                createdAt: serverTimestamp()
              });
              newlyAddedNips.set(nip, newDocRef);
              newCount++;
            }
            chunkCount++;
            successCount++;
          }
        }

        if (chunkCount > 0) {
          await batch.commit();
        }
      }

      if (successCount > 0) {
        const base = `Berhasil memproses data: ${newCount} ditambahkan, ${updatedCount} diperbarui`;
        if (invalidNipCount > 0) {
          toast.warning(`${base}. ${invalidNipCount} baris NIP bukan 18 digit numerik — periksa kembali.`);
        } else {
          toast.success(base);
        }
      } else {
        toast.error("Tidak ada data valid yang ditemukan di file");
      }
    } catch (err) {
      console.error("Batch upload error details:", err);
      handleFirestoreError(err, OperationType.WRITE, 'employees');
    } finally {
      setIsUploading(false);
    }
  };

  if (!db) return null;

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white p-4 md:p-5 rounded-xl border border-slate-200">
        <div className="flex flex-col xl:flex-row gap-4 w-full xl:w-auto xl:ml-auto">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input 
              placeholder="Cari nama pegawai..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs rounded-xl bg-slate-50 border-transparent focus:bg-white transition-all font-medium"
            />
          </div>
          <div className="flex flex-wrap gap-2 w-full xl:w-auto">
            <Button variant="outline" onClick={downloadTemplate} className="flex-1 md:flex-none gap-2 border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold">
              <FileSpreadsheet size={14} className="text-emerald-600" />
              Template
            </Button>
            <Button variant="outline" onClick={exportData} className="flex-1 md:flex-none gap-2 border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold">
              <Download size={14} className="text-blue-600" />
              Export
            </Button>
            <div className="relative flex-1 md:flex-none">
              <Input 
                type="file" 
                accept=".csv, .xlsx, .xls" 
                className="hidden" 
                id="excel-upload" 
                onChange={handleFileUpload}
                disabled={isUploading}
              />
              <label 
                htmlFor="excel-upload" 
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "w-full border-slate-200 hover:bg-slate-50 text-slate-600 cursor-pointer gap-2 flex items-center justify-center text-xs font-bold",
                  isUploading && "opacity-50 pointer-events-none"
                )}
              >
                <Upload size={14} className="text-rose-600" />
                {isUploading ? 'Mengunggah…' : 'Impor'}
              </label>
            </div>
            {!isAdding && (
              <Button 
                onClick={() => {
                  setIsAdding(true);
                  setTimeout(() => {
                    document.getElementById('employee-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 100);
                }} 
                className="w-full md:w-auto gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold"
              >
                <UserPlus size={14} />
                Tambah
              </Button>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {isAdding && (
          <motion.div
            id="employee-form"
            initial={{ opacity: 0, height: 0, y: -20 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -20 }}
            transition={{ ease: "easeOut", duration: 0.2 }}
            className="overflow-hidden"
          >
            <Card className="rounded-xl border-slate-200  overflow-hidden bg-white">
              <CardHeader className="bg-slate-50/50 border-b border-slate-200 p-6">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      {editingId ? <Save className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                      {editingId ? 'Edit Data Pegawai' : 'Tambah Pegawai Baru'}
                    </CardTitle>
                    <p className="text-slate-500 text-xs mt-0.5">Lengkapi informasi pegawai di bawah ini</p>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={resetForm} 
                    className="rounded-full hover:bg-slate-100 text-slate-400 h-8 w-8"
                  >
                    <X size={18} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 ml-1">Nama Lengkap</label>
                      <div className="relative group">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-900 transition-colors">
                          <User size={14} />
                        </div>
                        <Input 
                          placeholder="Ahmad Subarjo" 
                          value={formData.name}
                          onChange={(e) => setFormData({...formData, name: e.target.value})}
                          className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm focus-visible:ring-1 focus-visible:ring-slate-300"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 ml-1">NIP</label>
                      <div className="relative group">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-900 transition-colors">
                          <CreditCard size={14} />
                        </div>
                        <Input 
                          placeholder="18 digit NIP" 
                          value={formData.nip}
                          onChange={(e) => setFormData({...formData, nip: e.target.value})}
                          className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm focus-visible:ring-1 focus-visible:ring-slate-300"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 ml-1">Bidang / Unit Kerja</label>
                      <div className="relative group">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-900 transition-colors">
                          <Users size={14} />
                        </div>
                        <input
                          list="bidang-options"
                          placeholder="Cari atau ketik bidang baru..."
                          value={formData.bidang}
                          onChange={(e) => setFormData({...formData, bidang: e.target.value})}
                          className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 pl-10 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <datalist id="bidang-options">
                          {bidangOptions.map((b) => <option key={b} value={b} />)}
                        </datalist>
                      </div>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 ml-1">
                        Instagram <span className="text-[9px] font-normal text-slate-400 normal-case">(utama & ke-2)</span>
                      </label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative group">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-pink-500 transition-colors">
                            <Instagram size={14} />
                          </div>
                          <Input 
                            placeholder="@username (Utama)" 
                            value={formData.igUsername}
                            onChange={(e) => setFormData({...formData, igUsername: e.target.value})}
                            className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm focus-visible:ring-1 focus-visible:ring-pink-200"
                          />
                        </div>
                        <div className="relative group">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-pink-500 transition-colors">
                            <Instagram size={14} />
                          </div>
                          <Input 
                            placeholder="@username (Akun ke-2)" 
                            value={formData.igUsername2}
                            onChange={(e) => setFormData({...formData, igUsername2: e.target.value})}
                            className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm focus-visible:ring-1 focus-visible:ring-pink-200"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 ml-1">
                        Facebook <span className="text-[9px] font-normal text-slate-400 normal-case">(utama & ke-2)</span>
                      </label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative group">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors">
                            <Facebook size={14} />
                          </div>
                          <Input 
                            placeholder="Nama Profil FB (Utama)" 
                            value={formData.fbName}
                            onChange={(e) => setFormData({...formData, fbName: e.target.value})}
                            className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm focus-visible:ring-1 focus-visible:ring-blue-200"
                          />
                        </div>
                        <div className="relative group">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors">
                            <Facebook size={14} />
                          </div>
                          <Input 
                            placeholder="Nama Profil FB (Akun ke-2)" 
                            value={formData.fbName2}
                            onChange={(e) => setFormData({...formData, fbName2: e.target.value})}
                            className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm focus-visible:ring-1 focus-visible:ring-blue-200"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 ml-1">
                        TikTok <span className="text-[9px] font-normal text-slate-400 normal-case">(utama & ke-2)</span>
                      </label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative group">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-800 transition-colors">
                            <TiktokIcon size={14} />
                          </div>
                          <Input 
                            placeholder="Nama Profil TikTok (Utama)" 
                            value={formData.tiktokName}
                            onChange={(e) => setFormData({...formData, tiktokName: e.target.value})}
                            className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm focus-visible:ring-1 focus-visible:ring-slate-300"
                          />
                        </div>
                        <div className="relative group">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-800 transition-colors">
                            <TiktokIcon size={14} />
                          </div>
                          <Input 
                            placeholder="Nama Profil TikTok (Akun ke-2)" 
                            value={formData.tiktokName2}
                            onChange={(e) => setFormData({...formData, tiktokName2: e.target.value})}
                            className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm focus-visible:ring-1 focus-visible:ring-slate-300"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-slate-50">
                    <Button 
                      type="button" 
                      variant="ghost" 
                      onClick={resetForm} 
                      className="w-full sm:w-auto px-6 font-semibold text-slate-500 hover:bg-slate-50"
                    >
                      Batal
                    </Button>
                    <Button 
                      type="submit" 
                      className="w-full sm:w-auto px-8 bg-slate-900 hover:bg-slate-800 text-white font-bold flex items-center justify-center gap-2"
                    >
                      <Save size={16} />
                      {editingId ? 'Simpan Perubahan' : 'Simpan Pegawai'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="rounded-xl border-slate-200  overflow-hidden bg-white">
        <CardContent className="p-0">
          {/* Desktop Table - Hidden on small screens */}
          <div className="hidden md:block">
            <div className="overflow-x-auto overflow-y-auto">
              <div className="min-w-[800px]">
                <Table>
                  <TableHeader className="bg-slate-50/50 sticky top-0 z-10">
                    <TableRow className="hover:bg-transparent border-slate-200">
                      <TableHead 
                        className="pl-6 py-4 font-bold text-slate-400 uppercase tracking-widest text-[10px] bg-slate-50 cursor-pointer hover:text-slate-700 select-none group transition-colors"
                        onClick={() => handleSort('name')}
                      >
                        <div className="flex items-center">
                          Pegawai <SortIcon field="name" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="font-bold text-slate-400 uppercase tracking-widest text-[10px] bg-slate-50 cursor-pointer hover:text-slate-700 select-none group transition-colors"
                        onClick={() => handleSort('bidang')}
                      >
                        <div className="flex items-center">
                          Bidang <SortIcon field="bidang" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="font-bold text-slate-400 uppercase tracking-widest text-[10px] bg-slate-50 cursor-pointer hover:text-slate-700 select-none group transition-colors"
                        onClick={() => handleSort('nip')}
                      >
                        <div className="flex items-center">
                          Identitas (NIP) <SortIcon field="nip" />
                        </div>
                      </TableHead>
                      <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[10px] bg-slate-50">Sosial Media</TableHead>
                      <TableHead className="text-right pr-6 font-bold text-slate-400 uppercase tracking-widest text-[10px] bg-slate-50">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <motion.tbody 
                    variants={containerVariants} 
                    initial="hidden" 
                    animate="visible"
                    className="[&_tr:last-child]:border-0"
                  >
                    {paginatedEmployees.length === 0 ? (
                      <motion.tr variants={itemVariants} className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                        <TableCell colSpan={5} className="h-48 text-center text-slate-400">
                          <div className="flex flex-col items-center gap-2">
                            <Users size={24} className="opacity-20" />
                            <p className="text-xs font-medium">Belum ada data pegawai</p>
                          </div>
                        </TableCell>
                      </motion.tr>
                    ) : (
                      paginatedEmployees.map((emp, index) => (
                          <EmployeeRow 
                            key={emp.id} 
                            emp={emp} 
                            index={(page - 1) * pageSize + index + 1} 
                            onEdit={startEdit} 
                            onDelete={confirmDelete}
                          />
                      ))
                    )}
                  </motion.tbody>
                </Table>
              </div>
            </div>
          </div>

          {/* Mobile Card Layout - Shown on small screens */}
          <div className="md:hidden">
            <div className="divide-y divide-slate-100">
              {paginatedEmployees.length === 0 ? (
                <div className="px-6 py-12 text-center text-slate-400 space-y-2">
                  <Users size={32} className="mx-auto opacity-20" />
                  <p className="text-xs font-medium">Belum ada data pegawai</p>
                </div>
              ) : (
                paginatedEmployees.map((emp, index) => (
                  <motion.div 
                    key={emp.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-5 space-y-4"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex gap-3 flex-1 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 font-bold text-xs shrink-0 tracking-tighter">
                          {(page - 1) * pageSize + index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-slate-900 text-sm whitespace-normal line-clamp-2 leading-tight">{emp.name}</h4>
                          <code className="text-[10px] text-slate-400 font-mono mt-1 block truncate">{emp.nip}</code>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button 
                          variant="secondary" 
                          size="icon" 
                          onClick={() => startEdit(emp)} 
                          className={cn(
                            "h-10 w-10 rounded-xl transition-all active:scale-95",
                            editingId === emp.id ? "bg-slate-900 text-white " : "bg-white border border-slate-200 text-slate-500"
                          )}
                          title="Edit"
                        >
                          <UserCircle size={18} />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => confirmDelete(emp.id)}
                          className="h-10 w-10 rounded-xl hover:bg-red-50 text-slate-400 hover:text-red-600 active:scale-90 transition-transform"
                        >
                          <Trash2 size={18} />
                        </Button>
                      </div>
                    </div>
                    
                    <div className="flex flex-col gap-2 pt-2 border-t border-slate-50 mt-2">
                      <div className="flex">
                        <span className={cn("text-[9px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider", getBidangColor(emp.bidang))}>
                          {emp.bidang || 'N/A'}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1.5 pt-1">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                          <Instagram size={13} className={emp.igUsername || emp.igUsername2 ? "text-pink-500 shrink-0" : "text-slate-300 shrink-0"} />
                          <span className="truncate">{emp.igUsername || '-'}{emp.igUsername2 ? ` · ${emp.igUsername2}` : ''}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                          <Facebook size={13} className={emp.fbName || emp.fbName2 ? "text-blue-500 shrink-0" : "text-slate-300 shrink-0"} />
                          <span className="truncate">{emp.fbName || '-'}{emp.fbName2 ? ` · ${emp.fbName2}` : ''}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                          <TiktokIcon size={13} className={emp.tiktokName || emp.tiktokName2 ? "text-slate-800 shrink-0" : "text-slate-300 shrink-0"} />
                          <span className="truncate">{emp.tiktokName || '-'}{emp.tiktokName2 ? ` · ${emp.tiktokName2}` : ''}</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>

          {/* Pagination */}
          {filteredAndSortedEmployees.length > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-t border-slate-100 flex-wrap">
              <p className="text-[11px] text-slate-500 font-medium">
                Menampilkan {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredAndSortedEmployees.length)} dari {filteredAndSortedEmployees.length} pegawai
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="h-8 rounded-xl border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 px-2 focus:outline-none focus:ring-1 focus:ring-slate-300"
                  title="Jumlah per halaman"
                >
                  {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / hal</option>)}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="h-8 rounded-xl text-[11px] font-bold border-slate-200 text-slate-600"
                >
                  Sebelumnya
                </Button>
                <span className="text-[11px] font-bold text-slate-500 px-1">Hal {page} / {totalPages}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="h-8 rounded-xl text-[11px] font-bold border-slate-200 text-slate-600"
                >
                  Berikutnya
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Modal — di-portal ke body supaya tidak ter-clip
          oleh transform/overflow ancestor (animasi tab motion). */}
      {createPortal(
        <AnimatePresence>
          {deleteConfirmId && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
              onClick={cancelDelete}
              role="presentation"
            >
              <motion.div
                ref={deleteModalRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-pegawai-title"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ ease: "easeOut", duration: 0.18 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white w-full max-w-sm rounded-xl border border-slate-200 overflow-hidden shadow-lg"
              >
                <div className="p-6 text-center space-y-3">
                  <div className="w-14 h-14 bg-rose-50 rounded-xl flex items-center justify-center mx-auto">
                    <Trash2 size={24} className="text-rose-600" />
                  </div>
                  <h3 id="delete-pegawai-title" className="text-lg font-bold text-slate-900 tracking-tight">Hapus pegawai?</h3>
                  <p className="text-xs font-medium text-slate-500 leading-relaxed px-2">
                    Tindakan ini tidak bisa dibatalkan. Data pegawai dihapus permanen dari sistem.
                  </p>
                </div>
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-2">
                  <Button 
                    variant="outline" 
                    onClick={cancelDelete} 
                    className="flex-1 font-bold text-xs rounded-xl"
                  >
                    Batal
                  </Button>
                  <Button 
                    onClick={executeDelete} 
                    variant="destructive"
                    className="flex-1 font-bold text-xs rounded-xl"
                  >
                    Hapus
                  </Button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
