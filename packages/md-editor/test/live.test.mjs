import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { buildLive } from '../src/editor.js';

// Live Preview decorations for `text`, cursor on line 1 (so everything below it is "inactive" and gets its markup hidden).
function decorate(text, head = 0) {
  const state = EditorState.create({ doc: text, selection: { anchor: head }, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(state, state.doc.length, 20000);
  const set = buildLive({ state, visibleRanges: [{ from: 0, to: state.doc.length }] });
  const replaced = [];
  set.between(0, state.doc.length, (from, to, deco) => { if (to > from && deco.point) replaced.push({ from, to, text: state.doc.sliceString(from, to) }); });
  return { state, replaced };
}

// CodeMirror refuses replace decorations that cover a line break when they come from a plugin
// ("Decorations that replace line breaks may not be specified via plugins") and the editor stops rendering.
test('live preview never replaces a line break (empty ">" lines, adjacent marks)', () => {
  const docs = [
    'intro\n\n>\n> **굵게**\n>\n> 본문\n',          // the case that broke docs/study: an empty quote line next to a marked line
    'intro\n\n> a\n>\n>\n> b\n',
    'intro\n\n> > 중첩\n> >\n> 끝\n',
    'intro\n\n>\n',                                  // ">" as the last line
    'intro\n\n- [ ] 할 일\n- [x] 끝\n>\n# 제목 #\n',
    'intro\n\n[[a]]\n[[b]]\n**x**\n**y**\n~~z~~\n',
  ];
  for (const d of docs) {
    const { replaced } = decorate(d);
    for (const r of replaced) assert.ok(!r.text.includes('\n'), `replace covers a line break in ${JSON.stringify(d)}: ${JSON.stringify(r.text)}`);
  }
});

test('live preview still hides quote markers on lines the cursor is not on', () => {
  const { replaced } = decorate('intro\n\n> 인용\n>\n> 둘째\n');
  const hidden = replaced.map(r => r.text);
  assert.ok(hidden.includes('> '), 'the ">" and its space are hidden');
  assert.ok(hidden.includes('>'), 'an empty ">" line is hidden too (without its line break)');
});

test('live preview keeps markup on the cursor line', () => {
  const text = 'intro\n\n> 인용\n';
  const { replaced } = decorate(text, text.indexOf('인용'));
  assert.equal(replaced.filter(r => r.text.startsWith('>')).length, 0);
});
