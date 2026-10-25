#!/usr/bin/env node
// fake herdr: logs calls, mimics JSON replies of the real one
import fs from 'node:fs';
const a = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(['herdr', ...a]) + '\n');
const j = r => console.log(JSON.stringify({ result: r }));
const cnt = process.env.FAKE_LOG + '.n';
let n = 0; try { n = Number(fs.readFileSync(cnt, 'utf8')); } catch {}
if (a[0] === 'status') console.log('server:\n  status: running');
else if (a[0] === 'workspace' && a[1] === 'create') { n = 1; fs.writeFileSync(cnt, '1'); j({ root_pane: { pane_id: 'w9:p1' }, workspace: { workspace_id: 'w9' } }); }
else if (a[0] === 'pane' && a[1] === 'split') { n++; fs.writeFileSync(cnt, String(n)); j({ pane: { pane_id: `w9:p${n}` } }); }
else if (a[0] === 'pane' && a[1] === 'run') { /* real herdr prints nothing */ }
else j({ type: 'ok' });
