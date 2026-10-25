import { createMarkdownPane } from '../dist/index.js';

const SAMPLE = `# md-editor 데모

**굵게**, *기울임*, \`인라인 코드\`, ~~취소선~~, [외부 링크](https://example.com), [[다른 문서]] 위키링크.

## 할 일
- [x] 라이브 프리뷰
- [ ] 내 프로젝트에 붙이기

> 커서가 있는 줄만 마크업이 보입니다.

\`\`\`js
console.log('code block');
\`\`\`

| 모드 | 설명 |
|---|---|
| live | 입력하면서 렌더링 |
| read | 완성된 화면 |
`;
const log = t => (document.getElementById('log').textContent = t);
const pane = createMarkdownPane(document.getElementById('app'), {
  value: SAMPLE,
  placeholder: '내용을 입력하세요…',
  onSave: text => { log(`저장됨 (${text.length}자)`); pane.markClean(); },
  onWikiLink: name => log(`위키링크 클릭: ${name}`),
  onChange: () => log('수정됨 — Ctrl/Cmd+S로 저장'),
});
document.getElementById('theme').onclick = () => {
  const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark';
};
window.pane = pane;
