#!/usr/bin/env bash
# WSL 안에서 Agent Moringgroove 서버를 켠다. Windows 로그온 때 자동 실행하는 용도다 (README "로그온 때 자동 실행").
#
# 화면 없이 도는 셸은 ~/.bashrc의 nvm 줄에 닿기 전에 멈춰서 옛 node(예: Ubuntu 20.04의 v10)가 잡힌다.
# 그래서 nvm을 직접 불러와 기본 버전(README 3단계의 `nvm alias default 22`)을 고른다.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; nvm use default >/dev/null 2>&1; fi

cd "$(dirname "$(readlink -f "$0")")/.." || exit 1

command -v node >/dev/null 2>&1 || { echo "node를 찾지 못했습니다. README 3단계를 하세요." >&2; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' ||
  { echo "Node 20 이상이 필요합니다 (지금: $(node -v)). README 3단계의 'nvm alias default 22'를 확인하세요." >&2; exit 1; }

# 처음 실행이면 화면용 코드를 먼저 만든다 (npm start의 prestart와 같은 일)
[ -f public/vendor/editor.js ] || npm run build || exit 1

exec node serve.mjs
