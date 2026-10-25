import { GraphView } from './graphview.js';
import { initDocPanel } from './docpanel.js';
import { initChat } from './chat.js';
import { initTerm } from './termtab.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const S = { roots: [], kids: new Map(), open: new Set(), checked: new Set(), active: null, agent: null, agents: [], newAgent: false, tab: 'graph', chats: new Map(), busy: false, graph: null, lt: 'folders', favs: [], nodes: [] };

async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status, data: j });
  return j;
}
let docs;
let toastT;
function toast(msg, ms = 3500) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => (t.style.display = 'none'), ms); }
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message); } };
const base = p => p.split(/[\\/]/).filter(Boolean).pop() || p;

/* ---------------- tree ---------------- */
async function loadKids(p) { if (!S.kids.has(p)) S.kids.set(p, (await api('/api/tree?path=' + encodeURIComponent(p))).dirs); return S.kids.get(p); }

async function renderTree() {
  const t = $('#tree'); t.replaceChildren();
  if (!S.roots.length) t.append(el('div', { className: 'empty', style: 'padding:14px' }, '＋ 루트 폴더를 추가하세요.'));
  for (const r of S.roots) await renderNode(t, { name: base(r), path: r, hasChildren: true, root: true }, 0);
  updateCli(); renderFavs();
}
async function renderNode(parent, d, depth) {
  const row = el('div', { className: 'node' + (d.root ? ' rootrow' : '') + (S.active === d.path ? ' active' : ''), style: `padding-left:${4 + depth * 14}px` });
  const tw = el('span', { className: 'tw' }, d.hasChildren ? (S.open.has(d.path) ? '▾' : '▸') : '');
  tw.onclick = guard(async () => { S.open.has(d.path) ? S.open.delete(d.path) : S.open.add(d.path); await renderTree(); });
  const ags = d.agents || [];
  const cb = el('input', { type: 'checkbox', checked: folderChecked(d.path, ags), style: 'width:auto', title: ags.length > 1 ? '이 폴더의 에이전트 전체 선택' : '' });
  cb.onchange = () => { toggleFolder(d.path, ags, cb.checked); updateCli(); if (ags.length > 1) renderTree(); };
  const nm = el('span', { className: 'nm', title: d.path }, d.name);
  nm.onclick = guard(() => activate(d.path));
  row.append(tw, cb, nm);
  if (!d.root) row.append(starEl(d.path));
  if (d.agent) row.append(agBadge(d));
  if (d.root) { const x = el('button', { className: 'sm', title: '루트 해제' }, '✕'); x.onclick = guard(async () => { await api('/api/roots', 'DELETE', { path: d.path }); await boot(); }); row.append(x); }
  parent.append(row);
  if (ags.length > 1) for (const a of ags) parent.append(agentRow(d.path, a, 4 + (depth + 1) * 14 + 14));
  if (S.open.has(d.path)) for (const k of await loadKids(d.path)) await renderNode(parent, k, depth + 1);
}
// selection keys for "CLI로 보기": folder\0agentId (folders without an agent: just the folder)
const ckey = (f, id) => (id ? f + '\0' + id : f);
const folderChecked = (f, ags) => (ags.length ? ags.every(a => S.checked.has(ckey(f, a.id))) : S.checked.has(f));
function toggleFolder(f, ags, on) { for (const k of ags.length ? ags.map(a => ckey(f, a.id)) : [f]) on ? S.checked.add(k) : S.checked.delete(k); }
const agBadge = d => el('span', { className: 'ag', title: '담당 에이전트: ' + (d.agents?.length ? d.agents.map(a => a.name).join(', ') : d.agent) }, '● ' + d.agent + (d.agents?.length > 1 ? ` +${d.agents.length - 1}` : ''));
function agentRow(folder, a, pad) {
  const row = el('div', { className: 'node agrow' + (S.active === folder && S.agent?.id === a.id ? ' active' : ''), style: `padding-left:${pad}px` });
  const cb = el('input', { type: 'checkbox', checked: S.checked.has(ckey(folder, a.id)), style: 'width:auto' });
  cb.onchange = () => { cb.checked ? S.checked.add(ckey(folder, a.id)) : S.checked.delete(ckey(folder, a.id)); updateCli(); };
  const nm = el('span', { className: 'nm', title: a.name }, '● ' + a.name); nm.onclick = guard(() => activate(folder, a.id));
  row.append(cb, nm); return row;
}
const isFav = p => S.favs.some(f => f.path === p);
function starEl(p) {
  const on = isFav(p), st = el('span', { className: 'star' + (on ? ' on' : ''), title: on ? '즐겨찾기 해제' : '즐겨찾기 추가' }, on ? '★' : '☆');
  st.onclick = guard(async e => { e.stopPropagation(); S.favs = (await api('/api/favorites', on ? 'DELETE' : 'PUT', { path: p })).favorites; renderTree(); renderFavs(); });
  return st;
}
function renderFavs() {
  const box = $('#favs'); box.replaceChildren();
  if (!S.favs.length) box.append(el('div', { className: 'empty', style: 'padding:14px' }, '폴더 목록에서 ☆를 눌러 즐겨찾기에 추가하세요.'));
  for (const f of S.favs) {
    const row = el('div', { className: 'node' + (S.active === f.path ? ' active' : '') });
    const fa = f.agents || [];
    const cb = el('input', { type: 'checkbox', checked: folderChecked(f.path, fa), style: 'width:auto' });
    cb.onchange = () => { toggleFolder(f.path, fa, cb.checked); updateCli(); renderTree(); };
    const nm = el('span', { className: 'nm', title: f.path }, f.name, el('span', { className: 'sub' }, f.path.split(/[\\/]/).slice(-3, -1).join('/')));
    nm.onclick = guard(() => activate(f.path));
    row.append(cb, nm, starEl(f.path));
    if (f.agent) row.append(agBadge(f));
    box.append(row);
  }
}
function showLeft(t) {
  S.lt = t; localStorage.setItem('leftTab', t);
  document.querySelectorAll('#ltabs button').forEach(b => b.classList.toggle('on', b.dataset.lt === t));
  $('#tree').hidden = t !== 'folders'; $('#favs').hidden = t !== 'favs'; $('#rootBar').hidden = t !== 'folders';
  if (t === 'favs') renderFavs();
}
document.querySelectorAll('#ltabs button').forEach(b => (b.onclick = () => showLeft(b.dataset.lt)));
function updateCli() {
  const n = S.checked.size;
  $('#cliBtn').textContent = `CLI로 보기 (${n})`; $('#cliBtn').disabled = !n;
}

/* ---------------- activation ---------------- */
const sel = () => { try { return JSON.parse(localStorage.getItem('agentSel') || '{}'); } catch { return {}; } };
function remember() { if (!S.active || !S.agent) return; try { const m = sel(); m[S.active] = S.agent.id; localStorage.setItem('agentSel', JSON.stringify(m)); } catch {} }
// reload this folder's agents; keep `prefer` (or the remembered / current one) selected, else the default (first)
async function refreshAgents(prefer) {
  const { agents } = await api('/api/agent?folder=' + encodeURIComponent(S.active));
  S.agents = agents; S.kids.clear(); // tree rows carry each folder's agent list: reload them
  S.agent = agents.find(a => a.id === prefer) || agents.find(a => a.id === S.agent?.id) || agents.find(a => a.id === sel()[S.active]) || agents[0] || null;
  remember();
}
async function activate(folder, agentId) {
  if (S.active && S.active !== folder && !docs.close()) return;
  const switching = S.active !== folder;
  S.active = folder; S.kids.delete(folder); S.newAgent = false;
  $('#folderName').textContent = folder;
  if (switching) S.agent = null;
  await refreshAgents(agentId);
  renderChatHeader(); renderChat();
  await Promise.all([loadGraph(), renderAgentTab(), renderToolsTab()]);
  if (!S.agent && S.tab === 'graph') showTab('agent');
  if (S.tab === 'term') termApi.show();
  renderTree(); renderFavs();
}
async function selectAgent(id) {
  const a = S.agents.find(x => x.id === id); if (!a) return;
  S.agent = a; S.newAgent = false; remember();
  renderChatHeader(); renderChat(); await renderAgentTab();
  if (S.tab === 'term') termApi.show();
  renderTree(); renderFavs();
}
function renderChatHeader() {
  const a = S.agent;
  try { chatApi.meta(); } catch {}
  const sl = $('#agentSel'); sl.hidden = !S.agents.length; sl.replaceChildren(...S.agents.map(x => el('option', { value: x.id, selected: a && x.id === a.id }, x.name)));
  $('#chatTitle').hidden = !!S.agents.length; $('#chatTitle').textContent = S.active ? '에이전트 없음' : '대화';
  $('#agentAdd').disabled = !S.active;
  const fb = $('#fullbadge'); fb.hidden = !a; if (a) { const pm = a.permission || 'full'; fb.textContent = { full: '전체 권한', ask: '매번 확인', readonly: '읽기 전용' }[pm]; fb.className = 'badge ' + (pm === 'full' ? 'warn' : 'ok'); }
  for (const id of ['recMcp', 'recSkill', 'cliOne']) $('#' + id).disabled = !S.active || (id === 'cliOne' && !a);
  $('#chatInput').disabled = !a; if (!a || !chatApi.isRunning(a.id)) $('#chatForm button').disabled = !a;
  $('#chatInput').placeholder = a ? `${a.name}에게 메시지 (Enter 전송, Shift+Enter 줄바꿈)` : (S.active ? '에이전트 탭에서 먼저 생성하세요' : '폴더를 선택하세요');
}
$('#agentSel').onchange = guard(() => selectAgent($('#agentSel').value));
$('#agentAdd').onclick = guard(async () => { S.newAgent = true; showTab('agent'); await renderAgentTab(); });

/* ---------------- tabs ---------------- */
function showTab(t) {
  S.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + t));
  if (t === 'graph' && S.graph) S.graph.resize();
  if (t === 'term') termApi.show(); else termApi.hide();
}
document.querySelectorAll('#tabs button').forEach(b => (b.onclick = () => showTab(b.dataset.tab)));

/* ---------------- graph ---------------- */
async function loadGraph(keep = false) {
  const box = $('#graphEmpty');
  if (!S.graph) S.graph = new GraphView($('#graph'), guard(n => docs.open(n)));
  $('#newDocBtn').hidden = !S.active; $('#newDoc').hidden = true;
  const g = await api('/api/graph?folder=' + encodeURIComponent(S.active));
  S.nodes = g.nodes || [];
  if (g.empty) {
    S.graph.clear(); box.style.display = 'flex'; box.replaceChildren(
      el('div', { style: 'font-size:34px' }, '🕸'),
      el('div', {}, g.reason === 'no-docs' ? 'docs 폴더가 없습니다.' : 'docs 폴더에 md 파일이 없습니다.'),
      el('div', {}, '에이전트에게 문서를 생성하게 하면 여기에 지식그래프가 표시됩니다.'),
      el('div', { className: 'row' }, S.agent ? el('button', { onclick: () => { $('#chatInput').value = 'docs 폴더를 만들고, 이 폴더의 업무를 정리한 md 문서를 서로 [[링크]]로 연결해서 작성해 주세요.'; $('#chatInput').focus(); } }, '에이전트에게 docs 생성 요청') : null,
        el('button', { onclick: () => $('#newDocBtn').click() }, '직접 새 문서 만들기')));
  } else { box.style.display = 'none'; keep ? S.graph.update(g) : S.graph.set(g); }
}
const askDoc = id => { $('#chatInput').value = `docs/${id} 문서를 읽고 요약해 주세요.`; $('#chatInput').focus(); };
docs = initDocPanel({
  api, toast, getFolder: () => S.active, getNodes: () => S.nodes, onAsk: askDoc,
  onSaved: async id => { const was = S.nodes.length; await loadGraph(true); if (!was) S.graph.set(await api('/api/graph?folder=' + encodeURIComponent(S.active))); S.graph?.select(id); },
});
$('#newDocBtn').onclick = () => { $('#newDocBtn').hidden = true; $('#newDoc').hidden = false; $('#newDocName').value = ''; $('#newDocName').focus(); };
$('#newDoc').onsubmit = guard(async e => { e.preventDefault(); const n = $('#newDocName').value; $('#newDoc').hidden = true; $('#newDocBtn').hidden = !S.active; await docs.create(n); });
$('#newDocName').addEventListener('keydown', e => { if (e.key === 'Escape') { $('#newDoc').hidden = true; $('#newDocBtn').hidden = !S.active; } });

/* ---------------- agent tab ---------------- */
const MODELS = ['', 'sonnet', 'opus', 'haiku', 'fable'];
async function renderAgentTab() {
  const box = $('#pane-agent'); box.replaceChildren();
  if (!S.active) return box.append(el('div', { className: 'empty' }, '폴더를 선택하세요.'));
  const creating = S.newAgent || !S.agent;
  // one folder can have several agents (each has its own conversation/session); pick one to edit, or add another
  if (S.agents.length) {
    const chips = el('div', { className: 'agchips' });
    for (const x of S.agents) { const c = el('button', { className: 'chip' + (!creating && S.agent?.id === x.id ? ' on' : '') }, x.name); c.onclick = guard(() => selectAgent(x.id)); chips.append(c); }
    const add = el('button', { className: 'chip add' + (creating ? ' on' : '') }, '＋ 새 에이전트'); add.onclick = guard(async () => { S.newAgent = true; await renderAgentTab(); });
    chips.append(add); box.append(chips);
  }
  const a = creating ? { name: base(S.active) + ' 담당' + (S.agents.length ? ' ' + (S.agents.length + 1) : ''), role: '', systemPrompt: '', model: '', fullAccess: true } : S.agent;
  const f = {
    name: el('input', { value: a.name }), role: el('input', { value: a.role, placeholder: '예: 이 폴더의 문서 정리와 리서치 담당' }),
    prompt: el('textarea', { rows: 10, value: a.systemPrompt, placeholder: '담당 범위, 작업 원칙, 참고할 파일, 금지 사항…' }),
    model: el('select', {}, MODELS.map(m => el('option', { value: m, selected: m === (a.model || '') }, m || '기본 모델'))),
    perm: el('select', {}, [['full', '전체 허용 — 모든 도구를 묻지 않고 실행'], ['ask', '매번 확인 — 쓰기/실행 도구는 채팅에서 허용·거부'], ['readonly', '읽기 전용 — Read/Glob/Grep만']].map(([v, t]) => el('option', { value: v, selected: v === (a.permission || 'full') }, t))),
    mcp: el('select', {}, el('option', { value: 'folder', selected: a.mcpMode !== 'inherit' }, '이 폴더에 등록한 MCP만 사용 (권장)'), el('option', { value: 'inherit', selected: a.mcpMode === 'inherit' }, '내 전역 MCP도 함께 사용')),
  };
  const save = el('button', { className: 'primary' }, creating ? '에이전트 생성' : '저장');
  save.onclick = guard(async () => {
    const r = await api('/api/agent', 'PUT', { folder: S.active, ...(S.newAgent && S.agents.length ? { new: true } : creating ? {} : { agentId: S.agent.id }), name: f.name.value, role: f.role.value, systemPrompt: f.prompt.value, model: f.model.value, permission: f.perm.value, mcpMode: f.mcp.value });
    S.newAgent = false; await refreshAgents(r.agent.id); renderChatHeader(); renderChat(); await renderAgentTab(); renderTree(); renderFavs(); toast('저장되었습니다'); if (S.tab === 'agent') loadGraph();
  });
  const draft = el('button', {}, '초안 자동 제안 (폴더 분석)');
  draft.onclick = guard(async () => {
    draft.disabled = true; draft.textContent = '폴더 분석 중… (최대 1~2분)';
    try { const { draft: d } = await api('/api/agent/draft', 'POST', { folder: S.active }); f.name.value = d.name; f.role.value = d.role; f.prompt.value = d.systemPrompt; toast('초안을 채웠습니다. 확인 후 저장하세요.'); }
    finally { draft.disabled = false; draft.textContent = '초안 자동 제안 (폴더 분석)'; }
  });
  const del = el('button', { className: 'danger' }, '에이전트 삭제');
  del.onclick = guard(async () => {
    if (!confirm(`"${S.agent.name}" 에이전트를 삭제할까요? (대화 세션 기록 파일은 유지됩니다)`)) return;
    await api(`/api/agent?folder=${encodeURIComponent(S.active)}&agentId=${S.agent.id}`, 'DELETE', {});
    S.agent = null; await refreshAgents(); renderChatHeader(); renderChat(); await renderAgentTab(); renderTree(); renderFavs();
  });
  const idx = S.agents.findIndex(x => x.id === S.agent?.id);
  const mkDef = el('button', {}, '기본 에이전트로 지정');
  mkDef.onclick = guard(async () => { await api('/api/agent/default', 'POST', { folder: S.active, agentId: S.agent.id }); await refreshAgents(S.agent.id); await renderAgentTab(); renderTree(); renderFavs(); toast('기본 에이전트로 지정했습니다 (트리·CLI 기본값)'); });
  box.append(...[
    el('h3', {}, creating ? (S.agents.length ? '이 폴더에 에이전트 추가' : '이 폴더에는 담당 에이전트가 없습니다 — 생성하세요') : '담당 에이전트 수정'),
    el('div', { className: 'muted' }, S.active),
    el('label', {}, '이름'), f.name, el('label', {}, '역할'), f.role, el('label', {}, '지침 (시스템 프롬프트)'), f.prompt,
    el('label', {}, '모델'), f.model, el('label', {}, 'MCP 범위'), f.mcp,
    el('label', {}, '권한 모드'), f.perm,
    el('div', { className: 'row', style: 'margin-top:14px' }, save, draft, !creating ? del : null, !creating && idx > 0 ? mkDef : null),
    !creating ? el('div', { className: 'muted', style: 'margin-top:12px' }, `세션 ID: ${S.agent.sessionId} ${S.agent.started ? '(진행 중 — 터미널에서 이어 열 수 있음)' : '(아직 시작 전)'}`) : null,
    S.agents.length > 1 ? el('div', { className: 'muted', style: 'margin-top:8px' }, '같은 폴더의 에이전트는 파일을 공유합니다. 여러 에이전트가 동시에 같은 파일을 수정하지 않도록 역할을 나눠 주세요. MCP·스킬은 폴더 단위로 함께 씁니다.') : null].filter(Boolean));
}

/* ---------------- MCP / skills tab ---------------- */
async function renderToolsTab() {
  const box = $('#pane-tools'); box.replaceChildren();
  if (!S.active) return box.append(el('div', { className: 'empty' }, '폴더를 선택하세요.'));
  const [m, s] = await Promise.all([api('/api/mcp?folder=' + encodeURIComponent(S.active)), api('/api/skills?folder=' + encodeURIComponent(S.active))]);
  const f = encodeURIComponent(S.active);

  box.append(el('h3', {}, 'MCP 서버 (이 폴더 전용 · .mcp.json)'));
  const names = Object.keys(m.servers);
  if (!names.length) box.append(el('div', { className: 'muted' }, '등록된 MCP가 없습니다.'));
  for (const n of names) {
    const rm = el('button', { className: 'sm danger' }, '삭제'); rm.onclick = guard(async () => { await api(`/api/mcp?folder=${f}&name=${encodeURIComponent(n)}`, 'DELETE', {}); renderToolsTab(); });
    box.append(el('div', { className: 'card' }, el('div', { className: 'row' }, el('b', { className: 'grow' }, n), rm), el('pre', {}, JSON.stringify(m.servers[n], null, 2))));
  }
  const nameI = el('input', { placeholder: '서버 이름 (예: github)' }), cfgI = el('textarea', { rows: 4, placeholder: '{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}' });
  const add = el('button', {}, 'MCP 추가'); add.onclick = guard(async () => { let c; try { c = JSON.parse(cfgI.value); } catch { throw new Error('설정이 올바른 JSON이 아닙니다'); } await api('/api/mcp', 'PUT', { folder: S.active, name: nameI.value.trim(), config: c }); renderToolsTab(); });
  const gl = Object.keys(m.global).filter(k => !m.servers[k]);
  const glSel = el('select', {}, el('option', { value: '' }, `전역 MCP에서 가져오기 (${gl.length})`), gl.map(k => el('option', { value: k }, k)));
  glSel.onchange = guard(async () => { if (!glSel.value) return; await api('/api/mcp', 'PUT', { folder: S.active, name: glSel.value, config: m.global[glSel.value] }); renderToolsTab(); });
  const recM = el('button', { className: 'primary' }, 'MCP 추천 에이전트 호출'); recM.onclick = () => runRecommend('mcp', recM, mcpOut);
  const mcpOut = el('div');
  box.append(el('label', {}, '직접 추가'), nameI, cfgI, el('div', { className: 'row', style: 'margin-top:6px' }, add, glSel, recM), mcpOut);

  box.append(el('h3', {}, '스킬 (이 폴더 전용 · .claude/skills)'));
  if (!s.skills.length) box.append(el('div', { className: 'muted' }, '등록된 스킬이 없습니다.'));
  for (const k of s.skills) {
    const ed = el('button', { className: 'sm' }, '편집'); ed.onclick = () => { sn.value = k.name; sd.value = k.description; sb.value = k.body; sn.scrollIntoView(); };
    const rm = el('button', { className: 'sm danger' }, '삭제'); rm.onclick = guard(async () => { await api(`/api/skills?folder=${f}&name=${encodeURIComponent(k.name)}`, 'DELETE', {}); renderToolsTab(); });
    box.append(el('div', { className: 'card' }, el('div', { className: 'row' }, el('b', { className: 'grow' }, k.name), ed, rm), el('div', { className: 'muted' }, k.description), el('pre', {}, k.body.slice(0, 400))));
  }
  const sn = el('input', { placeholder: '스킬 이름 (영문, 예: weekly-report)' }), sd = el('input', { placeholder: '설명: 언제 사용하는지 한 문장' }), sb = el('textarea', { rows: 6, placeholder: '# 스킬 본문 (사용 시점, 단계, 규칙)' });
  const sv = el('button', {}, '스킬 저장'); sv.onclick = guard(async () => { await api('/api/skills', 'PUT', { folder: S.active, name: sn.value.trim(), description: sd.value, body: sb.value }); renderToolsTab(); });
  const recS = el('button', { className: 'primary' }, '스킬 추천 에이전트 호출'); recS.onclick = () => runRecommend('skills', recS, skOut);
  const skOut = el('div');
  box.append(el('label', {}, '직접 추가 / 편집'), sn, sd, sb, el('div', { className: 'row', style: 'margin-top:6px' }, sv, recS), skOut);
  S.outs = { mcp: mcpOut, skills: skOut };
}
async function runRecommend(kind, btn, out) {
  if (!S.active) return;
  showTab('tools');
  out = out || S.outs?.[kind];
  btn && (btn.disabled = true);
  out.replaceChildren(el('div', { className: 'muted' }, kind === 'mcp' ? 'MCP 추천 에이전트가 폴더를 분석 중입니다… (최대 1~3분)' : '스킬 추천 에이전트가 폴더를 분석 중입니다… (최대 1~3분)'));
  try {
    const { items } = await api('/api/recommend/' + kind, 'POST', { folder: S.active });
    out.replaceChildren(...(items.length ? [] : [el('div', { className: 'muted' }, '추천할 항목이 없습니다.')]));
    for (const it of items) {
      const reg = el('button', { className: 'sm primary' }, '등록');
      reg.onclick = guard(async () => {
        if (kind === 'mcp') await api('/api/mcp', 'PUT', { folder: S.active, name: it.name, config: it.config });
        else await api('/api/skills', 'PUT', { folder: S.active, name: it.name, description: it.description, body: it.body });
        toast(`${it.name} 등록됨`); renderToolsTab();
      });
      out.append(el('div', { className: 'card' }, el('div', { className: 'row' }, el('b', { className: 'grow' }, it.name), reg),
        el('div', {}, kind === 'mcp' ? it.why : it.description), el('pre', {}, kind === 'mcp' ? JSON.stringify(it.config, null, 2) : it.body)));
    }
  } catch (e) { out.replaceChildren(el('div', { className: 'msg err' }, e.message)); } finally { btn && (btn.disabled = false); }
}
$('#recMcp').onclick = () => runRecommend('mcp', null);
$('#recSkill').onclick = () => runRecommend('skills', null);

/* ---------------- chat (Agent SDK) + terminal (pty) ---------------- */
const chatApi = initChat({ api, $, el, toast, getState: () => S, onEnd: () => loadUsage() });
const termApi = initTerm({ api, $, el, toast, getState: () => S, onClosed: k => { if (S.agent?.id === k) chatApi.reloadHistory(k); } });
const renderChat = () => chatApi.show();

/* ---------------- CLI view ---------------- */
async function openCli(targets, force = false) {
  try {
    const r = await api('/api/cli/open', 'POST', { targets, force });
    toast(`herdr에서 ${r.panes?.length || targets.length}개 pane을 열었습니다${r.startedServer ? ' (herdr 서버 시작됨)' : ''}`);
  } catch (e) {
    if (e.status === 409 && confirm(e.message + '\n\n그래도 여시겠습니까?')) return openCli(targets, true);
    throw e;
  }
}
$('#cliBtn').onclick = guard(() => openCli([...S.checked].map(k => { const [folder, agentId] = k.split('\0'); return { folder, agentId }; })));
$('#cliOne').onclick = guard(() => openCli([{ folder: S.active, agentId: S.agent.id }]));

/* ---------------- roots dialog ---------------- */
$('#addRoot').onclick = guard(() => browseDialog());
async function browseDialog(p) {
  const d = $('#dlg'), b = await api('/api/browse' + (p ? '?path=' + encodeURIComponent(p) : ''));
  const up = b.parent ? el('div', { className: 'brow', onclick: guard(() => browseDialog(b.parent)) }, '⬆ 상위 폴더') : null;
  const pick = el('button', { className: 'primary' }, '이 폴더를 루트로 추가');
  pick.onclick = guard(async () => { await api('/api/roots', 'POST', { path: b.path }); d.close(); await boot(); });
  const close = el('button', {}, '취소'); close.onclick = () => d.close();
  d.replaceChildren(el('h3', {}, '루트 폴더 선택'), el('div', { className: 'muted', style: 'word-break:break-all' }, b.path),
    el('div', { style: 'max-height:320px;overflow:auto;margin:8px 0;border:1px solid var(--line);border-radius:6px' }, up, b.dirs.map(x => el('div', { className: 'brow', onclick: guard(() => browseDialog(x.path)) }, '📁 ' + x.name))),
    el('div', { className: 'row' }, pick, close));
  if (!d.open) d.showModal();
}

/* ---------------- boot ---------------- */
async function boot() {
  const st = await api('/api/state');
  S.roots = st.roots; S.favs = st.favorites || []; S.kids.clear();
  $('#plat').textContent = st.wsl ? `Windows · WSL(${st.wslDistro})` : st.platform;
  for (const r of S.roots) S.open.add(r);
  await renderTree();
}

/* ---------------- resizable side panels ---------------- */
function splitter(id, cssVar, key, side, min, def) {
  const h = $('#' + id), root = document.documentElement, main = $('#main');
  const saved = Number(localStorage.getItem(key)); if (saved) root.style.setProperty(cssVar, saved + 'px');
  h.onpointerdown = e => {
    e.preventDefault(); try { h.setPointerCapture(e.pointerId); } catch {} h.classList.add('drag'); document.body.classList.add('resizing');
    const box = main.getBoundingClientRect();
    const move = ev => {
      const raw = side === 'left' ? ev.clientX - box.left : box.right - ev.clientX;
      const w = Math.round(Math.max(min, Math.min(box.width * 0.5, raw)));
      root.style.setProperty(cssVar, w + 'px'); localStorage.setItem(key, w); S.graph?.resize();
    };
    const up = () => { h.classList.remove('drag'); document.body.classList.remove('resizing'); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); S.graph?.resize(); };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
  };
  h.ondblclick = () => { root.style.setProperty(cssVar, def + 'px'); localStorage.removeItem(key); S.graph?.resize(); };
}
splitter('sp1', '--lw', 'leftW', 'left', 200, 280);
splitter('sp2', '--rw', 'rightW', 'right', 260, 380);

/* ---------------- theme ---------------- */
function applyTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('theme', t); } catch {} $('#themeBtn').textContent = t === 'dark' ? '☀' : '☾'; $('#themeBtn').title = t === 'dark' ? '라이트 테마로' : '다크 테마로'; S.graph?.redraw(); try { termApi.retheme(); } catch {} }
$('#themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
applyTheme(document.documentElement.dataset.theme || 'light');

/* ---------------- Claude limit gauge (5h session / 7d week) ---------------- */
let U = null, uRefreshed = 0;
const fmtLeft = sec => {
  if (sec == null) return '—'; if (sec <= 0) return '리셋됨';
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m}분` : `${m}분`;
};
function renderUsage() {
  const box = $('#usage'); box.replaceChildren();
  if (!U || !U.known) return box.append(el('span', { className: 'muted' }, '한도 정보 없음 (↻)'));
  const now = Math.floor(Date.now() / 1000);
  const part = (label, w) => {
    if (!w) return null;
    const left = w.resetsAt ? w.resetsAt - now : null, p = w.percent;
    const lvl = p == null ? '' : p >= 90 ? 'err' : p >= 70 ? 'warn' : '';
    return el('span', { className: 'u ' + lvl, title: `${label} 한도: ${p ?? '?'}% 사용` + (w.resetsAt ? ` · 리셋 ${new Date(w.resetsAt * 1000).toLocaleString()}` : '') },
      el('span', { className: 'muted' }, label), el('span', { className: 'bar2' }, el('i', { style: `width:${Math.min(100, p ?? 0)}%` })),
      el('b', {}, p == null ? '?' : p + '%'), el('span', { className: 'muted' }, '⏳ ' + fmtLeft(left)));
  };
  box.append(part('5시간', U.session), part('주간', U.week));
  if (U.status && U.status !== 'allowed') box.append(el('b', { style: 'color:var(--err)' }, '한도 도달'));
  const age = U.at ? Math.round((Date.now() - U.at) / 60000) : null;
  box.title = 'Claude 사용 한도' + (age != null ? ` · ${age}분 전 확인` : '');
}
async function loadUsage(refresh = false) {
  try {
    U = await api('/api/usage' + (refresh ? '?refresh=1' : '')); renderUsage();
    const stale = !U.known || U.session?.expired || U.week?.expired;
    if (!refresh && stale && Date.now() - uRefreshed > 300000) { uRefreshed = Date.now(); loadUsage(true); }
  } catch { renderUsage(); }
}
$('#usageRefresh').onclick = async () => { const b = $('#usageRefresh'); b.disabled = true; b.textContent = '…'; try { uRefreshed = Date.now(); await loadUsage(true); } finally { b.disabled = false; b.textContent = '↻'; } };
loadUsage(); setInterval(() => loadUsage(), 60000); setInterval(renderUsage, 30000);

showLeft(localStorage.getItem('leftTab') === 'favs' ? 'favs' : 'folders');
boot().catch(e => toast(e.message));
window.__mg = { S, docs }; // handle for debugging / automated UI checks
