// Small, escaping markdown renderer for presenter notes.
// Supports paragraphs, lists, ### headings, > quotes, **bold**, *italic* and `code`.
// List items that start with "**Click N:**" or "**Clicks N to M:**" are tagged so the remote can track builds.
import { esc } from './util.js';

const inline = s => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');

function item(text) {
  const m = /^\*\*Clicks?\s+(\d+)(?:\s*(?:to|-|–)\s*(\d+))?:?\*\*/i.exec(text);
  if (!m) return `<li>${inline(text)}</li>`;
  return `<li class="click" data-from="${m[1]}" data-to="${m[2] || m[1]}">${inline(text)}</li>`;
}

export function renderNotes(md) {
  let html = '', list = null, para = [];
  const flush = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flush(); close(); continue; }
    if ((m = /^\s*[-*]\s+(.*)$/.exec(line)) || (m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flush();
      const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (list !== tag) { close(); html += `<${tag}>`; list = tag; }
      html += item(m[1]);
      continue;
    }
    if ((m = /^#{2,6}\s+(.*)$/.exec(line))) { flush(); close(); html += `<h4>${inline(m[1])}</h4>`; continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { flush(); close(); html += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
    close();
    para.push(line.trim());
  }
  flush(); close();
  return html;
}
