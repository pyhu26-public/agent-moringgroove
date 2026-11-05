# Agent Moringgroove

로컬 폴더 = 업무 단위. 폴더마다 전담 에이전트(로컬 `claude` CLI)를 붙이고, 문서는 지식그래프로, 세션은 herdr 터미널로 이어가는 로컬 웹앱.

## 설치 방법 (처음 받는 분께)

**결론:** Windows에서는 WSL2(Windows 안의 리눅스) 안에 전부 설치하고, 화면은 Windows 브라우저로 봅니다. 처음부터 끝까지 30분 정도 걸립니다.

| 단계 | 할 일 | 어디서 |
|---|---|---|
| 1 | WSL2 켜기 (Windows만) | PowerShell (관리자) |
| 2 | 기본 도구 설치 | Ubuntu (WSL) |
| 3 | Node.js 22 설치 | Ubuntu (WSL) |
| 4 | Claude Code 설치와 로그인 | Ubuntu (WSL) |
| 5 | herdr 설치 | Ubuntu (WSL) |
| 6 | 앱 받아서 실행 | Ubuntu (WSL) |

macOS와 Linux는 1단계를 건너뜁니다. [아래](#macos--linux)를 보세요. 이미 Node 20 이상, 로그인된 `claude`, `herdr`가 있다면 6단계만 하면 됩니다.

**준비물**
- Windows 10 (버전 2004, 빌드 19041 이상) 또는 Windows 11. 메모리는 4GB 이상.
- Claude 유료 계정 (Pro · Max · Team · Enterprise · Console 중 하나). 무료 플랜은 Claude Code를 쓸 수 없습니다.
- 이 저장소를 받을 수 있는 GitHub 권한. 저장소가 **비공개**입니다.
- 인터넷 연결.

### 1단계. WSL2 켜기 (Windows만)

1. **가상화가 켜져 있는지 확인합니다.** 작업 관리자(`Ctrl+Shift+Esc`) → 성능 → CPU에서 "가상화: 사용"이어야 합니다. "사용 안 함"이면 PC를 다시 켜서 BIOS/UEFI 설정에서 가상화(Intel VT-x 또는 AMD SVM)를 켭니다. 메뉴 이름은 제조사마다 다릅니다.
2. **PowerShell을 관리자 권한으로 엽니다.** 시작 메뉴에서 PowerShell을 우클릭 → "관리자 권한으로 실행".
   ```powershell
   wsl --install
   ```
   이 한 줄이 WSL 기능을 켜고 Ubuntu까지 설치합니다.
3. **PC를 다시 시작합니다.**
4. 다시 시작하면 Ubuntu 창이 열립니다. 잠시 기다린 뒤 리눅스 **사용자 이름과 비밀번호**를 정합니다. 비밀번호는 입력해도 화면에 안 보이는 것이 정상입니다. 창이 안 열리면 시작 메뉴에서 "Ubuntu"를 엽니다.
5. **WSL2로 도는지 확인합니다.** PowerShell에서:
   ```powershell
   wsl -l -v
   ```
   `VERSION` 열이 `2`여야 합니다. `1`이면 `wsl --set-version Ubuntu 2`를 실행합니다(이름은 목록에 보이는 그대로).
6. **Windows Terminal을 준비합니다(권장).** Windows 11에는 들어 있습니다. Windows 10은 Microsoft Store에서 "Windows Terminal"을 설치합니다. 없어도 쓸 수 있지만, 그러면 "CLI로 보기"가 일반 콘솔 창으로 열립니다.

<details>
<summary>wsl --install이 안 될 때</summary>

- 도움말만 나오면 이미 WSL이 있는 것입니다. `wsl --list --online`으로 이름을 보고 `wsl --install -d Ubuntu`를 실행합니다.
- 설치가 0%에서 멈추면 `wsl --install --web-download -d Ubuntu`를 실행합니다.
- 기능을 직접 켜려면 관리자 PowerShell에서 아래 두 줄을 실행하고, 다시 시작한 뒤 `wsl --set-default-version 2`와 `wsl --update`를 실행합니다.
  ```powershell
  dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
  dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
  ```
- `0x80370102` 오류는 가상화가 꺼져 있다는 뜻입니다. 위 1번을 하세요.
</details>

이 아래의 모든 명령은 **Ubuntu 창**에서 실행합니다. 시작 메뉴의 "Ubuntu"나 Windows Terminal의 Ubuntu 탭을 쓰면 됩니다.

### 2단계. 기본 도구 설치

```bash
sudo apt update
sudo apt install -y build-essential python3 curl git
```

웹 터미널에 쓰는 부품(`node-pty`)은 리눅스용 완성품이 없어서 설치할 때 직접 컴파일합니다. `build-essential`과 `python3`이 없으면 6단계의 `npm install`이 `make: not found` 또는 `gyp ERR!`로 실패합니다.

### 3단계. Node.js 22 설치

Ubuntu가 기본으로 주는 Node는 너무 낮습니다(Ubuntu 20.04는 v10). 이 앱은 **Node 20 이상**이 필요합니다. nvm으로 설치합니다.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

**Ubuntu 창을 닫고 새로 연 뒤** 이어서 실행합니다.

```bash
nvm install 22
nvm alias default 22
node -v        # v22.x.x 가 나와야 합니다
```

`nvm alias default 22`를 빼면 새 창을 열 때마다 옛 Node가 잡힙니다. nvm의 최신 설치 주소는 [nvm 저장소](https://github.com/nvm-sh/nvm)에서 확인합니다.

### 4단계. Claude Code 설치와 로그인

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

새 창을 열고 확인합니다.

```bash
claude --version
claude          # 로그인 안내가 나옵니다
```

브라우저가 저절로 안 열리면 화면에 나온 주소를 Windows 브라우저에 붙여넣습니다. 로그인이 끝나면 `/exit`로 나옵니다.

**반드시 WSL(Ubuntu) 안에 설치하세요.** Windows에 따로 깐 `claude`는 이 앱이 쓰지 않습니다. 대화 기록도 WSL 안의 `~/.claude`에 저장됩니다.

### 5단계. herdr 설치

herdr는 AI 코딩 에이전트용 터미널 작업공간입니다. 이 앱의 `CLI로 보기`를 누르면 폴더마다 pane(분할 창)을 만들어 Claude를 이어서 보여 줍니다.

```bash
curl -fsSL https://herdr.dev/install.sh | sh
```

새 창을 열고 확인합니다.

```bash
herdr --version      # 0.9.3 에서 확인했습니다
```

Windows용 herdr가 아니라 **WSL 안에** 설치합니다. 나중에 업데이트는 `herdr update`입니다. 설치 방법이 더 필요하면 [herdr 설치 문서](https://herdr.dev/tui/docs/install/)를 보세요.

### 6단계. 앱 받아서 실행

```bash
mkdir -p ~/project && cd ~/project
git clone https://github.com/pyhu26-public/agent-moringgroove.git
cd agent-moringgroove
npm install
npm start
```

- 저장소가 비공개라서 권한이 없으면 `Repository not found`가 나옵니다. 권한을 받은 뒤, 비밀번호를 물으면 GitHub 비밀번호 대신 **Personal access token**을 넣습니다. SSH 키를 쓴다면 `git@github.com:pyhu26-public/agent-moringgroove.git`로 받습니다.
- 프로젝트는 **WSL 홈(`~`) 안에** 두세요. `/mnt/c/...` 아래에 받으면 느립니다.
- 처음 `npm start`를 하면 화면용 코드를 만드느라 몇 초 더 걸립니다.
- `Agent Moringgroove  http://localhost:4600  (WSL2 …)` 줄이 보이면 성공입니다.
- **Windows 브라우저에서 `http://127.0.0.1:4600` 으로 접속합니다.** `localhost`는 Windows가 IPv6를 먼저 시도해서 느리거나 안 열릴 수 있습니다.
- 서버를 켠 Ubuntu 창을 닫으면 서버도 꺼집니다. 포트를 바꾸려면 `PORT=4700 npm start`.
- 이 안내는 Windows 11, WSL2 Ubuntu-20.04, 네트워크 mirrored 모드에서 확인했습니다. 서버는 `127.0.0.1`에만 열려서 같은 PC 밖에서는 접속할 수 없습니다(의도한 보안 설정).

### 설치가 잘 됐는지 확인

```bash
node -v && claude --version && herdr --version
npm test        # 마지막에 fail 0 이면 정상
```

`npm test`는 가짜 claude/herdr를 쓰므로 로그인 없이도 돌아갑니다. 부품 설치가 잘 됐는지 보는 용도입니다.

실제로 쓰는 모습까지 확인하려면:
1. 화면의 `＋ 루트 폴더`에 작업 폴더 경로를 넣습니다. WSL 폴더는 `/home/<이름>/project`, Windows 폴더는 `/mnt/c/Users/<이름>/...` 형식입니다.
2. 폴더를 고르고 에이전트 탭에서 에이전트를 만든 뒤, 오른쪽 채팅에서 말을 걸어 봅니다.
3. 폴더를 체크하고 `CLI로 보기`를 누릅니다. Windows Terminal 새 탭에 herdr가 열리면 끝입니다. 처음 여는 폴더에서는 Claude가 "이 폴더를 신뢰하시겠습니까?"를 한 번 묻습니다.

### macOS / Linux

- **macOS:** 1·2단계는 필요 없습니다(`node-pty`의 macOS용 완성품이 들어 있습니다). 3~6단계를 그대로 하세요. herdr는 `brew install herdr`로도 설치됩니다. `CLI로 보기`는 Terminal.app을 엽니다.
- **Linux:** 1단계를 건너뛰고 2~6단계를 하세요. `CLI로 보기`는 `x-terminal-emulator`로 터미널을 열도록 되어 있지만, 직접 확인하지는 못했습니다.

### 문제 해결

| 증상 | 원인과 해결 |
|---|---|
| `npm install`이 `gyp ERR!`, `make: not found`, `python` 오류로 실패 | 컴파일 도구가 없습니다. 2단계를 하고 `rm -rf node_modules && npm install`. |
| `SyntaxError`, `Unexpected token`, `engines` 경고 | Node가 낮습니다. `node -v`를 보고 3단계를 하세요. 새 창에서 `nvm use 22`도 해 봅니다. |
| `claude` 또는 `herdr`가 `command not found` | 설치 폴더 `~/.local/bin`이 PATH에 없습니다. 먼저 새 Ubuntu 창을 엽니다. 그래도 안 되면 `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc` 후 새 창. |
| 브라우저에서 `localhost`가 느리거나 안 열림 | `http://127.0.0.1:4600`으로 접속합니다. |
| `127.0.0.1`도 안 열림 | PowerShell에서 `wsl --shutdown`을 하고 Ubuntu를 다시 열어 `npm start`. |
| `EADDRINUSE` | 4600 포트를 다른 프로그램이 씁니다. `PORT=4700 npm start`. |
| `CLI로 보기`에서 "herdr 서버를 시작하지 못했습니다" | WSL 안에서 herdr를 못 찾습니다. Ubuntu에서 `bash -lc 'herdr --version'`이 되는지 보세요. 안 되면 5단계와 PATH를 확인합니다. |
| `CLI로 보기`가 Windows Terminal이 아닌 검은 콘솔 창으로 열림 | `wt.exe`가 없습니다. 1단계 6번대로 Windows Terminal을 설치합니다. 동작에는 문제가 없습니다. |
| 채팅에서 로그인 오류 | WSL 안의 `claude`가 로그인되지 않았습니다. Ubuntu에서 `claude`를 실행해 로그인합니다. |
| `git clone`이 `Repository not found` | GitHub 권한이나 로그인 문제입니다. 6단계 첫 항목을 보세요. |
| `wsl --install` 중 `0x80370102` | 가상화가 꺼져 있습니다. 1단계 1번을 하세요. |

### 업데이트

```bash
cd ~/project/agent-moringgroove
git pull && npm install && npm run build
herdr update
claude update
```

### 고급: Windows에서 node를 직접 실행 (검증 못 함)

권장하지 않습니다. 이 방식은 실제 Windows에서 아직 확인하지 못했습니다(PLAN.md 18장). Windows Terminal(`wt.exe`) → WSL → herdr로 이어지고, 채팅용 `claude`도 `wsl.exe`로 WSL 안에서 실행해 웹과 터미널이 같은 `~/.claude` 세션을 씁니다. WSL 배포판은 `data/config.json`의 `wslDistro`(예: `Ubuntu-20.04`)로 정하며, 비워 두면 WSL 기본 배포판입니다. `wsl.exe`는 로그인 셸(`bash -l`)로 실행하므로 `~/.local/bin`의 `claude`·`herdr`가 PATH에 잡힙니다.

## 사용
1. `＋ 루트 폴더`로 루트를 등록 → 왼쪽 트리에서 폴더 선택
2. 에이전트 탭에서 생성/수정 (`초안 자동 제안`은 폴더를 분석해 채워 줌)
   - 한 폴더에 에이전트를 여러 개 둘 수 있다(에이전트 탭의 `＋ 새 에이전트`, 채팅 헤더의 `＋`). 에이전트마다 대화 세션·권한 모드·터미널이 따로이고, 채팅 헤더의 드롭다운으로 전환한다. 첫 번째가 기본 에이전트(트리 배지·CLI 기본값). MCP·스킬은 폴더 단위로 함께 쓴다.
   - 에이전트가 2개 이상인 폴더는 트리에 에이전트 행이 나뉘어 보이고, 체크하면 `CLI로 보기`에서 에이전트별 pane으로 열린다.
3. 오른쪽 채팅 = **Claude Agent SDK**(Claude Code와 같은 엔진). 세션이 폴더별로 유지됨 (아래 "채팅" 참고)
4. 가운데 `지식그래프`: `<폴더>/docs/**/*.md` ([[위키링크]], 상대경로 링크). docs가 없으면 비어 있고 생성 안내가 표시됨
5. `MCP · 스킬` 탭: 폴더 전용 `.mcp.json`, `.claude/skills/`. `MCP/스킬 추천 에이전트`가 폴더 업무를 읽고 제안 → `등록` 클릭 시에만 기록
6. 체크박스로 폴더를 고르고 `CLI로 보기` → herdr 워크스페이스에 폴더별 pane (여러 개면 격자 분할), 각 pane에서 `claude --resume <세션>`

## 화면 기능
- **패널 크기 조절:** 좌/우 패널 경계와 문서 패널 왼쪽 가장자리를 드래그 (더블클릭 = 초기화). 크기·탭·테마는 브라우저에 저장됨.
- **즐겨찾기:** 왼쪽 `★ 즐겨찾기` 탭. 폴더 트리의 ☆를 눌러 추가/해제 (`data/config.json`에 저장).
- **문서 편집:** 그래프 노드를 클릭하면 문서 패널이 열림. Obsidian이 쓰는 **CodeMirror 6** 에디터 — `라이브 프리뷰`(마크업 숨김, 커서 줄만 원문) / `소스` / `읽기`(렌더링, 표·체크박스·코드). `Ctrl/Cmd+S` 저장, `[[위키링크]]` 클릭으로 이동(없으면 새로 생성), `＋ 새 문서`. 저장하면 그래프가 바로 갱신됨.
- **우측 상단:** 다크/라이트 전환, Claude 한도(5시간·주간 사용률과 리셋까지 남은 시간). 한도는 claude 실행 때마다 CLI가 내보내는 `rate_limit_event`에서 읽으며(토큰/비공식 엔드포인트 미사용), `↻`는 haiku로 아주 작은 요청 1회를 보내 갱신한다.
- 에디터는 독립 패키지 `packages/md-editor/`로 분리되어 있다(다른 웹에 그대로 복사해 쓸 수 있음, 사용법은 그 폴더의 README). 이 앱의 `src/editor.js`는 얇은 어댑터. 번들 재빌드: `npm run build` (→ `public/vendor/`).

## 채팅 (Agent SDK) · 터미널 탭 (pty)
- **채팅:** 글자 단위 스트리밍 + 마크다운 렌더링, 도구 호출 카드(펼치면 입력/결과), `■ 중단` 버튼, 새로고침/재접속 시 이전 대화 복원.
- **`/` 명령·스킬:** 입력 맨 앞에 `/`를 치면 내장 명령(`/compact`, `/context` …)과 설치된 모든 스킬(사용자·플러그인·폴더 `.claude/skills`)이 설명과 함께 자동완성된다. 첫 메시지를 보내기 전에도 목록이 채워진다(세션 초기화에서 읽어옴, 60초 캐시). 선택 후 인자를 붙여 전송하면 그대로 실행된다.
- **`@` 파일 멘션:** `@`를 치면 에이전트 폴더 안의 파일·폴더를 찾아 제안한다(폴더는 이어서 드릴다운). 선택한 `@경로`는 Claude Code가 파일 내용을 첨부해 준다.
- **권한 모드(에이전트별):** `전체 허용` / `매번 확인`(쓰기·실행 도구는 채팅에 권한 카드가 떠서 허용·거부·"이 세션에서 항상 허용") / `읽기 전용`.
- **터미널 탭:** 서버의 pty에서 진짜 Claude Code TUI(`claude --resume <세션>`)를 xterm.js로 표시. 채팅과 **같은 세션**이라 한쪽에서 한 대화가 다른 쪽에 이어진다. pty는 탭을 닫아도 유지되고(다시 열면 화면 복원) `세션 종료`로 끝낸다.
- 한 폴더 세션은 한 곳에서만 쓴다: 터미널이 열려 있으면 채팅이 잠기고(채팅 헤더의 `터미널 세션 종료`), 채팅이 응답 중이면 터미널을 열 수 없다.
- 터미널 WebSocket(`/ws/term`)은 셸급 권한이므로 127.0.0.1 바인딩 + Host/Origin 검증을 한다.
- 레거시 엔진(`claude -p` 1회성)은 `MORING_CHAT_ENGINE=cli`로 선택 (테스트용).

## 알아둘 점
- 에이전트는 기본 **전체 권한**으로 실행. 에이전트 탭의 권한 모드에서 `매번 확인`/`읽기 전용`으로 낮출 수 있다.
- 상위 Claude Code 세션 안에서 서버를 띄워도 자식 claude가 영향받지 않도록 `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION` 등 상속 마커 환경변수를 제거한다(남아 있으면 대화 기록 저장이 꺼진다).
- 에이전트는 기본적으로 **그 폴더에 등록한 MCP만** 사용(`--strict-mcp-config`). 전역 MCP 중에는 실행 시 현재 폴더에 파일을 만드는 것이 있다(예: `claude-talk-to-figma-mcp`가 저장소를 clone). 필요하면 에이전트별로 "전역 MCP도 함께 사용"을 선택.
- 터미널에서 처음 여는 폴더는 Claude의 "이 폴더를 신뢰하시겠습니까?" 확인이 한 번 나온다.
- 서버는 127.0.0.1에만 바인딩하고 Host/Origin을 검증한다. 등록된 루트 밖 폴더는 거부.
