// The editor now lives in the standalone package packages/md-editor (copy that folder into any web project).
// This shim keeps the app's original API: createEditor({text, onWiki, ...}) + getText().
import { createMarkdownEditor, renderMarkdown } from '../packages/md-editor/src/index.js';

export { renderMarkdown };
export function createEditor(parent, { text = '', onWiki, ...rest }) {
  const e = createMarkdownEditor(parent, { value: text, onWikiLink: onWiki, placeholder: '내용을 입력하세요… ([[문서이름]]으로 다른 문서와 연결)', ...rest });
  return { ...e, getText: e.getValue };
}
