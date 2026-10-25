// Platform adapter. macOS/Linux run everything natively. Windows runs claude and herdr inside WSL
// (Windows Terminal -> wsl.exe -> Ubuntu) so web chats and herdr terminals share one ~/.claude.
import os from 'node:os';

export function platform() { return process.env.MORING_FAKE_PLATFORM || process.platform; }
export const isWin = () => platform() === 'win32';

// C:\Users\me\x -> /mnt/c/Users/me/x ; already-posix paths pass through
export function toWslPath(p) {
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(p);
  if (!m) return p.replace(/\\/g, '/');
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}
export const toRuntimePath = p => (isWin() ? toWslPath(p) : p);

// Wrap a command so it runs where claude/herdr live. Returns {cmd,args,opts}.
export function wrap(cmd, args, { cwd, distro = 'Ubuntu' } = {}) {
  if (!isWin()) return { cmd, args, opts: { cwd } };
  const pre = ['-d', distro];
  if (cwd) pre.push('--cd', toWslPath(cwd));
  return { cmd: 'wsl.exe', args: [...pre, '--', cmd, ...args], opts: {} };
}

export const homeDir = () => os.homedir();

// Environment for child claude processes: drop the markers an enclosing Claude Code session leaves behind
// (they make the child refuse to nest or switch off transcript saving). User settings like API keys stay.
const PARENT_MARKERS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_PID'];
export function cleanEnv(base = process.env, extra = {}) {
  const e = { ...base, ...extra };
  for (const k of PARENT_MARKERS) delete e[k];
  return e;
}
