// Chat engine on the Claude Agent SDK (same engine as Claude Code): token streaming, interrupt,
// interactive tool-permission prompts, slash commands/skills, session resume.
// UI events: init · delta · block · text · tool · tool_result · permission · limit · done · error · end
import { query, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { agents, config } from './store.mjs';
import { buildSystemPrompt, hasStarted, permissionOf, setBusy, clearBusy, isBusy, CLAUDE_BIN } from './claude.mjs';
import { getMcp } from './mcpskills.mjs';
import { ingest } from './usage.mjs';
import { wrap, isWin, cleanEnv } from './platform.mjs';

const live = new Map(); // agent id -> { q, abort, pending: Map(id -> {resolve, input, suggestions}) }
const cmdCache = new Map(); // folder -> slash command names seen in the last init
export const cachedCommands = folder => cmdCache.get(folder) || [];
const richCache = new Map(); // folder -> { at, list:[{name,description,hint}] }

// All slash commands + skills the agent would have (user, plugin, project), without sending a prompt:
// start the session, read supportedCommands() from the init handshake, stop.
export async function loadCommands(folder, agent, force = false) {
  const hit = richCache.get(folder);
  if (hit && !force && Date.now() - hit.at < 60_000) return hit.list;
  const ac = new AbortController();
  const never = (async function* () { await new Promise(r => ac.signal.addEventListener('abort', r)); })();
  const q = query({ prompt: never, options: {
    cwd: folder, abortController: ac, settingSources: ['user', 'project', 'local'], pathToClaudeCodeExecutable: CLAUDE_BIN, env: cleanEnv(),
    ...(agent?.mcpMode === 'inherit' ? {} : { strictMcpConfig: true, mcpServers: getMcp(folder) }),
    ...(isWin() ? { spawnClaudeCodeProcess: spawnProcess } : {}), stderr: () => {} } });
  try {
    const cmds = await Promise.race([q.supportedCommands(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
    const list = cmds.map(c => ({ name: c.name, description: c.description || '', hint: c.argumentHint || '' }));
    richCache.set(folder, { at: Date.now(), list }); cmdCache.set(folder, list.map(c => c.name));
    return list;
  } finally { ac.abort(); }
}

const clip = (v, n = 300) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s; };
const summarize = (inp = {}) => clip(inp.command || inp.file_path || inp.pattern || inp.path || inp.url || inp.query || inp.description || inp, 200);

function spawnProcess(o) { // Windows: run claude inside WSL, like the rest of the app
  const w = wrap(o.command, o.args, { cwd: o.cwd, distro: config.get().wslDistro });
  const env = cleanEnv(o.env);
  return spawn(w.cmd, w.args, { ...w.opts, env, signal: o.signal, stdio: ['pipe', 'pipe', 'pipe'] });
}

export function chat(folder, agent, prompt, emit) {
  if (isBusy(agent.id)) { emit({ t: 'error', message: '이 에이전트의 세션을 다른 곳(채팅 응답 중 또는 터미널 탭)에서 사용 중입니다.' }); emit({ t: 'end' }); return { abort() {} }; }
  const mode = permissionOf(agent);
  const ac = new AbortController();
  const state = { pending: new Map(), q: null, abort: () => ac.abort() };
  live.set(agent.id, state);
  let finish; const finished = new Promise(r => (finish = r));
  const sessionId = agent.sessionId, resume = hasStarted(agent);

  async function* input() { // streaming-input mode (needed for interrupt + permission prompts); ends after the result
    yield { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null };
    await finished;
  }
  const canUseTool = (tool, inp, o) => new Promise(resolve => {
    if (tool === 'AskUserQuestion') return resolve({ behavior: 'deny', message: '이 채팅 UI는 선택형 질문을 지원하지 않습니다. 질문을 일반 텍스트로 물어보세요.' });
    const id = crypto.randomUUID().slice(0, 8);
    state.pending.set(id, { resolve, input: inp, suggestions: o.suggestions });
    o.signal?.addEventListener('abort', () => { if (state.pending.delete(id)) resolve({ behavior: 'deny', message: 'aborted' }); });
    emit({ t: 'permission', id, tool, summary: summarize(inp), detail: clip(inp, 1500), title: o.title || o.description || o.decisionReason || '', canAlways: !!o.suggestions?.length });
  });

  const options = {
    cwd: folder, abortController: ac, includePartialMessages: true,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: buildSystemPrompt(agent) },
    settingSources: ['user', 'project', 'local'],
    permissionMode: mode === 'full' ? 'bypassPermissions' : 'default',
    ...(mode === 'full' ? { allowDangerouslySkipPermissions: true } : {}),
    ...(mode === 'readonly' ? { allowedTools: ['Read', 'Glob', 'Grep'], disallowedTools: ['Bash', 'Edit', 'Write', 'NotebookEdit'] } : {}),
    ...(mode === 'ask' ? { allowedTools: ['Read', 'Glob', 'Grep'] } : {}),
    canUseTool,
    ...(agent.model ? { model: agent.model } : {}),
    ...(resume ? { resume: sessionId } : { sessionId }),
    ...(agent.mcpMode === 'inherit' ? {} : { strictMcpConfig: true, mcpServers: getMcp(folder) }),
    env: cleanEnv(),
    pathToClaudeCodeExecutable: CLAUDE_BIN,
    ...(isWin() ? { spawnClaudeCodeProcess: spawnProcess } : {}),
    stderr: d => { state.err = (state.err || '') + d; },
  };

  setBusy(agent.id, { kind: 'chat', abort: () => ac.abort() });
  const streamed = new Set(); let sawDone = false;

  (async () => {
    try {
      const q = query({ prompt: input(), options });
      state.q = q;
      for await (const m of q) {
        if (m.type === 'system' && m.subtype === 'init') {
          cmdCache.set(folder, m.slash_commands || []);
          emit({ t: 'init', model: m.model, commands: m.slash_commands || [], skills: m.skills || [], permissionMode: m.permissionMode });
        } else if (m.type === 'stream_event') {
          const e = m.event;
          if (e.type === 'content_block_start') { streamed.add(m.uuid); emit({ t: 'block', kind: e.content_block?.type, parent: m.parent_tool_use_id }); }
          else if (e.type === 'content_block_delta') {
            if (e.delta?.type === 'text_delta') emit({ t: 'delta', text: e.delta.text, parent: m.parent_tool_use_id });
            else if (e.delta?.type === 'thinking_delta') emit({ t: 'thinking', text: e.delta.thinking });
          } else if (e.type === 'message_start') streamed.add(e.message?.id);
        } else if (m.type === 'assistant') {
          const sawStream = streamed.has(m.message?.id);
          for (const b of m.message?.content || []) {
            if (b.type === 'text' && b.text && !sawStream) emit({ t: 'text', text: b.text });
            else if (b.type === 'tool_use') emit({ t: 'tool', id: b.id, name: b.name, input: summarize(b.input), detail: clip(b.input, 1200), parent: m.parent_tool_use_id });
          }
        } else if (m.type === 'user') {
          for (const b of Array.isArray(m.message?.content) ? m.message.content : []) {
            if (b.type === 'tool_result') emit({ t: 'tool_result', id: b.tool_use_id, error: !!b.is_error, preview: clip(Array.isArray(b.content) ? b.content.map(x => x.text || '').join('') : b.content, 400) });
          }
        } else if (m.type === 'rate_limit_event') {
          ingest(m.rate_limit_info);
          if (m.rate_limit_info?.status && m.rate_limit_info.status !== 'allowed') emit({ t: 'limit', resetsAt: m.rate_limit_info.resetsAt, status: m.rate_limit_info.status });
        } else if (m.type === 'result') {
          sawDone = true;
          emit({ t: 'done', ok: !m.is_error, interrupted: !!state.interrupted, text: m.result, cost: m.total_cost_usd, duration: m.duration_ms, turns: m.num_turns, subtype: m.subtype });
          const cur = agents.get(folder, agent.id); if (cur && !cur.started && !m.is_error) agents.put(folder, { ...cur, started: true });
          finish();
        }
      }
    } catch (e) {
      if (!ac.signal.aborted && !state.interrupted) emit({ t: 'error', message: String(state.err || e.message || e).trim().slice(-500) });
    } finally {
      finish(); live.delete(agent.id); clearBusy(agent.id);
      if (!sawDone && !ac.signal.aborted && !state.err && !state.interrupted) emit({ t: 'error', message: '응답을 받지 못했습니다.' });
      emit({ t: 'end' });
    }
  })();

  return { abort: () => ac.abort() };
}

export function answerPermission(key, id, behavior, always) {
  const s = live.get(key), p = s?.pending.get(id);
  if (!p) return false;
  s.pending.delete(id);
  p.resolve(behavior === 'allow'
    ? { behavior: 'allow', updatedInput: p.input, ...(always && p.suggestions ? { updatedPermissions: p.suggestions } : {}) }
    : { behavior: 'deny', message: '사용자가 거부했습니다.' });
  return true;
}
export async function interrupt(key) {
  const s = live.get(key); if (!s) return false;
  s.interrupted = true;
  for (const [id, p] of s.pending) { p.resolve({ behavior: 'deny', message: '중단됨', interrupt: true }); s.pending.delete(id); }
  try { await s.q?.interrupt(); } catch { s.abort(); }
  return true;
}

// previous conversation of this agent's session -> UI messages
export async function history(folder, agent) {
  if (isWin() || !hasStarted(agent)) return [];
  try {
    const ms = await getSessionMessages(agent.sessionId, { dir: folder, limit: 200 });
    const out = [];
    for (const m of ms) {
      const c = m.message?.content;
      if (m.type === 'user') {
        const text = typeof c === 'string' ? c : (c || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
        if (text && !/^<(command|local-command|system-reminder)/.test(text.trim())) out.push({ k: 'user', text });
      } else if (m.type === 'assistant') {
        for (const b of c || []) {
          if (b.type === 'text' && b.text?.trim()) out.push({ k: 'bot', text: b.text });
          else if (b.type === 'tool_use') out.push({ k: 'tool', id: b.id, name: b.name, input: summarize(b.input), detail: clip(b.input, 1200), status: 'ok' });
        }
      }
    }
    return out;
  } catch { return []; }
}
