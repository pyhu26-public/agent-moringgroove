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

// ---- Codex: rate limits come from the session files (token_count.rate_limits): used_percent, window_minutes, resets_at.
// Codex has one window (weekly on ChatGPT plans), occasionally two; short windows (<= 6h) show as "5시간", longer as "주간".
const CFILE = path.join(DATA, 'usage-codex.json');
let codexCur = (() => { try { return JSON.parse(fs.readFileSync(CFILE, 'utf8')); } catch { return null; } })();
export function ingestCodex(rl) {
  if (!rl) return;
  let session = null, week = null;
  for (const w of [rl.primary, rl.secondary]) {
    if (!w || typeof w.used_percent !== 'number') continue;
    const x = { utilization: w.used_percent / 100, resetsAt: w.resets_at || null, minutes: w.window_minutes || null };
    if (x.minutes && x.minutes <= 360) session = x; else week = x;
  }
  if (!session && !week) return;
  codexCur = { session, week, status: 'allowed', at: Date.now() };
  try { fs.writeFileSync(CFILE, JSON.stringify(codexCur)); } catch {}
}
export function snapshotCodex(now = Date.now()) {
  if (!codexCur) return { known: false, engine: 'codex' };
  const fix = w => (w ? { percent: Math.round(w.utilization * 100), resetsAt: w.resetsAt, secondsLeft: w.resetsAt ? Math.max(0, w.resetsAt - Math.floor(now / 1000)) : null, expired: !!(w.resetsAt && w.resetsAt * 1000 <= now) } : null);
  return { known: true, engine: 'codex', status: codexCur.status, at: codexCur.at, session: fix(codexCur.session), week: fix(codexCur.week) };
}
