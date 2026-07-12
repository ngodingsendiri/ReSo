import fs from 'fs';
const b = fs.readFileSync('public/icon-512x512.png');
console.log('512 len', b.length, 'header', b.subarray(0, 8).toString('hex'));
const b192 = fs.readFileSync('public/icon-192x192.png');
console.log('192 len', b192.length, 'header', b192.subarray(0, 8).toString('hex'));
const svg = fs.readFileSync('public/pwa-icon.svg', 'utf8');
console.log('svg starts', svg.slice(0, 120));
