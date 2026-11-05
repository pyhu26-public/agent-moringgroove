# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

로컬 폴더마다 전담 `claude` 에이전트를 붙이는 로컬 웹앱. 폴더 트리 · 지식그래프(`docs/**/*.md`) · 채팅 · 웹 터미널 · herdr 연동이 한 화면에 있다. 사용법은 `README.md`, 설계 결정과 변경 이력은 `PLAN.md`(12~18장)에 있다. 문서와 UI 문구는 한국어다.

## 명령

```bash
npm install
npm start                 # http://localhost:4600 (PORT로 변경). prestart가 public/vendor가 없으면 build를 먼저 실행
npm run build             # esbuild: src/editor.js, src/term.js → public/vendor/ (gitignore 대상)
npm test                  # node --test test/*.test.mjs  (단위 + E2E)
node --test --test-name-pattern="grid plan" test/unit.test.mjs   # 테스트 1개만
cd packages/md-editor && npm test                                 # 에디터 패키지 테스트(별도 package.json)
```

- Node 20+ 필요. 린터/포매터 설정은 없다.
- 단위 테스트는 외부 패키지 없이 `lib/`만 불러오므로 `npm install` 전에도 돈다. E2E는 `ws`와 `node-pty`(실제 pty)가 필요하다.

## 구조

서버는 프레임워크 없는 `http` 한 파일(`serve.mjs`)이고, 기능은 `lib/*.mjs`로 나뉜다. 프런트(`public/*.js`)는 번들러 없는 ES module이다. 에디터와 xterm만 esbuild로 묶는다.

**작업 단위는 (폴더, 에이전트)다.** `data/agents.json`은 `폴더 → [에이전트…]`이고 첫 번째가 기본 에이전트다. 옛 형식(객체 1개)은 읽을 때 목록으로 바뀐다(`lib/store.mjs`). 채팅 세션 · pty · 사용 중 잠금은 폴더가 아니라 **에이전트 id**로 구분한다. 에이전트마다 `sessionId`(uuid)가 있다.

**한 세션을 세 곳이 나눠 쓴다.** 웹 채팅(Agent SDK), 웹 터미널(`ptyterm.mjs`: node-pty + xterm.js + `/ws/term`), herdr pane(`terminal.mjs`)이 같은 `sessionId`를 쓴다. 그래서 한쪽 대화가 다른 쪽에 이어진다.
- 동시 사용은 `lib/claude.mjs`의 `busy` 맵(`setBusy/clearBusy/isBusy`)으로 막는다. 채팅과 터미널이 모두 이 잠금을 쓴다.
- `hasStarted()`가 `--resume`과 `--session-id` 중 무엇을 쓸지 정한다. 기본은 `~/.claude/projects/*/<id>.jsonl` 파일이 있는지 보고, Windows/WSL에서는 저장된 `started` 플래그를 쓴다.

**채팅 엔진이 둘이다.**
- `sdkchat.mjs` (기본): Agent SDK `query()`. 토큰 스트리밍, 중단, 권한 카드(`canUseTool`), `/` 명령 목록.
- `claude.mjs`의 `chat()`: 옛 `claude -p` 1회 실행. `MORING_CHAT_ENGINE=cli`일 때만 쓴다.
- 추천 에이전트와 초안 제안(`recommend.mjs`)은 엔진과 상관없이 늘 `claude.mjs`의 `runOnce()`를 쓴다. 읽기 전용 도구만 허용하고 MCP는 비운다.

**권한·MCP 정책이 두 군데에 있다.** CLI 플래그 쪽은 `agentFlags()`(`claude.mjs`)이고 CLI 채팅 · pty · herdr 명령이 함께 쓴다. SDK 쪽은 `sdkchat.mjs`의 `options`로, 같은 정책(권한 모드 `full/ask/readonly`, `--strict-mcp-config`, 모델, 시스템 프롬프트)을 따로 구현해 두었다. 정책을 바꿀 때는 둘 다 고친다. MCP는 기본적으로 그 폴더의 `.mcp.json`만 쓰고(`mcpMode: 'inherit'`일 때만 전역 MCP 포함), 이유는 README의 "알아둘 점"에 있다.

**플랫폼 분기는 `lib/platform.mjs`에 모은다.** 실행 방식은 셋이다: macOS/Linux 네이티브, **WSL 안에서 node 실행**(`isWsl()`, platform은 `linux`), **Windows에서 node 실행**(`isWin()`). 자식 프로세스는 `wrap()`을 거쳐 띄운다.
- Windows-native에서만 `wrap()`이 `wsl.exe [-d distro] [--cd 경로] -e bash -lc 'exec "$@"' _ cmd args…` 형태로 감싼다. `bash -l`이 있어야 `~/.local/bin`(claude, herdr)이 PATH에 잡히고(`wsl.exe -- cmd`는 비로그인 셸이라 `command not found`), `-e`와 `exec "$@"`는 인자(JSON, 따옴표, 한글)를 손대지 않고 넘긴다. 경로는 `C:\x` → `/mnt/c/x`로 바꾼다. `wslDistro`가 비어 있으면 `-d`를 붙이지 않는다.
- WSL 안에서는 claude·herdr가 네이티브다. 다른 점은 `terminal.mjs`의 `openTerminal()`뿐이다: WSL에는 데스크톱이 없어서 `cmd.exe /c start "" wt.exe new-tab … wsl.exe -d $WSL_DISTRO_NAME …`로 Windows Terminal을 연다(`wt.exe`는 WSL의 PATH에 없고 `cmd.exe`가 Windows PATH에서 찾는다). `cmd.exe`의 cwd는 `/mnt/c`여야 한다.
- 환경변수는 `cleanEnv()`로 상위 Claude Code 세션의 표식(`CLAUDECODE` 등)을 지운다. 지우지 않으면 자식 claude가 대화 기록을 저장하지 않는다.
- 검증 상태: WSL2 안 실행은 실제 claude · pty · Windows Terminal 실행까지 확인했다. Windows-native는 `MORING_FAKE_PLATFORM=win32`로 WSL 안에서 진짜 `wsl.exe`를 불러 확인했을 뿐, 진짜 Windows의 node는 아직 못 돌려 봤다(PLAN 18장). 그 흉내 환경에서 pty 안의 `wsl.exe`는 커서 위치 질문(`ESC[6n`)에 답해 줘야 출력을 낸다. 실제 브라우저의 xterm.js와 Windows의 ConPTY는 자동으로 답한다.

**보안 경계.** 서버는 `127.0.0.1`에만 바인딩한다. `guard()`가 Host/Origin/Content-Type을 검사하고, `folderOf()`가 폴더가 등록된 루트 안에 있는지 검사한다. 폴더를 받는 API는 반드시 `folderOf()`를 거친다. WebSocket 업그레이드는 `serve.mjs` 아래쪽에서 같은 규칙을 따로 검사한다(셸급 권한이라 Origin 필수). 문서 읽기/쓰기는 `<폴더>/docs` 아래 `.md`로만 제한된다(`graph.mjs`).

**상태 파일.** `data/`(gitignore, `MORING_DATA`로 변경)에 `config.json`(루트·즐겨찾기·`wslDistro`), `agents.json`, `usage.json`(CLI의 `rate_limit_event`에서 읽은 한도), `prompts/<에이전트 id>.md`(실행할 때마다 다시 만들어지는 시스템 프롬프트)를 둔다.

**프런트 구성.** `app.js`가 트리·탭·상태(`S`)를 맡고, `chat.js` · `docpanel.js` · `graphview.js` · `termtab.js`가 각 영역을 맡는다. `/vendor/force-graph.js`는 `serveStatic`이 `node_modules`에서 직접 내주고, `/vendor/editor.js`와 `term.js`는 `npm run build` 결과물이다. `src/editor.js`는 독립 패키지 `packages/md-editor/`의 얇은 어댑터다.

## 테스트

- `test/e2e.test.mjs`는 서버를 포트 4611에 따로 띄우고 `test/fake/claude.mjs`, `test/fake/herdr.mjs`를 env(`MORING_CLAUDE`, `MORING_HERDR`)로 꽂는다. 가짜 호출은 `FAKE_LOG`에 기록된다.
- E2E는 `MORING_CHAT_ENGINE=cli`로 돈다. **SDK 채팅 경로(`sdkchat.mjs`의 `chat()`)는 자동 테스트에 걸리지 않는다.** 바꿨다면 실제 claude로 직접 확인한다.
- `MORING_FAKE_PLATFORM=win32`, `MORING_FAKE_WSL=1`로 플랫폼 분기를 흉내 낼 수 있다(단위 테스트에서 사용). E2E는 전부 `launch: false`라서 터미널 창을 여는 코드(`openTerminal`)는 단위 테스트(`setRunner`/`setLauncher`로 가로채기)로만 덮인다.

## 환경변수

`PORT`, `MORING_DATA`, `MORING_CHAT_ENGINE`(`sdk`|`cli`), `MORING_CLAUDE`(claude 실행 파일), `MORING_HERDR`(herdr 실행 파일, `openTerminal`도 이 값을 연다), `MORING_FAKE_PLATFORM`, `MORING_FAKE_WSL`.
