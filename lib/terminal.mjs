// "CLI로 보기": open a terminal, attach herdr, and put each folder's Claude session in a pane.
//   macOS        : Terminal.app -> herdr
//   Windows      : Windows Terminal (wt.exe) -> WSL (Ubuntu) -> herdr          (node on Windows)
//   WSL (linux)  : Windows Terminal via cmd.exe -> this WSL distro -> herdr    (node inside WSL)
//   Linux        : x-terminal-emulator -> herdr
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { wrap, wslCommand, isWin, isWsl, wslDistroName, platform, toRuntimePath } from './platform.mjs';
import { config } from './store.mjs';
import { CLAUDE_BIN, agentFlags, sessionFlag, hasStarted } from './claude.mjs';
import { agents } from './store.mjs';

const HERDR_BIN = () => process.env.MORING_HERDR || 'herdr';

// POSIX single-quote for the shell inside the herdr pane
export const q = s => (/^[A-Za-z0-9_\/.:=@%+-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

let runner = (cmd, args, opts) => new Promise((resolve, reject) =>
  execFile(cmd, args, { encoding: 'utf8', timeout: 20000, ...opts }, (e, stdout, stderr) => (e ? reject(Object.assign(e, { stderr })) : resolve(stdout))));
export const setRunner = r => { runner = r; };
let launcher = (cmd, args, opts = {}) => { const c = spawn(cmd, args, { detached: true, stdio: 'ignore', ...opts }); c.on('error', () => {}); c.unref(); };
export const setLauncher = l => { launcher = l; };

async function herdr(args, { json = true } = {}) {
  const w = wrap(HERDR_BIN(), args, { distro: config.get().wslDistro });
  const out = await runner(w.cmd, w.args, w.opts);
  if (!json) return out;
  try { return JSON.parse(out).result; } catch { throw new Error(`herdr 응답 해석 실패: ${String(out).slice(0, 200)}`); }
}

async function serverUp() {
  try { return /status:\s*running/.test(await herdr(['status', 'server'], { json: false })); } catch { return false; }
}

// Where the Windows side starts from. cmd.exe refuses a WSL path (\\wsl.localhost\…) as its working directory.
const WIN_CWD = '/mnt/c';
const winCwd = () => ({ cwd: WIN_CWD });

// Windows Terminal is optional on Windows 10; without it a plain console window is used.
// (`cmd /c where` resolves wt.exe from the *Windows* PATH — %LOCALAPPDATA%\Microsoft\WindowsApps is not on WSL's PATH.)
async function hasWindowsTerminal() {
  try { await runner('cmd.exe', ['/c', 'where', 'wt.exe'], { ...winCwd() }); return true; } catch { return false; }
}

// Open the terminal app showing herdr (attaches to the persistent session).
// Resolves to true when a launch was attempted, false when this platform has nothing to launch with.
export async function openTerminal() {
  const p = platform();
  if (p === 'win32') {
    const w = wslCommand(HERDR_BIN(), [], { distro: config.get().wslDistro });
    launcher('wt.exe', ['new-tab', '--title', 'moringgroove', w.cmd, ...w.args]);
  } else if (isWsl()) {
    // node inside WSL: open a Windows Terminal tab that goes back into *this* distro and runs herdr
    const w = wslCommand(HERDR_BIN(), [], { distro: wslDistroName() });
    if (await hasWindowsTerminal()) launcher('cmd.exe', ['/c', 'start', '', 'wt.exe', 'new-tab', '--title', 'moringgroove', w.cmd, ...w.args], winCwd());
    else launcher('cmd.exe', ['/c', 'start', 'moringgroove', w.cmd, ...w.args], winCwd());
  } else if (p === 'darwin') {
    launcher('osascript', ['-e', 'tell application "Terminal" to activate', '-e', 'tell application "Terminal" to do script "herdr"']);
  } else {
    launcher('x-terminal-emulator', ['-e', 'herdr']);
  }
  return true;
}

async function ensureServer(launch) {
  if (await serverUp()) return false;
  await openTerminal();
  for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 500)); if (await serverUp()) return true; }
  throw new Error('herdr 서버를 시작하지 못했습니다. herdr가 설치되어 있는지 확인하세요' + (isWin() ? ' (WSL 안).' : isWsl() ? ' (이 WSL 안, PATH에 herdr 필요).' : '.'));
}

// shell command that continues (or starts) this folder's Claude session
export function claudeCommand(folder, agent) {
  const parts = [CLAUDE_BIN, ...sessionFlag(agent), ...agentFlags(folder, agent)];
  return parts.map(q).join(' ');
}

// grid plan for n panes -> array of {from, dir, ratio} (index = new pane; pane 0 is the workspace root)
export function gridPlan(n) {
  if (n <= 1) return [];
  const cols = n === 2 ? 2 : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const grid = Array.from({ length: cols }, () => []); // grid[c] = pane indices (top->bottom)
  const steps = [];
  grid[0].push(0);
  for (let c = 1; c < cols; c++) { // build columns left->right, equal widths
    const idx = c; grid[c].push(idx);
    steps.push({ idx, from: grid[c - 1][0], dir: 'right', ratio: 1 / (cols - c + 1) });
  }
  let next = cols;
  for (let r = 1; r < rows; r++) for (let c = 0; c < cols && next < n; c++) {
    const idx = next++; const above = grid[c][grid[c].length - 1];
    const colTotal = Math.ceil((n - c) / cols), have = grid[c].length;
    grid[c].push(idx);
    steps.push({ idx, from: above, dir: 'down', ratio: 1 / (colTotal - have + 1) });
  }
  return steps;
}

export async function openFolders(items, { launch = true, label = 'moringgroove' } = {}) {
  if (!items.length) throw new Error('폴더를 선택하세요');
  const startedServer = await ensureServer(launch);
  const rt = f => toRuntimePath(f);
  const ws = await herdr(['workspace', 'create', '--cwd', rt(items[0].folder), '--label', items.length === 1 ? path.basename(items[0].folder) : label, '--focus']);
  const panes = [ws.root_pane.pane_id];
  try {
    for (const s of gridPlan(items.length)) {
      const r = await herdr(['pane', 'split', panes[s.from], '--direction', s.dir, '--ratio', String(s.ratio), '--cwd', rt(items[s.idx].folder), '--no-focus']);
      panes[s.idx] = r.pane.pane_id;
    }
    for (let i = 0; i < items.length; i++) {
      const { folder, agent } = items[i];
      await herdr(['pane', 'rename', panes[i], agent.name || path.basename(folder)], { json: false }).catch(() => {});
      await herdr(['pane', 'run', panes[i], claudeCommand(folder, agent)], { json: false }); // prints nothing on success
      if (isWin() && !agent.started) agents.put(folder, { ...agent, started: true }); // WSL sessions can't be seen from here: remember it
    }
  } catch (e) {
    await herdr(['workspace', 'close', ws.workspace.workspace_id], { json: false }).catch(() => {}); // don't leave a half-built workspace
    throw e;
  }
  if (launch && !startedServer) await openTerminal();
  return { workspace: ws.workspace.workspace_id, panes, startedServer };
}
