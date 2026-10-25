#!/usr/bin/env node
// fake codex: records argv(+stdin), speaks `exec --json` like the real CLI, writes rollout files under $HOME/.codex/sessions
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('codex-cli 0.0.0-fake'); process.exit(0); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/;
const isExec = a[0] === 'exec', resume = isExec ? a[1] === 'resume' : a[0] === 'resume';
const known = a.find(x => UUID.test(x));
const id = known || crypto.randomUUID();
const T = Math.floor(Date.now() / 1000);

function rollout(lines) {
  const dir = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions', '2026', '10', '25');
  fs.mkdirSync(dir, { recursive: true });
  let f = fs.readdirSync(dir).map(n => path.join(dir, n)).find(n => n.endsWith(`-${id}.jsonl`));
  const add = [];
  if (!f) { f = path.join(dir, `rollout-2026-10-25T00-00-00-${id}.jsonl`); add.push({ type: 'session_meta', payload: { id, cwd: fs.realpathSync(process.cwd()), timestamp: new Date().toISOString(), originator: isExec ? 'codex_exec' : 'codex_cli_rs' } }); }
  fs.appendFileSync(f, [...add, ...lines].map(o => JSON.stringify(o)).join('\n') + '\n');
}
const msg = (role, text) => ({ type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
const tokens = () => ({ type: 'event_msg', payload: { type: 'token_count', rate_limits: { limit_id: 'codex', primary: { used_percent: 12.0, window_minutes: 10080, resets_at: T + 86400 }, secondary: null } } });

if (!isExec) { // interactive TUI
  fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(a) + '\n');
  if (!resume) rollout([msg('user', 'tui')]);
  process.stdout.write('FAKE-CODEX-TUI ready\r\n');
  process.stdin.setEncoding('utf8');
  let buf = '';
  process.stdin.on('data', d => { buf += d; let i; while ((i = buf.search(/[\r\n]/)) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l === '/exit') process.exit(0); if (l) process.stdout.write('echo:' + l + '\r\n'); } });
  setInterval(() => {}, 1000);
} else {
  let prompt = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { prompt += d; });
  process.stdin.on('end', async () => {
    fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify([...a, '::stdin::' + prompt]) + '\n');
    const out = o => console.log(JSON.stringify(o));
    out({ type: 'thread.started', thread_id: id }); out({ type: 'turn.started' });
    if (prompt.includes('FAIL')) { out({ type: 'error', message: '{"type":"error","status":400,"error":{"message":"모델을 쓸 수 없습니다"}}' }); out({ type: 'turn.failed', error: { message: '{"type":"error","status":400,"error":{"message":"모델을 쓸 수 없습니다"}}' } }); return process.exit(1); }
    if (prompt.includes('SLOW')) await new Promise(r => setTimeout(r, 8000));
    let text;
    if (a.includes('--ephemeral')) {
      text = /MCP/.test(prompt) && /추천/.test(prompt) ? '```json\n[{"name":"github","why":"깃 작업","config":{"command":"npx","args":["-y","@modelcontextprotocol/server-github"]}}]\n```'
        : /스킬을 제안/.test(prompt) ? '```json\n[{"name":"weekly-report","description":"주간 보고","body":"# 주간 보고\\n1. 정리"}]\n```'
        : '```json\n{"name":"코덱스담당","role":"문서 정리","systemPrompt":"docs를 관리한다"}\n```';
    } else text = '코덱스: ' + prompt;
    out({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: '시작합니다' } });
    if (/run/.test(prompt)) {
      out({ type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: "/bin/zsh -lc 'echo hi'", aggregated_output: '', exit_code: null, status: 'in_progress' } });
      out({ type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: "/bin/zsh -lc 'echo hi'", aggregated_output: 'hi\n', exit_code: 0, status: 'completed' } });
      out({ type: 'item.started', item: { id: 'item_2', type: 'command_execution', command: "/bin/zsh -lc 'false'", aggregated_output: '', exit_code: null, status: 'in_progress' } });
      out({ type: 'item.completed', item: { id: 'item_2', type: 'command_execution', command: "/bin/zsh -lc 'false'", aggregated_output: '', exit_code: 1, status: 'failed' } });
    }
    out({ type: 'item.completed', item: { id: 'item_9', type: 'agent_message', text } });
    out({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 } });
    if (!a.includes('--ephemeral')) rollout([msg('user', '<environment_context>x</environment_context>'), msg('user', prompt), { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["echo","hi"]}', call_id: 'c1' } }, { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'hi' } }, msg('assistant', text), tokens()]);
  });
}
