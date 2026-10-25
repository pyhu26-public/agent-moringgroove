// Web terminal: the real Claude Code TUI in a pty, bridged to xterm.js over a WebSocket.
// One pty per agent (same session id as the chat, so the two share one conversation).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isBusy, busyKind, setBusy, clearBusy } from './claude.mjs';
import { terminalSpec } from './engine.mjs';
import { codexEnv } from './codex.mjs';
import { wrap, cleanEnv } from './platform.mjs';
import { config } from './store.mjs';

const require = createRequire(import.meta.url);
let nodePty = null;
function loadPty() {
  if (nodePty) return nodePty;
  // node-pty ships spawn-helper without the exec bit on some installs
  try {
    const root = path.dirname(require.resolve('node-pty/package.json'));
    for (const d of fs.readdirSync(path.join(root, 'prebuilds'))) { const h = path.join(root, 'prebuilds', d, 'spawn-helper'); if (fs.existsSync(h)) fs.chmodSync(h, 0o755); }
  } catch {}
  return (nodePty = require('node-pty'));
}

const MAX_BUF = 400_000;
const sessions = new Map(); // agent id -> { p, clients:Set, buf:[], size }

export const isLive = key => sessions.has(key);

function start(folder, agent, cols, rows) {
  const pty = loadPty();
  const spec = terminalSpec(folder, agent);
  const w = wrap(spec.bin, spec.args, { cwd: folder, distro: config.get().wslDistro });
  const env = codexEnv(cleanEnv(process.env, { TERM: 'xterm-256color', COLORTERM: 'truecolor' }));
  const p = pty.spawn(w.cmd, w.args, { name: 'xterm-256color', cols: cols || 100, rows: rows || 30, cwd: w.opts.cwd || undefined, env });
  const s = { p, clients: new Set(), buf: [], size: 0 };
  sessions.set(agent.id, s);
  setBusy(agent.id, { kind: 'terminal', abort: () => kill(agent.id) });
  p.onData(data => {
    s.buf.push(data); s.size += data.length;
    while (s.size > MAX_BUF && s.buf.length > 1) s.size -= s.buf.shift().length;
    for (const c of s.clients) send(c, { t: 'out', data });
  });
  p.onExit(({ exitCode }) => {
    sessions.delete(agent.id); clearBusy(agent.id);
    for (const c of s.clients) send(c, { t: 'exit', code: exitCode });
  });
  return s;
}
const send = (ws, m) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(m)); } catch {} };

// Attach a WebSocket to the folder's pty (starting it if needed).
export function attach(folder, agent, ws, { cols, rows } = {}) {
  let s = sessions.get(agent.id);
  if (!s) {
    if (isBusy(agent.id)) { send(ws, { t: 'error', message: busyKind(agent.id) === 'chat' ? '채팅이 응답 중입니다. 끝난 뒤 열어 주세요.' : '이 폴더의 세션이 사용 중입니다.' }); return ws.close(); }
    try { s = start(folder, agent, cols, rows); } catch (e) { send(ws, { t: 'error', message: `터미널을 시작하지 못했습니다: ${e.message}` }); return ws.close(); }
  } else if (cols && rows) { try { s.p.resize(cols, rows); } catch {} }
  s.clients.add(ws);
  send(ws, { t: 'ready', replay: s.buf.join('') });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === 'input' && typeof m.data === 'string') s.p.write(m.data);
    else if (m.t === 'resize' && m.cols > 0 && m.rows > 0) { try { s.p.resize(Math.min(m.cols, 500), Math.min(m.rows, 200)); } catch {} }
  });
  ws.on('close', () => s.clients.delete(ws)); // the pty keeps running; reattach later
}

export function kill(key) { const s = sessions.get(key); if (s) { try { s.p.kill(); } catch {} } return !!s; }
export function killAll() { for (const k of [...sessions.keys()]) kill(k); }
process.on('exit', killAll);
