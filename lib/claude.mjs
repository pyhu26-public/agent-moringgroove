// Local Claude CLI runner. Chat = `claude -p` with stream-json, one persistent session per folder agent
// (so the same conversation can be continued in a terminal with `claude --resume <id>`).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DATA, agents, config } from './store.mjs';
import { wrap, toRuntimePath, isWin, cleanEnv } from './platform.mjs';
import { ingest } from './usage.mjs';

export const CLAUDE_BIN = process.env.MORING_CLAUDE || 'claude';
const busy = new Map(); // agent id -> {kind, abort} — one user of an agent's session at a time (chat run or terminal)
export const isBusy = key => busy.has(key);
export const busyKind = key => busy.get(key)?.kind || null;
export const setBusy = (key, h) => busy.set(key, h);
export const clearBusy = key => busy.delete(key);

export function promptFile(agent) {
  const f = path.join(DATA, 'prompts', `${agent.id}.md`);
  fs.writeFileSync(f, buildSystemPrompt(agent), 'utf8');
  return f;
}
export function buildSystemPrompt(agent) {
  return [`당신은 "${agent.name}" 에이전트입니다.`, agent.role ? `역할: ${agent.role}` : '', agent.systemPrompt || '',
    '작업 디렉터리(현재 폴더)가 당신이 담당하는 업무 영역입니다. 한국어로 답하세요.'].filter(Boolean).join('\n\n');
}

export function sessionExists(id) {
  if (isWin()) return false; // sessions live inside WSL; rely on the stored flag
  try {
    const base = path.join(os.homedir(), '.claude', 'projects');
    return fs.readdirSync(base).some(d => fs.existsSync(path.join(base, d, `${id}.jsonl`)));
  } catch { return false; }
}
// native: the session file is the truth (a terminal opened and closed without a message leaves none);
// Windows/WSL can't see it, so the stored flag is used there.
export const hasStarted = a => (isWin() ? !!a.started : sessionExists(a.sessionId));
// permission model: full (skip all prompts) | ask (prompt per tool) | readonly (Read/Glob/Grep only)
export const permissionOf = a => a.permission || (a.fullAccess === false ? 'readonly' : 'full');

// flags shared by web chat and terminal launch
export function agentFlags(folder, agent) {
  const a = [];
  if (agent.model) a.push('--model', agent.model);
  a.push('--append-system-prompt-file', toRuntimePath(promptFile(agent)));
  // MCP isolation: by default only this folder's .mcp.json is loaded (global servers can side-effect the cwd,
  // e.g. clone repos into it). mcpMode 'inherit' also keeps the user's global MCP servers.
  const mcp = path.join(folder, '.mcp.json');
  if (agent.mcpMode !== 'inherit') a.push('--strict-mcp-config');
  if (fs.existsSync(mcp)) a.push('--mcp-config', toRuntimePath(mcp));
  else if (agent.mcpMode !== 'inherit') a.push('--mcp-config', '{"mcpServers":{}}');
  const pm = permissionOf(agent);
  if (pm === 'full') a.push('--dangerously-skip-permissions');
  else if (pm === 'readonly') a.push('--allowedTools', 'Read,Glob,Grep', '--disallowedTools', 'Bash,Edit,Write,NotebookEdit');
  else a.push('--allowedTools', 'Read,Glob,Grep');
  return a;
}
export function sessionFlag(agent) {
  return hasStarted(agent) ? ['--resume', agent.sessionId] : ['--session-id', agent.sessionId];
}

export function newAgent(over = {}) {
  return { id: crypto.randomUUID().slice(0, 8), name: '', role: '', systemPrompt: '', model: '', permission: 'full', fullAccess: true,
    sessionId: crypto.randomUUID(), started: false, createdAt: new Date().toISOString(), ...over };
}

function spawnClaude(args, cwd) {
  const w = wrap(CLAUDE_BIN, args, { cwd, distro: config.get().wslDistro });
  const env = cleanEnv();
  return spawn(w.cmd, w.args, { ...w.opts, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

// parse newline-delimited JSON from a stream
function lines(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l); } });
  stream.on('end', () => { if (buf.trim()) onLine(buf.trim()); });
}

// Turn a stream-json event into UI events: {t:'text'|'tool'|'tool_result'|'limit'|'done', ...}
export function toUi(ev) {
  const out = [];
  if (ev.type === 'assistant') for (const b of ev.message?.content || []) {
    if (b.type === 'text' && b.text) out.push({ t: 'text', text: b.text });
    else if (b.type === 'tool_use') out.push({ t: 'tool', name: b.name, input: summarize(b.input) });
  } else if (ev.type === 'user') for (const b of ev.message?.content || []) {
    if (b.type === 'tool_result') out.push({ t: 'tool_result', error: !!b.is_error });
  } else if (ev.type === 'rate_limit_event') {
    ingest(ev.rate_limit_info);
    if (ev.rate_limit_info?.status && ev.rate_limit_info.status !== 'allowed') out.push({ t: 'limit', resetsAt: ev.rate_limit_info.resetsAt, status: ev.rate_limit_info.status });
  } else if (ev.type === 'result') {
    out.push({ t: 'done', ok: !ev.is_error, text: ev.result, cost: ev.total_cost_usd, duration: ev.duration_ms });
  }
  return out;
}
function summarize(inp = {}) {
  const v = inp.command || inp.file_path || inp.pattern || inp.path || inp.url || inp.query || JSON.stringify(inp);
  return String(v).slice(0, 160);
}

// Chat turn. emit(uiEvent). Returns {abort()}. Marks the session started on success.
export function chat(folder, agent, prompt, emit) {
  if (busy.has(agent.id)) { emit({ t: 'error', message: '이 에이전트가 이미 응답 중입니다.' }); emit({ t: 'end' }); return { abort() {} }; }
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', ...sessionFlag(agent), ...agentFlags(folder, agent)];
  const p = spawnClaude(args, folder);
  busy.set(agent.id, { kind: 'chat', abort: () => p.kill('SIGTERM') });
  let sawDone = false, err = '';
  lines(p.stdout, l => { try { for (const u of toUi(JSON.parse(l))) { if (u.t === 'done') sawDone = true; emit(u); } } catch {} });
  p.stderr.on('data', d => { err += d; });
  p.on('error', e => { busy.delete(agent.id); emit({ t: 'error', message: `claude 실행 실패: ${e.message}` }); emit({ t: 'end' }); });
  p.on('close', code => {
    busy.delete(agent.id);
    if (sawDone) { const cur = agents.get(folder, agent.id); if (cur && !cur.started) agents.put(folder, { ...cur, started: true }); }
    else emit({ t: 'error', message: err.trim().slice(-400) || `claude 종료 코드 ${code}` });
    emit({ t: 'end' });
  });
  return { abort() { try { p.kill('SIGTERM'); } catch {} } };
}

// One-shot, read-only helper run (recommenders, agent-draft). Resolves to the final text.
export function runOnce(prompt, { cwd, system, timeoutMs = 180000, model } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
      '--allowedTools', 'Read,Glob,Grep,WebSearch,WebFetch', '--permission-mode', 'default',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']; // helpers judge the folder only, not the user's global MCP setup
    if (model) args.push('--model', model);
    if (system) { const f = path.join(DATA, 'prompts', `_once_${crypto.randomUUID().slice(0, 6)}.md`); fs.writeFileSync(f, system, 'utf8'); args.push('--append-system-prompt-file', toRuntimePath(f)); }
    const p = spawnClaude(args, cwd);
    let text = '', err = '', done = false;
    const timer = setTimeout(() => { try { p.kill('SIGTERM'); } catch {} reject(new Error('시간 초과')); }, timeoutMs);
    lines(p.stdout, l => { try { const ev = JSON.parse(l); if (ev.type === 'rate_limit_event') ingest(ev.rate_limit_info); if (ev.type === 'result') { done = true; text = ev.result || text; if (ev.is_error) err = ev.result; } } catch {} });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', () => { clearTimeout(timer); done && text ? resolve(text) : reject(new Error(err.trim().slice(-400) || 'claude 응답 없음')); });
  });
}

export function extractJson(text) {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const cands = [fence?.[1], text].filter(Boolean);
  for (const c of cands) {
    const s = c.search(/[\[{]/); if (s < 0) continue;
    for (let e = c.length; e > s; e--) { const ch = c[e - 1]; if (ch !== ']' && ch !== '}') continue; try { return JSON.parse(c.slice(s, e)); } catch {} }
  }
  throw new Error('JSON 응답을 해석하지 못했습니다');
}
