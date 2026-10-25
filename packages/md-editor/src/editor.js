// Core editor: CodeMirror 6 (the editor Obsidian is built on) with two modes —
//   'live'   Live Preview: markup is hidden everywhere except on the lines the cursor touches
//   'source' plain Markdown with syntax highlighting
// Colors come from CSS variables with fallbacks:  --md-*  ->  host app variables  ->  built-in default.
import { EditorView, keymap, ViewPlugin, Decoration, WidgetType, drawSelection, highlightActiveLine, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxTree, syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { WIKI } from './render.js';

const v = (name, host, def) => `var(--md-${name}, var(${host}, ${def}))`;
const C = {
  bg: v('bg', '--bg', '#ffffff'), fg: v('fg', '--fg', '#1b1e27'), acc: v('accent', '--acc', '#2563eb'), h: v('heading', '--h', '#111827'),
  mut: v('muted', '--mut', '#667085'), code: v('code', '--code', '#c2410c'), ok: v('ok', '--ok', '#15803d'), panel2: v('panel2', '--panel2', '#eef0f5'),
};

const hl = HighlightStyle.define([
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '700', color: C.h },
  { tag: t.strong, fontWeight: '700' }, { tag: t.emphasis, fontStyle: 'italic' }, { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: C.acc }, { tag: t.url, color: C.mut }, { tag: t.monospace, color: C.code },
  { tag: [t.quote, t.processingInstruction, t.comment], color: C.mut },
  { tag: [t.keyword, t.operatorKeyword], color: C.acc }, { tag: [t.string, t.number], color: C.ok },
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: C.bg, color: C.fg, fontSize: '15px' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.7', overflow: 'auto' },
  '.cm-content': { padding: '14px 18px', caretColor: C.fg, maxWidth: '860px', margin: '0 auto' },
  '&.cm-focused': { outline: 'none' }, '.cm-cursor': { borderLeftColor: C.fg },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: `color-mix(in srgb, ${C.acc} 30%, transparent)` },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-line.lp-h1': { fontSize: '1.9em', fontWeight: '700', color: C.h, lineHeight: '1.35' },
  '.cm-line.lp-h2': { fontSize: '1.55em', fontWeight: '700', color: C.h, lineHeight: '1.4' },
  '.cm-line.lp-h3': { fontSize: '1.3em', fontWeight: '700', color: C.h },
  '.cm-line.lp-h4, .cm-line.lp-h5, .cm-line.lp-h6': { fontSize: '1.1em', fontWeight: '700', color: C.h },
  '.cm-line.lp-quote': { borderLeft: `3px solid ${C.acc}`, paddingLeft: '12px', color: C.mut },
  '.cm-line.lp-code': { backgroundColor: C.panel2, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '.92em' },
  '.lp-wiki': { color: C.acc, textDecoration: 'underline', cursor: 'pointer' },
  '.lp-link': { color: C.acc, textDecoration: 'underline' },
  '.lp-task': { display: 'inline-block', width: '1em', height: '1em', padding: '0', margin: '0 6px 0 2px', verticalAlign: '-0.12em', cursor: 'pointer', accentColor: C.acc }, // explicit sizes: host apps often style every <input> as a full-width field
  '.lp-done': { textDecoration: 'line-through', color: C.mut },
  '.lp-icode': { backgroundColor: C.panel2, borderRadius: '4px', padding: '0 4px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '.92em' },
  '.cm-placeholder': { color: C.mut },
});

const hide = Decoration.replace({});

// - [ ] / - [x] task items: the marker becomes a clickable checkbox that toggles the text
class CheckboxWidget extends WidgetType {
  constructor(checked) { super(); this.checked = checked; }
  eq(o) { return o.checked === this.checked; }
  toDOM(view) {
    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = this.checked; box.className = 'lp-task';
    box.addEventListener('mousedown', e => e.preventDefault()); // don't move the cursor into the line
    box.addEventListener('click', e => {
      e.preventDefault();
      if (view.state.readOnly) return;
      const from = view.posAtDOM(box);
      if (view.state.doc.sliceString(from, from + 3).length === 3) view.dispatch({ changes: { from, to: from + 3, insert: this.checked ? '[ ]' : '[x]' } });
    });
    return box;
  }
  ignoreEvent() { return true; }
}
const cls = c => Decoration.mark({ class: c });
const lineDeco = c => Decoration.line({ class: c });

function buildLive(view) {
  const ranges = [];
  const active = new Set();
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number, b = view.state.doc.lineAt(r.to).number;
    for (let i = a; i <= b; i++) active.add(i);
  }
  const lineOn = pos => active.has(view.state.doc.lineAt(pos).number);
  const eachLine = (n, c) => { for (let p = n.from; p <= n.to;) { const l = view.state.doc.lineAt(p); ranges.push({ from: l.from, to: l.from, v: lineDeco(c), line: true }); p = l.to + 1; } };
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to, enter: n => {
        const name = n.name, on = lineOn(n.from);
        let m;
        if ((m = /^ATXHeading([1-6])$/.exec(name))) ranges.push({ from: n.from, to: n.from, v: lineDeco('lp-h' + m[1]), line: true });
        else if (name === 'Blockquote') eachLine(n, 'lp-quote');
        else if (name === 'FencedCode') eachLine(n, 'lp-code');
        else if (name === 'InlineCode') ranges.push({ from: n.from, to: n.to, v: cls('lp-icode') });
        else if (name === 'Link') ranges.push({ from: n.from, to: n.to, v: cls('lp-link') });
        if (name === 'TaskMarker') {
          const checked = /\[[xX]\]/.test(view.state.doc.sliceString(n.from, n.to));
          ranges.push({ from: n.from, to: n.to, v: Decoration.replace({ widget: new CheckboxWidget(checked) }) });
          const task = n.node.parent; // Task: marker + the item text
          if (checked && task && task.to > n.to) ranges.push({ from: n.to, to: task.to, v: cls('lp-done') });
          const li = task?.parent;
          if (!on && li?.name === 'ListItem' && li.parent?.name === 'BulletList') { const lm = li.getChild('ListMark'); if (lm) ranges.push({ from: lm.from, to: n.from, v: hide }); } // drop the bullet, keep the checkbox
          return;
        }
        if (on) return;
        const parent = n.node.parent?.name;
        if (name === 'HeaderMark') { const l = view.state.doc.lineAt(n.from); if (l.text.slice(0, n.to - l.from).trim().startsWith('#')) ranges.push({ from: n.from, to: Math.min(n.to + 1, l.to), v: hide }); }
        else if (name === 'EmphasisMark' || name === 'StrikethroughMark') ranges.push({ from: n.from, to: n.to, v: hide });
        else if (name === 'QuoteMark') ranges.push({ from: n.from, to: n.to + 1, v: hide });
        else if (name === 'CodeMark' && parent === 'InlineCode') ranges.push({ from: n.from, to: n.to, v: hide });
        else if ((name === 'LinkMark' || name === 'URL') && parent === 'Link') ranges.push({ from: n.from, to: n.to, v: hide });
      },
    });
    const text = view.state.doc.sliceString(from, to);
    for (const mm of text.matchAll(WIKI)) { // [[wikilinks]]
      const s = from + mm.index, e = s + mm[0].length;
      ranges.push({ from: s, to: e, v: cls('lp-wiki') });
      if (!lineOn(s)) { ranges.push({ from: s, to: s + 2, v: hide }); ranges.push({ from: e - 2, to: e, v: hide }); }
    }
  }
  // lezer parses [[x]] as a nested Link, so hides can overlap: merge them, let CodeMirror sort the rest
  const hides = ranges.filter(r => r.v === hide).sort((x, y) => x.from - y.from), merged = [];
  for (const h of hides) { const l = merged[merged.length - 1]; if (l && h.from <= l.to) l.to = Math.max(l.to, h.to); else merged.push({ from: h.from, to: h.to }); }
  const out = ranges.filter(r => r.v !== hide).map(r => (r.line ? r.v.range(r.from) : r.v.range(r.from, r.to)));
  for (const h of merged) if (h.to > h.from) out.push(hide.range(h.from, h.to));
  return Decoration.set(out, true);
}
const livePreview = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildLive(view); }
  update(u) { if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) this.decorations = buildLive(u.view); }
}, { decorations: v => v.decorations });

const wikiAt = (view, pos) => {
  const line = view.state.doc.lineAt(pos);
  for (const m of line.text.matchAll(WIKI)) {
    const s = line.from + m.index, e = s + m[0].length;
    if (pos >= s && pos <= e) return m[1].split('|')[0].split('#')[0].trim();
  }
  return null;
};

/**
 * createMarkdownEditor(parent, options) -> { view, getValue, setValue, setMode, getMode, focus, destroy }
 *  value        initial text
 *  mode         'live' (default) | 'source'
 *  placeholder  text shown when empty
 *  readOnly     disable editing
 *  onChange(text)       every edit
 *  onSave(text)         Ctrl/Cmd+S
 *  onWikiLink(name)     click on a [[wikilink]] (Live Preview) or Ctrl/Cmd+click (Source)
 *  extensions           extra CodeMirror extensions
 */
export function createMarkdownEditor(parent, opts = {}) {
  const { value = '', placeholder = '', readOnly = false, onChange, onSave, onWikiLink, extensions = [] } = opts;
  let mode = opts.mode === 'source' ? 'source' : 'live';
  const modeC = new Compartment();
  const modeExt = m => (m === 'live' ? [livePreview] : []);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: value,
      extensions: [
        history(), drawSelection(), highlightActiveLine(), indentOnInput(), bracketMatching(), EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: languages }), syntaxHighlighting(hl), theme, modeC.of(modeExt(mode)),
        placeholder ? cmPlaceholder(placeholder) : [],
        readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: v => (onSave?.(v.state.doc.toString()), true) }, indentWithTab, ...markdownKeymap, ...historyKeymap, ...defaultKeymap]),
        EditorView.updateListener.of(u => { if (u.docChanged) onChange?.(u.state.doc.toString()); }),
        EditorView.domEventHandlers({
          mousedown(e, v) {
            const onWiki = e.target.closest?.('.lp-wiki') && mode === 'live';
            if (!(e.metaKey || e.ctrlKey) && !onWiki) return false;
            const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }); if (pos == null) return false;
            const w = wikiAt(v, pos); if (w) { e.preventDefault(); onWikiLink?.(w); return true; }
            return false;
          },
        }),
        ...extensions,
      ],
    }),
  });
  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(text) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); },
    setMode(m) { mode = m === 'source' ? 'source' : 'live'; view.dispatch({ effects: modeC.reconfigure(modeExt(mode)) }); },
    getMode: () => mode,
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
