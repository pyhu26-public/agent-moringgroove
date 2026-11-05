// Platform adapter. macOS/Linux run everything natively. Windows runs claude and herdr inside WSL
// (Windows Terminal -> wsl.exe -> Ubuntu) so web chats and herdr terminals share one ~/.claude.
// A third case: node itself runs inside WSL (platform 'linux'). Everything is native there too, except that
// "CLI로 보기" must open a *Windows* terminal (wt.exe) since WSL has no desktop of its own.
import fs from 'node:fs';
import os from 'node:os';

export function platform() { return process.env.MORING_FAKE_PLATFORM || process.platform; }
export const isWin = () => platform() === 'win32';
// node running inside WSL (not Windows-native). MORING_FAKE_WSL=1|0 forces the answer (tests).
export function isWsl() {
  if (process.env.MORING_FAKE_WSL !== undefined) return process.env.MORING_FAKE_WSL === '1';
  if (platform() !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try { return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')); } catch { return false; }
}
export const wslDistroName = () => process.env.WSL_DISTRO_NAME || '';

// C:\Users\me\x -> /mnt/c/Users/me/x ; already-posix paths pass through
export function toWslPath(p) {
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(p);
  if (!m) return p.replace(/\\/g, '/');
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}
export const toRuntimePath = p => (isWin() ? toWslPath(p) : p);

// `wsl.exe … cmd args` as an argv list, whatever platform we are on.
// Two things matter here (both seen on a real machine):
//  - `wsl.exe -- cmd` runs cmd through a NON-login shell, so ~/.local/bin (where claude and herdr usually live)
//    is not on PATH -> "command not found". `bash -lc` reads the login profile and fixes PATH.
//  - `-e` skips the outer shell, and `exec "$@"` hands the arguments over untouched (JSON, quotes, Korean text).
// An empty distro means "WSL's default distro" (no -d).
export function wslCommand(cmd, args, { cwd, distro = '' } = {}) {
  const pre = [];
  if (distro) pre.push('-d', distro);
  if (cwd) pre.push('--cd', toWslPath(cwd));
  return { cmd: 'wsl.exe', args: [...pre, '-e', 'bash', '-lc', 'exec "$@"', '_', cmd, ...args], opts: {} };
}

// Wrap a command so it runs where claude/herdr live. Returns {cmd,args,opts}.
export function wrap(cmd, args, { cwd, distro = '' } = {}) {
  if (!isWin()) return { cmd, args, opts: { cwd } };
  return wslCommand(cmd, args, { cwd, distro });
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
