import fs from 'fs';
import path from 'path';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = dir + '/' + file;
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('./src');
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  const initial = content;
  content = content.replace(/ hover:shadow-[a-z0-9\-]+/g, '');
  content = content.replace(/ shadow-[a-z0-9\-]+/g, '');
  content = content.replace(/ shadow\b/g, '');
  
  // Also fix focus rings as requested: 
  // "focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900"
  // remove default ring forms
  content = content.replace(/focus-visible:ring-\[?\w+\]?\/?[0-9]*\s/g, '');
  content = content.replace(/focus:ring-[a-z0-9\-]+\s/g, '');
  content = content.replace(/focus:border-[a-z0-9\-]+\s/g, '');

  if (content !== initial) {
    fs.writeFileSync(file, content);
    console.log('Updated ' + file);
  }
});
