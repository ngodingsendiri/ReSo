import React from 'react';
import { motion } from 'motion/react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ChevronLeft, ChevronRight, FileText, ImageIcon, Instagram, Facebook } from 'lucide-react';
import { TiktokIcon } from '../icons/TiktokIcon';
import { cn, getBidangColor } from '@/lib/utils';
import { getLocalISODate } from '../../lib/date';
import type { Employee } from '../../types';
import { containerVariants, itemVariants } from './report-variants';

interface MonthlyReportViewProps {
  monthlyReports: any[];
  monthlyStats: any;
  sortedMonthlyEmployees: Employee[];
  changeMonthlyReportDate: (offset: number) => void;
  monthlySortMode: string;
  setMonthlySortMode: (mode: 'rank' | 'bidang' | 'name') => void;
  handleExportPDF: (type: 'monthly', filename: string) => void;
  handleExportImage: (type: 'daily' | 'weekly' | 'monthly', filename: string) => void;
  printMonthlyRef: React.RefObject<HTMLDivElement | null>;
  isLoading: boolean;
  isExporting: boolean;
}

export function MonthlyReportView(props: MonthlyReportViewProps) {
  const { monthlyReports, monthlyStats, sortedMonthlyEmployees, changeMonthlyReportDate, monthlySortMode, setMonthlySortMode, handleExportPDF, handleExportImage, printMonthlyRef, isLoading, isExporting } = props;
  const mr = monthlyReports[0];
  return (
    <motion.div key="monthly-reports" variants={containerVariants} initial="hidden" animate="visible" exit="hidden" className="space-y-6 md:space-y-8">
      <motion.div variants={itemVariants} className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white p-4 md:p-5 rounded-xl border border-slate-200">
        <div className="flex flex-col xl:flex-row items-start xl:items-center gap-4 w-full lg:w-auto lg:ml-auto">
          <div className="flex items-center gap-2 md:gap-4 bg-slate-50 p-1.5 rounded-xl border border-slate-200 w-full xl:w-auto justify-between">
            <Button variant="ghost" size="icon" onClick={() => changeMonthlyReportDate(-1)} className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0"><ChevronLeft size={16} /></Button>
            <div className="text-center px-2 md:px-4 min-w-[160px] md:min-w-[200px]">
              <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
                <h2 className="text-xs sm:text-sm font-bold text-slate-900">{mr?.monthName} {mr?.year}</h2>
                {mr?.isCurrentMonth && <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0 font-semibold">Bulan ini</Badge>}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => changeMonthlyReportDate(1)} className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0"><ChevronRight size={16} /></Button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
            <div className="flex bg-slate-100 p-1.5 rounded-xl w-full sm:w-auto justify-center sm:justify-start">
              <button onClick={() => setMonthlySortMode('rank')} className={cn("flex-1 sm:flex-none px-3 py-2 text-xs font-semibold rounded-lg transition-colors", monthlySortMode === 'rank' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}>Peringkat</button>
              <button onClick={() => setMonthlySortMode('bidang')} className={cn("flex-1 sm:flex-none px-3 py-2 text-xs font-semibold rounded-lg transition-colors", monthlySortMode === 'bidang' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}>Bidang</button>
              <button onClick={() => setMonthlySortMode('name')} className={cn("flex-1 sm:flex-none px-3 py-2 text-xs font-semibold rounded-lg transition-colors", monthlySortMode === 'name' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}>Nama</button>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
              <Button onClick={() => handleExportPDF('monthly', `recaplink-bulanan-${getLocalISODate()}`)} disabled={isLoading} className="gap-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl h-10 font-bold text-xs border-none"><FileText size={14} /> PDF</Button>
              <Button onClick={() => handleExportImage('monthly', `recaplink-bulanan-${getLocalISODate()}`)} disabled={isLoading} variant="outline" className="gap-2 border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl h-10 font-bold text-xs"><ImageIcon size={14} /> Gambar</Button>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div variants={itemVariants} ref={printMonthlyRef} className={cn("bg-white rounded-xl border border-slate-200 min-h-[400px] md:min-h-[600px] flex flex-col", isExporting ? "p-3 w-max" : "p-4 sm:p-6 md:p-10")}>
        <div className={cn("flex justify-between border-b border-slate-200 gap-2", isExporting ? "flex-row items-end mb-2 pb-2" : "flex-col md:flex-row items-start md:items-center mb-6 pb-5")}>
          <div className={cn(isExporting ? "space-y-0 flex flex-col justify-end" : "space-y-0.5")}>
            <h3 className={cn("font-bold text-slate-900 tracking-tight", "text-xl")}>Laporan Bulanan</h3>
            <p className={cn("font-medium text-slate-500", "text-sm")}>{mr?.monthName} {mr?.year}</p>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <div className="flex flex-wrap items-center justify-end gap-1 md:gap-1.5">
              {monthlyStats.bidangRates?.map((br: any, idx: number) => (
                <div key={idx} className={cn("flex items-center gap-1 bg-slate-50 border border-slate-200 rounded", isExporting ? "px-1 py-0.5" : "px-1.5 py-0.5 md:px-2 md:py-1")}>
                  <span className={cn("font-semibold text-slate-500 leading-none", "text-[10px]")}>{br.bidang}</span>
                  <span className={cn("font-bold text-emerald-600 leading-none", "text-[10px]")}>{br.rate}%</span>
                </div>
              ))}
            </div>
            <div className={cn("bg-slate-50 rounded-lg border border-slate-200 flex flex-col justify-center shrink-0", isExporting ? "text-right p-1.5 h-full" : "text-left md:text-right p-3")}>
              <p className={cn("font-bold text-slate-900 leading-none", "text-[10px]")}>ReSo</p>
              <p className={cn("text-slate-500 leading-none", "text-[8px] mt-1")}>Gen: {new Date().toLocaleDateString('id-ID')}</p>
            </div>
          </div>
        </div>
        {!isExporting && (
          <div className="md:hidden space-y-2 mb-4">
            {sortedMonthlyEmployees.map((emp) => {
              const total = monthlyStats.employeeTotals[emp.id] || 0;
              const max = monthlyStats.maxEngagements || 1;
              const pct = Math.round((total / max) * 100);
              const isTop = monthlyStats.top3Ids.includes(emp.id);
              const isBottom = monthlyStats.bottom3Ids.includes(emp.id);
              const plat = monthlyStats.employeePlatformStats[emp.id];
              return (
                <div key={emp.id} className={cn('p-3 rounded-xl border', isTop ? 'bg-emerald-50/80 border-emerald-100' : isBottom ? 'bg-rose-50/50 border-rose-100' : 'bg-slate-50/50 border-slate-200')}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{emp.name}</p>
                      <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', getBidangColor(emp.bidang))}>{emp.bidang || '—'}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn('text-sm font-bold', isTop ? 'text-emerald-700' : isBottom ? 'text-rose-600' : 'text-slate-700')}>{pct}%</p>
                      <p className="text-[10px] text-slate-400">{total}/{max}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 text-[10px] font-semibold">
                    <span className="text-pink-600">IG {plat?.igPercent ?? 0}%</span>
                    <span className="text-blue-600">FB {plat?.fbPercent ?? 0}%</span>
                    <span className="text-slate-600">TT {plat?.tiktokPercent ?? 0}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className={cn("flex-1 rounded-xl border border-slate-200", !isExporting && "overflow-auto max-h-[60vh] md:max-h-[600px]", !isExporting && "hidden md:block")}>
          <div className="min-w-max">
            <Table id="engagement-monthly-table" className={cn("border-collapse", isExporting ? "w-max" : "w-full")}>
              <TableHeader>
                <TableRow className="bg-slate-50/50 border-b border-slate-200">
                  <TableHead className="sticky left-0 z-20 bg-slate-50 border-r border-slate-200 px-3 py-1.5 font-bold text-slate-900 whitespace-nowrap text-xs uppercase tracking-wider">Nama Pegawai</TableHead>
                  <TableHead className="text-center px-4 py-1.5 text-[10px] font-bold text-pink-600 bg-pink-50/50 uppercase tracking-wider w-[8%] whitespace-nowrap border-r border-slate-200"><div className="flex items-center justify-center gap-1"><Instagram size={12} /> IG</div></TableHead>
                  <TableHead className="text-center px-4 py-1.5 text-[10px] font-bold text-blue-600 bg-blue-50/50 uppercase tracking-wider w-[8%] whitespace-nowrap border-r border-slate-200"><div className="flex items-center justify-center gap-1"><Facebook size={12} /> FB</div></TableHead>
                  <TableHead className="text-center px-4 py-1.5 text-[10px] font-bold text-slate-700 bg-slate-100 uppercase tracking-wider w-[8%] whitespace-nowrap border-r border-slate-200"><div className="flex items-center justify-center gap-1"><TiktokIcon size={12} /> TT</div></TableHead>
                  <TableHead className="text-center px-4 py-1.5 text-xs font-bold text-slate-900 bg-slate-50 uppercase tracking-wider w-[10%] whitespace-nowrap border-r border-slate-200">% ENG</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedMonthlyEmployees.map((emp) => {
                  const isTop = monthlySortMode === 'rank' && monthlyStats.top3Ids?.includes(emp.id);
                  const isBottom = monthlySortMode === 'rank' && monthlyStats.bottom3Ids?.includes(emp.id);
                  const rowClass = isTop ? "bg-emerald-50/80 border-b border-emerald-200" : isBottom ? "bg-red-50/80 border-b border-red-200" : "hover:bg-slate-50/30 transition-colors border-b border-slate-50";
                  return (
                    <TableRow key={emp.id} className={rowClass}>
                      <TableCell className={cn("sticky left-0 z-10 border-r px-4 py-1.5 whitespace-nowrap", isTop ? "bg-emerald-50/80 border-emerald-200" : isBottom ? "bg-red-50/80 border-red-200" : "bg-white border-slate-200")}>
                        <div className="flex items-center gap-2">
                          <span className={cn("text-[8px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0", isTop ? "bg-emerald-100 text-emerald-700" : isBottom ? "bg-red-100 text-red-700" : getBidangColor(emp.bidang))}>{emp.bidang ? emp.bidang.substring(0, 3) : '---'}</span>
                          <p className={cn("font-bold text-xs whitespace-nowrap shrink-0", isTop ? "text-emerald-900" : isBottom ? "text-red-900" : "text-slate-800")}>{emp.name}</p>
                          <div className="flex items-center gap-1.5 ml-1">
                            {!!emp.igUsername && <div className="flex items-center gap-0.5"><Instagram size={8} className={isTop ? "text-emerald-600/50" : isBottom ? "text-red-600/50" : "text-pink-500/50"} /><span className={cn("text-[9px] font-mono", isTop ? "text-emerald-700/60" : isBottom ? "text-red-700/60" : "text-slate-400")}>{emp.igUsername.substring(0, 7)}</span></div>}
                            {!!emp.fbName && <div className="flex items-center gap-0.5"><Facebook size={8} className={isTop ? "text-emerald-600/50" : isBottom ? "text-red-600/50" : "text-blue-500/50"} /><span className={cn("text-[9px] font-mono", isTop ? "text-emerald-700/60" : isBottom ? "text-red-700/60" : "text-slate-400")}>{emp.fbName.substring(0, 7)}</span></div>}
                            {!!emp.tiktokName && <div className="flex items-center gap-0.5"><TiktokIcon size={8} className={isTop ? "text-emerald-600/50" : isBottom ? "text-red-600/50" : "text-slate-800/50"} /><span className={cn("text-[9px] font-mono", isTop ? "text-emerald-700/60" : isBottom ? "text-red-700/60" : "text-slate-400")}>{emp.tiktokName.substring(0, 7)}</span></div>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center px-4 py-1.5 whitespace-nowrap border-r border-slate-200"><span className="font-bold text-[10px] text-pink-600/80">{monthlyStats.employeePlatformStats[emp.id]?.igPercent || 0}%</span></TableCell>
                      <TableCell className="text-center px-4 py-1.5 whitespace-nowrap border-r border-slate-200"><span className="font-bold text-[10px] text-blue-600/80">{monthlyStats.employeePlatformStats[emp.id]?.fbPercent || 0}%</span></TableCell>
                      <TableCell className="text-center px-4 py-1.5 whitespace-nowrap border-r border-slate-200"><span className="font-bold text-[10px] text-slate-700/80">{monthlyStats.employeePlatformStats[emp.id]?.tiktokPercent || 0}%</span></TableCell>
                      <TableCell className="text-center px-4 py-1.5 whitespace-nowrap border-r border-slate-200"><span className={cn("font-bold text-xs", isTop ? "text-emerald-700" : isBottom ? "text-red-700" : "text-slate-600")}>{Math.round(((monthlyStats.employeeTotals[emp.id] || 0) / monthlyStats.maxEngagements) * 100)}%</span></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
        {isExporting && <div className="mt-2 text-[8px] text-slate-500 font-medium italic">* Catatan: pencatatan mengacu pada window 15.00 WIB (postingan 24 jam terakhir).</div>}
      </motion.div>
    </motion.div>
  );
}