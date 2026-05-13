import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Employee } from '../types';
import { Button, buttonVariants } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Trash2, Plus, UserPlus, Save, X, Download, Upload, FileSpreadsheet, Users, Instagram, Facebook, User, CreditCard, UserCircle, Search, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { TiktokIcon } from './icons/TiktokIcon';
import { toast } from 'sonner';
import { useAuth } from './FirebaseProvider';
import { motion, AnimatePresence } from 'motion/react';
import { cn, getBidangColor } from '@/lib/utils';
import { auth } from '../lib/firebase';

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
    <motion.tr 
      variants={itemVariants}
      whileHover={{ backgroundColor: "rgba(241, 245, 249, 0.5)" }}
      className="group transition-all border-b border-slate-50"
    >
      <TableCell className="pl-6 py-3">
        <div className="flex items-center gap-3">
          <motion.div 
            className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 font-mono font-bold text-[10px]"
            whileHover={{ scale: 1.1, rotate: 5 }}
          >
            {index + 1}
          </motion.div>
          <div className="font-bold text-slate-900 text-sm whitespace-nowrap">{emp.name}</div>
        </div>
      </TableCell>
      <TableCell>
        <span className={cn("text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider", getBidangColor(emp.bidang))}>
          {emp.bidang || 'N/A'}
        </span>
      </TableCell>
      <TableCell>
        <code className="text-[10px] bg-slate-50 px-2 py-0.5 rounded border border-slate-200 text-slate-500 font-mono">{emp.nip}</code>
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
            className="bg-white border border-slate-200 text-slate-400 hover:text-slate-900 h-8 w-8 rounded-lg transition-all "
            title="Edit"
          >
            <UserCircle size={14} />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => onDelete(emp.id)} 
            className="h-8 w-8 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-all"
            title="Hapus"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </TableCell>
    </motion.tr>
  );
});

EmployeeRow.displayName = 'EmployeeRow';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05
    }
  }
};

import { Variants } from 'motion/react';

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: {
      type: "tween",
      stiffness: 260,
      damping: 20
    }
  }
};

export default function EmployeeManager() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({ name: '', nip: '', bidang: '', igUsername: '', igUsername2: '', fbName: '', fbName2: '', tiktokName: '', tiktokName2: '' });
  const [showIg2, setShowIg2] = useState(false);
  const [showFb2, setShowFb2] = useState(false);
  const [showTiktok2, setShowTiktok2] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { user, loading } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  type SortField = 'name' | 'bidang' | 'nip';
  const [sortConfig, setSortConfig] = useState<{ field: SortField, direction: 'asc' | 'desc' } | null>({ field: 'name', direction: 'asc' });

  const filteredAndSortedEmployees = React.useMemo(() => {
    let result = [...employees];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(emp => emp.name.toLowerCase().includes(q));
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

  useEffect(() => {
    if (loading || !user) {
      setEmployees([]);
      return;
    }

    const q = query(collection(db, 'employees'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const emps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      setEmployees(emps);
    }, (error) => {
      console.error("Firestore Error:", error);
      if (user) {
        toast.error("Gagal memuat data pegawai");
      }
    });
    return unsubscribe;
  }, [user, loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.nip) {
      toast.error("Nama dan NIP wajib diisi");
      return;
    }

    try {
      if (editingId) {
        await updateDoc(doc(db, 'employees', editingId), {
          ...formData,
          updatedAt: serverTimestamp()
        });
        toast.success("Data pegawai diperbarui");
      } else {
        await addDoc(collection(db, 'employees'), {
          ...formData,
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
    setShowIg2(false);
    setShowFb2(false);
    setShowTiktok2(false);
    setIsAdding(false);
    setEditingId(null);
  };

  const confirmDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  const executeDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteDoc(doc(db, 'employees', deleteConfirmId));
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
    setShowIg2(!!emp.igUsername2);
    setShowFb2(!!emp.fbName2);
    setShowTiktok2(!!emp.tiktokName2);
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
        'Nama Profil Facebook': 'Nama Facebook',
        'Nama Profil TikTok': 'Nama Akun TikTok'
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
      'Nama Profil Facebook': emp.fbName || '',
      'Nama Profil TikTok': emp.tiktokName || ''
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
          error: (error) => {
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
    setIsUploading(true);
    
    try {
      const { writeBatch } = await import('firebase/firestore');
      
      // Split into chunks of 500 (Firestore batch limit)
      const chunks = [];
      for (let i = 0; i < data.length; i += 500) {
        chunks.push(data.slice(i, i + 500));
      }

      // Track newly added NIPs in this session to prevent duplicates inside the uploaded file itself
      const newlyAddedNips = new Map<string, any>();

      for (const chunk of chunks) {
        const batch = writeBatch(db);
        const employeesRef = collection(db, 'employees');
        let chunkCount = 0;

        for (const row of chunk) {
          // Map potential column names (Indonesian/English)
          const name = String(row.name || row['Nama Lengkap'] || row['Nama'] || '').trim();
          const nip = String(row.nip || row['NIP'] || row['Nomor Induk Pegawai'] || '').trim();
          const bidang = String(row.bidang || row['Bidang / Unit Kerja'] || row['Bidang'] || row['Unit Kerja'] || '').trim();
          const igUsername = String(row.igUsername || row['Username Instagram'] || row['Instagram'] || '').trim();
          const fbName = String(row.fbName || row['Nama Profil Facebook'] || row['Facebook'] || '').trim();
          const tiktokName = String(row.tiktokName || row['Nama Profil TikTok'] || row['TikTok'] || '').trim();

          if (name && nip) {
            // Check if it exists in the current database
            const existingEmployee = employees.find(
              emp => emp.nip === nip || emp.name.toLowerCase() === name.toLowerCase()
            );

            if (existingEmployee) {
              const docRef = doc(db, 'employees', existingEmployee.id);
              batch.set(docRef, {
                name: name,
                nip: nip,
                bidang: bidang,
                igUsername: igUsername,
                fbName: fbName,
                tiktokName: tiktokName,
                updatedAt: serverTimestamp()
              }, { merge: true });
              updatedCount++;
            } else if (newlyAddedNips.has(nip)) {
              // It's a duplicate in the same file without being in the DB yet, update the new doc reference
              const newDocRef = newlyAddedNips.get(nip);
              batch.set(newDocRef, {
                name: name,
                nip: nip,
                bidang: bidang,
                igUsername: igUsername,
                fbName: fbName,
                tiktokName: tiktokName,
                updatedAt: serverTimestamp()
              }, { merge: true });
            } else {
              // Completely new employee
              const newDocRef = doc(employeesRef);
              batch.set(newDocRef, {
                name: name,
                nip: nip,
                bidang: bidang,
                igUsername: igUsername,
                fbName: fbName,
                tiktokName: tiktokName,
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
          console.log(`Committing batch chunk with ${chunkCount} operations...`);
          await batch.commit();
        }
      }

      if (successCount > 0) {
        toast.success(`Berhasil memproses data: ${newCount} ditambahkan, ${updatedCount} diperbarui`);
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

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white p-6 rounded-xl-sm border border-slate-200">
        <div className="lg:hidden space-y-0.5">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Database Pegawai</h2>
          <p className="text-slate-500 text-xs">Kelola data pegawai untuk monitoring engagement kolektif</p>
        </div>
        <div className="flex flex-col xl:flex-row gap-4 w-full xl:w-auto xl:ml-auto">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input 
              placeholder="Cari nama pegawai..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-11 text-xs rounded-xl bg-slate-50 border-transparent focus:bg-white transition-all font-medium"
            />
          </div>
          <div className="flex flex-wrap gap-2 w-full xl:w-auto">
            <Button variant="outline" size="sm" onClick={downloadTemplate} className="flex-1 md:flex-none gap-2 rounded-xl border-slate-200 hover:bg-slate-50 text-slate-600 h-11 px-4 text-xs font-bold">
              <FileSpreadsheet size={14} className="text-emerald-600" />
              Template
            </Button>
            <Button variant="outline" size="sm" onClick={exportData} className="flex-1 md:flex-none gap-2 rounded-xl border-slate-200 hover:bg-slate-50 text-slate-600 h-11 px-4 text-xs font-bold">
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
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "w-full rounded-xl border-slate-200 hover:bg-slate-50 text-slate-600 cursor-pointer gap-2 flex items-center justify-center h-11 px-4 text-xs font-bold",
                  isUploading && "opacity-50 pointer-events-none"
                )}
              >
                <Upload size={14} className="text-rose-600" />
                {isUploading ? 'Uploading...' : 'Impor'}
              </label>
            </div>
            {!isAdding && (
              <Button 
                size="sm" 
                onClick={() => {
                  setIsAdding(true);
                  setTimeout(() => {
                    document.getElementById('employee-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 100);
                }} 
                className="w-full md:w-auto gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white  h-11 px-6 text-xs font-bold border-none transition-all active:scale-[0.98]"
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
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Nama Lengkap</label>
                      <div className="relative group">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-900 transition-colors">
                          <User size={14} />
                        </div>
                        <Input 
                          placeholder="Ahmad Subarjo" 
                          value={formData.name}
                          onChange={(e) => setFormData({...formData, name: e.target.value})}
                          className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">NIP</label>
                      <div className="relative group">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-900 transition-colors">
                          <CreditCard size={14} />
                        </div>
                        <Input 
                          placeholder="18 digit NIP" 
                          value={formData.nip}
                          onChange={(e) => setFormData({...formData, nip: e.target.value})}
                          className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Bidang / Unit Kerja</label>
                      <div className="relative group">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-900 transition-colors">
                          <Users size={14} />
                        </div>
                        <Input 
                          placeholder="Contoh: Bidang Aspirasi" 
                          value={formData.bidang}
                          onChange={(e) => setFormData({...formData, bidang: e.target.value})}
                          className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Instagram</label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative group">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-pink-500 transition-colors">
                            <Instagram size={14} />
                          </div>
                          <Input 
                            placeholder="@username (Utama)" 
                            value={formData.igUsername}
                            onChange={(e) => setFormData({...formData, igUsername: e.target.value})}
                            className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm"
                          />
                        </div>
                        {showIg2 ? (
                          <div className="relative group">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-pink-500 transition-colors">
                              <Instagram size={14} />
                            </div>
                            <Input 
                              placeholder="@username (Akun ke-2)" 
                              value={formData.igUsername2}
                              onChange={(e) => setFormData({...formData, igUsername2: e.target.value})}
                              className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm"
                            />
                            <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-slate-400 hover:text-red-500" onClick={() => { setShowIg2(false); setFormData({...formData, igUsername2: ''}); }}>
                              <X size={14} />
                            </Button>
                          </div>
                        ) : (
                          <Button type="button" variant="outline" className="h-10 border-dashed border-slate-200 text-slate-500 hover:text-slate-900 rounded-xl justify-start px-4 text-xs" onClick={() => setShowIg2(true)}>
                            <Plus size={14} className="mr-2" /> Tambah Akun Ke-2
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Facebook</label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative group">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors">
                            <Facebook size={14} />
                          </div>
                          <Input 
                            placeholder="Nama Profil FB (Utama)" 
                            value={formData.fbName}
                            onChange={(e) => setFormData({...formData, fbName: e.target.value})}
                            className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm"
                          />
                        </div>
                        {showFb2 ? (
                          <div className="relative group">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors">
                              <Facebook size={14} />
                            </div>
                            <Input 
                              placeholder="Nama Profil FB (Akun ke-2)" 
                              value={formData.fbName2}
                              onChange={(e) => setFormData({...formData, fbName2: e.target.value})}
                              className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm"
                            />
                            <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-slate-400 hover:text-red-500" onClick={() => { setShowFb2(false); setFormData({...formData, fbName2: ''}); }}>
                              <X size={14} />
                            </Button>
                          </div>
                        ) : (
                          <Button type="button" variant="outline" className="h-10 border-dashed border-slate-200 text-slate-500 hover:text-slate-900 rounded-xl justify-start px-4 text-xs" onClick={() => setShowFb2(true)}>
                            <Plus size={14} className="mr-2" /> Tambah Akun Ke-2
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">TikTok</label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative group">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-black transition-colors">
                            <TiktokIcon size={14} />
                          </div>
                          <Input 
                            placeholder="Nama Profil TikTok (Utama)" 
                            value={formData.tiktokName}
                            onChange={(e) => setFormData({...formData, tiktokName: e.target.value})}
                            className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm"
                          />
                        </div>
                        {showTiktok2 ? (
                           <div className="relative group">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-black transition-colors">
                              <TiktokIcon size={14} />
                            </div>
                            <Input 
                              placeholder="Nama Profil TikTok (Akun ke-2)" 
                              value={formData.tiktokName2}
                              onChange={(e) => setFormData({...formData, tiktokName2: e.target.value})}
                              className="rounded-xl bg-white border-slate-200 h-10 pl-10 text-sm"
                            />
                            <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-slate-400 hover:text-red-500" onClick={() => { setShowTiktok2(false); setFormData({...formData, tiktokName2: ''}); }}>
                              <X size={14} />
                            </Button>
                          </div>
                        ) : (
                          <Button type="button" variant="outline" className="h-10 border-dashed border-slate-200 text-slate-500 hover:text-slate-900 rounded-xl justify-start px-4 text-xs" onClick={() => setShowTiktok2(true)}>
                            <Plus size={14} className="mr-2" /> Tambah Akun Ke-2
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-slate-50">
                    <Button 
                      type="button" 
                      variant="ghost" 
                      onClick={resetForm} 
                      className="w-full sm:w-auto rounded-lg px-6 font-semibold text-slate-500 hover:bg-slate-50 h-10 text-sm"
                    >
                      Batal
                    </Button>
                    <Button 
                      type="submit" 
                      className="w-full sm:w-auto rounded-lg px-8 bg-slate-900 hover:bg-slate-800 text-white h-10 font-bold  transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-sm border-none"
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
            <div className="overflow-x-auto overflow-y-auto max-h-[600px]">
              <div className="min-w-[800px]">
                <Table>
                  <TableHeader className="bg-slate-50/50 sticky top-0 z-10">
                    <TableRow className="hover:bg-transparent border-slate-200">
                      <TableHead 
                        className="pl-6 py-4 font-bold text-slate-400 uppercase tracking-widest text-[10px] bg-slate-50/90 backdrop-blur-sm cursor-pointer hover:text-slate-700 select-none group transition-colors"
                        onClick={() => handleSort('name')}
                      >
                        <div className="flex items-center">
                          Pegawai <SortIcon field="name" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="font-bold text-slate-400 uppercase tracking-widest text-[10px] bg-slate-50/90 backdrop-blur-sm cursor-pointer hover:text-slate-700 select-none group transition-colors"
                        onClick={() => handleSort('bidang')}
                      >
                        <div className="flex items-center">
                          Bidang <SortIcon field="bidang" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="font-bold text-slate-400 uppercase tracking-widest text-[10px] bg-slate-50/90 backdrop-blur-sm cursor-pointer hover:text-slate-700 select-none group transition-colors"
                        onClick={() => handleSort('nip')}
                      >
                        <div className="flex items-center">
                          Identitas (NIP) <SortIcon field="nip" />
                        </div>
                      </TableHead>
                      <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[10px] bg-slate-50/90 backdrop-blur-sm">Sosial Media</TableHead>
                      <TableHead className="text-right pr-6 font-bold text-slate-400 uppercase tracking-widest text-[10px] bg-slate-50/90 backdrop-blur-sm">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <motion.tbody 
                    variants={containerVariants} 
                    initial="hidden" 
                    animate="visible"
                    className="[&_tr:last-child]:border-0"
                  >
                    {filteredAndSortedEmployees.length === 0 ? (
                      <motion.tr variants={itemVariants} className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                        <TableCell colSpan={5} className="h-48 text-center text-slate-400">
                          <div className="flex flex-col items-center gap-2">
                            <Users size={24} className="opacity-20" />
                            <p className="text-xs font-medium">Belum ada data pegawai</p>
                          </div>
                        </TableCell>
                      </motion.tr>
                    ) : (
                      filteredAndSortedEmployees.map((emp, index) => (
                          <EmployeeRow 
                            key={emp.id} 
                            emp={emp} 
                            index={index} 
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
              {filteredAndSortedEmployees.length === 0 ? (
                <div className="px-6 py-12 text-center text-slate-400 space-y-2">
                  <Users size={32} className="mx-auto opacity-20" />
                  <p className="text-xs font-medium">Belum ada data pegawai</p>
                </div>
              ) : (
                filteredAndSortedEmployees.map((emp, index) => (
                  <motion.div 
                    key={emp.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-5 space-y-4"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex gap-3 flex-1 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 font-bold text-xs shrink-0 tracking-tighter">
                          {index + 1}
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
                        <span className={cn("text-[9px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider", getBidangColor(emp.bidang))}>
                          {emp.bidang || 'N/A'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-4 pt-1">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                          <Instagram size={13} className={emp.igUsername ? "text-pink-500" : "text-slate-300"} />
                          <span className="truncate max-w-[80px]">{emp.igUsername || '-'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                          <Facebook size={13} className={emp.fbName ? "text-blue-500" : "text-slate-300"} />
                          <span className="truncate max-w-[80px]">{emp.fbName || '-'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                          <TiktokIcon size={13} className={emp.tiktokName ? "text-slate-800" : "text-slate-300"} />
                          <span className="truncate max-w-[80px]">{emp.tiktokName || '-'}</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirmId && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 10 }}
              transition={{ ease: "easeOut", duration: 0.2 }}
              className="bg-white w-full max-w-sm rounded-xl overflow-hidden"
            >
              <div className="p-8 text-center space-y-4">
                <motion.div 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.1, ease: "easeOut" }}
                  className="w-20 h-20 bg-red-50 rounded-xl flex items-center justify-center mx-auto mb-2 rotate-3"
                >
                  <Trash2 size={32} className="text-red-500" />
                </motion.div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">Hapus Pegawai?</h3>
                <p className="text-xs font-medium text-slate-400 leading-relaxed px-4">
                  Tindakan ini tidak dapat dibatalkan. Data pegawai akan dihapus secara permanen dari sistem.
                </p>
              </div>
              <div className="p-5 bg-slate-50/50 border-t border-slate-200 flex gap-3">
                <Button 
                  variant="outline" 
                  onClick={cancelDelete} 
                  className="flex-1 font-bold text-xs rounded-xl h-12 border-slate-200 hover:bg-white active:scale-[0.98] transition-all"
                >
                  Batal
                </Button>
                <Button 
                  onClick={executeDelete} 
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl h-12  border-none active:scale-[0.98] transition-all"
                >
                  Hapus
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
