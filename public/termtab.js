// Terminal tab: the real Claude Code TUI (pty on the server) rendered with xterm.js over a WebSocket.
let lib = null;
const load = () => (lib ||= import('/vendor/term.js'));

export function initTerm({ api, $, el, toast, getState, onClosed }) {
  const pane = $('#pane-term'); let cur = null; // { key (agent id), ws, t, ro }
  pane.replaceChildren(
    el('div', { className: 'termbar' }, el('span', { id: 'termStatus', className: 'muted' }, '폴더를 선택하세요'), el('span', { className: 'spacer' }),
      el('button', { id: 'termRestart', className: 'sm' }, '다시 연결'), el('button', { id: 'termKill', className: 'sm danger' }, '세션 종료')),
    el('div', { id: 'termHost' }));
  const status = t => ($('#termStatus').textContent = t);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const theme = () => ({ background: css('--bg'), foreground: css('--fg'), cursor: css('--fg'), selectionBackground: css('--acc') + '55' });

  function disconnect() {
    if (!cur) return;
    try { cur.ro.disconnect(); cur.ws.onclose = null; cur.ws.close(); } catch {}
    try { cur.t.term.dispose(); } catch {}
    $('#termHost').replaceChildren(); cur = null;
  }
  async function connect() {
    const { active: folder, agent } = getState();
    if (cur && cur.key === agent?.id) { setTimeout(() => cur.t.fit(), 30); return; }
    disconnect();
    if (!folder) return status('폴더를 선택하세요');
    if (!agent) return status('이 폴더에는 에이전트가 없습니다. 먼저 생성하세요.');
    const key = agent.id;
    const { createTerm } = await load();
    const host = $('#termHost'); host.replaceChildren();
    if (!document.getElementById('xtermCss')) document.head.append(el('link', { id: 'xtermCss', rel: 'stylesheet', href: '/vendor/xterm.css' }));
    const t = createTerm(host, theme()); const size = t.fit();
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/term?folder=${encodeURIComponent(folder)}&agent=${agent.id}&cols=${size.cols}&rows=${size.rows}`);
    const ro = new ResizeObserver(() => { const s = t.fit(); if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'resize', cols: s.cols, rows: s.rows })); });
    ro.observe(host);
    cur = { key, ws, t, ro };
    status('연결 중…');
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.t === 'ready') { status(`${agent.name} · ${agent.engine === 'codex' ? 'codex' : 'claude'} 세션 실행 중`); t.term.reset(); if (m.replay) t.term.write(m.replay); const s = t.fit(); ws.send(JSON.stringify({ t: 'resize', cols: s.cols, rows: s.rows })); t.term.focus(); agent.terminal = true; }
      else if (m.t === 'out') t.term.write(m.data);
      else if (m.t === 'exit') { status(`세션 종료됨 (코드 ${m.code}) — "다시 연결"로 새로 시작`); agent.terminal = false; onClosed?.(key); }
      else if (m.t === 'error') { status(m.message); toast(m.message); }
    };
    ws.onclose = () => { if (cur && cur.ws === ws) status('연결이 끊겼습니다 — "다시 연결"'); };
    t.term.onData(d => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'input', data: d })); });
  }
  $('#termRestart').onclick = () => { disconnect(); connect(); };
  $('#termKill').onclick = async () => {
    const { active: f, agent } = getState(); if (!f || !agent || !confirm('터미널의 세션 프로세스를 종료할까요? (대화 기록은 유지됩니다)')) return;
    await api('/api/terminal/kill', 'POST', { folder: f, agentId: agent.id }).catch(e => toast(e.message));
  };
  return { show: connect, hide: disconnect, retheme: () => cur?.t.term && (cur.t.term.options.theme = theme()), fit: () => cur?.t.fit() };
}
