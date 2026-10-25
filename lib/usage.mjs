// Claude plan limits (5-hour session + 7-day week) as reported by the claude CLI itself:
// every `claude -p --output-format stream-json` run emits a rate_limit_event carrying utilization
// (0..1) and resetsAt (epoch seconds) per window. We keep the latest one — no tokens or endpoints touched.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA, config } from './store.mjs';
import { wrap, cleanEnv } from './platform.mjs';

const FILE = path.join(DATA, 'usage.json');
let cur = (() => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } })();

// info = rate_limit_event.rate_limit_info
export function ingest(info) {
  if (!info) return;
  const w = info.unifiedWindows || {};
  const pick = x => (x && typeof x.utilization === 'number' ? { utilization: x.utilization, resetsAt: x.resetsAt || null } : null);
  let session = pick(w.five_hour), week = pick(w.seven_day);
  if (!session && info.rateLimitType === 'five_hour' && info.resetsAt) session = { utilization: cur?.session?.utilization ?? null, resetsAt: info.resetsAt };
  if (!session && !week) return;
  cur = { session: session || cur?.session || null, week: week || cur?.week || null, status: info.status || 'allowed', at: Date.now() };
  try { fs.writeFileSync(FILE, JSON.stringify(cur)); } catch {}
}

export function snapshot(now = Date.now()) {
  if (!cur) return { known: false };
  const fix = w => (w ? { percent: w.utilization == null ? null : Math.round(w.utilization * 100), resetsAt: w.resetsAt, secondsLeft: w.resetsAt ? Math.max(0, w.resetsAt - Math.floor(now / 1000)) : null, expired: !!(w.resetsAt && w.resetsAt * 1000 <= now) } : null);
  return { known: true, status: cur.status, at: cur.at, session: fix(cur.session), week: fix(cur.week) };
}

// Cheapest possible run (haiku, no tools/MCP/session) just to read a fresh rate_limit_event.
export function probe(timeoutMs = 60000) {
  return new Promise(resolve => {
    const args = ['-p', 'ok', '--model', 'haiku', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--allowedTools', ''];
    const w = wrap(process.env.MORING_CLAUDE || 'claude', args, { cwd: DATA, distro: config.get().wslDistro });
    const env = cleanEnv();
    const p = spawn(w.cmd, w.args, { ...w.opts, env, stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    const t = setTimeout(() => { try { p.kill('SIGTERM'); } catch {} }, timeoutMs);
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const ev = JSON.parse(l); if (ev.type === 'rate_limit_event') ingest(ev.rate_limit_info); } catch {} } });
    p.on('error', () => { clearTimeout(t); resolve(snapshot()); });
    p.on('close', () => { clearTimeout(t); resolve(snapshot()); });
  });
}
