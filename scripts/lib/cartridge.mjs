// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rampant LLC
// Shared cartridge helpers: notes parsing and validation. No dependencies.
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]*$/;

/** Parse notes.md into { intro, slides: { [id]: { title, md } } }. Sections start with "## [slide-id] Title". */
export function parseNotes(md) {
  const out = { intro: '', slides: {} };
  let cur = null;
  for (const line of md.split(/\r?\n/)) {
    const m = /^##\s+\[([^\]]+)\]\s*(.*)$/.exec(line);
    if (m) { cur = { title: m[2].trim(), md: '' }; out.slides[m[1].trim()] = cur; continue; }
    if (cur) cur.md += line + '\n';
    else if (!/^#\s/.test(line)) out.intro += line + '\n';
  }
  out.intro = out.intro.trim();
  for (const s of Object.values(out.slides)) s.md = s.md.trim();
  return out;
}

/** Slide ids in document order, read from data-id attributes on elements with class "slide". */
export function slideIds(html) {
  const ids = [];
  const re = /<section\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (!/class="[^"]*\bslide\b/.test(tag)) continue;
    const id = /data-id="([^"]+)"/.exec(tag);
    ids.push(id ? id[1] : null);
  }
  return ids;
}

function dirSize(dir) {
  let n = 0;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.name.startsWith('.')) continue;
    const p = join(dir, f.name);
    n += f.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return n;
}

/** Validate a cartridge folder. Returns { manifest, ids, notes, errors, warnings }. */
export function validateCartridge(dir) {
  const errors = [], warnings = [];
  const mPath = join(dir, 'cartridge.json');
  if (!existsSync(mPath)) return { errors: ['cartridge.json is missing'], warnings };
  let manifest;
  try { manifest = JSON.parse(readFileSync(mPath, 'utf8')); } catch (e) { return { errors: ['cartridge.json is not valid JSON: ' + e.message], warnings }; }

  if (manifest.cue !== 1) errors.push('cartridge.json "cue" must be 1');
  if (!ID.test(manifest.id || '')) errors.push('cartridge.json "id" must be lowercase letters, numbers and hyphens');
  if (!manifest.title) errors.push('cartridge.json "title" is required');
  const entry = manifest.entry || 'index.html';
  const entryPath = join(dir, entry);
  if (!existsSync(entryPath)) { errors.push(`entry file ${entry} is missing`); return { manifest, errors, warnings }; }

  const html = readFileSync(entryPath, 'utf8');
  const ids = slideIds(html);
  if (!ids.length) errors.push('no <section class="slide"> elements found in ' + entry);
  ids.forEach((id, i) => { if (!id) errors.push(`slide ${i + 1} has no data-id`); else if (!ID.test(id)) errors.push(`slide id "${id}" must be lowercase letters, numbers and hyphens`); });
  const dupes = ids.filter((id, i) => id && ids.indexOf(id) !== i);
  if (dupes.length) errors.push('duplicate slide ids: ' + [...new Set(dupes)].join(', '));

  // Audience interactions: <script type="application/json" data-interact>{...}</script> inside a slide.
  const TYPES = { join: [], words: ['id', 'prompt'], poll: ['id', 'prompt', 'options'], qa: [], followup: [] };
  const seen = new Set();
  for (const m of html.matchAll(/<script[^>]*data-interact[^>]*>([\s\S]*?)<\/script>/gi)) {
    let it;
    try { it = JSON.parse(m[1]); } catch (e) { errors.push('data-interact block is not valid JSON: ' + m[1].trim().slice(0, 60)); continue; }
    if (!TYPES[it.type]) { errors.push(`data-interact type "${it.type}" is not one of ${Object.keys(TYPES).join(', ')}`); continue; }
    for (const f of TYPES[it.type]) if (!it[f]) errors.push(`${it.type} interaction is missing "${f}"`);
    if (it.type === 'poll' && (!Array.isArray(it.options) || it.options.length < 2 || it.options.length > 8)) errors.push(`poll "${it.id}" needs 2 to 8 options`);
    if (it.id) { if (seen.has(it.id)) errors.push(`duplicate interaction id "${it.id}"`); seen.add(it.id); }
  }
  if (!/type:\s*['"]ready['"]/.test(html) || !/cue:\s*1/.test(html)) errors.push(`${entry} does not implement the cue/1 bridge (no "ready" message found)`);
  const ext = html.match(/(?:src|href)=["']https?:\/\/[^"']+/gi) || [];
  const extOk = ext.filter(u => !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u));
  if (extOk.length) warnings.push(`${extOk.length} external URL(s) in ${entry}; the deck will not work offline: ` + extOk.slice(0, 3).join(', '));

  let notes = { intro: '', slides: {} };
  const notesFile = manifest.notes || 'notes.md';
  if (existsSync(join(dir, notesFile))) {
    notes = parseNotes(readFileSync(join(dir, notesFile), 'utf8'));
    const known = new Set(ids);
    for (const id of Object.keys(notes.slides)) if (!known.has(id)) errors.push(`notes.md has a section for unknown slide id "${id}"`);
    const missing = ids.filter(id => id && !notes.slides[id]);
    if (missing.length) warnings.push(`${missing.length} slide(s) have no notes: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '...' : ''}`);
  } else warnings.push(`${notesFile} is missing; the remote will show no presenter notes`);

  const size = dirSize(dir);
  if (size > 25 * 1024 * 1024) warnings.push(`cartridge folder is ${(size / 1048576).toFixed(1)} MB; keep it under 25 MB`);
  return { manifest, ids, notes, errors, warnings };
}
