import React from 'react';
import { motion } from 'motion/react';
import { Users2, Activity, TrendingUp, CheckCircle2, Calendar as CalendarIcon, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { DailyEngagement } from '../../types';
import { parseLocalISODate } from '../../lib/date';

const EngagementChart = React.lazy(() => import('../EngagementChart'));

const containerVariants: import('motion/react').Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.02 }
  }
};

const itemVariants: import('motion/react').Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'tween', ease: 'easeOut', duration: 0.18 }
  }
};

export type DashboardStats = {
  totalEmployees: number;
  todayCount: number;
  totalEngagements: number;
  engagementRate: number;
};

export type ChartPoint = {
  name: string;
  ig: number;
  fb: number;
  tiktok: number;
  total: number;
};

export const DashboardTab = ({
  stats,
  chartData,
  dailyEngagements,
  onGoInput,
}: {
  stats: DashboardStats;
  chartData: ChartPoint[];
  dailyEngagements: DailyEngagement[];
  onGoInput?: () => void;
}) => {
  const StatCard = React.memo(function StatCard({
    title,
    value,
    icon,
    color,
  }: {
    title: string;
    value: string;
    icon: React.ReactNode;
    color: string;
  }) {
    const colorMap: Record<string, string> = {
      rose: 'bg-rose-50 text-rose-600 border-rose-100',
      sky: 'bg-sky-50 text-sky-600 border-sky-100',
      violet: 'bg-violet-50 text-violet-600 border-violet-100',
      emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    };

    return (
      <Card className="h-full border border-slate-200 rounded-xl overflow-hidden bg-white">
        <div className="p-4 sm:p-5 flex flex-col h-full justify-between gap-3">
          <div className="flex justify-between items-start">
            <p className="text-[11px] font-semibold text-slate-500">{title}</p>
            <div className={cn('p-2 rounded-lg border', colorMap[color])}>{icon}</div>
          </div>
          <p className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">{value}</p>
        </div>
      </Card>
    );
  });

  return (
    <motion.div
      key="dashboard"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit={{ opacity: 0 }}
      className="space-y-6 md:space-y-8"
    >
      <motion.div
        variants={itemVariants}
        className="lg:hidden flex flex-col gap-3 bg-white p-5 rounded-xl border border-slate-200"
      >
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">Beranda</h2>
          <p className="text-slate-500 text-xs mt-0.5">Ringkasan engagement pegawai</p>
        </div>
        {onGoInput && (
          <Button
            onClick={onGoInput}
            className="w-full h-11 rounded-xl bg-slate-900 text-white font-bold text-sm gap-2"
          >
            Input rekap hari ini
            <ArrowRight size={16} />
          </Button>
        )}
      </motion.div>

      <motion.div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4" variants={itemVariants}>
        <StatCard title="Total Pegawai" value={stats.totalEmployees.toString()} icon={<Users2 size={18} />} color="violet" />
        <StatCard title="Rekap Hari Ini" value={stats.todayCount.toString()} icon={<Activity size={18} />} color="emerald" />
        <StatCard title="Total Interaksi" value={stats.totalEngagements.toString()} icon={<TrendingUp size={18} />} color="sky" />
        <StatCard title="Engagement Rate" value={`${stats.engagementRate}%`} icon={<CheckCircle2 size={18} />} color="rose" />
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <Card className="h-full border border-slate-200 rounded-xl overflow-hidden bg-white">
            <CardHeader className="p-5 border-b border-slate-100">
              <CardTitle className="text-base font-bold text-slate-900">Tren 7 Hari</CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Interaksi Instagram, Facebook & TikTok
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-5 h-[280px] min-h-[280px]">
              <React.Suspense
                fallback={
                  <div className="w-full h-full rounded-xl bg-slate-50 animate-pulse" />
                }
              >
                <EngagementChart data={chartData} />
              </React.Suspense>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants} className="lg:col-span-1">
          <Card className="h-full border border-slate-200 rounded-xl overflow-hidden bg-white">
            <CardHeader className="p-5 border-b border-slate-100">
              <CardTitle className="text-base font-bold text-slate-900">Aktivitas Terakhir</CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Riwayat pembaruan rekap
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[280px]">
                <div className="divide-y divide-slate-100">
                  {dailyEngagements.slice(0, 8).map((eng, i) => (
                    <div
                      key={eng.id || i}
                      className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
                          <CalendarIcon size={14} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {parseLocalISODate(eng.date).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'long',
                            })}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {(eng.igEngagedEmployeeIds?.length || 0) +
                              (eng.fbEngagedEmployeeIds?.length || 0) +
                              (eng.tiktokEngagedEmployeeIds?.length || 0)}{' '}
                            interaksi
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-semibold border-emerald-100 text-emerald-700 bg-emerald-50 shrink-0"
                      >
                        Selesai
                      </Badge>
                    </div>
                  ))}
                  {dailyEngagements.length === 0 && (
                    <div className="p-8 text-center space-y-3">
                      <p className="text-sm text-slate-500">Belum ada data rekap.</p>
                      {onGoInput && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={onGoInput}
                          className="rounded-xl font-bold text-xs h-9"
                        >
                          Mulai input rekap
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
};
