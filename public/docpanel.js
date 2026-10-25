// Document side panel inside the graph tab: Obsidian-style editor (CodeMirror 6) + reading view.
// The editor bundle is loaded lazily so the app starts fast.
let ed = null; // lazy module
const loadEd = () => (ed ||= import('/vendor/editor.js'));
const $ = s => document.querySelector(s);

export function initDocPanel({ api, getFolder, getNodes, onSaved, toast, onAsk }) {
  const pane = $('#pane-graph'), view = $('#docView'), host = $('#editorHost'), reading = $('#reading');
  const S = { id: null, title: '', editor: null, dirty: false, mode: localStorage.getItem('docMode') || 'live', isNew: false };
  if (!['live', 'source', 'read'].includes(S.mode)) S.mode = 'live';

  const setDirty = d => { S.dirty = d; $('#docSave').classList.toggle('dirty', d); };
  const confirmLeave = () => !S.dirty || confirm('저장하지 않은 변경 사항이 있습니다. 버리고 계속할까요?');

  function applyMode() {
    document.querySelectorAll('#docModes button').forEach(b => b.classList.toggle('on', b.dataset.m === S.mode));
    const read = S.mode === 'read';
    host.hidden = read; reading.hidden = !read;
    if (!S.editor) return;
    if (read) renderReading(); else { S.editor.setMode(S.mode); S.editor.focus(); }
  }
  async function renderReading() {
    const { renderMarkdown } = await loadEd();
    reading.innerHTML = renderMarkdown(S.editor.getText());
    reading.querySelectorAll('a').forEach(a => { if (!a.dataset.wiki) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } });
  }
  reading.addEventListener('click', e => { const a = e.target.closest('a[data-wiki]'); if (a) { e.preventDefault(); openByName(a.dataset.wiki); } });
  document.querySelectorAll('#docModes button').forEach(b => (b.onclick = () => { S.mode = b.dataset.m; localStorage.setItem('docMode', S.mode); applyMode(); }));

  async function save() {
    if (!S.id || !S.editor) return;
    try {
      await api('/api/doc', 'PUT', { folder: getFolder(), path: S.id, text: S.editor.getText() });
      setDirty(false); toast('저장되었습니다', 1500);
      if (S.isNew) S.isNew = false;
      onSaved?.(S.id);
    } catch (e) { toast(e.message); }
  }
  $('#docSave').onclick = save;

  async function show(id, title, text, isNew = false) {
    const { createEditor } = await loadEd();
    S.editor?.destroy(); host.replaceChildren();
    S.id = id; S.title = title; S.isNew = isNew; setDirty(isNew);
    $('#docTitle').textContent = title; $('#docPath').textContent = 'docs/' + id;
    view.hidden = false; pane.classList.add('docopen');
    S.editor = createEditor(host, { text, mode: S.mode === 'read' ? 'live' : S.mode, onChange: () => setDirty(true), onSave: save, onWiki: openByName });
    applyMode();
  }
  async function open(node) {
    if (S.id === node.id && !view.hidden) return;
    if (!confirmLeave()) return;
    const { text } = await api(`/api/doc?folder=${encodeURIComponent(getFolder())}&path=${encodeURIComponent(node.id)}`);
    await show(node.id, node.title, text);
  }
  async function create(name) {
    let id = name.trim().replace(/^\/+|\/+$/g, '').replace(/\\/g, '/'); if (!id) return;
    if (!/\.md$/i.test(id)) id += '.md';
    if (id.split('/').some(p => p === '..' || p === '')) throw new Error('올바르지 않은 이름입니다');
    if (!confirmLeave()) return;
    const title = id.replace(/\.md$/i, '').split('/').pop();
    await show(id, title, `# ${title}\n\n`, true);
    await save();
  }
  async function openByName(name) {
    const key = name.toLowerCase().replace(/\.md$/, '');
    const hit = getNodes().find(n => n.id.toLowerCase().replace(/\.md$/, '') === key || n.id.toLowerCase().replace(/\.md$/, '').split('/').pop() === key);
    if (hit) return open(hit);
    if (confirm(`"${name}" 문서가 없습니다. 새로 만들까요?`)) await create(name);
  }
  function close() { if (!confirmLeave()) return false; S.editor?.destroy(); S.editor = null; S.id = null; setDirty(false); view.hidden = true; view.classList.remove('max'); pane.classList.remove('docopen', 'docmax'); return true; }
  $('#docClose').onclick = close;
  $('#docMax').onclick = () => pane.classList.toggle('docmax', view.classList.toggle('max'));
  $('#docAsk').onclick = () => S.id && onAsk?.(S.id);

  // width resize (drag the left edge)
  const root = document.documentElement;
  const dw = Number(localStorage.getItem('docW')); if (dw) root.style.setProperty('--dw', dw + 'px');
  const h = $('#docHandle');
  h.onpointerdown = e => {
    e.preventDefault(); try { h.setPointerCapture(e.pointerId); } catch {} h.classList.add('drag'); document.body.classList.add('resizing');
    const pr = pane.getBoundingClientRect();
    const move = ev => { const w = Math.max(280, Math.min(pr.width - 160, pr.right - ev.clientX)); view.classList.remove('max'); pane.classList.remove('docmax'); root.style.setProperty('--dw', w + 'px'); localStorage.setItem('docW', Math.round(w)); };
    const up = () => { h.classList.remove('drag'); document.body.classList.remove('resizing'); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
  };
  h.ondblclick = () => { root.style.removeProperty('--dw'); localStorage.removeItem('docW'); };

  window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
  return { open, openByName, create, close, isDirty: () => S.dirty, confirmLeave, current: () => S.id };
}
