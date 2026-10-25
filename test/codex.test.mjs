// Codex engine end-to-end against test/fake/codex.mjs (own server, own data dir)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-codex-'));
const PORT = 4612, B = `http://127.0.0.1:${PORT}`, LOG = path.join(tmp, 'calls.log');
const root = path.join(tmp, 'root'), proj = path.join(root, 'cx'), projC = path.join(root, 'cl');
fs.mkdirSync(proj, { recursive: true }); fs.mkdirSync(projC, { recursive: true });
const fakeBin = n => path.resolve('test/fake', n);
let srv;
const api = async (p, method = 'GET', body) => {
  const r = await fetch(B + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const calls = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const execCalls = () => calls().filter(c => c[0] === 'exec' && !c.includes('--ephemeral'));
const f = encodeURIComponent(proj);
const chat = async (agentId, message, folder = proj) => {
  const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder, agentId, message }) });
  return (await r.text()).split('\n\n').filter(Boolean).map(l => JSON.parse(l.replace(/^data: /, '')));
};
const put = (body, folder = proj) => api('/api/agent', 'PUT', { folder, ...body });

before(async () => {
  fs.writeFileSync(LOG, '');
  for (const n of ['claude', 'codex', 'herdr']) { const w = path.join(tmp, n); fs.writeFileSync(w, `#!/bin/sh\nexec node ${fakeBin(n + '.mjs')} "$@"\n`); fs.chmodSync(w, 0o755); }
  srv = spawn('node', ['serve.mjs'], { env: { ...process.env, PORT: String(PORT), MORING_DATA: path.join(tmp, 'data'), HOME: path.join(tmp, 'home'), MORING_CHAT_ENGINE: 'cli', MORING_CLAUDE: path.join(tmp, 'claude'), MORING_CODEX: path.join(tmp, 'codex'), MORING_HERDR: path.join(tmp, 'herdr'), FAKE_LOG: LOG }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/state'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  await api('/api/roots', 'POST', { path: root });
});
after(() => srv?.kill());

test('engine: default is claude, switchable; new agents take it; legacy agents stay claude', async () => {
  const st = (await api('/api/state')).json;
  assert.equal(st.defaultEngine, 'claude'); assert.equal(st.engines.codex.ok, true);
  const legacy = (await put({ name: '클로드' }, projC)).json.agent; assert.equal(legacy.engine, 'claude');
  assert.equal((await api('/api/engine/default', 'PUT', { engine: 'gpt' })).status, 400);
  assert.equal((await api('/api/engine/default', 'PUT', { engine: 'codex' })).json.defaultEngine, 'codex');
  const a = (await put({ name: '코덱스' })).json.agent;
  assert.equal(a.engine, 'codex'); assert.equal(a.permission, 'full');
  await api('/api/engine/default', 'PUT', { engine: 'claude' });
  assert.equal((await put({ agentId: a.id, name: '코덱스' })).json.agent.engine, 'codex'); // editing keeps the agent's own engine
  assert.equal((await api('/api/state')).json.defaultEngine, 'claude');
});

test('permission follows the engine: ask <-> workspace', async () => {
  const a = (await api('/api/agent?folder=' + f)).json.agent;
  assert.equal((await put({ agentId: a.id, name: '코덱스', engine: 'codex', permission: 'ask' })).json.agent.permission, 'workspace');
  const c = (await api('/api/agent?folder=' + encodeURIComponent(projC))).json.agent;
  assert.equal((await put({ agentId: c.id, name: '클로드', permission: 'ask' }, projC)).json.agent.permission, 'ask');
  assert.equal((await put({ agentId: c.id, name: '클로드', engine: 'codex', permission: 'ask' }, projC)).json.agent.permission, 'workspace');
  assert.equal((await put({ agentId: c.id, name: '클로드', engine: 'claude', permission: 'workspace' }, projC)).json.agent.permission, 'ask');
  await put({ agentId: a.id, name: '코덱스', engine: 'codex', permission: 'full' });
});

test('codex chat: events, stdin prompt, thread id saved, then exec resume', async () => {
  const a = (await api('/api/agent?folder=' + f)).json.agent;
  assert.equal(a.started, false);
  fs.writeFileSync(LOG, '');
  const ev = await chat(a.id, 'please run it');
  assert.equal(ev[0].t, 'init'); assert.equal(ev[0].engine, 'codex');
  assert.ok(ev.some(e => e.t === 'text' && e.text === '시작합니다'));
  const tools = ev.filter(e => e.t === 'tool'), res = ev.filter(e => e.t === 'tool_result');
  assert.deepEqual(tools.map(t => t.input), ['echo hi', 'false']); assert.equal(tools[0].name, 'Bash'); // zsh -lc wrapper stripped
  assert.deepEqual(res.map(r => r.error), [false, true]); assert.equal(res[0].preview, 'hi\n');
  assert.ok(ev.some(e => e.t === 'text' && e.text === '코덱스: please run it'));
  assert.ok(ev.some(e => e.t === 'done' && e.ok)); assert.equal(ev.at(-1).t, 'end');
  const c1 = execCalls()[0];
  assert.ok(c1.includes('--json') && c1.includes('--dangerously-bypass-approvals-and-sandbox') && !c1.includes('resume'));
  assert.ok(c1.some(x => x.startsWith('developer_instructions=') && x.includes('코덱스')), 'agent instructions injected');
  assert.ok(c1.includes('mcp_servers={}'), 'global MCP isolated');
  assert.equal(c1.at(-2), '-'); assert.equal(c1.at(-1), '::stdin::please run it');   // prompt travels on stdin
  const after1 = (await api('/api/agent?folder=' + f)).json.agent;
  assert.ok(/^[0-9a-f-]{36}$/.test(after1.codex.threadId)); assert.equal(after1.started, true);
  fs.writeFileSync(LOG, '');
  await chat(a.id, 'again');
  const c2 = execCalls()[0], i = c2.indexOf('resume');
  assert.ok(i > 0 && c2.includes(after1.codex.threadId), 'second turn resumes the same thread');
  assert.equal((await api('/api/agent?folder=' + f)).json.agent.codex.threadId, after1.codex.threadId);
});

test('codex permissions + folder MCP map to flags', async () => {
  const a = (await api('/api/agent?folder=' + f)).json.agent;
  const flagsFor = async perm => { await put({ agentId: a.id, name: '코덱스', permission: perm }); fs.writeFileSync(LOG, ''); await chat(a.id, 'x'); return execCalls()[0]; };
  const ro = await flagsFor('readonly'); assert.ok(ro.includes('sandbox_mode="read-only"') && !ro.includes('--dangerously-bypass-approvals-and-sandbox'));
  const ws = await flagsFor('workspace'); assert.ok(ws.includes('sandbox_mode="workspace-write"'));
  fs.writeFileSync(path.join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', 'x'], env: { TOKEN: '<t>' } }, remote: { type: 'http', url: 'https://x.test/mcp' } } }));
  const mcp = await flagsFor('full');
  assert.ok(mcp.includes('mcp_servers={github={command="npx",args=["-y","x"],env={TOKEN="<t>"}},remote={url="https://x.test/mcp"}}'));
  await put({ agentId: a.id, name: '코덱스', mcpMode: 'inherit' }); fs.writeFileSync(LOG, ''); await chat(a.id, 'x');
  assert.ok(!execCalls()[0].some(x => x.startsWith('mcp_servers=')), 'inherit keeps the global MCP');
  await put({ agentId: a.id, name: '코덱스', mcpMode: 'folder', model: 'gpt-x' }); fs.writeFileSync(LOG, ''); await chat(a.id, 'x');
  const m = execCalls()[0]; assert.equal(m[m.indexOf('-m') + 1], 'gpt-x');
  fs.rmSync(path.join(proj, '.mcp.json')); await put({ agentId: a.id, name: '코덱스', model: '' });
});

test('codex failure is reported once; history comes from the session file; usage from token_count', async () => {
  const a = (await api('/api/agent?folder=' + f)).json.agent;
  const ev = await chat(a.id, 'this will FAIL');
  const errs = ev.filter(e => e.t === 'error'); assert.equal(errs.length, 1); assert.equal(errs[0].message, '모델을 쓸 수 없습니다');
  assert.ok(!ev.some(e => e.t === 'done')); assert.equal(ev.at(-1).t, 'end');
  const h = (await api(`/api/chat/history?folder=${f}&agentId=${a.id}`)).json.messages;
  assert.ok(h.some(m => m.k === 'user' && m.text === 'please run it'));
  assert.ok(!h.some(m => m.text?.includes('environment_context')), 'injected context hidden');
  const tool = h.find(m => m.k === 'tool'); assert.equal(tool.name, 'Bash'); assert.equal(tool.input, 'echo hi'); assert.equal(tool.preview, 'hi');
  assert.ok(h.some(m => m.k === 'bot' && m.text.startsWith('코덱스: ')));
  const u = (await api('/api/usage?engine=codex')).json;
  assert.equal(u.known, true); assert.equal(u.week.percent, 12); assert.equal(u.session, null); assert.ok(u.week.secondsLeft > 0);
  assert.equal((await api('/api/chat/commands?folder=' + f)).json.engine, 'codex');
});

test('codex interrupt stops the run', async () => {
  const a = (await api('/api/agent?folder=' + f)).json.agent;
  const run = chat(a.id, 'SLOW please');
  await new Promise(r => setTimeout(r, 800));
  assert.equal((await api('/api/chat/interrupt', 'POST', { folder: proj, agentId: a.id })).json.ok, true);
  const ev = await run;
  assert.ok(ev.some(e => e.t === 'done' && e.interrupted)); assert.ok(!ev.some(e => e.t === 'error')); assert.equal(ev.at(-1).t, 'end');
  assert.equal((await api('/api/agent?folder=' + f)).json.agent.busy, false);
});

test('helper agents run on the chosen engine', async () => {
  fs.writeFileSync(LOG, '');
  const items = (await api('/api/recommend/mcp', 'POST', { folder: proj, engine: 'codex' })).json.items;
  assert.equal(items[0].name, 'github');
  const h = calls().find(c => c.includes('--ephemeral')); assert.ok(h && h.includes('mcp_servers={}') && h.includes('sandbox_mode="read-only"'));
  assert.equal((await api('/api/agent/draft', 'POST', { folder: proj, engine: 'codex' })).json.draft.name, '코덱스담당');
  fs.writeFileSync(LOG, ''); await api('/api/agent/draft', 'POST', { folder: proj, engine: 'claude' });
  assert.ok(calls().every(c => c[0] !== 'exec'), 'claude helper does not touch codex');
});

const wsOpen = query => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/term?${query}`, { headers: { origin: B } });
  const msgs = []; ws.on('message', d => msgs.push(JSON.parse(d.toString())));
  ws.on('open', () => resolve({ ws, msgs })); ws.on('error', reject);
});
const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
const textOf = msgs => msgs.map(m => m.replay || m.data || '').join('');

test('codex terminal: new session is linked afterwards, then `codex resume`; chat locked meanwhile', async () => {
  const a = (await put({ new: true, name: '터미널코덱스', engine: 'codex', permission: 'workspace' })).json.agent;
  fs.writeFileSync(LOG, '');
  const t = await wsOpen(`folder=${f}&agent=${a.id}&cols=90&rows=28`);
  assert.ok(await until(() => textOf(t.msgs).includes('FAKE-CODEX-TUI ready')), 'banner');
  const first = calls().find(c => c[0] !== 'exec');
  assert.ok(!first.includes('resume') && first.includes('-s') && first.includes('workspace-write') && first.includes('on-request'), 'TUI can ask: sandbox + -a on-request');
  assert.match((await chat(a.id, 'x')).find(e => e.t === 'error')?.message || '', /사용 중/);
  const linked = (await api(`/api/agent?folder=${f}&agentId=${a.id}`)).json.agent;      // the TUI wrote a session file for this folder
  assert.ok(linked.codex?.threadId, 'thread linked from ~/.codex/sessions'); assert.equal(linked.terminal, true);
  assert.equal((await api('/api/terminal/kill', 'POST', { folder: proj, agentId: a.id })).json.ok, true);
  assert.ok(await until(() => t.msgs.some(m => m.t === 'exit')), 'exit'); t.ws.close();
  fs.writeFileSync(LOG, '');
  const t2 = await wsOpen(`folder=${f}&agent=${a.id}`);
  assert.ok(await until(() => textOf(t2.msgs).includes('FAKE-CODEX-TUI ready')));
  const second = calls().find(c => c[0] !== 'exec'); assert.equal(second[0], 'resume'); assert.ok(second.includes(linked.codex.threadId));
  await api('/api/terminal/kill', 'POST', { folder: proj, agentId: a.id }); t2.ws.close();
  assert.ok(await until(() => true));
});

test('cli/open: codex and claude agents side by side in one herdr workspace', async () => {
  const ags = (await api('/api/agent?folder=' + f)).json.agents, cx = ags.find(a => a.name === '터미널코덱스');
  fs.writeFileSync(LOG, ''); fs.rmSync(LOG + '.n', { force: true });
  const r = await api('/api/cli/open', 'POST', { targets: [{ folder: proj, agentId: cx.id }, { folder: projC }], launch: false });
  assert.equal(r.status, 200); assert.equal(r.json.panes.length, 2);
  const runs = calls().map(c => c.slice(1).join(' ')).filter(x => x.startsWith('pane run'));
  assert.match(runs[0], /^pane run \S+ \S*codex resume /); assert.match(runs[0], /-s workspace-write -a on-request/);
  assert.match(runs[1], /claude (--resume|--session-id)/);
});
