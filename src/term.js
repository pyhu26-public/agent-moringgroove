// xterm.js bundle for the terminal tab.
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

export function createTerm(host, theme) {
  const term = new Terminal({
    cursorBlink: true, fontSize: 13, scrollback: 5000, allowProposedApi: true,
    fontFamily: 'Menlo, Monaco, "SF Mono", Consolas, "D2Coding", "Apple SD Gothic Neo", "Malgun Gothic", monospace', theme,
  });
  const fit = new FitAddon();
  term.loadAddon(fit); term.loadAddon(new WebLinksAddon());
  term.open(host);
  return { term, fit: () => { try { fit.fit(); } catch {} return { cols: term.cols, rows: term.rows }; } };
}
