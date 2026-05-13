import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'src/components/EngagementDashboard.tsx');
let content = fs.readFileSync(file, 'utf8');

// Replace standard non-flat values
content = content.replace(/bg-rose-600/g, 'bg-slate-900');
content = content.replace(/hover:bg-rose-700/g, 'hover:bg-slate-800');
content = content.replace(/shadow- rose-100/g, ''); // catch spacing
content = content.replace(/shadow-rose-100/g, '');
content = content.replace(/shadow-lg/g, '');
content = content.replace(/shadow-md/g, 'shadow-sm');
content = content.replace(/shadow-2xl/g, 'shadow-sm');
content = content.replace(/shadow-xl/g, 'shadow-sm');
content = content.replace(/rounded-2xl/g, 'rounded-xl');
content = content.replace(/rounded-3xl/g, 'rounded-xl');
content = content.replace(/rounded-\[14px\]/g, 'rounded-lg');
content = content.replace(/border-slate-100/g, 'border-slate-200');
content = content.replace(/border-emerald-100/g, 'border-emerald-200');
content = content.replace(/border-red-100/g, 'border-red-200');
content = content.replace(/bg-gradient-[a-z0-9\-]+/g, '');
content = content.replace(/from-[a-z0-9\-]+/g, '');
content = content.replace(/to-[a-z0-9\-]+/g, '');
content = content.replace(/shadow-\[.*?\]/g, 'shadow-sm'); // match arbitrary shadow
content = content.replace(/active:scale-95/g, 'active:scale-[0.98]');

// Let's also adjust initial y values for motion/react
content = content.replace(/y: 20/g, 'y: 10');
content = content.replace(/type: "spring"/g, 'type: "tween"'); // or standard ease-out
content = content.replace(/stiffness: 300,\s*damping: 24/g, 'ease: "easeOut", duration: 0.2');


fs.writeFileSync(file, content);
console.log('Dashboard updated!');
