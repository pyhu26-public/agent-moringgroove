// Built-in helper agents (read-only): MCP recommender, skill recommender, agent-draft suggester.
import fs from 'node:fs';
import path from 'node:path';
import { runOnce, extractJson } from './claude.mjs';
import { scanDocs, listDirs } from './fsx.mjs';
import { getMcp, listSkills } from './mcpskills.mjs';
import { agents } from './store.mjs';

function brief(folder) {
  const lines = [`폴더: ${folder}`];
  const sub = (d, depth) => listDirs(d).slice(0, 25).map(x => `${'  '.repeat(depth)}- ${x.name}/`).join('\n');
  lines.push('하위 폴더:\n' + (sub(folder, 0) || '(없음)'));
  try { lines.push('최상위 파일: ' + fs.readdirSync(folder, { withFileTypes: true }).filter(e => e.isFile()).slice(0, 30).map(e => e.name).join(', ')); } catch {}
  for (const n of ['README.md', 'CLAUDE.md', 'package.json']) {
    try { lines.push(`--- ${n} (앞부분) ---\n` + fs.readFileSync(path.join(folder, n), 'utf8').slice(0, 1500)); } catch {}
  }
  const docs = scanDocs(folder).files.slice(0, 40).map(f => path.relative(path.join(folder, 'docs'), f));
  if (docs.length) lines.push('docs 문서: ' + docs.join(', '));
  const as = agents.list(folder); if (as.length) lines.push('이미 있는 담당 에이전트(역할이 겹치지 않게): ' + as.map(a => `${a.name} / ${a.role}`).join(' ; '));
  lines.push('등록된 MCP: ' + (Object.keys(getMcp(folder)).join(', ') || '없음'));
  lines.push('등록된 스킬: ' + (listSkills(folder).map(s => s.name).join(', ') || '없음'));
  return lines.join('\n\n');
}

const SYS_MCP = `당신은 "MCP 추천 에이전트"입니다. 주어진 폴더의 업무를 파악하고, 그 업무에 실제로 도움이 되는 MCP 서버를 3~6개 추천합니다.
- 반드시 실제 존재하는 공식/널리 쓰이는 MCP 서버만 추천하고, 확실하지 않으면 WebSearch로 확인하세요.
- 이미 등록된 MCP는 제외합니다.
- 설치 설정은 .mcp.json 의 서버 항목 형식입니다: {"command":"npx","args":["-y","패키지"],"env":{"KEY":"<설명>"}} 또는 {"type":"http","url":"https://..."}.
- 비밀 키는 실제 값 대신 "<여기에 입력>" 형태의 자리표시자로 둡니다.
- 출력은 오직 하나의 \`\`\`json 코드블록: [{"name":"서버키(영문)","why":"이 폴더 업무에 필요한 이유(한국어 1~2문장)","config":{...}}]`;
const SYS_SKILL = `당신은 "스킬 추천 에이전트"입니다. 주어진 폴더의 업무를 파악하고, 반복되는 작업을 표준화할 Claude Code 스킬을 3~5개 제안합니다.
- 이미 등록된 스킬과 겹치지 않게 합니다.
- 각 스킬은 name(영문 소문자-하이픈), description(언제 쓰는지 한 문장, 한국어), body(SKILL.md 본문 마크다운: 사용 시점, 단계, 규칙. 한국어, 400자~1200자)를 가집니다.
- 출력은 오직 하나의 \`\`\`json 코드블록: [{"name":"...","description":"...","body":"..."}]`;
const SYS_DRAFT = `당신은 "에이전트 설계 도우미"입니다. 주어진 폴더를 읽고 이 폴더의 업무를 전담할 에이전트 초안을 만듭니다.
출력은 오직 하나의 \`\`\`json 코드블록: {"name":"짧은 이름(한국어)","role":"한 줄 역할","systemPrompt":"에이전트 지침(한국어, 5~12줄: 담당 범위, 작업 원칙, 참고할 파일/폴더, 금지 사항)"}`;

export async function recommendMcp(folder) {
  const out = extractJson(await runOnce(brief(folder) + '\n\n이 폴더에 맞는 MCP 서버를 추천해 주세요.', { cwd: folder, system: SYS_MCP }));
  const have = getMcp(folder);
  return (Array.isArray(out) ? out : []).filter(x => x && x.name && x.config && !have[x.name]);
}
export async function recommendSkills(folder) {
  const out = extractJson(await runOnce(brief(folder) + '\n\n이 폴더에 맞는 스킬을 제안해 주세요.', { cwd: folder, system: SYS_SKILL }));
  const have = new Set(listSkills(folder).map(s => s.name));
  return (Array.isArray(out) ? out : []).filter(x => x && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(x.name || '') && !have.has(x.name));
}
export async function draftAgent(folder) {
  const o = extractJson(await runOnce(brief(folder) + '\n\n이 폴더 담당 에이전트 초안을 만들어 주세요.', { cwd: folder, system: SYS_DRAFT }));
  return { name: String(o.name || path.basename(folder)), role: String(o.role || ''), systemPrompt: String(o.systemPrompt || '') };
}
