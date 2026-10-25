// Which CLI an agent runs on. agent.engine = 'claude' | 'codex' (missing = claude, so older data keeps working).
// Sessions are separate per engine: agent.sessionId (Claude) and agent.codex.threadId (Codex).
import { config } from './store.mjs';
import { CLAUDE_BIN, agentFlags, sessionFlag, hasStarted as claudeStarted, permissionOf as claudePermission } from './claude.mjs';
import * as codex from './codex.mjs';

export const ENGINES = ['claude', 'codex'];
export const engineOf = a => (a?.engine === 'codex' ? 'codex' : 'claude');
export const defaultEngine = () => (config.get().defaultEngine === 'codex' ? 'codex' : 'claude');
export const startedOf = a => (engineOf(a) === 'codex' ? codex.hasStarted(a) : claudeStarted(a));
export const permissionOf = a => (engineOf(a) === 'codex' ? codex.permissionOf(a) : claudePermission(a));
export const PERMISSIONS = { claude: ['full', 'ask', 'readonly'], codex: ['full', 'workspace', 'readonly'] };
// keep a permission valid for the engine (ask <-> workspace are the "sandboxed but writable" middle step of each)
export function permissionFor(engine, perm) {
  if (PERMISSIONS[engine].includes(perm)) return perm;
  return perm === 'ask' ? 'workspace' : perm === 'workspace' ? 'ask' : 'full';
}
// the interactive command (web terminal pty, herdr pane)
export function terminalSpec(folder, agent) {
  if (engineOf(agent) === 'codex') { codex.markPending(folder, agent); return { bin: codex.CODEX_BIN, args: codex.terminalArgs(folder, agent) }; }
  return { bin: CLAUDE_BIN, args: [...sessionFlag(agent), ...agentFlags(folder, agent)] };
}
