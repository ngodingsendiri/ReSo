import React from 'react';
import { motion } from 'motion/react';
import { Users2, Activity, TrendingUp, CheckCircle2, Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { DailyEngagement } from '../../types';

const EngagementChart = React.lazy(() => import('../EngagementChart'));

const containerVariants: import('motion/react').Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.05 }
  }
};

const itemVariants: import('motion/react').Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { type: "tween", ease: "easeOut", duration: 0.2 }
  }
};

export const DashboardTab = ({ 
  stats, 
  chartData, 
  dailyEngagements 
}: { 
  stats: any;
  chartData: any;
  dailyEngagements: DailyEngagement[];
}) => {
  const StatCard = React.memo(function StatCard({ title, value, icon, color }: { title: string, value: string, icon: React.ReactNode, color: string }) {
    const colorMap: Record<string, string> = {
      rose: 'bg-rose-50 text-rose-500 border-rose-100/50',
      sky: 'bg-sky-50 text-sky-500 border-sky-100/50',
      violet: 'bg-violet-50 text-violet-500 border-violet-100/50',
      emerald: 'bg-emerald-50 text-emerald-500 border-emerald-200/50'
    };

    return (
      <motion.div
        transition={{ ease: "easeOut", duration: 0.2 }}
      >
        <Card className="h-full border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 relative group hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
          <div className="p-6 relative z-10 flex flex-col h-full justify-between">
            <div className="flex justify-between items-start mb-6 md:mb-8">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</p>
              <div className={cn("p-2 md:p-3 rounded-xl border", colorMap[color])}>
                {icon}
              </div>
            </div>
            <div className="space-y-1 md:space-y-2">
              <p className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-slate-900 dark:text-slate-50">{value}</p>
            </div>
          </div>
        </Card>
      </motion.div>
    );
  });

  return (
    <motion.div
      key="dashboard"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      className="space-y-6 md:space-y-10"
    >
      <motion.div variants={itemVariants} className="lg:hidden flex flex-col justify-between items-start gap-4 bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="space-y-0.5">
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Dashboard Utama</h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs">Ringkasan statistik dan tren engagement pegawai</p>
        </div>
      </motion.div>

      <motion.div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6" variants={itemVariants}>
        <StatCard title="Total Pegawai" value={stats.totalEmployees.toString()} icon={<Users2 size={20} />} color="violet" />
        <StatCard title="Rekap Hari Ini" value={stats.todayCount.toString()} icon={<Activity size={20} />} color="emerald" />
        <StatCard title="Total Interaksi (2 Bln)" value={stats.totalEngagements.toString()} icon={<TrendingUp size={20} />} color="sky" />
        <StatCard title="Engagement Rate" value={`${stats.engagementRate}%`} icon={<CheckCircle2 size={20} />} color="rose" />
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <Card className="h-full border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
            <CardHeader className="p-6 border-b border-slate-200 dark:border-slate-800">
              <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-50">Tren Engagement (7 Hari Terakhir)</CardTitle>
              <CardDescription className="text-xs text-slate-600 dark:text-slate-400">Perbandingan interaksi harian Instagram, Facebook & TikTok</CardDescription>
            </CardHeader>
            <CardContent className="p-6 h-[300px] min-h-[300px]">
              <React.Suspense fallback={<div className="w-full h-full flex items-center justify-center bg-slate-50/50 rounded-xl text-slate-400 text-xs font-bold">Memuat Grafik...</div>}>
                <EngagementChart data={chartData} />
              </React.Suspense>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants} className="lg:col-span-1">
          <Card className="h-full border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
            <CardHeader className="p-6 border-b border-slate-200 dark:border-slate-800">
              <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-50">Aktivitas Terakhir</CardTitle>
              <CardDescription className="text-xs text-slate-600 dark:text-slate-400">Riwayat pembaruan data rekap</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[300px]">
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {dailyEngagements.slice(0, 5).map((eng, i) => (
                    <div key={i} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
                          <CalendarIcon size={14} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-900">{new Date(eng.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })}</p>
                          <p className="text-[10px] text-slate-400">{(eng.igEngagedEmployeeIds?.length || 0) + (eng.fbEngagedEmployeeIds?.length || 0) + (eng.tiktokEngagedEmployeeIds?.length || 0)} Interaksi</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[9px] font-bold border-slate-200 text-slate-400">Selesai</Badge>
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
  );
};
