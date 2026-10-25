import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-e2e-'));
const PORT = 4611, B = `http://127.0.0.1:${PORT}`, LOG = path.join(tmp, 'calls.log');
const root = path.join(tmp, 'root'), projA = path.join(root, 'projA'), projB = path.join(root, 'projB');
fs.mkdirSync(path.join(projA, 'docs'), { recursive: true }); fs.mkdirSync(projB, { recursive: true });
fs.writeFileSync(path.join(projA, 'docs', 'a.md'), '# A\n[[b]]'); fs.writeFileSync(path.join(projA, 'docs', 'b.md'), '# B');
const fakeBin = (n) => path.resolve('test/fake', n);
let srv;
const api = async (p, method = 'GET', body, headers = {}) => {
  const r = await fetch(B + p, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const calls = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

before(async () => {
  fs.writeFileSync(LOG, '');
  // wrappers so the fake .mjs run through node regardless of exec bit semantics
  for (const n of ['claude', 'herdr']) {
    const w = path.join(tmp, n); fs.writeFileSync(w, `#!/bin/sh\nexec node ${fakeBin(n + '.mjs')} "$@"\n`); fs.chmodSync(w, 0o755);
  }
  srv = spawn('node', ['serve.mjs'], { env: { ...process.env, PORT: String(PORT), MORING_DATA: path.join(tmp, 'data'), HOME: path.join(tmp, 'home'), MORING_CHAT_ENGINE: 'cli', MORING_CLAUDE: path.join(tmp, 'claude'), MORING_HERDR: path.join(tmp, 'herdr'), FAKE_LOG: LOG }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/state'); return; } catch { await new Promise(r => setTimeout(r, 100)); } }
  throw new Error('server did not start');
});
after(() => srv?.kill());

const raw = (method, p, headers, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  r.on('error', reject); r.end(body);
});
test('security: bad host / origin rejected', async () => {
  assert.equal(await raw('GET', '/api/state', { host: 'evil.com' }), 403);
  const body = JSON.stringify({ path: root });
  assert.equal(await raw('POST', '/api/roots', { host: `127.0.0.1:${PORT}`, origin: 'http://evil.com', 'content-type': 'application/json' }, body), 403);
  assert.equal(await raw('POST', '/api/roots', { host: `127.0.0.1:${PORT}`, 'content-type': 'text/plain' }, body), 415);
  assert.equal(await raw('GET', '/api/state', { host: `127.0.0.1:${PORT}` }), 200);
});
test('roots + tree + outside-root rejection', async () => {
  assert.equal((await api('/api/tree?path=' + encodeURIComponent(root))).status, 403);
  assert.deepEqual((await api('/api/roots', 'POST', { path: root })).json.roots, [root]);
  const t = (await api('/api/tree?path=' + encodeURIComponent(root))).json;
  assert.deepEqual(t.dirs.map(d => d.name), ['projA', 'projB']);
  assert.equal(t.dirs[0].hasDocs, true);
  assert.equal((await api('/api/tree?path=' + encodeURIComponent(path.join(root, '..')))).status, 403);
});
test('graph: filled for projA, empty for projB', async () => {
  const g = (await api('/api/graph?folder=' + encodeURIComponent(projA))).json;
  assert.equal(g.nodes.length, 2); assert.equal(g.links.length, 1);
  const e = (await api('/api/graph?folder=' + encodeURIComponent(projB))).json;
  assert.equal(e.empty, true); assert.equal(e.reason, 'no-docs');
  assert.equal((await api(`/api/doc?folder=${encodeURIComponent(projA)}&path=${encodeURIComponent('../secret.md')}`)).status, 400);
});
test('agent create / get / edit / draft', async () => {
  assert.equal((await api('/api/agent?folder=' + encodeURIComponent(projA))).json.agent, null);
  assert.equal((await api('/api/agent', 'PUT', { folder: projA, name: '' })).status, 400);
  const c = (await api('/api/agent', 'PUT', { folder: projA, name: 'A담당', role: '문서', systemPrompt: '규칙', model: 'sonnet' })).json.agent;
  assert.equal(c.name, 'A담당'); assert.equal(c.fullAccess, true); assert.ok(c.sessionId);
  const e = (await api('/api/agent', 'PUT', { folder: projA, name: 'A담당2', fullAccess: false })).json.agent;
  assert.equal(e.sessionId, c.sessionId); assert.equal(e.fullAccess, false);
  await api('/api/agent', 'PUT', { folder: projA, name: 'A담당', fullAccess: true, model: '' });
  const d = (await api('/api/agent/draft', 'POST', { folder: projB })).json.draft;
  assert.equal(d.name, '문서담당');
});
test('chat streams events and uses --session-id then --resume', async () => {
  const chat = async msg => {
    const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: projA, message: msg }) });
    const txt = await r.text(); return txt.split('\n\n').filter(Boolean).map(l => JSON.parse(l.replace(/^data: /, '')));
  };
  const ev1 = await chat('hello');
  assert.ok(ev1.some(e => e.t === 'text' && e.text.includes('hello')));
  assert.ok(ev1.some(e => e.t === 'tool' && e.name === 'Read'));
  assert.equal(ev1.at(-1).t, 'end');
  await chat('again');
  const cl = calls().filter(c => c.includes('--session-id') || c.includes('--resume'));
  assert.ok(cl[0].includes('--session-id')); assert.ok(cl[1].includes('--resume'));
  assert.ok(cl[0].includes('--dangerously-skip-permissions')); assert.ok(cl[0].includes('--strict-mcp-config')); assert.ok(cl[0].includes('{"mcpServers":{}}')); assert.ok(cl[0].includes('--append-system-prompt-file'));
  assert.equal((await api('/api/agent?folder=' + encodeURIComponent(projA))).json.agent.started, true);
});
test('mcp + skills per folder, passed via --mcp-config', async () => {
  await api('/api/mcp', 'PUT', { folder: projA, name: 'fs', config: { command: 'npx', args: ['x'] } });
  assert.deepEqual(Object.keys((await api('/api/mcp?folder=' + encodeURIComponent(projA))).json.servers), ['fs']);
  assert.equal((await api('/api/mcp', 'PUT', { folder: projA, name: 'bad', config: {} })).status, 400);
  await api('/api/skills', 'PUT', { folder: projA, name: 'rep', description: '설명', body: '본문' });
  assert.equal((await api('/api/skills?folder=' + encodeURIComponent(projA))).json.skills[0].name, 'rep');
  assert.ok(fs.existsSync(path.join(projA, '.claude/skills/rep/SKILL.md')));
  const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: projA, message: 'x' }) }); await r.text();
  const last = calls().filter(c => c.includes('--resume')).at(-1);
  assert.equal(last[last.indexOf('--mcp-config') + 1], path.join(projA, '.mcp.json'));
  await api('/api/mcp?folder=' + encodeURIComponent(projA) + '&name=fs', 'DELETE', {});
  await api('/api/skills?folder=' + encodeURIComponent(projA) + '&name=rep', 'DELETE', {});
});
test('recommenders return registrable items', async () => {
  const m = (await api('/api/recommend/mcp', 'POST', { folder: projA })).json.items;
  assert.equal(m[0].name, 'github'); assert.ok(m[0].config.command);
  const s = (await api('/api/recommend/skills', 'POST', { folder: projA })).json.items;
  assert.equal(s[0].name, 'weekly-report');
});
test('cli/open: needs agents; single + multi pane via herdr', async () => {
  assert.equal((await api('/api/cli/open', 'POST', { folders: [projB], launch: false })).status, 400);
  await api('/api/agent', 'PUT', { folder: projB, name: 'B담당' });
  fs.writeFileSync(LOG, ''); fs.rmSync(LOG + '.n', { force: true });
  const r = (await api('/api/cli/open', 'POST', { folders: [projA, projB], launch: false }));
  assert.equal(r.status, 200); assert.equal(r.json.panes.length, 2);
  const h = calls().map(c => c.slice(1).join(' '));
  assert.ok(h.some(x => x.startsWith('workspace create --cwd ' + projA)));
  assert.ok(h.some(x => x.startsWith('pane split w9:p1 --direction right --ratio 0.5 --cwd ' + projB)));
  const runs = h.filter(x => x.startsWith('pane run'));
  assert.equal(runs.length, 2);
  assert.match(runs[0], /claude --resume [0-9a-f-]+ .*--dangerously-skip-permissions/); // A already started
  assert.match(runs[1], /claude --session-id [0-9a-f-]+/); // B has no session yet -> terminal creates it
  assert.equal((await api('/api/agent?folder=' + encodeURIComponent(projB))).json.agent.started, false); // no session file yet: the terminal hasn't talked
});
test('cli/open with 4 folders builds a 2x2 grid', async () => {
  const dirs = [projA, projB, path.join(root, 'c'), path.join(root, 'd')];
  for (const d of dirs.slice(2)) { fs.mkdirSync(d, { recursive: true }); await api('/api/agent', 'PUT', { folder: d, name: path.basename(d) }); }
  fs.writeFileSync(LOG, ''); fs.rmSync(LOG + '.n', { force: true });
  const r = await api('/api/cli/open', 'POST', { folders: dirs, launch: false });
  assert.equal(r.json.panes.length, 4);
  const splits = calls().map(c => c.slice(1)).filter(c => c[0] === 'pane' && c[1] === 'split');
  assert.deepEqual(splits.map(s => s[s.indexOf('--direction') + 1]), ['right', 'down', 'down']);
});

test('favorites: add/remove, only inside roots, persisted in state', async () => {
  assert.equal((await api('/api/favorites', 'PUT', { path: os.tmpdir() })).status, 400);
  assert.deepEqual((await api('/api/favorites', 'PUT', { path: projA })).json.favorites.map(f => f.name), ['projA']);
  await api('/api/favorites', 'PUT', { path: projA });
  const st = (await api('/api/state')).json;
  assert.equal(st.favorites.length, 1); assert.equal(st.favorites[0].agent, 'A담당');
  assert.deepEqual((await api('/api/favorites', 'DELETE', { path: projA })).json.favorites, []);
});
test('doc edit: write, create nested, reject traversal, graph follows', async () => {
  const w = (p, text) => api('/api/doc', 'PUT', { folder: projA, path: p, text });
  assert.equal((await w('a.md', '# A edited\n[[b]] [[c]]')).status, 200);
  assert.equal((await api(`/api/doc?folder=${encodeURIComponent(projA)}&path=a.md`)).json.text.startsWith('# A edited'), true);
  assert.equal((await w('plan/c.md', '# C\n[[a]]')).status, 200);
  assert.equal((await w('../x.md', 'no')).status, 400);
  assert.equal((await w('a.txt', 'no')).status, 400);
  const g = (await api('/api/graph?folder=' + encodeURIComponent(projA))).json;
  assert.equal(g.nodes.find(n => n.id === 'a.md').title, 'A edited');
  assert.ok(g.nodes.some(n => n.id === 'plan/c.md')); assert.ok(g.links.length >= 3);
});
test('usage gauge comes from rate_limit_event (chat + probe)', async () => {
  const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: projA, message: 'x' }) }); await r.text();
  const u = (await api('/api/usage')).json;
  assert.equal(u.known, true); assert.equal(u.session.percent, 27); assert.equal(u.week.percent, 60);
  assert.ok(u.session.secondsLeft > 3000 && u.session.secondsLeft <= 3600); assert.equal(u.session.expired, false);
  const p = (await api('/api/usage?refresh=1')).json; assert.equal(p.known, true); assert.equal(p.status, 'allowed');
});

test('chat helper endpoints: permission/interrupt without a run, history, commands', async () => {
  const pm = (await api('/api/chat/permission', 'POST', { folder: projA, id: 'nope', behavior: 'allow' })).json; assert.equal(pm.ok, false);
  assert.equal((await api('/api/chat/interrupt', 'POST', { folder: projA })).json.ok, false);
  const h = (await api('/api/chat/history?folder=' + encodeURIComponent(projA))).json; assert.ok(Array.isArray(h.messages));
  const c = (await api('/api/chat/commands?folder=' + encodeURIComponent(projA))).json.commands; assert.ok(c.includes('compact') && c.includes('context'));
  assert.equal((await api('/api/chat/permission', 'POST', { folder: '/etc', id: 'x' })).status, 403);
});
test('permission modes: full / ask / readonly map to CLI flags', async () => {
  const flags = async perm => {
    await api('/api/agent', 'PUT', { folder: projA, name: 'A담당', permission: perm });
    fs.writeFileSync(LOG, '');
    const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: projA, message: 'x' }) }); await r.text();
    return calls().find(c => c.includes('--resume') || c.includes('--session-id'));
  };
  const full = await flags('full'); assert.ok(full.includes('--dangerously-skip-permissions'));
  const ask = await flags('ask'); assert.ok(!ask.includes('--dangerously-skip-permissions')); assert.ok(ask.includes('Read,Glob,Grep')); assert.ok(!ask.includes('--disallowedTools'));
  const ro = await flags('readonly'); assert.ok(ro.includes('--disallowedTools'));
  assert.equal((await api('/api/agent?folder=' + encodeURIComponent(projA))).json.agent.permission, 'readonly');
  await api('/api/agent', 'PUT', { folder: projA, name: 'A담당', permission: 'full' });
});

const wsOpen = (query, origin = B) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/term?${query}`, { headers: { origin } });
  const msgs = []; ws.on('message', d => msgs.push(JSON.parse(d.toString())));
  ws.on('open', () => resolve({ ws, msgs })); ws.on('unexpected-response', (_, res) => reject(Object.assign(new Error('http ' + res.statusCode), { status: res.statusCode }))); ws.on('error', reject);
});
const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
const textOf = msgs => msgs.map(m => m.replay || m.data || '').join('');

test('terminal ws: rejects bad origin / unknown folder', async () => {
  await assert.rejects(wsOpen('folder=' + encodeURIComponent(projA), 'http://evil.com'), e => e.status === 403);
  await assert.rejects(wsOpen('folder=' + encodeURIComponent(os.tmpdir())), e => e.status === 403);
  await assert.rejects(wsOpen('folder=' + encodeURIComponent(path.join(root, 'noagent'))), e => e.status === 404 || e.status === 400);
});
test('terminal ws: real pty session, shared by two viewers, locks chat, kill', async () => {
  const q = `folder=${encodeURIComponent(projA)}&cols=90&rows=28`;
  const a = await wsOpen(q);
  assert.ok(await until(() => textOf(a.msgs).includes('FAKE-TUI ready')), 'banner');
  a.ws.send(JSON.stringify({ t: 'input', data: 'hello\r' }));
  assert.ok(await until(() => textOf(a.msgs).includes('echo:hello')), 'echo');
  a.ws.send(JSON.stringify({ t: 'resize', cols: 120, rows: 40 }));
  // chat is locked while the terminal owns the session
  const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: projA, message: 'x' }) });
  assert.match(await r.text(), /사용 중|응답 중/);
  assert.equal((await api('/api/agent?folder=' + encodeURIComponent(projA))).json.agent.terminal, true);
  // a second viewer replays the scrollback
  const b = await wsOpen(q);
  assert.ok(await until(() => textOf(b.msgs).includes('echo:hello')), 'replay');
  const cmd = calls().filter(c => !c.includes('-p')).at(-1);
  assert.ok(cmd.includes('--resume') || cmd.includes('--session-id'));
  assert.equal((await api('/api/terminal/kill', 'POST', { folder: projA })).json.ok, true);
  assert.ok(await until(() => a.msgs.some(m => m.t === 'exit')), 'exit event');
  assert.equal((await api('/api/agent?folder=' + encodeURIComponent(projA))).json.agent.terminal, false);
  a.ws.close(); b.ws.close();
  // chat works again afterwards
  const r2 = await fetch(B + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: projA, message: 'back' }) });
  assert.match(await r2.text(), /안녕: back/);
});

test('@mention files endpoint + rich command items', async () => {
  const fl = (await api(`/api/chat/files?folder=${encodeURIComponent(projA)}&q=alp`)).json.files;
  assert.ok(fl.every(f => typeof f.path === 'string' && typeof f.dir === 'boolean'));
  assert.ok((await api(`/api/chat/files?folder=${encodeURIComponent(projA)}&q=`)).json.files.length > 0);
  assert.equal((await api(`/api/chat/files?folder=${encodeURIComponent(os.tmpdir())}&q=x`)).status, 403);
  await api('/api/skills', 'PUT', { folder: projA, name: 'hello', description: '인사 스킬', body: '본문' });
  const c = (await api('/api/chat/commands?folder=' + encodeURIComponent(projA))).json;
  const sk = c.items.find(i => i.name === 'hello'); assert.equal(sk.description, '인사 스킬');
  assert.ok(c.items.some(i => i.name === 'compact'));
  await api('/api/skills?folder=' + encodeURIComponent(projA) + '&name=hello', 'DELETE', {});
});

test('several agents in one folder: separate sessions, parallel chat, per-agent terminal/cli', async () => {
  const projM = path.join(root, 'multi'); fs.mkdirSync(projM, { recursive: true });
  const f = encodeURIComponent(projM);
  const a1 = (await api('/api/agent', 'PUT', { folder: projM, name: '문서담당' })).json.agent;
  const r2 = (await api('/api/agent', 'PUT', { folder: projM, name: '리뷰담당', new: true, permission: 'readonly' })).json;
  const a2 = r2.agent;
  assert.notEqual(a1.id, a2.id); assert.notEqual(a1.sessionId, a2.sessionId);
  assert.deepEqual(r2.agents.map(a => a.name), ['문서담당', '리뷰담당']);
  // PUT without agentId edits the default (first) agent; with agentId edits that one
  await api('/api/agent', 'PUT', { folder: projM, name: '문서담당2' });
  await api('/api/agent', 'PUT', { folder: projM, agentId: a2.id, name: '리뷰담당2', permission: 'readonly' });
  const list = (await api('/api/agent?folder=' + f)).json;
  assert.deepEqual(list.agents.map(a => a.name), ['문서담당2', '리뷰담당2']); assert.equal(list.agent.id, a1.id);
  assert.equal((await api(`/api/agent?folder=${f}&agentId=${a2.id}`)).json.agent.permission, 'readonly');
  assert.equal((await api('/api/agent', 'PUT', { folder: projM, agentId: 'nope', name: 'x' })).status, 404);
  // tree + favorites list every agent of the folder
  const t = (await api('/api/tree?path=' + encodeURIComponent(root))).json.dirs.find(d => d.name === 'multi');
  assert.equal(t.agent, '문서담당2'); assert.deepEqual(t.agents.map(a => a.id), [a1.id, a2.id]);

  // each agent chats on its own session; both can run at the same time
  const chat = async (agentId, msg) => {
    const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: projM, agentId, message: msg }) });
    return (await r.text()).split('\n\n').filter(Boolean).map(l => JSON.parse(l.replace(/^data: /, '')));
  };
  fs.writeFileSync(LOG, '');
  const [e1, e2] = await Promise.all([chat(a1.id, 'one'), chat(a2.id, 'two')]);
  assert.ok(e1.some(e => e.t === 'text' && e.text.includes('one'))); assert.ok(e2.some(e => e.t === 'text' && e.text.includes('two')));
  assert.ok(!e1.some(e => e.t === 'error') && !e2.some(e => e.t === 'error'), 'no busy clash between agents of one folder');
  const used = calls().filter(c => c.includes('--session-id')).map(c => c[c.indexOf('--session-id') + 1]);
  assert.deepEqual(new Set(used), new Set([a1.sessionId, a2.sessionId]));
  const ro = calls().find(c => c.includes(a2.sessionId)); assert.ok(ro.includes('--disallowedTools'));       // per-agent permission
  assert.ok(calls().find(c => c.includes(a1.sessionId)).includes('--dangerously-skip-permissions'));
  // the next turn of each agent resumes its own session
  fs.writeFileSync(LOG, ''); await chat(a2.id, 'again');
  assert.ok(calls().find(c => c.includes('--resume')).includes(a2.sessionId));
  assert.equal((await api(`/api/agent?folder=${f}&agentId=${a2.id}`)).json.agent.started, true);
  assert.equal((await api(`/api/agent?folder=${f}&agentId=${a1.id}`)).json.agent.started, true);

  // CLI view: targets pick agents; same folder twice -> two panes, each with its own session
  fs.writeFileSync(LOG, ''); fs.rmSync(LOG + '.n', { force: true });
  const r = await api('/api/cli/open', 'POST', { targets: [{ folder: projM, agentId: a1.id }, { folder: projM, agentId: a2.id }, { folder: projM, agentId: a2.id }], launch: false });
  assert.equal(r.status, 200); assert.equal(r.json.panes.length, 2);
  const runs = calls().map(c => c.slice(1).join(' ')).filter(x => x.startsWith('pane run'));
  assert.ok(runs[0].includes(a1.sessionId) && runs[1].includes(a2.sessionId));
  assert.equal((await api('/api/cli/open', 'POST', { folders: [projM], launch: false })).json.panes.length, 1); // legacy shorthand = default agent

  // default agent + delete
  assert.equal((await api('/api/agent/default', 'POST', { folder: projM, agentId: a2.id })).json.agents[0].id, a2.id);
  const del = (await api(`/api/agent?folder=${f}&agentId=${a2.id}`, 'DELETE', {})).json;
  assert.deepEqual(del.agents.map(a => a.id), [a1.id]);
});
