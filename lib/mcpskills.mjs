// Per-folder MCP (<folder>/.mcp.json) and skills (<folder>/.claude/skills/<name>/SKILL.md).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const bad = m => Object.assign(new Error(m), { status: 400 });
export const checkName = n => { if (!NAME.test(n || '')) throw bad('이름은 영문/숫자/._- 만 가능합니다 (최대 64자)'); return n; };

const mcpFile = folder => path.join(folder, '.mcp.json');
export function getMcp(folder) {
  try { return JSON.parse(fs.readFileSync(mcpFile(folder), 'utf8')).mcpServers || {}; } catch { return {}; }
}
function putMcp(folder, servers) {
  let cur = {}; try { cur = JSON.parse(fs.readFileSync(mcpFile(folder), 'utf8')); } catch {}
  fs.writeFileSync(mcpFile(folder), JSON.stringify({ ...cur, mcpServers: servers }, null, 2), 'utf8');
}
export function setMcp(folder, name, cfg) {
  checkName(name);
  if (!cfg || typeof cfg !== 'object' || !(cfg.command || cfg.url)) throw bad('command 또는 url이 필요합니다');
  putMcp(folder, { ...getMcp(folder), [name]: cfg });
}
export function delMcp(folder, name) { const s = getMcp(folder); delete s[name]; putMcp(folder, s); }

// MCP servers already known globally (Claude Code user config), for "import into this folder"
export function globalMcp() {
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')).mcpServers || {}; } catch { return {}; }
}

const skillsDir = folder => path.join(folder, '.claude', 'skills');
export function listSkills(folder) {
  const d = skillsDir(folder); let ents = [];
  try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return []; }
  return ents.filter(e => e.isDirectory()).map(e => {
    let raw = ''; try { raw = fs.readFileSync(path.join(d, e.name, 'SKILL.md'), 'utf8'); } catch { return null; }
    const { description, body } = parseSkill(raw);
    return { name: e.name, description, body };
  }).filter(Boolean);
}
export function parseSkill(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { description: '', body: raw };
  const desc = /^description:\s*(.*)$/m.exec(m[1])?.[1]?.trim().replace(/^["']|["']$/g, '').replace(/\\"/g, '"') || '';
  return { description: desc, body: m[2].trim() };
}
export function setSkill(folder, name, description, body) {
  checkName(name);
  const dir = path.join(skillsDir(folder), name);
  fs.mkdirSync(dir, { recursive: true });
  const desc = String(description || '').replace(/\r?\n/g, ' ').replace(/"/g, '\\"');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: "${desc}"\n---\n\n${String(body || '').trim()}\n`, 'utf8');
}
export function delSkill(folder, name) {
  checkName(name);
  fs.rmSync(path.join(skillsDir(folder), name), { recursive: true, force: true });
}
