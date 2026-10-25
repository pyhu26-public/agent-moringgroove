# md-editor

Obsidian 방식의 마크다운 에디터. **CodeMirror 6**(옵시디언이 쓰는 에디터) 위에 **라이브 프리뷰 / 소스** 모드, **읽기 뷰**, **`[[위키링크]]`** 를 얹었다. 프레임워크 없이 DOM에 바로 붙고, React/Vue에서도 얇게 감싸 쓸 수 있다.

| 모드 | 동작 |
|---|---|
| 라이브 프리뷰 (`live`) | 입력하는 자리에서 렌더링. 커서가 있는 줄만 `#`, `**`, `[]()` 같은 마크업이 보인다 |
| 소스 (`source`) | 마크다운 원문 + 문법 하이라이트 |
| 읽기 (`read`) | `marked` + `DOMPurify`로 렌더링(표·체크박스·코드블록·위키링크) — `createMarkdownPane` 전용 |

## 설치 / 빌드
```bash
npm install          # 이 폴더에서
npm run build        # dist/ 생성 (esbuild, 언어 팩은 지연 로드)
npm run demo         # http://localhost:5177/demo/
npm test
```
번들러가 있는 프로젝트라면 `src/index.js`를 직접 import해도 된다 (필요한 의존성은 `package.json` 참고: `@codemirror/*`, `@lezer/highlight`, `marked`, `dompurify`).
번들러가 없으면 `dist/`를 복사해서 `<script type="module">`로 쓴다.

## 가장 쉬운 사용: `createMarkdownPane` (툴바 + 에디터 + 읽기 뷰)
```html
<link rel="stylesheet" href="dist/md-editor.css">
<div id="app" style="height:100vh"></div>
<script type="module">
  import { createMarkdownPane } from './dist/index.js';
  const pane = createMarkdownPane(document.getElementById('app'), {
    value: '# 제목\n\n[[다른 문서]]',
    mode: 'live',                                   // 'live' | 'source' | 'read'
    onSave: async text => { await save(text); pane.markClean(); },   // 저장 버튼 / Ctrl·Cmd+S
    onWikiLink: name => openDoc(name),              // [[링크]] 클릭 (모든 모드)
    onChange: (text, { dirty }) => {},
  });
</script>
```
`pane.getValue() · setValue(text) · getMode() · setMode(m) · isDirty() · markClean() · focus() · destroy()`

## 에디터만 쓰기: `createMarkdownEditor`
```js
import { createMarkdownEditor, renderMarkdown } from 'md-editor';
const ed = createMarkdownEditor(el, {
  value, mode: 'live', placeholder: '', readOnly: false,
  onChange: text => {}, onSave: text => {}, onWikiLink: name => {},
  extensions: [],                                    // 추가 CodeMirror 확장
});
ed.getValue(); ed.setValue(text); ed.setMode('source'); ed.focus(); ed.destroy(); ed.view /* EditorView */
const html = renderMarkdown(markdown);               // 읽기 뷰 HTML (sanitize됨). 담을 컨테이너에 class="md"
```
위키링크 클릭: 라이브 프리뷰는 클릭, 소스는 Ctrl/Cmd+클릭. 읽기 뷰의 링크는 `<a class="wikilink" data-wiki="이름">` 이니 직접 click 이벤트를 처리하면 된다.
보조 함수: `extractWikiLinks(text)`, `parseWiki('Page#Heading|별칭')`.

## 테마
색은 CSS 변수로 정한다. 우선순위: `--md-*` → 호스트 앱의 변수(`--bg --fg --acc --h --mut --code --ok --panel2`) → 내장 기본값.
`md-editor.css`를 불러오면 라이트/다크(`prefers-color-scheme` 또는 `<html data-theme="dark">`) 기본 팔레트가 들어온다.
```css
.my-card { --md-bg:#fff; --md-fg:#222; --md-accent:#e11d48; --md-heading:#000; --md-muted:#777; --md-code:#c2410c; --md-panel2:#f1f1f1; }
```

## 프레임워크에서
```jsx
// React
function MarkdownPane({ value, onSave }) {
  const ref = useRef(); const pane = useRef();
  useEffect(() => { pane.current = createMarkdownPane(ref.current, { value, onSave }); return () => pane.current.destroy(); }, []);
  useEffect(() => { if (pane.current && pane.current.getValue() !== value) pane.current.setValue(value); }, [value]);
  return <div ref={ref} style={{ height: '100%' }} />;
}
```
Vue는 `onMounted`/`onBeforeUnmount`에서 같은 방식으로 만들고 정리하면 된다.

## 알아둘 점
- 라이브 프리뷰에서 표·이미지는 원문 그대로 보인다(`- [ ]` 체크박스는 클릭해서 토글되는 체크박스로 보인다)(읽기 모드에서 렌더링). 옵시디언과 100% 같지는 않다.
- 저장·문서 목록·위키링크 해석은 앱이 맡는다(이 패키지는 `onSave`, `onWikiLink` 콜백만 호출).
- 한글 UI 문구는 `labels` 옵션으로 바꾼다: `{ live, source, read, save }`.
- 구조: `src/editor.js`(CodeMirror 코어) · `src/pane.js`(툴바 컴포넌트) · `src/render.js`(읽기 뷰) · `src/md-editor.css`.
