// docs/**/*.md -> {nodes, links}. Library-neutral shape (force-graph reads it as-is).
import fs from 'node:fs';
import path from 'node:path';
import { scanDocs } from './fsx.mjs';

const WIKI = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MDLINK = /\[[^\]]*\]\(([^)\s]+?\.md)(?:#[^)]*)?\)/gi;

export function buildGraph(folder) {
  const { exists, files } = scanDocs(folder);
  if (!exists || !files.length) return { empty: true, reason: exists ? 'no-md' : 'no-docs', nodes: [], links: [] };
  const docsDir = path.join(folder, 'docs');
  const byRel = new Map(), byBase = new Map();
  const nodes = files.map(f => {
    const rel = path.relative(docsDir, f).split(path.sep).join('/');
    let text = ''; try { text = fs.readFileSync(f, 'utf8'); } catch {}
    const title = (/^#\s+(.+)$/m.exec(text) || [])[1]?.trim() || path.basename(f, '.md');
    const n = { id: rel, title, group: rel.includes('/') ? rel.split('/')[0] : '(root)', degree: 0, _text: text };
    byRel.set(rel.toLowerCase(), n);
    const base = path.basename(rel, '.md').toLowerCase();
    if (!byBase.has(base)) byBase.set(base, n);
    return n;
  });
  const seen = new Set(), links = [];
  const add = (a, b, type) => {
    if (!b || a === b) return; const k = a.id + '\0' + b.id;
    if (seen.has(k)) return; seen.add(k); links.push({ source: a.id, target: b.id, type }); a.degree++; b.degree++;
  };
  for (const n of nodes) {
    for (const m of n._text.matchAll(WIKI)) add(n, byBase.get(path.basename(m[1].trim(), '.md').toLowerCase()), 'wiki');
    for (const m of n._text.matchAll(MDLINK)) {
      if (/^[a-z]+:\/\//i.test(m[1])) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(n.id), decodeURIComponent(m[1]))).toLowerCase();
      add(n, byRel.get(target), 'link');
    }
  }
  for (const n of nodes) delete n._text;
  return { empty: false, nodes, links };
}

export function readDoc(folder, rel) {
  const docsDir = path.resolve(folder, 'docs'), f = path.resolve(docsDir, rel);
  if (!f.startsWith(docsDir + path.sep) || !/\.md$/i.test(f)) throw Object.assign(new Error('bad path'), { status: 400 });
  return fs.readFileSync(f, 'utf8');
}

// create or overwrite a doc under <folder>/docs (path must stay inside docs, .md only)
export function writeDoc(folder, rel, text) {
  const docsDir = path.resolve(folder, 'docs'), f = path.resolve(docsDir, rel);
  if (!f.startsWith(docsDir + path.sep) || !/\.md$/i.test(f)) throw Object.assign(new Error('docs 아래의 .md 경로만 가능합니다'), { status: 400 });
  if (typeof text !== 'string' || text.length > 2e6) throw Object.assign(new Error('내용이 올바르지 않습니다'), { status: 400 });
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text, 'utf8');
}
