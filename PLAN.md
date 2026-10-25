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

## 18. Codex 겸용 (기획, 2026-10-25) — 브랜치 `feature/codex-engine`
**목표:** 같은 앱에서 에이전트마다 Claude Code 또는 Codex CLI를 골라 쓰고, 언제든 바꿀 수 있다. 상단에서 새 에이전트의 기본 엔진을 고른다.

### 18.1 조사 결과 (codex-cli 0.162.1, 이 PC에서 실제 실행)
| 항목 | 확인 내용 |
|---|---|
| 비대화형 | `codex exec --json` → JSONL: `thread.started{thread_id}` · `turn.started` · `item.started/completed`(`agent_message`, `command_execution`, `error`) · `turn.completed{usage}` · `turn.failed{error}` · `error`. 글자 단위 델타 없음(메시지 단위). |
| 세션 | 세션 ID를 미리 지정할 수 없다(Claude `--session-id`와 다름). 첫 턴의 `thread_id`로 알게 된다. 이어가기: `codex exec resume <id> "<프롬프트>"`, 대화형: `codex resume <id>`. |
| 세션 파일 | `~/.codex/sessions/Y/M/D/rollout-<시각>-<id>.jsonl`. 첫 줄 `session_meta{id,cwd}`, 이후 `response_item`(message/tool call), `event_msg.token_count{rate_limits}`. |
| 권한 | `-s read-only｜workspace-write｜danger-full-access`, 전부 허용 `--dangerously-bypass-approvals-and-sandbox`. `exec resume`에는 `-s`가 없어 `-c sandbox_mode="…"`로 지정. 대화형은 `-a`(승인 정책) 사용 가능. |
| 지침 주입 | `-c developer_instructions="…"` 동작 확인(에이전트 이름·역할·지침을 여기로). |
| MCP | `-c 'mcp_servers={}'`로 전역 MCP 차단, `-c 'mcp_servers={이름={command=…,args=[…]}}'`로 폴더 전용 주입(인라인 TOML). 전역 설정은 `~/.codex/config.toml`(OAuth 만료 서버가 에러 로그를 남김 → 격리 필요). |
| 한도 | 세션 파일 `token_count.rate_limits`: `primary{used_percent, window_minutes, resets_at}`(주간 1개 창). 5시간 창 없음. |
| 오류 | 모델 오류 등은 `error` + `turn.failed`로 오고 종료 코드는 0일 수 있다 → 이벤트로 판정. |
| 제한 | 슬래시(`/`) 명령·`@` 첨부는 TUI 기능이라 exec에서 처리되지 않는다. 대화형 승인 카드(`ask`)는 exec에서 불가. |

### 18.2 설계
- **엔진 값:** 에이전트의 `engine`(`claude`|`codex`, 없으면 claude = 기존 데이터 호환). 전역 기본값은 `config.defaultEngine`. 세션은 엔진별로 따로 저장(`sessionId`는 Claude, `codex.threadId`는 Codex) — 엔진을 바꿔도 각자 대화가 남고 돌아가면 이어진다.
- **구조:** `lib/codex.mjs`(실행·이벤트 변환·세션 탐색·기록 읽기·한도·MCP 변환)를 새로 두고, 서버/pty/herdr/추천기는 `agent.engine`으로 분기한다. 기존 Claude 경로는 건드리지 않는다. 바쁨 잠금·SSE 이벤트·UI 이벤트 형식은 그대로 공유.
- **채팅(Codex):** `codex exec --json` 프로세스(+`resume`)를 띄워 이벤트를 UI 이벤트(`text`·`tool`·`tool_result`·`done`·`error`)로 변환. 중단 = 프로세스 종료. 첫 턴의 `thread_id`를 저장.
- **터미널/herdr(Codex):** `codex resume <id> -C <폴더> …`. 아직 thread가 없으면 `codex …`로 새 세션을 열고, 다음 사용 때 `session_meta.cwd`가 같고 다른 에이전트가 쓰지 않는 가장 최근 세션을 연결한다.
- **권한:** Codex는 `full`(우회) · `workspace`(작업 폴더만 쓰기 샌드박스) · `readonly`. `ask`(카드 승인)는 Claude 전용 — UI는 엔진에 맞는 선택지만 보여준다. 터미널에서는 `-a on-request`로 승인 가능.
- **기록:** 세션 파일(`response_item`)을 UI 메시지로 변환.
- **한도 게이지:** 마지막 턴의 세션 파일에서 읽어 Codex 주간 창 1개로 표시. 상단 게이지는 선택한 에이전트(없으면 기본) 엔진 것을 보여준다.
- **MCP:** `.mcp.json` → `-c mcp_servers=…` 변환(stdio/http). 기본은 폴더 전용 격리, `inherit`면 전역 유지. **스킬:** Codex는 `.claude/skills`를 읽지 않으므로 2차(지침에 요약 포함 또는 `AGENTS.md`)로 미룸.
- **추천기·초안:** 보조 실행(`runOnce`)도 엔진을 받는다(`codex exec --ephemeral -s read-only -o <파일>`).
- **UI:** 상단 `기본 엔진` 선택, 에이전트 탭 `엔진` 선택(+엔진별 권한 선택지), 채팅 헤더에 엔진 배지·전환, `/` 팝업은 Codex에서 비활성 안내.
- **Windows/WSL:** 기존 `wrap()` 재사용(`MORING_CODEX`로 경로 지정).

### 18.3 단계
1. 엔진 값·저장·API, 2. `lib/codex.mjs` + fake codex 테스트, 3. 채팅/기록/한도, 4. pty·herdr, 5. MCP 변환·추천기, 6. UI, 7. 실제 codex 확인 + 문서.

### 18.4 구현 결과 (2026-10-25)
- 새 파일: `lib/codex.mjs`(실행·이벤트 변환·세션 탐색·기록·한도·MCP 변환), `lib/engine.mjs`(엔진 분기), `test/fake/codex.mjs`, `test/codex.test.mjs`. 서버·pty·herdr·추천기·UI가 `agent.engine`으로 분기하고 Claude 경로는 그대로.
- 검증: 단위+e2e 38개 통과, 실제 codex로 채팅·resume·읽기 전용 샌드박스·기록·한도 게이지·웹 터미널(웹 채팅 대화를 TUI가 그대로 이어받음) 확인.
- 남은 것: 스킬/AGENTS.md 연동(2차), Codex 승인 카드(app-server 조사 필요), 토큰 단위 스트리밍, Windows/WSL 실제 PC 확인, herdr 실제 pane에서 Codex 확인.
