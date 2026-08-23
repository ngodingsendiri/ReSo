import React from 'react';
import { motion } from 'motion/react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ChevronLeft, ChevronRight, FileText, FileSpreadsheet, ImageIcon, Heart, X, ThumbsUp, Instagram, Facebook } from 'lucide-react';
import { TiktokIcon } from '../icons/TiktokIcon';
import { cn, getBidangColor } from '@/lib/utils';
import { getLocalISODate, parseLocalISODate } from '../../lib/date';
import type { DailyEngagement, Employee } from '../../types';
import { containerVariants, itemVariants } from './report-variants';

interface WeeklyReportViewProps {
  weeklyReports: any[];
  weeklyStats: any;
  weeklyDatesList: string[];
  changeWeek: (offset: number) => void;
  weeklySortMode: string;
  setWeeklySortMode: (mode: 'bidang' | 'name') => void;
  handleExportPDF: (type: 'weekly', filename: string) => void;
  handleExportImage: (type: 'daily' | 'weekly' | 'monthly', filename: string) => void;
  handleExportExcel: (type: 'daily' | 'weekly' | 'monthly', filename: string) => void;
  canExportImage: boolean;
  printRef: React.RefObject<HTMLDivElement | null>;
  isLoading: boolean;
  sortedEmployees: Employee[];
  dailyEngagementsMap: Record<string, DailyEngagement>;
}

export function WeeklyReportView(props: WeeklyReportViewProps) {
  const { weeklyReports, weeklyStats, weeklyDatesList, changeWeek, weeklySortMode, setWeeklySortMode, handleExportPDF, handleExportImage, handleExportExcel, canExportImage, printRef, isLoading, sortedEmployees, dailyEngagementsMap } = props;
  const wr = weeklyReports[0];
  return (
    <motion.div key="reports" variants={containerVariants} initial="hidden" animate="visible" exit="hidden" className="space-y-6 md:space-y-8">
      <motion.div variants={itemVariants} className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white p-4 md:p-5 rounded-xl border border-slate-200">
        <div className="flex flex-col xl:flex-row items-start xl:items-center gap-4 w-full lg:w-auto lg:ml-auto">
          <div className="flex items-center gap-2 md:gap-4 bg-slate-50 p-1.5 rounded-xl border border-slate-200 w-full xl:w-auto justify-between">
            <Button variant="ghost" size="icon" onClick={() => changeWeek(-1)} className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0"><ChevronLeft size={16} /></Button>
            <div className="text-center px-2 md:px-4 min-w-[160px] md:min-w-[200px]">
              <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
                <h2 className="text-xs sm:text-sm font-bold text-slate-900">Minggu ke-{wr?.weekNumber}</h2>
                {wr?.isCurrentWeek && <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0 font-semibold">Minggu ini</Badge>}
              </div>
              <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{wr?.monthName} {wr?.year}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => changeWeek(1)} className="rounded-lg h-8 w-8 text-slate-600 hover:bg-white shrink-0"><ChevronRight size={16} /></Button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
            <div className="flex bg-slate-100 p-1.5 rounded-xl w-full sm:w-auto justify-center sm:justify-start">
              <button onClick={() => setWeeklySortMode('bidang')} className={cn("flex-1 sm:flex-none px-3 py-2 text-xs font-semibold rounded-lg transition-colors", weeklySortMode === 'bidang' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}>Bidang</button>
              <button onClick={() => setWeeklySortMode('name')} className={cn("flex-1 sm:flex-none px-3 py-2 text-xs font-semibold rounded-lg transition-colors", weeklySortMode === 'name' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}>Nama</button>
            </div>
            <div className="grid grid-cols-3 gap-2 w-full sm:w-auto">
              <Button onClick={() => handleExportPDF('weekly', `recaplink-mingguan-${getLocalISODate()}`)} disabled={isLoading} className="gap-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl h-10 font-bold text-xs border-none"><FileText size={14} /> PDF</Button>
              <Button onClick={() => handleExportExcel('weekly', `recaplink-mingguan-${getLocalISODate()}`)} disabled={isLoading} variant="outline" className="gap-2 border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl h-10 font-bold text-xs"><FileSpreadsheet size={14} className="text-emerald-600" /> Excel</Button>
              <Button onClick={() => handleExportImage('weekly', `recaplink-mingguan-${getLocalISODate()}`)} disabled={isLoading || !canExportImage} variant="outline" className="gap-2 border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl h-10 font-bold text-xs"><ImageIcon size={14} /> Gambar</Button>
            </div>
            {!canExportImage && (
              <p className="w-full text-[9px] text-slate-400 font-medium text-center sm:text-left">
                Export gambar dibatasi maks 60 pegawai — gunakan PDF/Excel.
              </p>
            )}
          </div>
        </div>
      </motion.div>

      <motion.div variants={itemVariants} ref={printRef} className="bg-white rounded-xl border border-slate-200 min-h-[400px] md:min-h-[600px] flex flex-col p-4 sm:p-6 md:p-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 gap-2 mb-8 pb-6">
          <div className="space-y-0.5">
            <h3 className="font-black text-slate-900 tracking-tight uppercase text-2xl">Laporan Mingguan</h3>
            <p className="font-bold text-slate-500 uppercase tracking-widest text-sm">Rekapitulasi Engagement • Minggu ke-{wr?.weekNumber} • {wr?.year}</p>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <div className="flex flex-wrap items-center justify-end gap-1 md:gap-1.5">
              {weeklyStats.bidangRates?.map((br: any, idx: number) => (
                <div key={idx} className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 md:px-2 md:py-1">
                  <span className="font-bold uppercase tracking-wider text-slate-500 leading-none text-[7px] md:text-[8px]">{br.bidang}</span>
                  <span className="font-bold text-emerald-600 leading-none text-[8px] md:text-[10px]">{br.rate}%</span>
                </div>
              ))}
            </div>
            <div className="bg-slate-50 rounded-lg border border-slate-200 flex flex-col justify-center shrink-0 text-left md:text-right p-3">
              <p className={cn("font-bold text-slate-900 uppercase tracking-widest leading-none", "text-[10px]")}>ReSo</p>
              <p className={cn("text-slate-500 leading-none", "text-[8px] mt-1")}>Gen: {new Date().toLocaleDateString('id-ID')}</p>
            </div>
          </div>
        </div>
        <div className="md:hidden space-y-2 mb-4">
            {sortedEmployees.map((emp) => {
              const total = weeklyStats.employeeTotals[emp.id] || 0;
              const max = weeklyStats.maxEngagements || 1;
              const pct = Math.round((total / max) * 100);
              const isTop = weeklyStats.top3Ids.includes(emp.id);
              const isBottom = weeklyStats.bottom3Ids.includes(emp.id);
              return (
                <div key={emp.id} className={cn('flex items-center justify-between gap-3 p-3 rounded-xl border', isTop ? 'bg-emerald-50/80 border-emerald-100' : isBottom ? 'bg-rose-50/50 border-rose-100' : 'bg-slate-50/50 border-slate-200')}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{emp.name}</p>
                    <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', getBidangColor(emp.bidang))}>{emp.bidang || '—'}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn('text-sm font-bold', isTop ? 'text-emerald-700' : isBottom ? 'text-rose-600' : 'text-slate-700')}>{pct}%</p>
                    <p className="text-[10px] text-slate-400">{total}/{max}</p>
                  </div>
                </div>
              );
            })}
          </div>

        <div className="flex-1 rounded-xl border border-slate-200 overflow-auto max-h-[60vh] md:max-h-[600px] hidden md:block">
          <div className="min-w-max">
            <Table id="engagement-table" className="border-collapse w-full">
              <TableHeader>
                <TableRow className="bg-slate-50/50 border-b border-slate-200">
                  <TableHead className="sticky left-0 z-20 bg-slate-50 border-r border-slate-200 px-3 py-2 font-bold text-slate-900 whitespace-nowrap text-[10px] uppercase tracking-wider">Nama Pegawai</TableHead>
                  {weeklyDatesList.map((date, dIdx) => (
                    <TableHead key={dIdx} className={cn("border-r border-slate-200 text-center px-2 py-2 text-[10px] font-bold w-[1%] whitespace-nowrap", date === getLocalISODate(new Date()) ? "text-slate-900 bg-slate-100/50" : "text-slate-400")}>
                      <div className="flex flex-col items-center">
                        <span className="opacity-50 text-[8px]">{parseLocalISODate(date).toLocaleDateString('id-ID', { weekday: 'short' })}</span>
                        <span className="text-sm leading-tight">{parseLocalISODate(date).getDate()}</span>
                        <span className="opacity-50 text-[8px]">{parseLocalISODate(date).toLocaleDateString('id-ID', { month: 'short' })}</span>
                      </div>
                    </TableHead>
                  ))}
                  <TableHead className="border-l border-slate-200 text-center px-3 py-2 text-[10px] font-bold text-slate-900 bg-slate-50 uppercase tracking-wider w-[1%] whitespace-nowrap">% ENG</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedEmployees.map((emp) => {
                  const isTop = weeklyStats.top3Ids?.includes(emp.id);
                  const isBottom = weeklyStats.bottom3Ids?.includes(emp.id);
                  const rowClass = isTop ? "bg-emerald-50/80 border-b border-emerald-200" : isBottom ? "bg-red-50/80 border-b border-red-200" : "hover:bg-slate-50/30 transition-colors border-b border-slate-50";
                  return (
                    <TableRow key={emp.id} className={rowClass}>
                      <TableCell className={cn("sticky left-0 z-10 border-r px-2 py-1 w-[1%] whitespace-nowrap", isTop ? "bg-emerald-50/80 border-emerald-200" : isBottom ? "bg-red-50/80 border-red-200" : "bg-white border-slate-200")}>
                        <div className="flex items-center gap-2">
                          <span className={cn("text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0", isTop ? "bg-emerald-100 text-emerald-700" : isBottom ? "bg-red-100 text-red-700" : getBidangColor(emp.bidang))}>{emp.bidang ? emp.bidang.substring(0, 3) : '---'}</span>
                          <p className={cn("font-bold text-xs whitespace-nowrap shrink-0", isTop ? "text-emerald-900" : isBottom ? "text-red-900" : "text-slate-800")}>{emp.name}</p>
                          <div className="flex items-center gap-0.5 ml-1">
                            {!!emp.igUsername && <Instagram size={10} className={isTop ? "text-emerald-600/50" : isBottom ? "text-red-600/50" : "text-pink-500/50"} />}
                            {!!emp.fbName && <Facebook size={10} className={isTop ? "text-emerald-600/50" : isBottom ? "text-red-600/50" : "text-blue-500/50"} />}
                            {!!emp.tiktokName && <TiktokIcon size={10} className={isTop ? "text-emerald-600/50" : isBottom ? "text-red-600/50" : "text-slate-800/50"} />}
                          </div>
                        </div>
                      </TableCell>
                      {weeklyDatesList.map((date, dIdx) => {
                        const e = dailyEngagementsMap[date];
                        const hasIg = e?.igEngagedEmployeeIds?.includes(emp.id);
                        const hasFb = e?.fbEngagedEmployeeIds?.includes(emp.id);
                        const hasTiktok = e?.tiktokEngagedEmployeeIds?.includes(emp.id);
                        const isFuture = date > getLocalISODate(new Date());
                        return (
                          <TableCell key={dIdx} className="border-r border-slate-50 text-center px-1.5 py-0 w-[1%] whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1.5 py-1">
                              {!isFuture ? (hasIg ? <Heart size={12} className="text-pink-500" fill="currentColor" /> : <X size={12} className="text-red-500" strokeWidth={3} />) : <div className="w-3 h-3" />}
                              {!isFuture ? (hasFb ? <ThumbsUp size={12} className="text-blue-500" fill="currentColor" /> : <X size={12} className="text-red-500" strokeWidth={3} />) : <div className="w-3 h-3" />}
                              {!isFuture ? (hasTiktok ? <TiktokIcon size={12} className="text-slate-800" fill="currentColor" /> : <X size={12} className="text-red-500" strokeWidth={3} />) : <div className="w-3 h-3" />}
                            </div>
                          </TableCell>
                        );
                      })}
                      <TableCell className={cn("border-l text-center px-3 py-1 w-[1%] whitespace-nowrap", isTop ? "border-emerald-200 bg-emerald-50/50" : isBottom ? "border-red-200 bg-red-50/50" : "border-slate-200 bg-slate-50/30")}>
                        <span className={cn("text-xs font-medium", isTop ? "text-emerald-600 font-bold" : isBottom ? "text-red-600 font-bold" : "text-slate-600")}>{Math.round(((weeklyStats.employeeTotals[emp.id] || 0) / weeklyStats.maxEngagements) * 100)}%</span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}