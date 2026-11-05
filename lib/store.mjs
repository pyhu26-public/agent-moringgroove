// Tiny JSON file store: data/config.json (roots, settings), data/agents.json (folder -> agent).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA = process.env.MORING_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.mkdirSync(path.join(DATA, 'prompts'), { recursive: true });

function read(name, def) { try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); } catch { return def; } }
function write(name, v) {
  const f = path.join(DATA, name), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), 'utf8'); fs.renameSync(tmp, f);
}

export const config = {
  get: () => ({ roots: [], wslDistro: '', ...read('config.json', {}) }), // '' = WSL's default distro (Windows-native node only)
  set: c => write('config.json', c),
};
// agents.json: folder -> [agent, ...] (first = the folder's default agent). Older files stored a single agent object.
function loadAgents() {
  const out = {};
  for (const [folder, v] of Object.entries(read('agents.json', {}))) { const l = (Array.isArray(v) ? v : v ? [v] : []).filter(a => a && a.id); if (l.length) out[folder] = l; }
  return out;
}
export const agents = {
  all: loadAgents,
  list: folder => loadAgents()[folder] || [],
  get: (folder, id) => { const l = loadAgents()[folder] || []; return id ? l.find(a => a.id === id) || null : l[0] || null; },
  put(folder, a) {
    const all = loadAgents(), l = all[folder] || [], i = l.findIndex(x => x.id === a.id);
    i >= 0 ? (l[i] = a) : l.push(a); all[folder] = l; write('agents.json', all); return a;
  },
  del(folder, id) {
    const all = loadAgents(), l = all[folder] || [], i = id ? l.findIndex(x => x.id === id) : 0;
    if (i < 0 || !l.length) return null;
    const [gone] = l.splice(i, 1); l.length ? (all[folder] = l) : delete all[folder]; write('agents.json', all); return gone;
  },
  makeDefault(folder, id) { // move to the front
    const all = loadAgents(), l = all[folder] || [], i = l.findIndex(x => x.id === id);
    if (i < 0) return false;
    l.unshift(...l.splice(i, 1)); write('agents.json', all); return true;
  },
};
