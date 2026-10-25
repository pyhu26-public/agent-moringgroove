// Codex CLI engine. Chat = `codex exec --json` (one process per turn, prompt on stdin), terminal = `codex resume`.
// Unlike Claude, Codex picks the session id itself: the first turn reports `thread_id`, which we store on the agent
// (agent.codex.threadId). A session first opened in a terminal/herdr pane is linked later from ~/.codex/sessions.
// UI events are the same ones the Claude engines emit: init · text · tool · tool_result · notice · done · error · end
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { agents, config } from './store.mjs';
import { wrap, isWin } from './platform.mjs';
import { buildSystemPrompt, isBusy, setBusy, clearBusy } from './claude.mjs';
import { getMcp } from './mcpskills.mjs';
import { ingestCodex } from './usage.mjs';

export const CODEX_BIN = process.env.MORING_CODEX || 'codex';
const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const sessionsDir = () => path.join(codexHome(), 'sessions');

/* ---------------- sessions (~/.codex/sessions/Y/M/D/rollout-<time>-<id>.jsonl) ---------------- */
function* rolloutFiles() { // newest first
  const ls = d => { try { return fs.readdirSync(d).sort().reverse(); } catch { return []; } };
  const base = sessionsDir();
  for (const y of ls(base)) for (const m of ls(path.join(base, y))) for (const d of ls(path.join(base, y, m)))
    for (const f of ls(path.join(base, y, m, d))) if (f.startsWith('rollout-') && f.endsWith('.jsonl')) yield path.join(base, y, m, d, f);
}
export function findRollout(id) {
  if (!id) return null;
  for (const f of rolloutFiles()) if (f.endsWith(`-${id}.jsonl`)) return f;
  return null;
}
const firstLine = f => { try { const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(4096); const n = fs.readSync(fd, b, 0, 4096, 0); fs.closeSync(fd); return b.toString('utf8', 0, n).split('\n')[0]; } catch { return ''; } };
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

// sessions can't be seen from Windows (they live inside WSL): trust the stored id there
export const hasStarted = a => !!a.codex?.threadId && (isWin() || !!findRollout(a.codex.threadId));
// permission: full (no sandbox) | workspace (sandbox, writes inside the folder) | readonly. Claude's "ask" has no exec equivalent -> workspace.
export const permissionOf = a => { const p = a.permission || (a.fullAccess === false ? 'readonly' : 'full'); return p === 'readonly' ? 'readonly' : p === 'full' ? 'full' : 'workspace'; };

// A terminal/herdr pane started a brand-new Codex session: find it afterwards (same cwd, newer than the agent, not used by another agent).
export function linkThread(folder, agent) {
  if (agent.codex?.threadId || !agent.codexPending) return agent;
  const claimed = new Set(Object.values(agents.all()).flat().map(a => a.codex?.threadId).filter(Boolean));
  const dir = real(folder), since = Date.parse(agent.createdAt || 0) || 0;
  let n = 0;
  for (const f of rolloutFiles()) {
    if (++n > 60) break;
    let meta; try { meta = JSON.parse(firstLine(f)).payload; } catch { continue; }
    if (!meta?.id || claimed.has(meta.id) || real(meta.cwd || '') !== dir || Date.parse(meta.timestamp || 0) < since) continue;
    return agents.put(folder, { ...(agents.get(folder, agent.id) || agent), codex: { ...agent.codex, threadId: meta.id }, codexPending: false });
  }
  return agent;
}
export function markPending(folder, agent) {
  if (agent.codex?.threadId || agent.codexPending) return;
  const cur = agents.get(folder, agent.id); if (cur) agents.put(folder, { ...cur, codexPending: true });
}

/* ---------------- command line ---------------- */
const tstr = s => JSON.stringify(String(s)); // TOML basic string (JSON escapes are valid TOML)
const tkey = k => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tstr(k));
function tval(v) {
  if (Array.isArray(v)) return '[' + v.map(tval).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.entries(v).filter(([, x]) => x != null).map(([k, x]) => `${tkey(k)}=${tval(x)}`).join(',') + '}';
  return typeof v === 'number' || typeof v === 'boolean' ? String(v) : tstr(v);
}
// <folder>/.mcp.json servers -> `-c mcp_servers={...}` (inline TOML). Fields Codex understands only.
export function mcpToml(servers) {
  const out = {};
  for (const [name, s] of Object.entries(servers || {})) {
    if (s?.command) out[name] = { command: s.command, args: s.args, env: s.env, cwd: s.cwd };
    else if (s?.url) out[name] = { url: s.url, http_headers: s.headers };
  }
  return 'mcp_servers=' + tval(out);
}
// same isolation rule as Claude: only this folder's servers unless the agent opts into the global ones
const mcpArgs = (folder, agent) => (agent.mcpMode === 'inherit' ? [] : ['-c', mcpToml(getMcp(folder))]);
const instructionArgs = agent => ['-c', `developer_instructions=${tstr(buildSystemPrompt(agent))}`];

function execArgs(folder, agent, resume) {
  const pm = permissionOf(agent);
  const a = ['exec'];
  if (resume) a.push('resume');
  a.push('--json', '--skip-git-repo-check');
  if (agent.model) a.push('-m', agent.model);
  // `exec resume` has no -s flag, so the sandbox goes through config for both
  if (pm === 'full') a.push('--dangerously-bypass-approvals-and-sandbox');
  else a.push('-c', `sandbox_mode=${tstr(pm === 'readonly' ? 'read-only' : 'workspace-write')}`);
  a.push(...instructionArgs(agent), ...mcpArgs(folder, agent));
  if (resume) a.push(agent.codex.threadId);
  a.push('-'); // prompt comes from stdin
  return a;
}
// interactive session (web terminal, herdr pane)
export function terminalArgs(folder, agent) {
  const pm = permissionOf(agent), a = [];
  if (agent.model) a.push('-m', agent.model);
  if (pm === 'full') a.push('--dangerously-bypass-approvals-and-sandbox');
  else a.push('-s', pm === 'readonly' ? 'read-only' : 'workspace-write', '-a', 'on-request'); // the TUI can ask, unlike exec
  a.push(...instructionArgs(agent), ...mcpArgs(folder, agent));
  return hasStarted(agent) ? ['resume', ...a, agent.codex.threadId] : a;
}

const PARENT_MARKERS = ['CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_CI', 'CODEX_MANAGED_BY_NPM'];
export function codexEnv(base = process.env, extra = {}) { const e = { ...base, ...extra }; for (const k of PARENT_MARKERS) delete e[k]; return e; }
function spawnCodex(args, cwd) {
  const w = wrap(CODEX_BIN, args, { cwd, distro: config.get().wslDistro });
  return spawn(w.cmd, w.args, { ...w.opts, env: codexEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
}
function lines(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l); } });
  stream.on('end', () => { if (buf.trim()) onLine(buf.trim()); });
}

/* ---------------- event stream -> UI events ---------------- */
const clip = (v, n = 300) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s; };
// "/bin/zsh -lc 'ls -la'" -> "ls -la"
export const plainCommand = c => { const m = /^\S*(?:ba|z|da)?sh -lc (['"])([\s\S]*)\1$/.exec(String(c || '')); return m ? m[2].replace(/'\\''/g, "'") : String(c || ''); };
// errors arrive as a JSON string: {"type":"error","status":400,"error":{"message":"…"}}
export function errorText(m) { try { const j = JSON.parse(m); return j?.error?.message || j?.message || String(m); } catch { return String(m || ''); } }
const TOOL_NAMES = { command_execution: 'Bash', file_change: 'Edit', web_search: 'WebSearch' };
function toolOf(it) {
  if (it.type === 'command_execution') { const c = plainCommand(it.command); return { name: 'Bash', input: clip(c, 200), detail: clip(c, 1200) }; }
  if (it.type === 'file_change') { const ch = (it.changes || []).map(c => `${c.kind || ''} ${c.path || ''}`.trim()); return { name: 'Edit', input: clip(ch.join(', '), 200), detail: clip(it.changes || ch, 1200) }; }
  if (it.type === 'mcp_tool_call') return { name: `${it.server || 'mcp'}.${it.tool || ''}`, input: clip(it.arguments ?? '', 200), detail: clip(it.arguments ?? '', 1200) };
  if (it.type === 'web_search') return { name: 'WebSearch', input: clip(it.query || '', 200), detail: clip(it.query || '', 1200) };
  return null;
}

export function toUi(ev, state) {
  const out = [], it = ev.item;
  if (ev.type === 'thread.started') state.threadId = ev.thread_id;
  else if (ev.type === 'item.started' || ev.type === 'item.completed') {
    if (it.type === 'agent_message') { if (ev.type === 'item.completed' && it.text) out.push({ t: 'text', text: it.text }); }
    else if (it.type === 'error') { if (it.message) out.push({ t: 'notice', text: errorText(it.message) }); }
    else if (it.type === 'reasoning') { /* hidden */ }
    else if (it.type === 'todo_list') { /* hidden */ }
    else if (toolOf(it) || (it.type && ev.type === 'item.completed' && !['agent_message', 'user_message'].includes(it.type))) {
      const tl = toolOf(it) || { name: TOOL_NAMES[it.type] || it.type, input: clip(it, 160), detail: clip(it, 1200) };
      if (!state.tools.has(it.id)) { state.tools.add(it.id); out.push({ t: 'tool', id: it.id, ...tl }); }
      if (ev.type === 'item.completed') {
        const bad = it.status === 'failed' || (typeof it.exit_code === 'number' && it.exit_code !== 0);
        out.push({ t: 'tool_result', id: it.id, error: bad, preview: clip(it.aggregated_output ?? it.output ?? it.result ?? '', 400) });
      }
    }
  } else if (ev.type === 'turn.completed') {
    state.sawDone = true;
    out.push({ t: 'done', ok: true, text: '', duration: Date.now() - state.started, usage: ev.usage || null });
  } else if (ev.type === 'turn.failed') { state.failed = true; out.push({ t: 'error', message: errorText(ev.error?.message) || 'Codex 실행 실패' }); }
  else if (ev.type === 'error') state.lastError = errorText(ev.message);
  return out;
}

const live = new Map(); // agent id -> { p, interrupted }

export function chat(folder, agent, prompt, emit) {
  if (isBusy(agent.id)) { emit({ t: 'error', message: '이 에이전트의 세션을 다른 곳(채팅 응답 중 또는 터미널 탭)에서 사용 중입니다.' }); emit({ t: 'end' }); return { abort() {} }; }
  agent = linkThread(folder, agent);
  const p = spawnCodex(execArgs(folder, agent, hasStarted(agent)), folder);
  const state = { p, interrupted: false, tools: new Set(), started: Date.now(), sawDone: false, failed: false, lastError: '', threadId: agent.codex?.threadId || null, err: '' };
  live.set(agent.id, state);
  setBusy(agent.id, { kind: 'chat', abort: () => p.kill('SIGTERM') });
  emit({ t: 'init', model: agent.model || 'codex', commands: [], skills: [], engine: 'codex' });
  p.stdin.on('error', () => {}); p.stdin.end(prompt);
  lines(p.stdout, l => {
    let ev; try { ev = JSON.parse(l); } catch { return; }
    const had = state.threadId;
    for (const u of toUi(ev, state)) emit(u);
    if (ev.type === 'thread.started' && state.threadId && state.threadId !== had) { // remember it right away: the terminal can resume even if this turn fails
      const cur = agents.get(folder, agent.id); if (cur) agents.put(folder, { ...cur, codex: { ...cur.codex, threadId: state.threadId }, codexPending: false });
    }
  });
  p.stderr.on('data', d => { state.err = (state.err + d).slice(-4000); });
  let closed = false;
  const finish = (errMsg) => {
    if (closed) return; closed = true;
    live.delete(agent.id); clearBusy(agent.id);
    if (state.interrupted) emit({ t: 'done', ok: false, interrupted: true, text: '' });
    else if (!state.sawDone && !state.failed) emit({ t: 'error', message: errMsg || state.lastError || cleanStderr(state.err) || '응답을 받지 못했습니다.' });
    if (state.threadId) try { ingestCodex(readRateLimits(findRollout(state.threadId))); } catch {}
    emit({ t: 'end' });
  };
  p.on('error', e => finish(`codex 실행 실패: ${e.message}`));
  p.on('close', code => finish(code ? `codex 종료 코드 ${code}` : ''));
  return { abort() { try { p.kill('SIGTERM'); } catch {} } };
}
// stderr of codex is mostly log noise (timestamped WARN/ERROR lines); keep what a human needs
const cleanStderr = s => String(s || '').split('\n').filter(l => l.trim() && !/^\d{4}-\d\d-\d\dT/.test(l)).join('\n').trim().slice(-400);

export async function interrupt(agentId) {
  const s = live.get(agentId); if (!s) return false;
  s.interrupted = true; try { s.p.kill('SIGTERM'); } catch {}
  return true;
}

/* ---------------- history ---------------- */
const textOf = c => (Array.isArray(c) ? c.map(x => x.text || '').join('\n') : String(c || '')).trim();
export function parseHistory(raw) {
  const out = [], byCall = new Map();
  for (const l of raw.split('\n')) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type !== 'response_item') continue;
    const p = o.payload || {};
    if (p.type === 'message') {
      const text = textOf(p.content);
      if (p.role === 'user' && text && !text.startsWith('<')) out.push({ k: 'user', text });   // <environment_context>… are injected, not typed
      else if (p.role === 'assistant' && text) out.push({ k: 'bot', text });
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      let args = p.arguments ?? p.input ?? ''; try { if (typeof args === 'string') args = JSON.parse(args); } catch {}
      // code-mode tool calls arrive as a JS snippet: text(await tools.exec_command({cmd:"rg --files docs",…}))
      const js = typeof args === 'string' ? /\bcmd:\s*("(?:[^"\\]|\\.)*")/.exec(args) : null;
      if (js) try { args = { cmd: JSON.parse(js[1]) }; } catch {}
      const cmd = args?.cmd || (Array.isArray(args?.command) ? args.command.join(' ') : args?.command) || (typeof args === 'string' ? args : JSON.stringify(args));
      const name = /shell|exec|bash/i.test(p.name || '') ? 'Bash' : /patch|edit/i.test(p.name || '') ? 'Edit' : p.name || 'tool';
      const m = { k: 'tool', id: p.call_id, name, input: clip(plainCommand(cmd), 200), detail: clip(plainCommand(cmd), 1200), status: 'ok' };
      out.push(m); byCall.set(p.call_id, m);
    } else if ((p.type === 'function_call_output' || p.type === 'custom_tool_call_output') && byCall.has(p.call_id)) {
      byCall.get(p.call_id).preview = clip(typeof p.output === 'string' ? p.output : JSON.stringify(p.output), 400);
    }
  }
  return out.slice(-200);
}
export async function history(folder, agent) {
  const f = findRollout(agent.codex?.threadId); if (!f) return [];
  try { return parseHistory(fs.readFileSync(f, 'utf8')); } catch { return []; }
}

/* ---------------- usage (rate limits written into the session files) ---------------- */
export function readRateLimits(file) {
  if (!file) return null;
  try {
    const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size, len = Math.min(size, 300_000), b = Buffer.alloc(len);
    fs.readSync(fd, b, 0, len, size - len); fs.closeSync(fd);
    const ls = b.toString('utf8').split('\n');
    for (let i = ls.length - 1; i >= 0; i--) {
      if (!ls[i].includes('"rate_limits"')) continue;
      try { const rl = JSON.parse(ls[i]).payload?.rate_limits; if (rl && (rl.primary || rl.secondary)) return rl; } catch {}
    }
  } catch {}
  return null;
}
let scanAt = 0;
export function refreshUsage(force = false) {
  if (!force && Date.now() - scanAt < 15_000) return;
  scanAt = Date.now(); let n = 0;
  for (const f of rolloutFiles()) { const rl = readRateLimits(f); if (rl) { ingestCodex(rl); return; } if (++n >= 8) return; }
}

/* ---------------- helper one-shot run (recommenders, agent draft) ---------------- */
export function runOnce(prompt, { cwd, system, timeoutMs = 180000, model } = {}) {
  return new Promise((resolve, reject) => {
    const a = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '-c', 'mcp_servers={}'];
    if (model) a.push('-m', model);
    if (system) a.push('-c', `developer_instructions=${tstr(system)}`);
    a.push('-');
    const p = spawnCodex(a, cwd);
    let text = '', err = '', failed = '', done = false;
    const timer = setTimeout(() => { try { p.kill('SIGTERM'); } catch {} reject(new Error('시간 초과')); }, timeoutMs);
    p.stdin.on('error', () => {}); p.stdin.end(prompt);
    lines(p.stdout, l => { try {
      const ev = JSON.parse(l);
      if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') text = ev.item.text || text;
      else if (ev.type === 'turn.completed') done = true;
      else if (ev.type === 'turn.failed' || ev.type === 'error') failed = errorText(ev.error?.message || ev.message);
    } catch {} });
    p.stderr.on('data', d => { err = (err + d).slice(-4000); });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', () => { clearTimeout(timer); done && text ? resolve(text) : reject(new Error(failed || cleanStderr(err) || 'codex 응답 없음')); });
  });
}

let availCache = null;
export function available() { // is the codex CLI installed? (cached)
  if (availCache && Date.now() - availCache.at < 60_000) return availCache.p;
  const w = wrap(CODEX_BIN, ['--version'], { distro: config.get().wslDistro });
  const p = new Promise(resolve => execFile(w.cmd, w.args, { timeout: 8000, encoding: 'utf8' }, (e, out) => resolve(e ? { ok: false } : { ok: true, version: String(out).trim() })));
  availCache = { at: Date.now(), p }; return p;
}
