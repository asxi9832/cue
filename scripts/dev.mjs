#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rampant LLC
// Local dev server: builds from ../slides (or SLIDES_DIR) and serves dist/. Rebuilds when the app shell is requested.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { build } from './build.mjs';

const DIST = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist');
const PORT = +process.env.PORT || 8787;
// Optional .env (gitignored) for relay settings during local testing.
const dotenv = join(dirname(DIST), '.env');
const fileEnv = existsSync(dotenv) ? Object.fromEntries(readFileSync(dotenv, 'utf8').split('\n').filter(l => /^\w+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])) : {};
const env = { ...fileEnv, ...process.env, CUE_DEV: '1', SLIDES_DIR: process.env.SLIDES_DIR || '../slides' };
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
