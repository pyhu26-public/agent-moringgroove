# Agent Moringgroove — MVP 기획안

> 로컬 폴더 = 업무 단위. 폴더마다 전담 에이전트(로컬 Claude CLI)를 붙이고, 문서는 지식그래프로, 세션은 터미널(herdr)로 이어가는 웹-서버 멀티에이전트 관리 툴.

## 1. 한 줄 정의
지정한 로컬 루트 폴더를 트리로 보여주고, **폴더를 고르면 그 폴더의 업무를 맡은 에이전트가 호출**되어 대화·지식그래프·MCP/스킬 관리·터미널 이어가기까지 한 화면에서 처리하는 로컬 웹앱.

## 2. agents-office 참고 분석 (재사용 / 변경)

| 항목 | agents-office | 이 프로젝트 |
|---|---|---|
| 서버 | 의존성 없는 `node serve.mjs` (http, :4520), 단일 파일 API | 동일 방식 유지 (Node 20+, 최소 의존성) |
| 에이전트 실행 | `claude -p … --output-format stream-json --verbose` spawn, `CLAUDECODE` env 제거 | **재사용.** 단 `--no-session-persistence` 제거, `--session-id`/`--resume`으로 세션 보존 |
| 권한 | Bash/Edit/Write 등 `--disallowedTools` 차단 | 폴더 에이전트는 `cwd=폴더`, **전체 권한 허용** (8장 안전장치) |
| 에이전트 정의 | `office.agents.json` (35석 고정) | **폴더당 1에이전트, 자유 생성/수정** (JSON 파일 저장) |
| MCP | `claude mcp list` 파싱, allow/deny | **폴더별** `--mcp-config` + `--strict-mcp-config` |
| 스킬 | brain 폴더 `skills/<name>/SKILL.md` 로더 | 폴더별 `.claude/skills/` 로 등록 (Claude Code 네이티브) |
| 지식그래프 | `graph-build.mjs`가 d3-force로 **빌드 시 좌표만 사전 계산**, three.js 3D에 정적 표시 (재사용할 인터랙티브 컴포넌트 없음) | **새로 선정: `force-graph`** (6장 참고). 대상은 선택 폴더의 `docs/**/*.md` |
| UI | three.js 3D 오피스 | **전혀 다름**: 좌측 트리 + 중앙 그래프 + 우측 채팅 |

주의: agents-office는 PolyForm Noncommercial + 추가 약관(재브랜딩·타 제품 결합 금지)이다. **코드 복사가 아니라 구조·패턴 참고**로 새로 작성한다.

## 3. 기능 요구사항 (제공해주신 목록 → 기능 ID)

| ID | 기능 | MVP |
|---|---|---|
| F1 | 지정 로컬 폴더 구조를 좌측 트리로 표시 | ✅ |
| F2 | 폴더 선택 시 하위 `docs/**/*.md`를 지식그래프로 표시 | ✅ |
| F3 | 폴더 선택 시 담당 에이전트 호출, 없으면 생성, 이후 수정 | ✅ |
| F4 | 에이전트 호출 시 대화창 오픈 | ✅ |
| F5 | 대화 → 로컬 `claude` CLI 호출 (스트리밍) | ✅ |
| F6 | 폴더별 MCP·스킬 등록 | ✅ |
| F7 | MCP 추천 에이전트 / 스킬 추천 에이전트 (폴더 업무 기반) | ✅ |
| F8 | 위 추천 에이전트를 기능(버튼)으로 호출 | ✅ |
| F9 | "CLI로 보기" → 터미널 → herdr → 진행 중이던 Claude 세션 이어서 열기 | ✅ |
| F10 | 멀티 폴더 선택 후 "CLI로 보기" → pane split으로 한 번에 보기 | ✅ |

## 4. 화면 구성

```
┌──────────────┬───────────────────────────────┬──────────────────┐
│ 폴더 트리    │  [그래프] [에이전트] [MCP/스킬]│  채팅 (에이전트)  │
│  ☑ proj-a    │                               │  ▸ 대화 스트림    │
│   ├ docs     │   docs/*.md 지식그래프        │  ▸ 도구 사용 로그 │
│   └ src      │   (노드=md, 엣지=링크)        │  [입력]           │
│  ☐ proj-b    │                               │                   │
│ [CLI로 보기] │  하단: 선택 폴더 에이전트 카드 │  [CLI로 보기]     │
└──────────────┴───────────────────────────────┴──────────────────┘
```

- 트리: 체크박스로 멀티 선택, 클릭으로 활성 폴더. 에이전트가 있는 폴더는 뱃지 표시.
- 가운데 탭: **그래프 / 에이전트 설정 / MCP·스킬**.
- 우측: 활성 폴더 에이전트와의 채팅. 탭 헤더에 MCP/스킬 추천 호출 버튼.

## 5. 아키텍처

```
Browser (Vanilla/Preact + d3-force)
   │  REST + SSE
Node 서버 (serve.mjs 스타일, :4600, 127.0.0.1 바인딩)
   ├─ fs 모듈      : 루트 하위 트리, md 스캔 (루트 밖 접근 차단)
   ├─ store        : data/agents.json, data/sessions.json (폴더경로 → 에이전트/세션ID)
   ├─ claude 러너   : spawn('claude', …) stream-json → SSE 중계
   ├─ mcp/skill    : 폴더별 .mcp.json · .claude/skills 읽기/쓰기
   ├─ graph        : md 파싱([[wikilink]], [text](x.md)) → nodes/edges
   └─ herdr 브리지  : herdr CLI(workspace/pane split/run) 호출
```

### 5.1 폴더 ↔ 에이전트 모델
```json
{
  "folder": "/Users/…/proj-a",
  "agent": { "id": "a1", "name": "프로젝트A 담당", "role": "…",
             "systemPrompt": "…", "model": "sonnet", "tools": ["Read","Grep"],
             "sessionId": "uuid", "createdAt": "…" }
}
```
- 폴더 선택 → `agents.json` 조회 → 있으면 호출, 없으면 "생성" 폼(이름·역할·프롬프트; 폴더 구조·README를 읽어 **초안 자동 제안** 가능).
- 수정은 같은 폼으로, 저장 즉시 반영(다음 턴부터 적용).

### 5.2 채팅 = 로컬 Claude CLI (F5)
```
claude -p "<입력>" --output-format stream-json --verbose
       --session-id <uuid> (첫 턴) | --resume <uuid> (이후)
       --append-system-prompt "<에이전트 프롬프트>"
       --mcp-config <폴더 mcp.json> --strict-mcp-config
       --allowedTools …   (cwd = 폴더)
```
- 서버가 stdout JSON 라인을 SSE로 브라우저에 전달.
- **핵심 설계:** 세션을 `cwd` 기준으로 영속화하면 웹 채팅과 터미널 `claude --resume <id>`가 **같은 대화**를 공유 → F9의 기반.
- `CLAUDECODE` 환경변수 제거(agents-office와 동일), 동시 실행은 폴더당 1개 큐.

### 5.3 지식그래프 (F2)
- 대상: 선택 폴더의 `docs/**/*.md` (재귀). 파일 mtime 캐시.
- 노드: 파일(제목=첫 H1/파일명, 크기=링크 수). 엣지: wikilink, 상대경로 링크, (옵션) 공통 태그.
- 노드 클릭 → 본문 미리보기 + "이 문서로 에이전트에 질문".
- 렌더: **`force-graph` (vasturiano, Canvas 2D)** — 6장 비교 참고. 폴더 변경 시 `graphData()`만 교체.
- `docs` 폴더가 없거나 md가 0개면 **그래프를 비우고** 안내 문구 표시: *"docs 폴더가 없습니다. 에이전트에게 문서를 생성하게 하면 여기에 지식그래프가 표시됩니다."* + [에이전트에게 docs 생성 요청] 버튼(채팅에 프롬프트 프리필). 문서가 생기면 파일 변경 감지(mtime 폴링 또는 `fs.watch`)로 자동 갱신.

### 5.4 폴더별 MCP·스킬 (F6)
- **MCP:** `<폴더>/.mcp.json`을 UI에서 추가/삭제/토글(서버 이름, command/args/env 또는 URL). 채팅 시 해당 파일만 `--mcp-config`로 주입. 전역 등록 서버 목록(`claude mcp list`)에서 "이 폴더에 가져오기" 지원.
- **스킬:** `<폴더>/.claude/skills/<name>/SKILL.md` 생성/편집/삭제(프론트매터 name·description). 템플릿 제공. Claude Code가 자동 인식하므로 별도 로더 불필요.

### 5.5 추천 에이전트 (F7·F8)
시스템 내장 에이전트 2종(폴더 에이전트와 별개, 읽기 전용 + 웹검색):
1. **MCP 추천 에이전트** — 입력: 폴더 트리 요약, README/docs 제목, 기존 에이전트 역할, 이미 등록된 MCP. 출력: `[{name, why, installConfig}]` JSON.
2. **스킬 추천 에이전트** — 동일 입력. 출력: `[{name, description, SKILL.md 초안}]`.
- 호출: MCP·스킬 탭의 "추천 받기" 버튼 + 채팅 헤더 버튼. 결과는 카드로 표시, **"등록" 클릭 시에만** 파일 기록(자동 설치 금지).
- 구현은 5.2와 동일한 러너에 `--json-schema`/출력 JSON 파싱을 얹는 것.

### 5.6 CLI로 보기 — herdr 연동 (F9·F10)
herdr 확인 결과 `workspace create`, `pane split`, `pane run`, `pane send-text` 등 소켓 API가 있어 자동화 가능.

- **F9 (단일):** 버튼 → 서버가 `herdr`에서 워크스페이스/pane 생성 → `cd <폴더> && claude --resume <sessionId>` 실행 → macOS에서 터미널 앱 활성화(`open -a Terminal` 또는 `herdr` attach). 세션 없으면 `claude --session-id <새 uuid>`로 시작하고 저장.
- **F10 (멀티):** 선택 폴더 N개 → 워크스페이스 1개 생성 → 첫 pane에 폴더1, `pane split`(우/아래 교대, 격자 레이아웃)으로 나머지 pane 생성 → 각 pane에 `claude --resume`. pane 이름을 에이전트명으로 `pane rename`.
- 충돌 방지: 웹 채팅이 실행 중인 세션이면 "턴 종료 후 열기" 안내(같은 세션 동시 쓰기 방지).
- **MVP 리스크:** herdr 서브커맨드 상세 옵션(`pane split` 방향 인자, `workspace create --cwd` 등)은 구현 첫 단계에서 `--help`로 확정 → 어댑터 한 파일(`herdr.mjs`)에 격리해 교체 용이하게.

## 6. 지식그래프 라이브러리 선정

| 후보 | 렌더 | 규모 | 인터랙션(줌·드래그·호버·클릭) | 번들러 없이 사용 | 평가 |
|---|---|---|---|---|---|
| d3-force (직접 구현) | 직접 (SVG/Canvas) | 중 | 전부 직접 구현 | 가능 | 물리엔진일 뿐. 렌더·이벤트 코드가 수백 줄 |
| **force-graph 1.52** | Canvas 2D (내부적으로 d3-force 사용) | ~수천 노드 | **내장** (`onNodeClick`, `onNodeHover`, 줌/팬/드래그, 화살표, 커스텀 노드 그리기) | 가능 (UMD/ESM CDN) | **MVP 최적** |
| Sigma.js 4 + graphology | WebGL | 수만 노드 | 내장, 레이아웃은 별도 플러그인 | 번들러 권장 | 대규모용. 현 단계엔 과함 |
| Cytoscape.js 3.34 | Canvas | 중~대 | 풍부, 그래프 분석 알고리즘 포함 | 가능 | 기능 많으나 지식그래프 룩 만들 설정이 큼 |
| vis-network 10 | Canvas | 중 | 내장 | 가능 | 스타일이 구식, 커스텀 한계 |
| AntV G6 5 | Canvas/WebGL | 대 | 풍부 | 번들러 권장 | 무겁고 중문 위주 문서 |

**결론: `force-graph`로 시작.**
- d3-force가 부적합한 것은 아니지만 **물리 엔진만 있는 저수준 도구**라서 렌더·줌·클릭·호버를 모두 직접 짜야 합니다. `force-graph`는 같은 d3-force 엔진 위에 이것들을 얹은 완성품입니다.
- md 문서 그래프는 보통 수십~수백 노드라서 Canvas로 충분하고, 번들러 없이 `<script>` 하나로 쓸 수 있어 "의존성 최소" 방침과 맞습니다.
- 3D가 필요해지면 같은 API 계열인 `3d-force-graph`로 교체가 쉽습니다.
- 교체 대비: 그래프 데이터는 라이브러리 중립 포맷 `{nodes:[{id,title,path,degree}], links:[{source,target,type}]}`로 API에서 내려주고, 렌더는 `graphview.js` 한 파일에 격리합니다.
- **업그레이드 기준:** 한 폴더의 md가 약 5,000개를 넘어 프레임이 떨어지면 `Sigma.js + graphology`(WebGL)로 교체.

## 7. API 초안

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/tree?root=` | 폴더 트리 |
| GET | `/api/graph?folder=` | docs md 그래프 |
| GET/POST/PUT | `/api/agents` | 폴더별 에이전트 조회/생성/수정 |
| POST | `/api/chat` (SSE) | 폴더 에이전트와 대화 |
| GET/PUT | `/api/mcp?folder=` | 폴더 MCP 설정 |
| GET/PUT/DELETE | `/api/skills?folder=` | 폴더 스킬 |
| POST | `/api/recommend/{mcp,skills}` | 추천 에이전트 호출 |
| POST | `/api/cli/open` | `{folders:[…]}` → herdr 열기 |

## 8. 보안·안전 (로컬 도구지만 필수)
- 서버는 `127.0.0.1`만 바인딩, 루트 폴더 외 경로 접근 차단(`path.resolve` 검증, 심볼릭 링크 해제 확인).
- **결정: 에이전트는 모든 권한 허용** (`--permission-mode bypassPermissions`, cwd=해당 폴더). 안전장치: ①서버 127.0.0.1 바인딩 ②에이전트 `cwd`는 항상 등록된 폴더 ③UI에 "전체 권한" 상시 배지 ④에이전트별로 권한을 낮추는 토글(수정 폼) 제공.
- MCP `env`(토큰)는 폴더 `.mcp.json`에 평문 저장되므로 `.gitignore` 안내.
- 추천 결과 자동 설치 금지(사용자 확인 후 기록).

## 9. 구현 단계 (제안: 약 2주)

| 단계 | 내용 | 산출 |
|---|---|---|
| M0 | 스캐폴딩, 루트 설정(`config.json`), 트리 API/UI | F1 |
| M1 | 에이전트 CRUD + 폴더 연결 | F3 |
| M2 | Claude 러너 + SSE 채팅창 + 세션 영속화 | F4, F5 |
| M3 | md 스캔 + 지식그래프 | F2 |
| M4 | 폴더별 MCP·스킬 관리 UI | F6 |
| M5 | 추천 에이전트 2종 | F7, F8 |
| M6 | herdr 어댑터: 단일/멀티 pane | F9, F10 |
| M7 | 다듬기: 오류 처리, 동시 세션 보호, README | MVP 완료 |

## 10. 기술 스택
- 서버: Node 20+, 순수 `http` + 내장 `child_process`/`fs` (의존성 최소)
- 클라이언트: 번들러 없는 ES module + `force-graph` (필요 시 Preact)
- 저장: `data/*.json` (DB 불필요)
- 외부 요구: `claude` CLI 로그인, `herdr` (설치 확인됨: `~/.local/bin/herdr`)

## 11. 성공 기준 (MVP)
1. 루트 지정 → 트리 표시 → 폴더 클릭 시 docs 그래프가 2초 내 표시된다.
2. 에이전트 없는 폴더에서 생성 → 즉시 대화 가능, 응답이 스트리밍된다.
3. 웹에서 나눈 대화를 "CLI로 보기"로 연 터미널에서 같은 맥락으로 이어간다.
4. 3개 폴더 선택 → 한 번에 3-pane으로 각 세션이 열린다.
5. 폴더에 MCP/스킬을 등록하면 해당 폴더 에이전트만 사용한다.

## 12. 확정된 결정
1. **루트 지정:** UI에서 폴더 선택(복수 루트 가능), 목록은 `data/config.json`에 저장. 브라우저는 절대경로를 못 얻으므로 서버가 `GET /api/fs/browse`로 폴더 탐색 다이얼로그를 제공.
2. **터미널 앱 (갱신):** OS별 분기, 둘 다 **herdr**를 연다.
   - macOS: 기본 `Terminal.app`(osascript) → `herdr` 실행, herdr API(`workspace create` / `pane split` / `pane run`)로 pane 구성.
   - Windows: **Windows Terminal(`wt.exe`) → WSL(Ubuntu) → `herdr`**. herdr API 호출도 `wsl.exe -d <distro> -- herdr …`로 수행하고 경로는 `C:\x` → `/mnt/c/x`로 변환.
   - Windows에서는 웹 채팅의 `claude` 호출도 WSL 안에서 실행(`wsl.exe -d <distro> --cd <path> -- claude …`)해서 **웹 세션과 herdr 터미널 세션이 같은 `~/.claude`를 공유**하도록 한다. 전제: WSL Ubuntu에 `claude`, `herdr` 설치. distro 이름은 `data/config.json`의 `wslDistro`(기본 `Ubuntu`).
   - 플랫폼 분기는 `lib/platform.mjs` / `lib/terminal.mjs`에 격리. Windows 경로는 이 개발 환경(macOS)에서 명령 생성 단위 테스트로 검증하고 실기는 Windows PC에서 확인한다.
3. **에이전트 권한:** 전체 허용 (8장).
4. **docs 없음:** 그래프를 비우고 생성 안내 표시 (5.3절).
5. **agents-office:** 코드 복사 없이 패턴만 참고.
6. **지식그래프:** `force-graph` (6장).

## 13. 구현 현황 (2026-10-09)
- M0~M6 구현 완료: 트리, 지식그래프(`force-graph`), 에이전트 CRUD/초안 제안, 채팅(SSE), 폴더별 MCP·스킬, 추천 에이전트 2종, herdr 단일/멀티 pane.
- 검증: 단위+E2E 16건 통과(가짜 claude/herdr), 실제 claude 채팅·세션 이어쓰기·추천·herdr pane 분할·Terminal.app 실행 수동 확인, 브라우저 UI 확인.
- 설계 변경: 에이전트는 기본 `--strict-mcp-config`(폴더 MCP만). 사용자의 전역 MCP 중 세션 시작 시 cwd에 저장소를 clone하는 것이 있어 폴더가 오염되는 문제가 확인됨. `mcpMode: inherit`로 해제 가능.
- Windows(WSL) 경로: 명령 생성 단위 테스트만 완료. **실제 Windows PC 검증은 남음.**

## 14. 2차 개선 (2026-10-10)
- 좌/우 패널·문서 패널 리사이즈(드래그, 저장), 왼쪽 `폴더 | ★ 즐겨찾기` 탭(서버 저장).
- 문서 편집: CodeMirror 6(Obsidian 에디터) 라이브 프리뷰/소스 + marked 기반 읽기 뷰, 저장 시 그래프 갱신, 위키링크 이동/생성.
- 헤더: 다크/라이트 테마 전환, Claude 한도(5h/주간 %, 리셋 잔여시간) — CLI `rate_limit_event` 기반.
- 테스트: 단위+E2E 19건 통과, 브라우저에서 편집·저장·읽기·리사이즈·테마·즐겨찾기·한도 표시 확인.

## 15. 3차 개선 (2026-10-10): 네이티브 채팅 + 웹 터미널
- 채팅 엔진을 `claude -p` 1회 호출에서 **Claude Agent SDK**로 교체: 토큰 스트리밍, 중단, 도구 권한 프롬프트(canUseTool), 슬래시 명령/스킬, 세션 resume, 이전 대화 복원(`getSessionMessages`).
- **터미널 탭**: node-pty + xterm.js + WebSocket으로 실제 Claude Code TUI를 웹에서 실행. 채팅과 같은 세션 ID를 공유(상호 배타 잠금).
- 권한 모드 3종(full/ask/readonly). 세션 존재 여부는 세션 파일(`~/.claude/projects/*/<id>.jsonl`)로 판단(Windows/WSL은 저장 플래그).
- 부모 Claude 세션 환경 마커 제거(`cleanEnv`).
- 검증: 단위+E2E 23건(가짜 claude/herdr + 실제 pty/WebSocket), 실제 claude로 스트리밍·권한 허용/거부·슬래시·중단·터미널 입력·터미널↔채팅 세션 공유 확인.
- (추가) 채팅 입력 `/` 자동완성은 `supportedCommands()`로 전역/플러그인/폴더 스킬 전체를 첫 턴 전에 로드, `@` 파일 멘션 자동완성(`/api/chat/files`) 추가. 엔진 단계에서 `@파일`·`/스킬` 실행은 SDK가 네이티브로 처리함을 실측 확인.

## 16. 에디터 독립 패키지화 (2026-10-11)
- `packages/md-editor/`: 프레임워크 무관 Obsidian 방식 마크다운 에디터(CodeMirror 6 라이브 프리뷰/소스 + 읽기 뷰 + 위키링크). API `createMarkdownPane`(툴바 포함), `createMarkdownEditor`, `renderMarkdown`. CSS 변수 테마(`--md-*` → 호스트 변수 → 기본값). 데모/테스트/README 포함.
- 이 앱은 `src/editor.js` 어댑터로 해당 패키지를 사용(회귀 확인 완료). 다른 프로젝트에는 폴더 복사 후 `npm install && npm run build`.

## 17. 폴더당 여러 에이전트 (2026-10-15)
- 저장: `agents.json`을 `폴더 → [에이전트…]`로 변경(첫 번째 = 기본). 옛 형식(객체 1개)은 읽을 때 자동으로 목록으로 취급.
- 키: 채팅 세션·터미널 pty·사용 중 잠금(busy)을 폴더가 아니라 **에이전트 id** 기준으로 변경 → 같은 폴더의 에이전트끼리 동시에 응답/터미널 가능, 세션 분리.
- API: `/api/agent`(GET은 `agents` 목록 포함, PUT `new:true`=추가 / `agentId`=수정 / 생략=기본), `/api/agent/default`, 채팅·히스토리·명령·터미널·권한·중단에 `agentId`(생략 시 기본 에이전트), `/api/cli/open`은 `targets:[{folder,agentId}]`(옛 `folders`도 유지).
- UI: 채팅 헤더 에이전트 드롭다운 + `＋`, 에이전트 탭 칩 목록, 트리에 에이전트 행(2개 이상일 때)과 `+N` 배지, 선택한 에이전트는 폴더별로 기억.
- 한계: 같은 폴더의 에이전트는 파일·MCP·스킬을 공유하므로 동시 수정 충돌은 막지 않고 안내 문구만 표시.
- 검증: 단위 테스트(저장소 마이그레이션) + e2e(병렬 채팅·세션 분리·CLI targets·기본 지정·삭제) 포함 28개 통과, 실제 claude로 두 에이전트 동시 대화·에이전트별 터미널 확인.

## 18. WSL2 검증과 수정 (2026-11-05)
이 PC(Windows 11 + WSL2 `Ubuntu-20.04`, mirrored 네트워킹)에서 실제로 돌려 보며 확인했다. 서버를 WSL 안에서 실행하고 Windows 브라우저로 접속하는 방식이 기본 대상이다.

**고친 문제**
- "CLI로 보기"가 WSL에서 터미널을 열지 못함: WSL은 `linux`로 인식되어 `x-terminal-emulator`(없음)를 호출했고, 실패가 조용히 삼켜져 응답은 성공으로 나갔다. → `isWsl()` 추가, `cmd.exe /c start "" wt.exe new-tab … wsl.exe -d $WSL_DISTRO_NAME …`로 Windows Terminal을 연다(`wt.exe` 없으면 일반 콘솔 창).
- `wsl.exe -- claude|herdr`가 `command not found`: 비로그인 셸이라 `~/.local/bin`이 PATH에 없다. → `wsl.exe -e bash -lc 'exec "$@"' _ cmd args…`로 변경(인자 JSON·따옴표·한글이 그대로 전달됨을 실측).
- 기본 `wslDistro: 'Ubuntu'`가 이 PC에 없는 이름(`WSL_E_DISTRO_NOT_FOUND`). → 기본값을 빈 값(= WSL 기본 배포판, `-d` 생략)으로 변경.
- `MORING_HERDR`가 `openTerminal`에는 적용되지 않던 것을 맞춤.

**확인된 것(실측)**
- WSL 안에서: 실제 claude Agent SDK 채팅(스트리밍·대화 복원·`/` 명령 118개), 터미널 탭(진짜 claude TUI), Windows Terminal 탭에서 herdr 실행(가짜 herdr로 호출 기록 확인), `/mnt/c` 탐색.
- Windows → WSL 접속: `127.0.0.1:포트` 정상. `localhost`는 Windows가 `::1`을 먼저 시도해 약 0.2초 늦게 `127.0.0.1`로 넘어간다(curl.exe 0.23초 성공, PowerShell `Invoke-WebRequest`는 시간 초과). 코드가 아니라 안내 문제 → 시작 로그와 README에 `127.0.0.1` 안내.
- Windows-native(`wsl.exe` 감싸기): `MORING_FAKE_PLATFORM=win32`로 WSL 안에서 진짜 `wsl.exe`를 호출해 SDK 채팅과 herdr 명령 확인.

**남은 것**
- 진짜 Windows에서 node를 직접 실행하는 경로(Windows용 node-pty/ConPTY, 인자 따옴표 처리, `\\wsl.localhost\…` 경로)는 미검증. 이 경로에서는 세션 파일을 볼 수 없어 대화 복원(`history`)이 비활성이다.
- 진짜 herdr로 pane을 만드는 시험은 하지 않았다(사용 중인 워크스페이스가 있어 가짜 herdr로 대체). pane 분할 로직은 기존 E2E가 덮는다.

## 19. 에디터 오류 수정: 줄바꿈을 덮는 장식 (2026-11-05)
- 증상: 일부 문서(예: `docs/study/*.md`)를 열면 "Decorations that replace line breaks may not be specified via plugins"가 뜨고 라이브 프리뷰가 멈춘다.
- 원인: `>`만 있는 빈 인용 줄에서 숨김 범위가 `to + 1`로 줄바꿈까지 포함되고, 다음 줄의 `> `와 이어 붙으며 줄바꿈을 덮었다. CodeMirror는 플러그인이 만든 장식이 줄바꿈을 덮는 것을 허용하지 않는다.
- 수정: 인용 기호의 숨김 범위를 그 줄 안으로 제한, 숨김 범위를 줄 단위로 자르는 안전장치 추가(`packages/md-editor/src/editor.js`). 회귀 테스트 `packages/md-editor/test/live.test.mjs`(수정 전 코드에서는 실패함을 확인).
- 검증: 프로젝트 안 docs 문서 1,606개를 같은 방식으로 검사해 줄바꿈을 덮는 장식 0건(수정 전에는 study 문서 2개에서 4건).

## 20. 설치 안내 README 작성 (2026-11-05)
- 목적: 처음 받는 사람이 WSL2 켜기부터 herdr·Claude Code 설치, 앱 실행까지 혼자 따라 할 수 있게 README 맨 앞을 "설치 방법"으로 바꿨다.
- 확인한 사실(README에 반영):
  - `node-pty`는 리눅스용 미리 빌드 파일이 없다(`prebuilds/`에 darwin·win32만). 새 WSL에서는 `build-essential`과 `python3`이 없으면 `npm install`이 컴파일에서 실패한다. macOS는 미리 빌드 파일이 있어 불필요.
  - Ubuntu 20.04가 주는 기본 Node는 v10이다. 앱은 Node 20+가 필요하므로 nvm으로 22를 깔고 `nvm alias default 22`까지 해야 새 창에서도 유지된다.
  - GitHub 저장소가 비공개(PRIVATE)다. 받는 사람은 접근 권한과 토큰(또는 SSH 키)이 필요하다.
  - herdr 설치 명령은 `curl -fsSL https://herdr.dev/install.sh | sh`(Linux·macOS 공통, 바이너리는 `~/.local/bin`). herdr 공식 문서는 WSL을 따로 다루지 않아 리눅스 방식을 안내했다. 이 PC에는 `~/.local/bin/herdr`(0.9.3)가 WSL 안에서 동작 중이지만, 설치 스크립트를 새로 돌려 보지는 않았다. Claude Code 설치 명령도 공식 문서 기준이며 새로 돌려 보지 않았다.
  - Claude Code 설치 명령은 `curl -fsSL https://claude.ai/install.sh | bash`. 유료 계정이 필요하다.
- 검증 범위: Windows 11 + WSL2 Ubuntu-20.04(mirrored 네트워크)에서 확인. 기본(NAT) 네트워크 모드, Ubuntu 22.04/24.04 새 설치, 리눅스 데스크톱은 직접 확인하지 못했다.
