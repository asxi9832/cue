// Cue service worker: makes the app installable and keeps decks playable when the venue network drops.
const VERSION = 'cue-__CUE_VERSION__';
const SHELL = ['/', '/index.html', '/app.css', '/app.js', '/config.js', '/vendor/qrcode.js', '/remote/lib/relay.js', '/remote/lib/util.js', '/remote/lib/md.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const usable = r => r && r.ok && (r.type === 'basic' || r.type === 'cors');

// Network first: the library list, config and pages, so new decks show up when online.
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.type === 'opaqueredirect' || res.status === 401) return res; // signed out: let the login page through
    // Behind a login wall an expired session returns the login page instead of JSON; keep the cached copy then.
    const json = req.url.endsWith('.json');
    if (usable(res) && (!json || (res.headers.get('content-type') || '').includes('json'))) { cache.put(req, res.clone()); return res; }
    return (await cache.match(req)) || res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? cache.match('/index.html') : Response.error());
  }
}
// Stale while revalidate: deck files and libraries play instantly from cache and refresh in the background.
async function swr(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (usable(res)) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/remote/') && !url.pathname.startsWith('/remote/lib/')) return; // the phone remote is always live
    if (req.mode === 'navigate' || url.pathname === '/c/index.json' || url.pathname.endsWith('config.js')) e.respondWith(networkFirst(req));
    else e.respondWith(swr(req));
  } else if (url.hostname === 'cdn.jsdelivr.net') e.respondWith(swr(req));
});
