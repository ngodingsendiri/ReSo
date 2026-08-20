import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { cn } from '@/lib/utils';

export type EngagementChartPoint = {
  name: string;
  ig: number;
  fb: number;
  tiktok?: number;
  total?: number;
};

const fmt = (n: number) => n.toLocaleString('id-ID');

export default function EngagementChart({ data }: { data: EngagementChartPoint[] }) {
  const hasData = data.some((d) => (d.ig || 0) + (d.fb || 0) + (d.tiktok || 0) > 0);

  return (
    <div className="relative w-full h-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis 
            dataKey="name" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 10, fontWeight: 600, fill: '#94a3b8' }}
            dy={10}
          />
          <YAxis 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 10, fontWeight: 600, fill: '#94a3b8' }}
            allowDecimals={false}
            tickFormatter={fmt}
          />
          <Tooltip 
            cursor={{ fill: 'rgba(226, 232, 240, 0.4)' }}
            contentStyle={{ 
              borderRadius: '12px', 
              border: '1px solid #e2e8f0', 
              boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
              backgroundColor: '#ffffff',
              color: '#0f172a',
              fontSize: 12,
            }}
            formatter={(value) => fmt(Number(value))}
          />
          <Legend 
            iconType="circle" 
            iconSize={8} 
            wrapperStyle={{ fontSize: 11, fontWeight: 600, color: '#64748b', paddingTop: 8 }}
          />
          <Bar dataKey="ig" name="Instagram" stackId="a" fill="#ec4899" barSize={32} />
          <Bar dataKey="fb" name="Facebook" stackId="a" fill="#3b82f6" barSize={32} />
          <Bar dataKey="tiktok" name="TikTok" stackId="a" fill="#0f172a" radius={[4, 4, 0, 0]} barSize={32} />
        </BarChart>
      </ResponsiveContainer>

      {!hasData && (
        <div className={cn(
          "absolute inset-0 flex flex-col items-center justify-center gap-1 text-center",
          "bg-white/80 backdrop-blur-[1px] rounded-xl"
        )}>
          <p className="text-sm font-semibold text-slate-500">Belum ada data 7 hari</p>
          <p className="text-[11px] text-slate-400">Isi rekap untuk melihat tren interaksi</p>
        </div>
      )}
    </div>
  );
}
