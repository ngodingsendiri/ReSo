import React from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';

export default function EngagementChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart data={data}>
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
        />
        <Tooltip 
          cursor={{ fill: '#f8fafc' }}
          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' }}
        />
        <Bar dataKey="ig" name="Instagram" stackId="a" fill="#ec4899" radius={[0, 0, 0, 0]} barSize={32} />
        <Bar dataKey="fb" name="Facebook" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} barSize={32} />
        <Bar dataKey="tiktok" name="TikTok" stackId="a" fill="#0f172a" radius={[4, 4, 0, 0]} barSize={32} />
      </BarChart>
    </ResponsiveContainer>
  );
}
