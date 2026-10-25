// Native-style chat on the Claude Agent SDK: token streaming, markdown, tool cards,
// interactive permission prompts, stop button, slash-command autocomplete, history.
const MODES = { full: '전체 권한', ask: '매번 확인', workspace: '작업 폴더 쓰기', readonly: '읽기 전용' };

export function initChat({ api, $, el, toast, getState, onEnd }) {
  // Chat state is per agent (key = agent id): one folder can hold several agents with separate conversations.
  const C = new Map(); // agent id -> { folder, log, run, cmds, loaded, meta, tools }
  const st = k => C.get(k) || (C.set(k, { folder: getState().active, log: [], run: null, cmds: null, loaded: false, meta: {}, tools: {}, cur: null }), C.get(k));
  const active = () => getState().agent?.id;
  const fo = k => st(k).folder;
  let md = null; import('/vendor/editor.js').then(m => { md = m.renderMarkdown; for (const m2 of (active() ? st(active()).log : [])) if (m2.k === 'bot') mount(active(), m2); }).catch(() => {});

  const box = () => $('#chat');
  const nearBottom = () => { const c = box(); return c.scrollHeight - c.scrollTop - c.clientHeight < 80; };
  const stick = force => { const c = box(); if (force) c.scrollTop = c.scrollHeight; };

  /* ---------- message rendering ---------- */
  function build(m, f) {
    switch (m.k) {
      case 'user': return el('div', { className: 'msg user' }, m.text);
      case 'bot': { const d = el('div', { className: 'msg bot md' }); if (md) d.innerHTML = md(m.text); else d.textContent = m.text; d.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; }); return d; }
      case 'tool': {
        const ic = m.status === 'err' ? '✗' : m.status === 'ok' ? '✓' : '⏳';
        const d = el('details', { className: 'toolcard ' + (m.status || 'run') }, el('summary', {}, `${ic} ${m.name}  `, el('span', { className: 'muted' }, m.input || '')));
        if (m.detail || m.preview) d.append(el('pre', {}, (m.detail || '') + (m.preview ? '\n— 결과 —\n' + m.preview : '')));
        return d;
      }
      case 'perm': {
        const c = el('div', { className: 'card perm ' + m.state }, el('div', { className: 'row' }, el('b', { className: 'grow' }, `권한 요청: ${m.tool}`), el('span', { className: 'badge warn' }, m.state === 'pending' ? '대기 중' : m.state === 'allow' ? '허용됨' : '거부됨')),
          m.title ? el('div', { className: 'muted' }, m.title) : null, el('pre', {}, m.detail || m.summary));
        if (m.state === 'pending') {
          const answer = (behavior, always) => async () => { m.state = behavior; mount(f, m); try { await api('/api/chat/permission', 'POST', { folder: fo(f), agentId: f, id: m.id, behavior, always }); } catch (e) { toast(e.message); } };
          const ok = el('button', { className: 'sm primary' }, '허용'); ok.onclick = answer('allow', false);
          const row = el('div', { className: 'row' }, ok);
          if (m.canAlways) { const al = el('button', { className: 'sm' }, '이 세션에서 항상 허용'); al.onclick = answer('allow', true); row.append(al); }
          const no = el('button', { className: 'sm danger' }, '거부'); no.onclick = answer('deny', false); row.append(no);
          c.append(row);
        }
        return c;
      }
      case 'err': return el('div', { className: 'msg err' }, m.text);
      default: return el('div', { className: 'msg sys' }, m.text);
    }
  }
  const pending = new Set();
  function mount(f, m) {
    if (active() !== f) return;
    const follow = nearBottom() || m.k === 'user';
    const e = build(m, f);
    if (m.el && m.el.isConnected) m.el.replaceWith(e); else box().append(e);
    m.el = e; if (follow) stick(true);
  }
  function schedule(f, m) { if (pending.has(m)) return; pending.add(m); requestAnimationFrame(() => { pending.delete(m); mount(f, m); }); }
  function add(f, m) { st(f).log.push(m); mount(f, m); return m; }

  function renderAll() {
    box().replaceChildren();
    const f = active(), a = getState().agent;
    if (!getState().active) return;
    if (!a) return box().append(el('div', { className: 'msg sys' }, '이 폴더에는 아직 에이전트가 없습니다. "에이전트" 탭에서 생성하세요.'));
    const s = st(f);
    if (!s.log.length) box().append(el('div', { className: 'msg sys' }, a.started ? '이전 대화를 불러오는 중…' : a.engine === 'codex' ? '새 Codex 대화를 시작합니다. (슬래시 명령·스킬은 Codex 터미널에서 사용)' : '새 대화를 시작합니다. 슬래시(/) 명령과 스킬을 쓸 수 있습니다.'));
    for (const m of s.log) { m.el = null; mount(f, m); }
    stick(true); meta();
  }
  function meta() {
    const f = active(), a = getState().agent, m = $('#chatMeta'); m.replaceChildren();
    if (!a) return;
    const s = st(f), parts = [];
    parts.push(el('span', { className: 'engbadge ' + (a.engine || 'claude') }, a.engine === 'codex' ? 'Codex' : 'Claude'));
    parts.push(el('span', { className: 'badge' + (a.permission === 'full' ? ' warn' : ' ok') }, MODES[a.permission] || '전체 권한'));
    if (s.meta.model || a.model) parts.push(el('span', { className: 'muted' }, s.meta.model || a.model));
    if (s.meta.cost != null) parts.push(el('span', { className: 'muted' }, `직전 $${s.meta.cost.toFixed(3)} · ${(s.meta.duration / 1000).toFixed(1)}s`));
    else if (s.meta.tokens != null) parts.push(el('span', { className: 'muted' }, `직전 ${s.meta.tokens.toLocaleString()} 토큰 · ${(s.meta.duration / 1000).toFixed(1)}s`));
    if (s.meta.thinking) parts.push(el('span', { className: 'muted' }, '생각 중…'));
    m.append(...parts);
    if (a.terminal) {
      const b = el('button', { className: 'sm' }, '터미널 세션 종료');
      b.onclick = async () => { await api('/api/terminal/kill', 'POST', { folder: fo(f), agentId: f }).catch(() => {}); a.terminal = false; await reloadHistory(f); };
      m.append(el('span', { className: 'badge warn' }, '터미널이 세션 사용 중 — 채팅 불가'), b);
    }
  }

  /* ---------- history ---------- */
  async function show() {
    const f = active(), a = getState().agent; renderAll(); setRunning(false);
    if (!f || !a) return;
    const s = st(f);
    setRunning(!!s.run);
    if (!s.loaded) {
      s.loaded = true;
      if (a.started) {
        try { const { messages } = await api(`/api/chat/history?folder=${encodeURIComponent(fo(f))}&agentId=${f}`); if (!s.log.length) { s.log = messages.map(m => ({ ...m })); } } catch {}
        if (active() === f) renderAll();
      }
    }
    api(`/api/chat/commands?folder=${encodeURIComponent(fo(f))}&agentId=${f}`).then(r => { s.cmds = r.commands; s.items = r.items; }).catch(() => {});
  }
  async function reloadHistory(f) { const s = st(f); s.log = []; s.loaded = false; s.tools = {}; s.cur = null; if (active() === f) await show(); }

  /* ---------- sending / events ---------- */
  function setRunning(on) {
    const b = $('#chatForm button'), a = getState().agent;
    b.textContent = on ? '■ 중단' : '전송'; b.type = on ? 'button' : 'submit'; b.className = on ? 'danger' : 'primary'; b.disabled = !a;
  }
  function onEvent(f, s, ev) {
    switch (ev.t) {
      case 'init': s.meta.model = ev.model; s.cmds = [...new Set([...(ev.commands || []), ...(s.cmds || [])])]; meta(); break; // descriptions come from /api/chat/commands
      case 'block': if (ev.kind === 'text') { s.cur = add(f, { k: 'bot', text: '' }); } else if (ev.kind === 'thinking') { s.meta.thinking = true; meta(); } else s.cur = null; break;
      case 'delta': if (!s.cur) s.cur = add(f, { k: 'bot', text: '' }); s.cur.text += ev.text; schedule(f, s.cur); break;
      case 'thinking': break;
      case 'text': add(f, { k: 'bot', text: ev.text }); break;
      case 'tool': s.cur = null; s.meta.thinking = false; s.tools[ev.id] = add(f, { k: 'tool', id: ev.id, name: ev.name, input: ev.input, detail: ev.detail, status: 'run' }); break;
      case 'tool_result': { const m = s.tools[ev.id]; if (m) { m.status = ev.error ? 'err' : 'ok'; m.preview = ev.preview; mount(f, m); } break; }
      case 'permission': add(f, { k: 'perm', id: ev.id, tool: ev.tool, summary: ev.summary, detail: ev.detail, title: ev.title, canAlways: ev.canAlways, state: 'pending' }); break;
      case 'limit': add(f, { k: 'sys', text: `사용 한도 상태: ${ev.status}` + (ev.resetsAt ? ` (재설정 ${new Date(ev.resetsAt * 1000).toLocaleString()})` : '') }); break;
      case 'done': s.meta.cost = ev.cost; s.meta.duration = ev.duration; s.meta.tokens = ev.usage ? (ev.usage.input_tokens || 0) + (ev.usage.output_tokens || 0) : null; s.meta.thinking = false;
        if (ev.interrupted) add(f, { k: 'sys', text: '■ 응답이 중단되었습니다.' });
        else if (!ev.ok && ev.text) add(f, { k: 'err', text: ev.text });
        break;
      case 'notice': add(f, { k: 'sys', text: ev.text }); break;
      case 'error': add(f, { k: 'err', text: ev.message }); break;
      case 'end': s.cur = null; s.run = null; s.meta.thinking = false; if (active() === f) { setRunning(false); meta(); } onEnd?.(f); break;
    }
  }
  async function send(text) {
    const f = active(), a = getState().agent; if (!f || !a || !text.trim()) return;
    const s = st(f); if (s.run) return;
    if (a.terminal) { toast('터미널이 이 세션을 사용 중입니다. 먼저 터미널 세션을 종료하세요.'); return; }
    add(f, { k: 'user', text }); s.cur = null;
    const ctrl = new AbortController(); s.run = { ctrl }; setRunning(true);
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: fo(f), agentId: f, message: text }), signal: ctrl.signal });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i).replace(/^data: /, ''); buf = buf.slice(i + 2); if (line) { try { onEvent(f, s, JSON.parse(line)); } catch {} } }
      }
    } catch (e) { if (e.name !== 'AbortError') add(f, { k: 'err', text: e.message }); }
    finally { if (s.run) { s.run = null; if (active() === f) { setRunning(false); meta(); } } }
  }
  async function stop() {
    const f = active(), s = st(f); if (!s.run) return;
    try { const r = await api('/api/chat/interrupt', 'POST', { folder: fo(f), agentId: f }); if (!r.ok) s.run.ctrl.abort(); } catch { s.run.ctrl.abort(); }
  }

  /* ---------- form: "/" commands & skills, "@" file mentions ---------- */
  const input = $('#chatInput'), pop = $('#slashPop'); let sel = 0, items = [], tok = null, seq = 0, timer = null;
  const hide = () => { pop.hidden = true; items = []; };
  function token() {
    const pos = input.selectionStart, m = /(^|\s)([/@])([^\s]*)$/.exec(input.value.slice(0, pos));
    if (!m) return null;
    const start = pos - m[3].length - 1;
    if (m[2] === '/' && start !== 0) return null;            // slash commands only at the very start
    return { kind: m[2], q: m[3], start, end: pos };
  }
  function draw() {
    if (!items.length) return hide();
    sel = Math.min(sel, items.length - 1); pop.hidden = false;
    pop.replaceChildren(...items.map((it, i) => {
      const d = el('div', { className: 'it' + (i === sel ? ' on' : '') },
        el('span', { className: 'nm' }, it.label), it.desc ? el('span', { className: 'ds' }, it.desc) : null);
      d.onmousedown = e => { e.preventDefault(); pick(i); }; return d;
    }));
    pop.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  async function update() {
    tok = token(); const f = active(), s = f && st(f);
    if (!tok || !s) return hide();
    const mine = ++seq, q = tok.q.toLowerCase();
    if (tok.kind === '/') {
      const all = s.items || (s.cmds || []).map(n => ({ name: n, description: '', hint: '' }));
      const rank = c => (c.name.toLowerCase().startsWith(q) ? 0 : c.name.toLowerCase().includes(q) ? 1 : (c.description || '').toLowerCase().includes(q) ? 2 : 9);
      items = all.filter(c => rank(c) < 9).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 10)
        .map(c => ({ label: '/' + c.name + (c.hint ? ' ' + c.hint : ''), desc: c.description, insert: '/' + c.name + ' ' }));
      sel = 0; draw();
    } else {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const { files } = await api(`/api/chat/files?folder=${encodeURIComponent(fo(f))}&q=${encodeURIComponent(tok?.q || '')}`);
          if (mine !== seq) return;
          items = files.map(x => ({ label: (x.dir ? '📁 ' : '📄 ') + x.path, insert: '@' + x.path + (x.dir ? '' : ' '), keep: x.dir }));
          sel = 0; draw();
        } catch { hide(); }
      }, 90);
    }
  }
  function pick(i) {
    const it = items[i]; if (!it || !tok) return;
    const v = input.value, caret = tok.start + it.insert.length;
    input.value = v.slice(0, tok.start) + it.insert + v.slice(tok.end);
    input.setSelectionRange(caret, caret); input.focus();
    if (it.keep) update(); else hide();            // folders keep the popup open so you can drill down
  }
  input.addEventListener('input', () => { sel = 0; update(); });
  input.addEventListener('click', update);
  input.addEventListener('blur', () => setTimeout(hide, 120));
  input.addEventListener('keydown', e => {
    if (!pop.hidden && items.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; draw(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; draw(); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.isComposing)) { e.preventDefault(); pick(sel); return; }
      if (e.key === 'Escape') { hide(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chatForm').requestSubmit(); }
  });
  $('#chatForm').onsubmit = e => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ''; hide(); send(t); };
  $('#chatForm button').onclick = e => { if ($('#chatForm button').type === 'button') { e.preventDefault(); stop(); } };

  return { show, reloadHistory, send, stop, meta, isRunning: f => !!st(f).run };
}
