// Agent Moringgroove — local web server. http only, bound to 127.0.0.1.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, agents } from './lib/store.mjs';
import { listDirs, browse, insideAnyRoot, searchFiles } from './lib/fsx.mjs';
import { buildGraph, readDoc, writeDoc } from './lib/graph.mjs';
import * as usage from './lib/usage.mjs';
import { chat as chatCli, newAgent, isBusy } from './lib/claude.mjs';
import * as codex from './lib/codex.mjs';
import { ENGINES, engineOf, defaultEngine, startedOf, permissionOf, permissionFor } from './lib/engine.mjs';
import * as sdk from './lib/sdkchat.mjs';
import * as term from './lib/ptyterm.mjs';
import { WebSocketServer } from 'ws';
import * as ms from './lib/mcpskills.mjs';
import * as rec from './lib/recommend.mjs';
import { openFolders } from './lib/terminal.mjs';
import { platform, isWin } from './lib/platform.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4600);
const HOST = '127.0.0.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const err = (status, message) => Object.assign(new Error(message), { status });
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((resolve, reject) => {
  let b = ''; req.setEncoding('utf8');
  req.on('data', c => { b += c; if (b.length > 2e6) { reject(err(413, 'too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(err(400, 'invalid json')); } });
});

// Folder must be a real directory inside a registered root.
function folderOf(p) {
  if (!p || typeof p !== 'string') throw err(400, 'folder required');
  const f = path.resolve(p);
  if (!fs.existsSync(f) || !fs.statSync(f).isDirectory()) throw err(404, '폴더가 없습니다');
  if (!insideAnyRoot(f, config.get().roots)) throw err(403, '등록된 루트 밖의 폴더입니다');
  return f;
}
const favorites = () => (config.get().favorites || []).filter(f => { try { return fs.statSync(f).isDirectory(); } catch { return false; } })
  .map(f => ({ path: f, name: path.basename(f), ...agentBrief(f) }));
const agentBrief = f => { const l = agents.list(f); return { agent: l[0]?.name || null, agents: l.map(a => ({ id: a.id, name: a.name })) }; };
// the agent a request refers to: explicit id, else the folder's default (first) agent
function agentOf(f, id) {
  const a = agents.get(f, id || undefined);
  if (id && !a) throw err(404, '에이전트가 없습니다');
  return a;
}
const ENGINE = process.env.MORING_CHAT_ENGINE || 'sdk'; // 'cli' = legacy one-shot `claude -p` (used by the fake-claude tests)
const chat = (...a) => (ENGINE === 'cli' ? chatCli(...a) : sdk.chat(...a));
// agent as the UI sees it. A Codex agent whose first session was opened in a terminal is linked to it here (lazily).
const agentView = (a, folder) => {
  if (!a) return a;
  if (engineOf(a) === 'codex' && a.codexPending && !a.codex?.threadId) a = codex.linkThread(folder, a);
  return { ...a, engine: engineOf(a), chatEngine: ENGINE, started: startedOf(a), busy: isBusy(a.id), permission: permissionOf(a), terminal: term.isLive(a.id) };
};
const views = f => agents.list(f).map(a => agentView(a, f));
const helperEngine = e => (ENGINES.includes(e) ? e : defaultEngine());

// DNS-rebinding + cross-site protection: local tool that can run claude with full permissions.
function guard(req) {
  const host = (req.headers.host || '').toLowerCase();
  if (!new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]).has(host)) throw err(403, 'bad host');
  const o = req.headers.origin;
  if (o && req.method !== 'GET' && !new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]).has(o)) throw err(403, 'bad origin');
  if (req.method !== 'GET' && req.method !== 'HEAD' && !/application\/json/.test(req.headers['content-type'] || '') && req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined) throw err(415, 'json only');
}

const BUILTIN_COMMANDS = ['clear', 'compact', 'context', 'cost', 'init', 'memory', 'model', 'review', 'status', 'help'];

async function api(req, res, url) {
  const m = req.method, p = url.pathname, q = url.searchParams;
  const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m) ? await readBody(req) : {};

  if (p === '/api/state') return json(res, 200, { roots: config.get().roots, favorites: favorites(), platform: platform(), wsl: isWin(), wslDistro: config.get().wslDistro, defaultEngine: defaultEngine(), engines: { claude: { ok: true }, codex: await codex.available() } });

  if (p === '/api/favorites') {
    const c = config.get(), f = path.resolve(body.path || '');
    if (m === 'PUT') {
      if (!fs.existsSync(f) || !fs.statSync(f).isDirectory() || !insideAnyRoot(f, c.roots)) throw err(400, '등록된 루트 안의 폴더만 즐겨찾기할 수 있습니다');
      c.favorites = [...new Set([...(c.favorites || []), f])];
    } else if (m === 'DELETE') c.favorites = (c.favorites || []).filter(x => x !== f);
    config.set(c);
    return json(res, 200, { favorites: favorites() });
  }
  if (p === '/api/engine/default' && m === 'PUT') {
    if (!ENGINES.includes(body.engine)) throw err(400, '엔진은 claude 또는 codex 입니다');
    config.set({ ...config.get(), defaultEngine: body.engine }); return json(res, 200, { defaultEngine: body.engine });
  }
  if (p === '/api/usage') {
    if (q.get('engine') === 'codex') { codex.refreshUsage(q.get('refresh') === '1'); return json(res, 200, usage.snapshotCodex()); } // read from codex's session files: free
    return json(res, 200, q.get('refresh') === '1' ? await usage.probe() : usage.snapshot());
  }

  if (p === '/api/roots') {
    const c = config.get();
    if (m === 'POST') {
      const r = path.resolve(body.path || '');
      if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) throw err(400, '폴더가 아닙니다');
      if (!c.roots.includes(r)) c.roots.push(r);
      config.set(c);
    } else if (m === 'DELETE') {
      config.set({ ...c, roots: c.roots.filter(x => x !== path.resolve(body.path || q.get('path') || '')) });
    }
    return json(res, 200, { roots: config.get().roots });
  }
  if (p === '/api/browse') return json(res, 200, browse(q.get('path')));

  if (p === '/api/tree') {
    const dir = folderOf(q.get('path'));
    const all = agents.all();
    return json(res, 200, { path: dir, dirs: listDirs(dir).map(d => ({ ...d, agent: all[d.path]?.[0]?.name || null, agents: (all[d.path] || []).map(a => ({ id: a.id, name: a.name })) })) });
  }
  if (p === '/api/graph') return json(res, 200, buildGraph(folderOf(q.get('folder'))));
  if (p === '/api/doc') {
    if (m === 'PUT') { writeDoc(folderOf(body.folder), body.path || '', body.text); return json(res, 200, { ok: true }); }
    return json(res, 200, { text: readDoc(folderOf(q.get('folder')), q.get('path') || '') });
  }

  if (p === '/api/agent') {
    if (m === 'GET') { const f = folderOf(q.get('folder')), list = views(f); return json(res, 200, { agent: (q.get('agentId') && list.find(a => a.id === q.get('agentId'))) || list[0] || null, agents: list }); }
    const f = folderOf(body.folder ?? q.get('folder'));
    if (m === 'DELETE') {
      const gone = agents.del(f, body.agentId ?? q.get('agentId') ?? undefined);
      if (gone) { await sdk.interrupt(gone.id).catch(() => {}); term.kill(gone.id); }
      return json(res, 200, { ok: true, agents: views(f) });
    }
    if (m === 'PUT') {
      const name = String(body.name || '').trim();
      if (!name) throw err(400, '이름이 필요합니다');
      // body.new -> an additional agent for this folder; body.agentId -> that one; neither -> the folder's default (created if none)
      const existing = body.new ? null : (body.agentId ? agentOf(f, body.agentId) : agents.get(f));
      const cur = existing || newAgent();
      // engine: as asked, else keep the agent's own (legacy agents = claude), else the app default for brand-new agents
      const engine = ENGINES.includes(body.engine) ? body.engine : existing ? engineOf(existing) : defaultEngine();
      const perm = permissionFor(engine, ['full', 'ask', 'workspace', 'readonly'].includes(body.permission) ? body.permission : (body.fullAccess === false ? 'readonly' : 'full'));
      const saved = agents.put(f, { ...cur, engine, name, role: String(body.role || ''), systemPrompt: String(body.systemPrompt || ''), model: String(body.model || ''), permission: perm, fullAccess: perm === 'full', mcpMode: body.mcpMode === 'inherit' ? 'inherit' : 'folder', updatedAt: new Date().toISOString() });
      return json(res, 200, { agent: agentView(saved, f), agents: views(f) });
    }
  }
  if (p === '/api/agent/default' && m === 'POST') { const f = folderOf(body.folder); if (!agents.makeDefault(f, String(body.agentId))) throw err(404, '에이전트가 없습니다'); return json(res, 200, { agents: views(f) }); }
  if (p === '/api/agent/draft' && m === 'POST') return json(res, 200, { draft: await rec.draftAgent(folderOf(body.folder), helperEngine(body.engine)) });

  if (p === '/api/chat' && m === 'POST') {
    const f = folderOf(body.folder), a = agentOf(f, body.agentId);
    if (!a) throw err(400, '이 폴더에는 에이전트가 없습니다');
    if (!String(body.message || '').trim()) throw err(400, '메시지가 비어 있습니다');
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    let ended = false;
    const run = (engineOf(a) === 'codex' ? codex.chat : chat)(f, a, String(body.message), ev => { if (res.writableEnded) return; res.write(`data: ${JSON.stringify(ev)}\n\n`); if (ev.t === 'end') { ended = true; res.end(); } });
    res.on('close', () => { if (!ended) run.abort(); });
    return;
  }

  if (p === '/api/chat/permission' && m === 'POST') return json(res, 200, { ok: sdk.answerPermission(agentOf(folderOf(body.folder), body.agentId)?.id, String(body.id), body.behavior === 'allow' ? 'allow' : 'deny', !!body.always) });
  if (p === '/api/chat/interrupt' && m === 'POST') return json(res, 200, { ok: await (async () => { const a = agentOf(folderOf(body.folder), body.agentId); return engineOf(a) === 'codex' ? codex.interrupt(a.id) : sdk.interrupt(a?.id); })() });
  if (p === '/api/chat/history') { const f = folderOf(q.get('folder')), a = agentOf(f, q.get('agentId')); return json(res, 200, { messages: !a ? [] : engineOf(a) === 'codex' ? await codex.history(f, a) : await sdk.history(f, a) }); }
  if (p === '/api/chat/commands') {
    const f = folderOf(q.get('folder')), a = agentOf(f, q.get('agentId'));
    if (engineOf(a) === 'codex') return json(res, 200, { commands: [], items: [], engine: 'codex' }); // slash commands/skills are Codex TUI features: exec has none
    let list = [];
    if (ENGINE !== 'cli') { try { list = await sdk.loadCommands(f, a, q.get('refresh') === '1'); } catch {} }
    const have = new Set(list.map(c => c.name));
    const extra = [...sdk.cachedCommands(f), ...ms.listSkills(f).map(s => s.name), ...BUILTIN_COMMANDS].filter(n => !have.has(n));
    for (const n of new Set(extra)) { const sk = ms.listSkills(f).find(s => s.name === n); list.push({ name: n, description: sk?.description || '', hint: '' }); }
    list.sort((x, y) => x.name.localeCompare(y.name));
    return json(res, 200, { commands: list.map(c => c.name), items: list });
  }
  if (p === '/api/chat/files') return json(res, 200, { files: searchFiles(folderOf(q.get('folder')), q.get('q') || '') });
  if (p === '/api/terminal/kill' && m === 'POST') return json(res, 200, { ok: term.kill(String(body.agentId || agentOf(folderOf(body.folder))?.id)) });

  if (p === '/api/mcp') {
    if (m === 'GET') { const f = folderOf(q.get('folder')); return json(res, 200, { servers: ms.getMcp(f), global: ms.globalMcp() }); }
    const f = folderOf(body.folder ?? q.get('folder'));
    if (m === 'PUT') ms.setMcp(f, body.name, body.config);
    if (m === 'DELETE') ms.delMcp(f, body.name ?? q.get('name'));
    return json(res, 200, { servers: ms.getMcp(f) });
  }
  if (p === '/api/skills') {
    if (m === 'GET') return json(res, 200, { skills: ms.listSkills(folderOf(q.get('folder'))) });
    const f = folderOf(body.folder ?? q.get('folder'));
    if (m === 'PUT') ms.setSkill(f, body.name, body.description, body.body);
    if (m === 'DELETE') ms.delSkill(f, body.name ?? q.get('name'));
    return json(res, 200, { skills: ms.listSkills(f) });
  }
  if (p === '/api/recommend/mcp' && m === 'POST') return json(res, 200, { items: await rec.recommendMcp(folderOf(body.folder), helperEngine(body.engine)) });
  if (p === '/api/recommend/skills' && m === 'POST') return json(res, 200, { items: await rec.recommendSkills(folderOf(body.folder), helperEngine(body.engine)) });

  if (p === '/api/cli/open' && m === 'POST') {
    // targets: [{folder, agentId?}] (agentId omitted -> the folder's default agent); `folders: [path]` is the older shorthand
    const targets = Array.isArray(body.targets) ? body.targets : (Array.isArray(body.folders) ? body.folders : []).map(folder => ({ folder }));
    if (!targets.length) throw err(400, '폴더를 선택하세요');
    const items = [], missing = [], seen = new Set();
    for (const t of targets) {
      const f = folderOf(t.folder), a = agentOf(f, t.agentId);
      if (!a) { missing.push(f); continue; }
      if (!seen.has(a.id)) { seen.add(a.id); items.push({ folder: f, agent: a }); }
    }
    if (missing.length) throw err(400, `에이전트가 없는 폴더가 있습니다: ${missing.map(x => path.basename(x)).join(', ')}`);
    const busy = items.filter(i => isBusy(i.agent.id)).map(i => i.agent.name);
    if (busy.length && !body.force) return json(res, 409, { error: `웹 채팅이 응답 중입니다: ${busy.join(', ')}. 끝난 뒤 열거나 강제로 여세요.`, busy });
    return json(res, 200, await openFolders(items, { launch: body.launch !== false }));
  }
  throw err(404, 'not found');
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/vendor/force-graph.js') return sendFile(res, path.join(ROOT, 'node_modules/force-graph/dist/force-graph.min.js'));
  if (rel === '/') rel = '/index.html';
  const f = path.join(ROOT, 'public', rel);
  if (!f.startsWith(path.join(ROOT, 'public') + path.sep)) { res.writeHead(403); return res.end(); }
  sendFile(res, f);
}
function sendFile(res, f) {
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(buf);
  });
}

export const server = http.createServer(async (req, res) => {
  try {
    guard(req);
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) await api(req, res, url); else serveStatic(req, res, url);
  } catch (e) {
    if (res.headersSent) return res.end();
    json(res, e.status || 500, { error: e.message || String(e) });
  }
});

// WebSocket for the terminal tab. Same Host/Origin rules as the REST API (this is a shell-capable endpoint).
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  try {
    const host = (req.headers.host || '').toLowerCase(), o = req.headers.origin;
    if (!new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]).has(host)) throw err(403, 'bad host');
    if (!o || !new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]).has(o)) throw err(403, 'bad origin');
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname !== '/ws/term') throw err(404, 'not found');
    const f = folderOf(url.searchParams.get('folder')), a = agentOf(f, url.searchParams.get('agent'));
    if (!a) throw err(400, 'no agent');
    wss.handleUpgrade(req, socket, head, ws => term.attach(f, a, ws, { cols: Number(url.searchParams.get('cols')), rows: Number(url.searchParams.get('rows')) }));
  } catch (e) { socket.write(`HTTP/1.1 ${e.status || 400} ${e.message}\r\nConnection: close\r\n\r\n`); socket.destroy(); }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, HOST, () => console.log(`Agent Moringgroove  http://localhost:${PORT}  (${platform()})`));
}
