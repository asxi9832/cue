#!/usr/bin/env node
// Local dev server: builds from ../slides (or SLIDES_DIR) and serves dist/. Rebuilds when the app shell is requested.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { build } from './build.mjs';

const DIST = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist');
const PORT = +process.env.PORT || 8787;
const env = { ...process.env, CUE_DEV: '1', SLIDES_DIR: process.env.SLIDES_DIR || '../slides' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4' };

build(env);
createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/' || path === '/index.html') { try { build(env); } catch (e) { console.error(e); } }
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Cue dev server on http://localhost:${PORT}`));
