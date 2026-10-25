// Drop-in component: toolbar (Live Preview / Source / Reading) + editor + rendered reading view.
// Plain DOM, no framework. Style it with md-editor.css (or your own, see class names .md-pane*).
import { createMarkdownEditor } from './editor.js';
import { renderMarkdown } from './render.js';

const MODES = [['live', '라이브 프리뷰'], ['source', '소스'], ['read', '읽기']];

/**
 * createMarkdownPane(container, options) -> { getValue, setValue, getMode, setMode, isDirty, markClean, focus, destroy, editor }
 *  value, placeholder, readOnly            as createMarkdownEditor
 *  mode        'live' | 'source' | 'read'  (default 'live')
 *  toolbar     show the mode buttons / save button (default true)
 *  labels      { live, source, read, save } button texts
 *  onChange(text, {dirty})   every edit
 *  onSave(text)              Save button or Ctrl/Cmd+S (call pane.markClean() once persisted)
 *  onWikiLink(name)          click on a [[wikilink]] in any mode
 *  onModeChange(mode)
 */
export function createMarkdownPane(container, opts = {}) {
  const labels = { live: '라이브 프리뷰', source: '소스', read: '읽기', save: '저장', ...(opts.labels || {}) };
  let mode = ['live', 'source', 'read'].includes(opts.mode) ? opts.mode : 'live';
  let dirty = false;

  const root = document.createElement('div'); root.className = 'md-pane';
  const bar = document.createElement('div'); bar.className = 'md-pane-bar';
  const seg = document.createElement('div'); seg.className = 'md-pane-seg';
  const save = document.createElement('button'); save.type = 'button'; save.className = 'md-pane-save'; save.textContent = labels.save;
  const host = document.createElement('div'); host.className = 'md-pane-editor';
  const reading = document.createElement('div'); reading.className = 'md-pane-reading md'; reading.hidden = true;
  const buttons = {};
  for (const [m] of MODES) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = labels[m]; b.dataset.mode = m;
    b.onclick = () => setMode(m); seg.append(b); buttons[m] = b;
  }
  if (opts.toolbar !== false) { bar.append(seg); if (opts.onSave) bar.append(save); root.append(bar); }
  root.append(host, reading); container.append(root);

  const editor = createMarkdownEditor(host, {
    value: opts.value || '', placeholder: opts.placeholder, readOnly: opts.readOnly,
    mode: mode === 'read' ? 'live' : mode,
    onChange: text => { setDirty(true); opts.onChange?.(text, { dirty }); },
    onSave: text => opts.onSave?.(text),
    onWikiLink: name => opts.onWikiLink?.(name),
  });
  save.onclick = () => opts.onSave?.(editor.getValue());

  function setDirty(d) { dirty = d; save.classList.toggle('dirty', d); root.classList.toggle('md-pane-dirty', d); }
  function paint() {
    for (const [m, b] of Object.entries(buttons)) b.classList.toggle('on', m === mode);
    host.hidden = mode === 'read'; reading.hidden = mode !== 'read';
    if (mode === 'read') {
      reading.innerHTML = renderMarkdown(editor.getValue());
      reading.querySelectorAll('a:not([data-wiki])').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    } else { editor.setMode(mode); editor.focus(); }
  }
  reading.addEventListener('click', e => { const a = e.target.closest('a[data-wiki]'); if (a) { e.preventDefault(); opts.onWikiLink?.(a.dataset.wiki); } });
  function setMode(m) { mode = m; paint(); opts.onModeChange?.(m); }
  paint();

  return {
    editor, root,
    getValue: () => editor.getValue(),
    setValue(text, { markClean = true } = {}) { editor.setValue(text); if (markClean) setDirty(false); if (mode === 'read') paint(); },
    getMode: () => mode, setMode,
    isDirty: () => dirty, markClean: () => setDirty(false),
    focus: () => editor.focus(),
    destroy() { editor.destroy(); root.remove(); },
  };
}
