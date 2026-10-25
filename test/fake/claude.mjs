#!/usr/bin/env node
// fake claude: records argv, emits stream-json like the real CLI
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const a = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(a) + '\n');
// like the real CLI: a new --session-id creates the session file under ~/.claude/projects
const sid = a[a.indexOf('--session-id') + 1];
if (a.includes('--session-id') && sid) { const d = path.join(os.homedir(), '.claude', 'projects', 'fake'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, sid + '.jsonl'), '{}\n'); }
if (!a.includes('-p')) { // interactive "TUI": banner + echo lines, exits on /exit
  process.stdout.write('FAKE-TUI ready\r\n');
  process.stdin.setEncoding('utf8');
  let buf = '';
  process.stdin.on('data', d => { buf += d; let i; while ((i = buf.search(/[\r\n]/)) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l === '/exit') process.exit(0); if (l) process.stdout.write('echo:' + l + '\r\n'); } });
  setInterval(() => {}, 1000);
} else {
const prompt = a[a.indexOf('-p') + 1] || '';
const out = o => console.log(JSON.stringify(o));
out({ type: 'system', subtype: 'init' });
const T = Math.floor(Date.now() / 1000);
out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: T + 3600, rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization: 0.27, resetsAt: T + 3600 }, seven_day: { utilization: 0.6, resetsAt: T + 86400 } } } });
if (/추천/.test(prompt) && /MCP/.test(prompt)) {
  out({ type: 'result', is_error: false, result: '```json\n[{"name":"github","why":"깃 작업","config":{"command":"npx","args":["-y","@modelcontextprotocol/server-github"]}}]\n```' });
} else if (/스킬을 제안/.test(prompt)) {
  out({ type: 'result', is_error: false, result: '```json\n[{"name":"weekly-report","description":"주간 보고","body":"# 주간 보고\\n1. 정리"}]\n```' });
} else if (/에이전트 초안/.test(prompt)) {
  out({ type: 'result', is_error: false, result: '```json\n{"name":"문서담당","role":"문서 정리","systemPrompt":"docs를 관리한다"}\n```' });
} else {
  out({ type: 'assistant', message: { content: [{ type: 'text', text: '안녕: ' + prompt }, { type: 'tool_use', name: 'Read', input: { file_path: 'x.md' } }] } });
  out({ type: 'result', is_error: false, result: 'done', total_cost_usd: 0 });
}
}
