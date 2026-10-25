// Filesystem helpers: folder tree, directory browsing for the root picker, docs scan.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SKIP = new Set(['node_modules', '__pycache__', 'dist', 'build', 'venv', '.venv']);
const rp = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

export function isInside(child, parent) {
  const rel = path.relative(rp(parent), rp(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
export function insideAnyRoot(p, roots) { return roots.some(r => isInside(p, r)); }

// one level of sub-folders (lazy tree). hasChildren lets the UI show an expander.
export function listDirs(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return ents
    .filter(e => (e.isDirectory() || (e.isSymbolicLink() && isDir(path.join(dir, e.name)))) && !e.name.startsWith('.') && !SKIP.has(e.name))
    .map(e => {
      const p = path.join(dir, e.name);
      return { name: e.name, path: p, hasChildren: hasSub(p), hasDocs: isDir(path.join(p, 'docs')) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function hasSub(p) { return listDirsShallow(p); }
function listDirsShallow(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }).some(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)); } catch { return false; }
}

// directory browser for the "add root" dialog (any directory the user may read)
export function browse(dir) {
  const cur = path.resolve(dir || os.homedir());
  const parent = path.dirname(cur);
  return { path: cur, parent: parent === cur ? null : parent, dirs: listDirs(cur).map(({ name, path }) => ({ name, path })) };
}

// all .md under <folder>/docs (recursive), capped
export function scanDocs(folder, cap = 3000) {
  const docs = path.join(folder, 'docs');
  if (!isDir(docs)) return { exists: false, files: [] };
  const files = [];
  (function walk(d) {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (files.length >= cap) return;
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.md$/i.test(e.name)) files.push(p);
    }
  })(docs);
  return { exists: true, files };
}

// files/folders under <folder> matching q (for @mentions). Skips dot-dirs, node_modules etc.
export function searchFiles(folder, q, limit = 12, cap = 6000) {
  if (/^(\.\.?|~)?(\/|$)/.test(q) || q === '..' || q === '.') return browsePath(folder, q, limit * 2);
  const needle = q.toLowerCase().replace(/\\/g, '/'), out = []; let seen = 0;
  const score = rel => {
    const l = rel.toLowerCase(), base = l.split('/').pop();
    if (!needle) return 1 + rel.split('/').length;               // empty: shallow first
    if (base.startsWith(needle)) return 0;
    if (l.startsWith(needle)) return 1;
    if (base.includes(needle)) return 2;
    if (l.includes(needle)) return 3;
    let i = 0; for (const ch of l) if (ch === needle[i] && ++i === needle.length) return 5; // loose subsequence
    return -1;
  };
  (function walk(dir, depth) {
    if (seen > cap || depth > 8) return;
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    ents.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of ents) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name), rel = path.relative(folder, p).split(path.sep).join('/'), isD = e.isDirectory();
      if (!isD && !e.isFile()) continue;
      seen++;
      const s = score(rel); if (s >= 0) out.push({ path: rel + (isD ? '/' : ''), dir: isD, s });
      if (isD) walk(p, depth + 1);
    }
  })(folder, 0);
  return out.sort((a, b) => a.s - b.s || a.path.length - b.path.length).slice(0, limit).map(({ path, dir }) => ({ path, dir }));
}

// "@../x/", "@./sub/", "@/abs/", "@~/": list a directory instead of searching by name.
// The returned path keeps the text the user typed (relative stays relative), so the mention stays portable.
function browsePath(folder, q, limit) {
  let typed = q === '..' || q === '.' ? q + '/' : q;
  const slash = typed.lastIndexOf('/'), dirPart = typed.slice(0, slash + 1), namePart = typed.slice(slash + 1).toLowerCase();
  const base = dirPart.startsWith('~/') ? path.join(os.homedir(), dirPart.slice(2)) : path.resolve(folder, dirPart);
  let ents = []; try { ents = fs.readdirSync(base, { withFileTypes: true }); } catch { return []; }
  const showHidden = namePart.startsWith('.');
  const rank = n => { const l = n.toLowerCase(); return !namePart ? 1 : l.startsWith(namePart) ? 0 : l.includes(namePart) ? 2 : -1; };
  const rows = [];
  for (const e of ents) {
    if (!showHidden && e.name.startsWith('.')) continue;
    let isD = e.isDirectory(); if (!isD && e.isSymbolicLink()) isD = isDir(path.join(base, e.name));
    if (!isD && !e.isFile() && !e.isSymbolicLink()) continue;
    const r = rank(e.name); if (r < 0) continue;
    rows.push({ path: dirPart + e.name + (isD ? '/' : ''), dir: isD, r });
  }
  return rows.sort((a, b) => a.r - b.r || (a.dir === b.dir ? a.path.localeCompare(b.path, 'ko') : a.dir ? -1 : 1)).slice(0, limit).map(({ path, dir }) => ({ path, dir }));
}
