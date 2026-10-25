import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-'));
process.env.MORING_DATA = path.join(tmp, 'data');

const { toWslPath, wrap } = await import('../lib/platform.mjs');
const { gridPlan, q } = await import('../lib/terminal.mjs');
const { buildGraph } = await import('../lib/graph.mjs');
const { extractJson } = await import('../lib/claude.mjs');
const ms = await import('../lib/mcpskills.mjs');
const { searchFiles } = await import('../lib/fsx.mjs');

test('windows path -> wsl path', () => {
  assert.equal(toWslPath('C:\\Users\\me\\proj x'), '/mnt/c/Users/me/proj x');
  assert.equal(toWslPath('/home/me'), '/home/me');
});
test('wsl wrap on windows', () => {
  process.env.MORING_FAKE_PLATFORM = 'win32';
  const w = wrap('claude', ['-p', 'hi'], { cwd: 'D:\\work\\a', distro: 'Ubuntu' });
  assert.equal(w.cmd, 'wsl.exe');
  assert.deepEqual(w.args, ['-d', 'Ubuntu', '--cd', '/mnt/d/work/a', '--', 'claude', '-p', 'hi']);
  delete process.env.MORING_FAKE_PLATFORM;
  assert.equal(wrap('claude', ['x'], { cwd: '/a' }).cmd, 'claude');
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

test('codex: TOML overrides, command cleanup, history parsing', async () => {
  const c = await import('../lib/codex.mjs');
  assert.equal(c.mcpToml({}), 'mcp_servers={}');
  assert.equal(c.mcpToml({ 'my.srv': { command: 'npx', args: ['-y', 'x"y'], env: { A: 'b\nc' } }, h: { type: 'http', url: 'https://x/y', headers: { Authorization: 'Bearer t' } }, bad: { foo: 1 } }),
    'mcp_servers={"my.srv"={command="npx",args=["-y","x\\"y"],env={A="b\\nc"}},h={url="https://x/y",http_headers={Authorization="Bearer t"}}}');
  assert.equal(c.plainCommand("/bin/zsh -lc 'echo '\\''hi'\\'''"), "echo 'hi'");
  assert.equal(c.plainCommand('ls -la'), 'ls -la');
  assert.equal(c.errorText('{"type":"error","error":{"message":"nope"}}'), 'nope'); assert.equal(c.errorText('plain'), 'plain');
  const raw = [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '안녕' }] } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'k', input: 'text(await tools.exec_command({cmd:"rg --files docs",max_output_tokens:100}))' } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'k', output: 'docs/a.md' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '답' }] } },
  ].map(o => JSON.stringify(o)).join('\n');
  const h = c.parseHistory(raw);
  assert.deepEqual(h.map(m => m.k), ['user', 'tool', 'bot']); assert.equal(h[1].input, 'rg --files docs'); assert.equal(h[1].preview, 'docs/a.md');
  const st = { tools: new Set(), started: Date.now() };
  assert.deepEqual(c.toUi({ type: 'item.completed', item: { id: 'x', type: 'file_change', status: 'completed', changes: [{ path: 'a.md', kind: 'add' }] } }, st).map(e => e.t), ['tool', 'tool_result']);
  assert.equal(c.toUi({ type: 'item.completed', item: { id: 'r', type: 'reasoning', text: '..' } }, st).length, 0);
});
