import React from 'react';
import { motion } from 'motion/react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Heart, X, ThumbsUp, Instagram, Facebook } from 'lucide-react';
import { ReportControls } from './ReportControls';
import { TiktokIcon } from '../icons/TiktokIcon';
import { cn, getBidangColor } from '@/lib/utils';
import { getLocalISODate } from '../../lib/date';
import type { DailyEngagement, Employee } from '../../types';
import { containerVariants, itemVariants } from './report-variants';

interface DailyReportViewProps {
  currentDailyDate: Date;
  changeDailyDate: (offset: number) => void;
  weeklySortMode: string;
  setWeeklySortMode: (mode: 'bidang' | 'name') => void;
  handleExportPDF: (type: 'daily' | 'weekly' | 'monthly', filename: string) => void;
  handleExportImage: (type: 'daily' | 'weekly' | 'monthly', filename: string) => void;
  handleExportExcel: (type: 'daily' | 'weekly' | 'monthly', filename: string) => void;
  canExportImage: boolean;
  printDailyRef: React.RefObject<HTMLDivElement | null>;
  isLoading: boolean;
  sortedEmployees: Employee[];
  dailyEngagementsMap: Record<string, DailyEngagement>;
  dailyEngagementRate: number;
}

export function DailyReportView({
  currentDailyDate,
  changeDailyDate,
  weeklySortMode,
  setWeeklySortMode,
  handleExportPDF,
  handleExportImage,
  handleExportExcel,
  canExportImage,
  printDailyRef,
  isLoading,
  sortedEmployees,
  dailyEngagementsMap,
  dailyEngagementRate,
}: DailyReportViewProps) {
  const dateStr = getLocalISODate(currentDailyDate);
  return (
    <motion.div
      key="daily-report"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      className="space-y-6 md:space-y-8"
    >
      <motion.div variants={itemVariants} className="hidden lg:flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Laporan Harian</h1>
          <p className="text-xs text-slate-500 mt-0.5">Rekapitulasi engagement per pegawai</p>
        </div>
      </motion.div>

      <ReportControls
        title={currentDailyDate.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        currentBadge={dateStr === getLocalISODate(new Date()) ? 'Hari ini' : null}
        onPrev={() => changeDailyDate(-1)}
        onNext={() => changeDailyDate(1)}
        sortOptions={[
          { value: 'bidang', label: 'Bidang' },
          { value: 'name', label: 'Nama' },
        ]}
        activeSort={weeklySortMode}
        onSortChange={(v) => setWeeklySortMode(v as 'bidang' | 'name')}
        onExportPdf={() => handleExportPDF('daily', `recaplink-harian-${dateStr}`)}
        onExportExcel={() => handleExportExcel('daily', `recaplink-harian-${dateStr}`)}
        onExportImage={() => handleExportImage('daily', `recaplink-harian-${dateStr}`)}
        canExportImage={canExportImage}
        isLoading={isLoading}
      />

      <motion.div variants={itemVariants} ref={printDailyRef} className="bg-white rounded-xl border border-slate-200 min-h-[400px] md:min-h-[600px] flex flex-col p-4 sm:p-6 md:p-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 gap-2 mb-8 pb-6">
          <div className="space-y-0.5">
            <h3 className="font-black text-slate-900 tracking-tight uppercase text-2xl">Laporan Harian</h3>
            <p className="font-bold text-slate-500 uppercase tracking-widest text-sm">Rekapitulasi Engagement • {currentDailyDate.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
          <div className="flex items-center bg-slate-50 rounded-lg border border-slate-200 p-3 gap-4">
            <div className="flex flex-col items-end justify-center">
              <p className="font-black text-emerald-600 leading-none text-[18px]">{dailyEngagementRate}%</p>
              <p className="font-bold text-slate-500 uppercase tracking-widest leading-none text-[8px] mt-1">Rate</p>
            </div>
            <div className="w-px bg-slate-200 h-7"></div>
            <div className="flex flex-col justify-center text-right">
              <p className="font-bold text-slate-900 uppercase tracking-widest leading-none text-[10px]">ReSo</p>
              <p className="text-slate-500 leading-none text-[8px] mt-1">Gen: {new Date().toLocaleDateString('id-ID')}</p>
            </div>
          </div>
        </div>

        <div className="md:hidden space-y-2 mb-4">
            {sortedEmployees.map((emp) => {
              const engagement = dailyEngagementsMap[dateStr];
              const hasIg = engagement?.igEngagedEmployeeIds?.includes(emp.id);
              const hasFb = engagement?.fbEngagedEmployeeIds?.includes(emp.id);
              const hasTiktok = engagement?.tiktokEngagedEmployeeIds?.includes(emp.id);
              const score = (hasIg ? 1 : 0) + (hasFb ? 1 : 0) + (hasTiktok ? 1 : 0);
              return (
                <div key={emp.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/50">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{emp.name}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                      <span className={cn('font-medium px-1.5 py-0.5 rounded text-[10px]', getBidangColor(emp.bidang))}>
                        {emp.bidang || '—'}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold border', hasIg ? 'bg-pink-50 text-pink-600 border-pink-100' : 'bg-white text-slate-300 border-slate-200')}>IG</span>
                    <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold border', hasFb ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-white text-slate-300 border-slate-200')}>FB</span>
                    <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold border', hasTiktok ? 'bg-slate-200 text-slate-800 border-slate-300' : 'bg-white text-slate-300 border-slate-200')}>TT</span>
                    <span className="text-xs font-bold text-slate-600 w-6 text-right">{score}/3</span>
                  </div>
                </div>
              );
            })}
            {sortedEmployees.length === 0 && (
              <p className="text-center text-sm text-slate-400 py-8">Belum ada data pegawai.</p>
            )}
          </div>

        <div className="flex-1 rounded-xl border border-slate-200 overflow-auto max-h-[60vh] md:max-h-[600px] hidden md:block">
          <div className="min-w-max">
            <Table className="border-collapse w-full">
              <TableHeader>
                <TableRow className="bg-slate-50/50 border-b border-slate-200">
                  <TableHead className="sticky left-0 z-20 bg-slate-50 border-r border-slate-200 px-1.5 py-1 font-bold text-slate-900 whitespace-nowrap text-[10px] uppercase tracking-wider h-auto">Nama Pegawai</TableHead>
                  <TableHead className="border-r border-slate-200 px-1.5 py-1 font-bold text-slate-900 w-[1%] whitespace-nowrap text-[10px] uppercase tracking-wider h-auto">NIP</TableHead>
                  <TableHead className="border-r border-slate-200 px-1.5 py-1 font-bold text-slate-900 w-[1%] whitespace-nowrap text-[10px] uppercase tracking-wider h-auto">Bidang</TableHead>
                  <TableHead className="border-r border-slate-200 text-center px-1.5 py-1 text-[10px] font-bold text-slate-900 uppercase tracking-wider h-auto w-[1%] whitespace-nowrap">Instagram</TableHead>
                  <TableHead className="text-center px-1.5 py-1 text-[10px] font-bold text-slate-900 uppercase tracking-wider h-auto w-[1%] whitespace-nowrap">Facebook</TableHead>
                  <TableHead className="border-l border-slate-200 text-center px-1.5 py-1 text-[10px] font-bold text-slate-900 uppercase tracking-wider h-auto w-[1%] whitespace-nowrap">TikTok</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j} className="border-b border-slate-50 px-2 py-2.5">
                          <div className="h-3 rounded bg-slate-100 animate-pulse" style={{ width: j === 0 ? 120 : j === 1 ? 80 : j === 2 ? 60 : 24 }} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : sortedEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center">
                      <p className="text-sm font-semibold text-slate-500">Belum ada data pegawai</p>
                      <p className="text-[11px] text-slate-400 mt-1">Tambahkan pegawai di menu Data Pegawai</p>
                    </TableCell>
                  </TableRow>
                ) : (
                sortedEmployees.map((emp) => {
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
                      <TableCell className="sticky left-0 z-10 bg-white border-r border-slate-200 px-1.5 py-0.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <p className="font-bold text-slate-800 text-[11px] whitespace-nowrap">{emp.name}</p>
                          <div className="flex items-center gap-0.5">
                            {hasIgAccount && <Instagram size={10} className="text-pink-500/50" />}
                            {hasFbAccount && <Facebook size={10} className="text-blue-500/50" />}
                            {hasTiktokAccount && <TiktokIcon size={10} className="text-slate-800/50" />}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="border-r border-slate-200 px-1.5 py-0.5 w-[1%] whitespace-nowrap">
                        <p className="text-slate-500 text-[11px] font-mono">{emp.nip || '-'}</p>
                      </TableCell>
                      <TableCell className="border-r border-slate-200 px-1.5 py-0.5 w-[1%] whitespace-nowrap">
                        <span className={cn("text-[9px] font-mono font-bold px-1 py-0 rounded uppercase tracking-wider", getBidangColor(emp.bidang))}>
                          {emp.bidang || '---'}
                        </span>
                      </TableCell>
                      <TableCell className="border-r border-slate-50 text-center p-0 w-[1%] whitespace-nowrap">
                        <div className="flex items-center justify-center py-0.5">
                          {!isFuture ? (hasIg ? <Heart size={14} className="text-pink-500" fill="currentColor" /> : <X size={14} className="text-red-500" strokeWidth={3} />) : null}
                        </div>
                      </TableCell>
                      <TableCell className="border-r border-slate-50 text-center p-0 w-[1%] whitespace-nowrap">
                        <div className="flex items-center justify-center py-0.5">
                          {!isFuture ? (hasFb ? <ThumbsUp size={14} className="text-blue-500" fill="currentColor" /> : <X size={14} className="text-red-500" strokeWidth={3} />) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-center p-0 w-[1%] whitespace-nowrap">
                        <div className="flex items-center justify-center py-0.5">
                          {!isFuture ? (hasTiktok ? <TiktokIcon size={14} className="text-slate-800" fill="currentColor" /> : <X size={14} className="text-red-500" strokeWidth={3} />) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
