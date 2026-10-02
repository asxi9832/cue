#!/usr/bin/env node
// Build Cue into dist/: copy the app, pull cartridges from the slides repo, write config.
//
// Cartridge source (first match wins):
//   SLIDES_DIR=../slides                      use a local checkout
//   SLIDES_REPO=owner/slides GITHUB_TOKEN=... shallow-clone a private repo (used on Cloudflare Pages)
// Relay (optional, enables phone remotes): SUPABASE_URL, SUPABASE_ANON_KEY
// Lobby (optional, lists live sessions to logged-in devices): CUE_LOBBY_KEY
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateCartridge } from './lib/cartridge.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const SKIP = new Set(['src', 'node_modules', '.git', '.github']);
// Published: everything except dotfiles, source folders, build scripts and markdown (notes ship as notes.json).
const skipFile = name => name.startsWith('.') || SKIP.has(name) || /\.(py|mjs|md)$/.test(name);

function cartridgeSource(env) {
  if (env.SLIDES_DIR) return resolve(ROOT, env.SLIDES_DIR);
  if (env.SLIDES_REPO) {
    const dest = join(ROOT, '.cache', 'slides');
    rmSync(dest, { recursive: true, force: true });
    const auth = env.GITHUB_TOKEN ? `x-access-token:${env.GITHUB_TOKEN}@` : '';
    console.log(`Cloning ${env.SLIDES_REPO}...`);
    execFileSync('git', ['clone', '--depth', '1', `https://${auth}github.com/${env.SLIDES_REPO}.git`, dest], { stdio: ['ignore', 'ignore', 'inherit'] });
    return dest;
  }
  const sibling = resolve(ROOT, '..', 'slides');
  return existsSync(sibling) ? sibling : null;
}

export function build(env = process.env) {
  rmSync(DIST, { recursive: true, force: true });
  cpSync(join(ROOT, 'public'), DIST, { recursive: true });

  const src = cartridgeSource(env);
  const list = [];
  const hash = createHash('sha256');
  mkdirSync(join(DIST, 'c'), { recursive: true });

  for (const name of src ? readdirSync(src).sort() : []) {
    const dir = join(src, name);
    if (!existsSync(join(dir, 'cartridge.json'))) continue;
    const { manifest, ids, notes, errors, warnings } = validateCartridge(dir);
    warnings.forEach(w => console.warn(`  ! ${name}: ${w}`));
    if (errors.length) { errors.forEach(e => console.error(`  x ${name}: ${e}`)); console.error(`  Skipped ${name}`); continue; }

    const out = join(DIST, 'c', manifest.id);
    cpSync(dir, out, { recursive: true, filter: p => p === dir || !skipFile(basename(p)) });
    writeFileSync(join(out, 'notes.json'), JSON.stringify(notes));
    hash.update(readFileSync(join(dir, manifest.entry || 'index.html')));
    hash.update(JSON.stringify(notes));
    list.push({
      id: manifest.id, title: manifest.title, subtitle: manifest.subtitle || '', author: manifest.author || '',
      version: manifest.version || '', duration: manifest.duration || null, accent: manifest.accent || '#ffb547',
      background: manifest.background || '#111', tags: manifest.tags || [], slides: ids.length,
      entry: `/c/${manifest.id}/${manifest.entry || 'index.html'}`, notes: `/c/${manifest.id}/notes.json`,
    });
    console.log(`  + ${manifest.id} (${ids.length} slides, ${Object.keys(notes.slides).length} notes)`);
  }
  writeFileSync(join(DIST, 'c', 'index.json'), JSON.stringify({ cartridges: list }, null, 2));

  const relay = env.SUPABASE_URL && env.SUPABASE_ANON_KEY ? { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY } : null;
  const dev = env.CUE_DEV === '1';
  // The remote config is served outside the login wall, so it never carries the lobby key.
  writeFileSync(join(DIST, 'config.js'), `window.CUE_CONFIG=${JSON.stringify({ relay, lobby: env.CUE_LOBBY_KEY || null, dev })};\n`);
  writeFileSync(join(DIST, 'remote', 'config.js'), `window.CUE_CONFIG=${JSON.stringify({ relay, dev })};\n`);

  hash.update(String(Date.now()));
  const version = hash.digest('hex').slice(0, 10);
  const sw = join(DIST, 'sw.js');
  writeFileSync(sw, readFileSync(sw, 'utf8').replace('__CUE_VERSION__', version));
  console.log(`Built ${list.length} cartridge(s) from ${src || '(no source)'}; relay ${relay ? 'on' : 'off'}; version ${version}`);
  return { list, version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) build();
