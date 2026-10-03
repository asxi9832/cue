// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rampant LLC
// Password gate for Cue on Cloudflare Pages. Runs before every request.
// Set CUE_PASSWORD (encrypted) in the Pages project to turn it on. The phone remote (/remote/)
// stays open: it holds no content, and the session id in the QR code is its key.
// If you later put Cloudflare Access in front of the site, delete CUE_PASSWORD and this gate turns itself off.
const COOKIE = 'cue_auth';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const OPEN = [/^\/remote(\/|$)/, /^\/login$/, /^\/manifest\.webmanifest$/, /^\/icons\//, /^\/favicon/];

const enc = new TextEncoder();
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function same(a, b) { // constant-time string compare
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function makeToken(secret) { const exp = Math.floor(Date.now() / 1000) + MAX_AGE; return `${exp}.${await sign(secret, 'cue1.' + exp)}`; }
async function validToken(secret, token) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || +exp < Date.now() / 1000) return false;
  return same(sig, await sign(secret, 'cue1.' + exp));
}
const cookieOf = (req, name) => (req.headers.get('Cookie') || '').split(/;\s*/).map(c => c.split('=')).find(([k]) => k === name)?.[1];
const safeNext = n => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

function loginPage(next, error) {
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cue</title><meta name="robots" content="noindex"><meta name="theme-color" content="#0b0c0f"><link rel="icon" href="/icons/icon-192.png">
<style>*{box-sizing:border-box;margin:0}body{min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(60% 50% at 50% 0%,rgba(255,181,71,.08),transparent 70%),#0b0c0f;color:#eceae6;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
form{width:100%;max-width:380px;text-align:center}.logo{display:inline-flex;align-items:center;gap:12px;font-weight:600;font-size:34px;letter-spacing:-.02em}
.logo i{width:15px;height:15px;border-radius:50%;background:#ffb547;box-shadow:0 0 0 4px rgba(255,181,71,.12),0 0 24px rgba(255,181,71,.45)}
p{color:#8d919b;margin:18px 0 26px;line-height:1.5}input{width:100%;height:50px;padding:0 16px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#15171d;color:#eceae6;font:inherit;font-size:16px}
button{width:100%;height:50px;margin-top:10px;border:0;border-radius:12px;background:#ffb547;color:#1a1205;font:inherit;font-weight:600;font-size:16px;cursor:pointer}.err{color:#ff6b5e;margin-top:14px;font-size:14px}</style></head>
<body><form method="post" action="/login"><span class="logo"><i></i>cue</span><p>Enter the password to open the presentation library.</p>
<input type="hidden" name="next" value="${esc(next)}"><input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
<button>Unlock</button>${error ? '<div class="err">That password is not right.</div>' : ''}</form></body></html>`,
  { status: error ? 401 : 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

export async function onRequest({ request, env, next }) {
  const secret = env.CUE_PASSWORD;
  if (!secret) return next(); // gate is off
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/login' && request.method === 'POST') {
    const form = await request.formData();
    const to = safeNext(String(form.get('next') || '/'));
    if (same(String(form.get('password') || ''), secret)) {
      return new Response(null, { status: 303, headers: { Location: to, 'Set-Cookie': `${COOKIE}=${await makeToken(secret)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax` } });
    }
    await new Promise(r => setTimeout(r, 900)); // slow down guessing
    return loginPage(to, true);
  }
  if (path === '/logout') {
    return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
  }
  if (OPEN.some(r => r.test(path))) return path === '/login' ? loginPage(safeNext(url.searchParams.get('next')), false) : next();

  if (await validToken(secret, cookieOf(request, COOKIE))) return next();

  const wantsPage = request.method === 'GET' && (request.headers.get('Accept') || '').includes('text/html');
  if (wantsPage) return Response.redirect(`${url.origin}/login?next=${encodeURIComponent(path + url.search)}`, 302);
  return new Response('Unauthorized', { status: 401, headers: { 'Cache-Control': 'no-store' } });
}
