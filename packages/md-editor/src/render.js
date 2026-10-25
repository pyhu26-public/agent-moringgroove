// Reading view: Markdown -> sanitized HTML (marked + DOMPurify), with [[wikilinks]] turned into
// <a class="wikilink" data-wiki="name">. Handle clicks yourself (see createMarkdownPane / README).
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export const WIKI = /\[\[([^\]\n]+?)\]\]/g;

// "[[Page#Heading|alias]]" -> { target: "Page", heading: "Heading", alias: "alias" }
export function parseWiki(inner) {
  const [left, alias] = inner.split('|');
  const [target, heading] = left.split('#');
  return { target: target.trim(), heading: heading?.trim() || null, alias: alias?.trim() || null };
}
export function extractWikiLinks(text) {
  return [...text.matchAll(WIKI)].map(m => parseWiki(m[1]).target);
}

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(src) {
  const withWiki = src.replace(WIKI, (_, inner) => {
    const w = parseWiki(inner);
    const label = (w.alias || w.target).replace(/</g, '&lt;');
    return `<a href="#" class="wikilink" data-wiki="${w.target.replace(/"/g, '&quot;')}">${label}</a>`;
  });
  return DOMPurify.sanitize(marked.parse(withWiki), { ADD_ATTR: ['data-wiki'] });
}
