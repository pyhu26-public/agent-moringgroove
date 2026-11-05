import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-'));
process.env.MORING_DATA = path.join(tmp, 'data');

const { toWslPath, wrap, isWsl } = await import('../lib/platform.mjs');
const { gridPlan, q, openTerminal, setRunner, setLauncher } = await import('../lib/terminal.mjs');
const { buildGraph } = await import('../lib/graph.mjs');
const { extractJson } = await import('../lib/claude.mjs');
const ms = await import('../lib/mcpskills.mjs');
const { searchFiles } = await import('../lib/fsx.mjs');

test('windows path -> wsl path', () => {
  assert.equal(toWslPath('C:\\Users\\me\\proj x'), '/mnt/c/Users/me/proj x');
  assert.equal(toWslPath('/home/me'), '/home/me');
});
test('wsl wrap on windows: login shell (PATH) + untouched argv', () => {
  process.env.MORING_FAKE_PLATFORM = 'win32';
  const w = wrap('claude', ['-p', 'hi'], { cwd: 'D:\\work\\a', distro: 'Ubuntu' });
  assert.equal(w.cmd, 'wsl.exe');
  // bash -l so ~/.local/bin (claude, herdr) is on PATH; -e + exec "$@" so no outer shell re-parses the arguments
  assert.deepEqual(w.args, ['-d', 'Ubuntu', '--cd', '/mnt/d/work/a', '-e', 'bash', '-lc', 'exec "$@"', '_', 'claude', '-p', 'hi']);
  assert.deepEqual(wrap('herdr', ['status'], {}).args, ['-e', 'bash', '-lc', 'exec "$@"', '_', 'herdr', 'status'], 'no distro -> WSL default distro, no -d');
  delete process.env.MORING_FAKE_PLATFORM;
  assert.equal(wrap('claude', ['x'], { cwd: '/a' }).cmd, 'claude');
});
test('isWsl: detection + override; not a Windows-native wrap', () => {
  const keep = { ...process.env };
  try {
    process.env.MORING_FAKE_WSL = '1'; assert.equal(isWsl(), true);
    process.env.MORING_FAKE_WSL = '0'; assert.equal(isWsl(), false);
    delete process.env.MORING_FAKE_WSL;
    process.env.MORING_FAKE_PLATFORM = 'darwin'; process.env.WSL_DISTRO_NAME = 'Ubuntu-20.04';
    assert.equal(isWsl(), false, 'only a linux node can be "inside WSL"');
    process.env.MORING_FAKE_PLATFORM = 'linux'; assert.equal(isWsl(), true);
    delete process.env.WSL_DISTRO_NAME; delete process.env.WSL_INTEROP;
    process.env.MORING_FAKE_WSL = '1';
    assert.equal(wrap('claude', ['x'], { cwd: '/a' }).cmd, 'claude', 'inside WSL claude runs natively, no wsl.exe');
  } finally { for (const k of ['MORING_FAKE_WSL', 'MORING_FAKE_PLATFORM', 'WSL_DISTRO_NAME', 'WSL_INTEROP']) { if (k in keep) process.env[k] = keep[k]; else delete process.env[k]; } }
});
test('openTerminal inside WSL: Windows Terminal via cmd.exe, back into this distro, login shell; falls back without wt.exe', async () => {
  process.env.MORING_FAKE_WSL = '1'; process.env.WSL_DISTRO_NAME = 'Ubuntu-20.04';
  const launched = [];
  let wt = true;
  setRunner(async (cmd, args) => { if (cmd === 'cmd.exe' && args.includes('where')) { if (wt) return 'C:\\wt.exe'; throw new Error('not found'); } throw new Error('unexpected ' + cmd); });
  setLauncher((cmd, args, opts) => launched.push({ cmd, args, opts }));
  try {
    await openTerminal();
    assert.deepEqual(launched[0], { cmd: 'cmd.exe', args: ['/c', 'start', '', 'wt.exe', 'new-tab', '--title', 'moringgroove', 'wsl.exe', '-d', 'Ubuntu-20.04', '-e', 'bash', '-lc', 'exec "$@"', '_', 'herdr'], opts: { cwd: '/mnt/c' } });
    wt = false; await openTerminal();
    assert.deepEqual(launched[1].args.slice(0, 4), ['/c', 'start', 'moringgroove', 'wsl.exe'], 'no Windows Terminal -> plain console window');
    assert.equal(launched.length, 2);
  } finally { delete process.env.MORING_FAKE_WSL; delete process.env.WSL_DISTRO_NAME; }
});
test('shell quoting', () => { assert.equal(q("a b'c"), `'a b'\\''c'`); assert.equal(q('--resume'), '--resume'); });
test('grid plan gives n-1 splits, valid parents', () => {
  for (let n = 1; n <= 9; n++) {
    const plan = gridPlan(n); assert.equal(plan.length, n - 1);
    const made = new Set([0]);
    for (const s of plan) { assert.ok(made.has(s.from), `n=${n} parent ${s.from}`); assert.ok(s.ratio > 0 && s.ratio < 1); made.add(s.idx); }
    assert.equal(made.size, n);
  }
  assert.deepEqual(gridPlan(2), [{ idx: 1, from: 0, dir: 'right', ratio: 0.5 }]);
});
test('graph: wiki + md links, empty without docs', () => {
  const f = path.join(tmp, 'proj'); fs.mkdirSync(path.join(f, 'docs', 'sub'), { recursive: true });
  assert.equal(buildGraph(path.join(tmp, 'nope')).empty, true);
  assert.equal(buildGraph(f).empty, true);
  fs.writeFileSync(path.join(f, 'docs', 'a.md'), '# Alpha\nsee [[b]] and [c](sub/c.md) and [x](https://e.com/x.md)');
  fs.writeFileSync(path.join(f, 'docs', 'b.md'), '# Beta\n[[a|back]]');
  fs.writeFileSync(path.join(f, 'docs', 'sub', 'c.md'), 'no title');
  const g = buildGraph(f);
  assert.equal(g.nodes.length, 3); assert.equal(g.links.length, 3);
  assert.equal(g.nodes.find(n => n.id === 'a.md').title, 'Alpha');
  assert.equal(g.nodes.find(n => n.id === 'sub/c.md').title, 'c');
});
test('extractJson handles fenced and bare', () => {
  assert.deepEqual(extractJson('설명\n```json\n[{"a":1}]\n```\n끝'), [{ a: 1 }]);
  assert.deepEqual(extractJson('{"x":[1,2]} trailing'), { x: [1, 2] });
  assert.throws(() => extractJson('none'));
});
test('mcp + skills per folder', () => {
  const f = path.join(tmp, 'mp'); fs.mkdirSync(f);
  ms.setMcp(f, 'fs', { command: 'npx', args: ['-y', 'x'] });
  assert.deepEqual(Object.keys(ms.getMcp(f)), ['fs']);
  assert.throws(() => ms.setMcp(f, '../bad', { command: 'x' }));
  ms.delMcp(f, 'fs'); assert.deepEqual(ms.getMcp(f), {});
  ms.setSkill(f, 'review', '리뷰 방법: "중요"', '# 본문\n단계');
  const s = ms.listSkills(f); assert.equal(s[0].name, 'review'); assert.equal(s[0].description, '리뷰 방법: "중요"');
  assert.match(s[0].body, /본문/);
  ms.delSkill(f, 'review'); assert.equal(ms.listSkills(f).length, 0);
});

test('@mention file search: ranking, dirs, skips dot/node_modules', () => {
  const f = path.join(tmp, 'sf'); for (const d of ['docs/guide', 'src', 'node_modules/x', '.git']) fs.mkdirSync(path.join(f, d), { recursive: true });
  for (const n of ['README.md', 'docs/guide/setup.md', 'docs/notes.md', 'src/main.js', 'src/readme-helper.js', 'node_modules/x/readme.md', '.git/readme']) fs.writeFileSync(path.join(f, n), 'x');
  const q = x => searchFiles(f, x).map(r => r.path);
  assert.deepEqual(q('readme').slice(0, 2), ['README.md', 'src/readme-helper.js']);   // base-name prefix first
  assert.ok(!q('readme').some(p => p.includes('node_modules') || p.includes('.git')));
  assert.ok(q('guide').includes('docs/guide/') && searchFiles(f, 'guide').find(r => r.path === 'docs/guide/').dir);
  assert.ok(q('dg/set').includes('docs/guide/setup.md') || q('setup').includes('docs/guide/setup.md'));
  assert.ok(q('').length > 0 && q('zzzz-nope').length === 0);
});

test('@ path mentions: ../, ./, ~/, absolute list directories', () => {
  const root = path.join(tmp, 'pm'), proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, 'sub'), { recursive: true }); fs.mkdirSync(path.join(root, 'sibling'), { recursive: true });
  for (const n of ['outer.txt', 'proj/inner.md', 'proj/sub/deep.md', '.hidden']) fs.writeFileSync(path.join(root, n), 'x');
  const q = x => searchFiles(proj, x).map(r => r.path);
  assert.deepEqual(q('../'), ['../proj/', '../sibling/', '../outer.txt']);          // dirs first, hidden skipped
  assert.deepEqual(q('..'), q('../'));
  assert.deepEqual(q('../out'), ['../outer.txt']);
  assert.deepEqual(q('./'), ['./sub/', './inner.md']);
  assert.deepEqual(q('./su'), ['./sub/']);
  assert.ok(q('../.').includes('../.hidden'));
  assert.deepEqual(q(root + '/sib'), [root + '/sibling/']);
  assert.ok(Array.isArray(q('~/')));
  assert.deepEqual(q('../nope-dir/x'), []);
});

test('agents store: legacy single-agent file migrates; several agents per folder', async () => {
  const { agents, DATA } = await import('../lib/store.mjs');
  fs.writeFileSync(path.join(DATA, 'agents.json'), JSON.stringify({ '/x': { id: 'old1', name: '옛 에이전트', sessionId: 's1' } }));
  assert.deepEqual(agents.list('/x').map(a => a.id), ['old1']);          // object form is read as a one-element list
  agents.put('/x', { id: 'n2', name: '둘째' });
  agents.put('/x', { id: 'old1', name: '옛 에이전트', started: true });  // upsert by id, order kept
  assert.deepEqual(agents.list('/x').map(a => a.id), ['old1', 'n2']);
  assert.equal(agents.get('/x').id, 'old1'); assert.equal(agents.get('/x', 'n2').name, '둘째'); assert.equal(agents.get('/x', 'zz'), null);
  assert.ok(agents.makeDefault('/x', 'n2')); assert.equal(agents.get('/x').id, 'n2');
  assert.equal(agents.del('/x', 'n2').id, 'n2'); assert.equal(agents.get('/x').id, 'old1');
  agents.del('/x'); assert.deepEqual(agents.list('/x'), []); assert.equal('/x' in agents.all(), false);
});
