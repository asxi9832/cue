// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rampant LLC
// Cue screen app: pairing, library, stage. The screen is the source of truth for position;
// remotes only send commands and render whatever state the screen broadcasts.
import { openRelay, openLobby, relayConfigured, rpc } from '/remote/lib/relay.js';
import { randomId, esc, fmtTime } from '/remote/lib/util.js';

const CFG = window.CUE_CONFIG || {};
const SELF = 'screen';
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const HAS_RELAY = relayConfigured(CFG);
const STALE_MS = 35000;
// If you run a modified Cue for others, the AGPL asks you to point this at your modified source.
const SOURCE_URL = 'https://github.com/asxi9832/cue';

/* ---------------- session + relay ---------------- */
let session = sessionStorage.getItem('cue:session');
if (!session) { session = randomId(); sessionStorage.setItem('cue:session', session); }
const remoteUrl = `${CFG.remoteBase || location.origin}/remote/#s=${session}`;

const S = {
  cart: null, notes: { intro: '', slides: {} }, slides: [],
  index: 0, id: null, build: 0, builds: 0, total: 0,
  blackout: false,
  timer: { running: false, base: 0, since: 0 },
  reh: { on: false, times: {}, cur: null, at: 0, startedAt: 0 },
  controller: null, relay: { local: 'off', remote: 'off' },
};
const remotes = new Map();

const relay = openRelay({ session, config: CFG, onMessage: onRelay, onStatus: st => {
  // Announce on every (re)connect so remotes that waited through a reload resync at once.
  const up = (st.local === 'on' && S.relay.local !== 'on') || (st.remote === 'on' && S.relay.remote !== 'on');
  S.relay = st; paintStatus();
  if (up) setTimeout(() => { send({ t: 'who' }); sendDeck(); sendState(); }, 50);
} });
const lobby = openLobby({ config: CFG, key: session, info: lobbyInfo() });
const send = m => relay.send({ ...m, from: SELF });
addEventListener('pagehide', () => send({ t: 'end' }));
setInterval(() => { pruneRemotes(); sendState(); }, 15000);

function lobbyInfo() { return { session, deck: S.cart ? S.cart.title : null, since: Date.now() }; }

function upsert(m, via) {
  const r = remotes.get(m.rid) || { rid: m.rid, first: Date.now() };
  Object.assign(r, { name: m.name || 'Remote', kind: m.kind || 'remote', via, seen: Date.now() });
  remotes.set(m.rid, r);
  return r;
}
const alive = rid => { const r = remotes.get(rid); return r && Date.now() - r.seen < STALE_MS; };
function pruneRemotes() {
  let changed = false;
  for (const [rid, r] of remotes) if (Date.now() - r.seen > STALE_MS * 2) { remotes.delete(rid); changed = true; }
  if (S.controller && !alive(S.controller)) { S.controller = null; changed = true; }
  if (changed) paintStatus();
}
function canControl(rid) {
  const r = remotes.get(rid);
  if (!r) return false;
  if (r.via === 'local' || r.kind === 'presenter') return true; // this computer's own presenter window
  if (!S.controller || !alive(S.controller)) S.controller = rid;
  return S.controller === rid;
}

function onRelay(m, via) {
  if (!m || m.from === SELF || !m.rid) return;
  switch (m.t) {
    case 'hello': {
      const isNew = !remotes.has(m.rid);
      const r = upsert(m, via);
      if (r.kind === 'remote' && (!S.controller || !alive(S.controller))) S.controller = m.rid;
      if (isNew) toast(`<i class="dot on"></i>${esc(r.name)} connected`);
      sendDeck(); sendState(); paintStatus();
      break;
    }
    case 'ping': upsert(m, via); break;
    case 'bye': remotes.delete(m.rid); if (S.controller === m.rid) S.controller = null; sendState(); paintStatus(); break;
    case 'take': upsert(m, via); S.controller = m.rid; sendState(); paintStatus(); toast(`${esc(m.name || 'Remote')} took control`); break;
    case 'cmd': upsert(m, via); if (canControl(m.rid)) exec(m.cmd, m); else send({ t: 'denied', rid: m.rid }); break;
  }
}

/* ---------------- commands ---------------- */
const timerElapsed = () => S.timer.base + (S.timer.running ? Date.now() - S.timer.since : 0);
function timer(action) {
  const T = S.timer;
  if (action === 'start' && !T.running) { T.running = true; T.since = Date.now(); }
  else if (action === 'pause' && T.running) { T.base = timerElapsed(); T.running = false; }
  else if (action === 'toggle') return timer(T.running ? 'pause' : 'start');
  else if (action === 'reset') { T.base = 0; T.since = Date.now(); }
  sendState();
}

function exec(cmd, m = {}) {
  switch (cmd) {
    case 'next': if (!S.timer.running && !S.timer.base) timer('start'); toDeck({ type: 'next' }); break;
    case 'prev': toDeck({ type: 'prev' }); break;
    case 'goto': toDeck({ type: 'goto', index: m.index | 0, build: m.build | 0 }); break;
    case 'blackout': setBlackout(typeof m.value === 'boolean' ? m.value : !S.blackout); break;
    case 'timer': timer(m.action); break;
    case 'rehearse': m.action === 'stop' ? stopRehearsal() : startRehearsal(); break;
    case 'resync': sendDeck(); sendState(); sendAud(); break;
    case 'qa': hostQuestion(m.action, m.id); break;
  }
}

function setBlackout(v) { S.blackout = v; const st = $('.stage'); if (st) st.classList.toggle('blackout', v); paintBar(); sendState(); }

/* ---------------- rehearsal ---------------- */
function tick() { const R = S.reh; if (R.on && R.cur) { R.times[R.cur] = (R.times[R.cur] || 0) + (Date.now() - R.at); R.at = Date.now(); } }
function startRehearsal() {
  if (!S.cart) return;
  Object.assign(S.reh, { on: true, times: {}, cur: S.id, at: Date.now(), startedAt: Date.now() });
  S.timer = { running: true, base: 0, since: Date.now() };
  $('.stage')?.classList.add('rehearsing'); paintBar(); sendState(); toast('Rehearsal started');
}
function stopRehearsal() {
  const R = S.reh;
  if (!R.on) return;
  tick(); R.on = false;
  const rows = S.slides.map(s => ({ id: s.id, title: s.title, ms: R.times[s.id] || 0 }));
  const report = { deck: S.cart.id, title: S.cart.title, duration: S.cart.duration, at: Date.now(), total: Date.now() - R.startedAt, rows };
  const key = 'cue:rehearsals:' + S.cart.id;
  try { const all = JSON.parse(localStorage.getItem(key) || '[]'); all.unshift(report); localStorage.setItem(key, JSON.stringify(all.slice(0, 5))); } catch {}
  $('.stage')?.classList.remove('rehearsing'); paintBar();
  send({ t: 'report', report }); sendState();
  toast(`Rehearsal saved: ${fmtTime(report.total)}`);
}
const lastRehearsal = id => { try { return JSON.parse(localStorage.getItem('cue:rehearsals:' + id) || '[]')[0]; } catch { return null; } };

/* ---------------- broadcast ---------------- */
function sendState() {
  send({
    t: 'state', deck: S.cart ? S.cart.id : null, index: S.index, id: S.id, build: S.build, builds: S.builds, total: S.total,
    blackout: S.blackout, timer: { running: S.timer.running, elapsed: timerElapsed() },
    rehearsal: { on: S.reh.on, elapsed: S.reh.on ? Date.now() - S.reh.startedAt : 0 }, controller: S.controller,
  });
}
function sendDeck() {
  if (!S.cart) { send({ t: 'deck', deck: null }); return; }
  send({ t: 'deck', deck: {
    id: S.cart.id, title: S.cart.title, version: S.cart.version, duration: S.cart.duration, intro: S.notes.intro,
    slides: S.slides.map(s => ({ id: s.id, title: s.title, builds: s.builds, notes: (S.notes.slides[s.id] || {}).md || '' })),
  } });
}

/* ---------------- deck frame (cue/1 protocol) ---------------- */
let frame = null;
const toDeck = m => { if (frame && frame.contentWindow) frame.contentWindow.postMessage({ cue: 1, ...m }, location.origin); };
addEventListener('message', e => {
  if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return;
  const d = e.data;
  if (!d || d.cue !== 1) return;
  if (d.type === 'ready') {
    S.slides = (d.slides || []).map(s => ({ id: s.id, title: (S.notes.slides[s.id] || {}).title || s.title || s.id, builds: s.builds | 0, interact: s.interact || null }));
    sendDeck(); sendState(); audienceStart();
  } else if (d.type === 'state') {
    if (d.id !== S.id) { tick(); S.reh.cur = d.id; }
    Object.assign(S, { index: d.index | 0, id: d.id, build: d.build | 0, builds: d.builds | 0, total: d.total | 0 });
    if (S.index > 0 && !S.timer.running && !S.timer.base) timer('start');
    paintBar(); sendState(); audienceStep();
  } else if (d.type === 'key') onKey(d.key);
});

/* ---------------- audience participation ---------------- */
// One event per deck per browser session. Phones join on a separate public channel (cue-aud:<code>),
// never the presenter channel. Phone messages are only hints to refresh; the database is the truth.
const AUD = { code: null, key: null, ch: null, deck: null, step: null, wall: { count: 0, recent: [] }, results: {}, qs: { featured: null, items: [] }, host: { featured: null, items: [] }, timer: null, needs: new Set(), poll: null, reacts: [] };
const audUrl = () => AUD.code ? `${CFG.remoteBase || location.origin}/j/#${AUD.code}` : ''; // trailing slash: no redirect hop on slow networks
const hasAudience = () => HAS_RELAY && S.slides.some(s => s.interact);

async function audienceStart() {
  if (!hasAudience() || !S.cart || AUD.deck === S.cart.id) { pushDeck(); return; }
  AUD.deck = S.cart.id;
  const keyName = 'cue:aud:' + S.cart.id;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(keyName) || 'null'); } catch { }
  try {
    if (saved) { Object.assign(AUD, saved); await rpc(CFG, 'cue_wall', { p_code: AUD.code }); }
  } catch { saved = null; }
  if (!saved) {
    try {
      const r = await rpc(CFG, 'cue_host_start', { p_deck: S.cart.id, p_title: S.cart.title, p_filter: !(S.cart.audience && S.cart.audience.filter === false) });
      Object.assign(AUD, { code: r.code, key: r.host_key });
      sessionStorage.setItem(keyName, JSON.stringify({ code: AUD.code, key: AUD.key }));
      const past = JSON.parse(localStorage.getItem('cue:events') || '[]');
      past.unshift({ code: AUD.code, key: AUD.key, deck: S.cart.id, title: S.cart.title, at: Date.now() });
      localStorage.setItem('cue:events', JSON.stringify(past.slice(0, 50)));
    } catch (e) { AUD.deck = null; toast('Audience features unavailable: ' + esc(e.message)); return; }
  }
  AUD.ch = openRelay({ channel: 'cue-aud:' + AUD.code, config: CFG, onMessage: onAud, onStatus: st => { if (st.remote === 'on') pushStage(); } });
  AUD.poll = setInterval(() => { need('wall'); if (AUD.step && AUD.step.id) need('r:' + AUD.step.id); if (S.slides.some(s => s.interact && s.interact.type === 'qa')) need('qs'); }, 4000);
  need('wall'); need('qs'); audienceStep();
}
function audienceStop() {
  if (AUD.ch) AUD.ch.close();
  clearInterval(AUD.poll);
  Object.assign(AUD, { ch: null, deck: null, code: null, key: null, step: null, results: {}, wall: { count: 0, recent: [] }, qs: { featured: null, items: [] }, host: { featured: null, items: [] } });
  sendAud();
}
function audienceStep() {
  if (!AUD.code) return;
  const sl = S.slides[S.index];
  const it = sl && sl.interact;
  let step = null;
  if (it) {
    step = { ...it, state: 'open' };
    if (it.type === 'poll') step.state = S.build >= (it.revealAt ?? 1) ? 'reveal' : 'open';
    if (it.id) need('r:' + it.id);
    if (it.type === 'join') need('wall');
    if (it.type === 'qa') need('qs');
  }
  const changed = JSON.stringify(step) !== JSON.stringify(AUD.step);
  AUD.step = step;
  if (changed) { pushStage(); pushDeck(); sendAud(); }
}
function need(what) { AUD.needs.add(what); if (!AUD.timer) AUD.timer = setTimeout(refresh, 450); }
async function refresh() {
  AUD.timer = null;
  if (!AUD.code) return;
  const needs = [...AUD.needs]; AUD.needs.clear();
  const code = AUD.code;
  try {
    await Promise.all(needs.map(async n => {
      if (n === 'wall') AUD.wall = await rpc(CFG, 'cue_wall', { p_code: code });
      else if (n === 'qs') {
        AUD.qs = await rpc(CFG, 'cue_questions_public', { p_code: code });
        AUD.host = await rpc(CFG, 'cue_host_questions', { p_code: code, p_key: AUD.key });
      } else if (n.startsWith('r:')) AUD.results[n.slice(2)] = await rpc(CFG, 'cue_results', { p_code: code, p_interaction: n.slice(2) });
    }));
  } catch (e) { if (/ended/i.test(e.message)) { sessionStorage.removeItem('cue:aud:' + (S.cart && S.cart.id)); } return; }
  pushDeck(); pushStage(); sendAud();
}
function onAud(m) {
  if (!m || !m.cid) return; // only phones carry a client id
  if (m.t === 'hi') pushStage();
  else if (m.t === 'joined') need('wall');
  else if ((m.t === 'voted' || m.t === 'worded') && m.id) need('r:' + m.id);
  else if (m.t === 'asked' || m.t === 'upvoted') need('qs');
  else if (m.t === 'react' && typeof m.e === 'string' && m.e.length <= 8) {
    const now = Date.now(); AUD.reacts = AUD.reacts.filter(t => now - t < 1000);
    if (AUD.reacts.length < 14) { AUD.reacts.push(now); toDeck({ type: 'aud-react', e: m.e }); }
  }
}
function pollCounts(id, n) {
  const r = AUD.results[id], out = Array(n).fill(0);
  if (r) r.votes.forEach(v => { if (v.choice < n) out[v.choice] = v.count; });
  return out;
}
function pushStage() {
  if (!AUD.ch || !S.cart) return;
  const st = AUD.step ? { ...AUD.step } : null;
  if (st && st.type === 'poll') st.results = st.state === 'reveal' ? pollCounts(st.id, st.options.length) : null;
  AUD.ch.send({
    t: 'stage', title: S.cart.title, theme: { accent: S.cart.accent, background: S.cart.background },
    qa: S.slides.some(s => s.interact && s.interact.type === 'qa'), step: st,
    words: st && st.type === 'words' ? ((AUD.results[st.id] || {}).words || []).slice(0, 12) : [],
    questions: AUD.qs,
  });
}
let qrCache = { url: '', data: null };
function qrData(url) {
  if (qrCache.url === url) return qrCache.data;
  const q = qrcode(0, 'M'); q.addData(url); q.make();
  const n = q.getModuleCount(); let cells = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) cells += q.isDark(r, c) ? '1' : '0';
  qrCache = { url, data: { n, cells, svg: q.createSvgTag({ cellSize: 8, margin: 0, scalable: true }) } };
  return qrCache.data;
}
function pushDeck() {
  if (!frame || !AUD.code) return;
  const results = {};
  S.slides.forEach(s => { const it = s.interact; if (!it || !it.id) return;
    if (it.type === 'poll') results[it.id] = { kind: 'poll', counts: pollCounts(it.id, it.options.length), reveal: AUD.step && AUD.step.id === it.id && AUD.step.state === 'reveal' };
    if (it.type === 'words') results[it.id] = { kind: 'words', words: (AUD.results[it.id] || {}).words || [] };
  });
  const url = audUrl();
  toDeck({ type: 'aud', code: AUD.code, url, short: url.replace(/^https?:\/\//, '').replace(/\/?#.*$/, ''), qr: qrData(url), wall: AUD.wall, results, questions: AUD.qs });
}
function sendAud() {
  send({ t: 'aud', aud: AUD.code ? { code: AUD.code, url: audUrl(), count: AUD.wall.count || 0, step: AUD.step, filter: !(S.cart && S.cart.audience && S.cart.audience.filter === false), questions: AUD.host } : null });
}
async function hostQuestion(action, id) {
  if (!AUD.code) return;
  const items = AUD.host.items || [];
  try {
    if (action === 'next') {
      const nx = items.find(q => q.status === 'approved' && q.id !== AUD.host.featured);
      if (AUD.host.featured) await rpc(CFG, 'cue_host_question', { p_code: AUD.code, p_key: AUD.key, p_id: AUD.host.featured, p_status: 'answered', p_feature: false });
      if (nx) await rpc(CFG, 'cue_host_question', { p_code: AUD.code, p_key: AUD.key, p_id: nx.id, p_status: null, p_feature: true });
    } else if (action === 'feature') await rpc(CFG, 'cue_host_question', { p_code: AUD.code, p_key: AUD.key, p_id: id, p_status: 'approved', p_feature: true });
    else if (action === 'clear') await rpc(CFG, 'cue_host_question', { p_code: AUD.code, p_key: AUD.key, p_id: id, p_status: null, p_feature: false });
    else if (action === 'answered') await rpc(CFG, 'cue_host_question', { p_code: AUD.code, p_key: AUD.key, p_id: id, p_status: 'answered', p_feature: false });
    else if (action === 'hide') await rpc(CFG, 'cue_host_question', { p_code: AUD.code, p_key: AUD.key, p_id: id, p_status: 'hidden', p_feature: false });
    else if (action === 'restore') await rpc(CFG, 'cue_host_question', { p_code: AUD.code, p_key: AUD.key, p_id: id, p_status: 'approved', p_feature: null });
  } catch (e) { toast('Could not update the question'); }
  need('qs');
}
async function exportAudience() {
  if (!AUD.code) return;
  const d = await rpc(CFG, 'cue_host_export', { p_code: AUD.code, p_key: AUD.key });
  const csv = rows => rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const out = csv([['name', 'email', 'phone', 'consent_email', 'consent_sms', 'consent_text', 'at'], ...d.contacts.map(c => [c.name, c.email, c.phone, c.consent_email, c.consent_sms, c.consent_text, c.at])]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out], { type: 'text/csv' }));
  a.download = `${d.event.deck}-${d.event.code}-contacts.csv`; a.click();
  const b = document.createElement('a');
  b.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
  b.download = `${d.event.deck}-${d.event.code}-report.json`; setTimeout(() => b.click(), 300);
}

/* ---------------- keys ---------------- */
function onKey(k) {
  if (k === 'b' || k === 'B' || k === '.' || k === 'w' || k === 'W') exec('blackout');
  else if (k === 'p' || k === 'P') openPresenter();
  else if (k === 'f' || k === 'F') toggleFullscreen();
  else if (k === 'q' || k === 'Q') openPairModal();
  else if (k === 'Escape') closeModal();
}
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea/i.test(e.target.tagName)) return;
  if (!$('#modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
  if (frame) {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); exec('next'); return; }
    if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); exec('prev'); return; }
  }
  onKey(e.key);
});
function toggleFullscreen() { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); }
function openPresenter() { window.open(`/remote/#s=${session}&l=1`, 'cue-presenter-' + session, 'popup,width=1180,height=760'); }

/* ---------------- shared UI bits ---------------- */
function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
}
function controllerName() { const r = S.controller && remotes.get(S.controller); return r && alive(S.controller) ? r.name : null; }
function remoteSummary() {
  const live = [...remotes.values()].filter(r => alive(r.rid));
  if (!live.length) return { cls: HAS_RELAY ? 'warn' : '', text: HAS_RELAY ? 'No remote yet' : 'Remote relay off' };
  const c = controllerName();
  return { cls: 'on', text: c ? `${c} in control` : `${live.length} connected` };
}
function paintStatus() {
  const s = remoteSummary();
  document.querySelectorAll('[data-remote-pill]').forEach(el => { el.innerHTML = `<i class="dot ${s.cls}"></i>${esc(s.text)}`; });
  const qr = $('.pair .qr'); if (qr) qr.classList.toggle('paired', [...remotes.values()].some(r => alive(r.rid) && r.kind === 'remote'));
  const st = $('[data-pair-status]'); if (st) st.innerHTML = `<i class="dot ${s.cls}"></i>${s.cls === 'on' ? esc(s.text) : HAS_RELAY ? 'Waiting for a remote...' : 'Phone remote needs a relay. The presenter window still works.'}`;
  const dl = $('[data-devices]'); if (dl) dl.innerHTML = devicesHtml();
}
function devicesHtml() {
  const live = [...remotes.values()].filter(r => alive(r.rid));
  if (!live.length) return '<li><i class="dot"></i>No devices yet</li>';
  return live.map(r => `<li class="${r.rid === S.controller ? 'ctl' : ''}"><i class="dot on"></i>${esc(r.name)}<small>${r.rid === S.controller ? 'In control' : r.kind === 'presenter' ? 'This computer' : 'Viewing'}</small></li>`).join('');
}
function pairBlock() {
  const qr = HAS_RELAY
    ? `<div class="qr">${qrSvg(remoteUrl)}<div class="ok"><div><b>&#10003;</b>Remote connected</div></div></div>`
    : `<div class="qr off">Phone remote is off.<br>Add a Supabase relay to enable it. See docs/DEPLOY.md.</div>`;
  return { qr, code: HAS_RELAY ? `<div class="code">Session ${session.slice(0, 4)}&middot;&middot;&middot;${session.slice(-4)}</div>` : '' };
}
function toast(html, ms = 2800) {
  const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = html;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
}

/* ---------------- modal: pair / devices ---------------- */
function openPairModal() {
  const p = pairBlock();
  const m = $('#modal');
  m.innerHTML = `<div class="box"><h3>Remote</h3><p>Scan to use a phone or tablet as the remote. The code is the key, so no login is needed. One device controls at a time.</p>
    <div class="pair">${p.qr}<div><ul class="devices" data-devices>${devicesHtml()}</ul>${p.code}
    <div class="acts" style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn sm" data-act="presenter">Presenter window here</button><button class="btn sm ghost" data-act="close">Done</button></div>
    ${AUD.code ? `<div class="aud-info"><b>Audience</b> &middot; code <span class="mono">${AUD.code}</span> &middot; ${AUD.wall.count || 0} joined <button class="btn sm" data-act="export">Export contacts</button></div>` : ''}
    <div class="keys"><kbd>B</kbd><span>Blackout</span><kbd>P</kbd><span>Presenter window</span><kbd>F</kbd><span>Full screen</span><kbd>Q</kbd><span>This panel</span></div></div></div></div>`;
  m.hidden = false;
  m.onclick = e => { if (e.target === m || e.target.closest('[data-act="close"]')) closeModal(); if (e.target.closest('[data-act="presenter"]')) openPresenter(); if (e.target.closest('[data-act="export"]')) exportAudience().catch(() => toast('Export failed')); };
  paintStatus();
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; if (frame) frame.focus(); }

/* ---------------- views ---------------- */
function viewPair() {
  const p = pairBlock();
  view.innerHTML = `<div class="center"><div class="pair">${p.qr}<div>
    <span class="logo big"><i></i>cue</span>
    <h1>Pair a remote</h1>
    <p>Scan with a phone or tablet to get presenter notes and slide controls. Do it now, before you share your screen.</p>
    ${p.code}
    <div class="status" data-pair-status></div>
    <div class="acts"><a class="btn primary" href="#/library">Continue to library</a><button class="btn" data-act="presenter">Presenter window here</button><a class="btn ghost" href="#/library">Skip</a></div>
    <div class="small">${CFG.dev ? `Testing: <a href="/remote/#s=${session}&l=1" target="_blank">open a remote in a new tab</a>. ` : ''}Already logged in on your phone? Open Cue there and go to <a href="#/join">Join</a>.</div>
  </div></div></div>`;
  view.querySelector('[data-act="presenter"]').onclick = openPresenter;
  paintStatus();
}

// Fetch the cartridge list. A 401 means the password gate's session expired, so go log in again.
async function cartridges() {
  const res = await fetch('/c/index.json', { cache: 'no-cache' });
  if (res.status === 401) { location.href = '/login?next=' + encodeURIComponent('/' + location.hash); throw new Error('signed out'); }
  return (await res.json()).cartridges;
}

async function viewLibrary() {
  view.innerHTML = `<div class="lib"><div class="top"><span class="logo"><i></i>cue</span><div class="r"><button class="pill" data-remote-pill></button>${CFG.dev ? '' : '<a class="btn sm ghost" href="/logout" title="Sign out of this device">Lock</a>'}</div></div>
    <main><h2>Cartridges</h2><div class="grid" id="grid"></div>
    <footer class="foot">Cue is free software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">AGPL-3.0</a>. <a href="${SOURCE_URL}" target="_blank" rel="noopener">Source code</a></footer></main></div>`;
  view.querySelector('[data-remote-pill]').onclick = openPairModal;
  paintStatus();
  let list = [];
  try { list = await cartridges(); } catch { }
  const grid = $('#grid');
  if (!list.length) { grid.outerHTML = '<div class="empty">No cartridges yet. Add a folder with a cartridge.json to your slides repository and push.</div>'; return; }
  grid.innerHTML = list.map(c => {
    const r = lastRehearsal(c.id);
    return `<a class="card" href="#/play/${encodeURIComponent(c.id)}" style="--acc:${esc(c.accent)};--bgc:${esc(c.background)}">
      <div class="art"><em>${esc(c.version ? 'v' + c.version : '')}</em><span>${esc(c.title)}</span></div>
      <div class="meta"><p>${esc(c.subtitle)}</p><div class="row"><span>${c.slides} slides</span>${c.duration ? `<span>${c.duration} min</span>` : ''}${c.author ? `<span>${esc(c.author)}</span>` : ''}${r ? `<span>Rehearsed ${fmtTime(r.total)}</span>` : ''}</div></div></a>`;
  }).join('');
  // Warm the cache so every deck still plays if the venue network drops.
  if (navigator.serviceWorker && navigator.serviceWorker.controller) list.forEach(c => { fetch(c.entry).catch(() => {}); fetch(c.notes).catch(() => {}); });
}

async function viewPlay(id) {
  let list = [];
  try { list = await cartridges(); } catch { }
  const cart = list.find(c => c.id === id);
  if (!cart) { location.hash = '#/library'; return; }
  S.cart = cart; S.slides = []; S.index = 0; S.id = null; S.build = 0; S.blackout = false;
  S.timer = { running: false, base: 0, since: 0 };
  try { S.notes = await (await fetch(cart.notes)).json(); } catch { S.notes = { intro: '', slides: {} }; }
  view.innerHTML = `<div class="stage"><iframe title="${esc(cart.title)}" allow="fullscreen; autoplay; clipboard-write"></iframe><div class="hot"></div>
    <div class="bar show"><div class="grp"><a class="btn sm ghost" href="#/library">&larr; Library</a><span class="ttl">${esc(cart.title)}</span><span class="cnt" data-cnt></span></div>
    <div class="grp"><button class="pill" data-remote-pill></button><button class="btn sm" data-act="presenter">Presenter</button><button class="btn sm" data-act="rehearse">Rehearse</button><button class="btn sm" data-act="blackout">Blackout</button><button class="btn sm" data-act="fs">Full screen</button></div></div>
    <div class="black"></div><div class="rec"><i></i>REHEARSING</div></div>`;
  frame = $('.stage iframe');
  frame.addEventListener('load', () => { toDeck({ type: 'hello' }); frame.focus(); });
  frame.src = cart.entry;
  const bar = $('.stage .bar');
  setTimeout(() => bar.classList.remove('show'), 3500);
  bar.onclick = e => {
    const a = e.target.closest('[data-act]'); const pill = e.target.closest('[data-remote-pill]');
    if (pill) openPairModal();
    if (!a) return;
    ({ presenter: openPresenter, fs: toggleFullscreen, blackout: () => exec('blackout'), rehearse: () => exec('rehearse', { action: S.reh.on ? 'stop' : 'start' }) })[a.dataset.act]();
    frame.focus();
  };
  lobby && lobby.update(lobbyInfo());
  paintStatus(); paintBar(); sendDeck(); sendState();
}
function paintBar() {
  const c = $('[data-cnt]'); if (c && S.total) c.textContent = `${S.index + 1} / ${S.total}`;
  const b = $('.stage [data-act="blackout"]'); if (b) b.classList.toggle('on', S.blackout);
  const r = $('.stage [data-act="rehearse"]'); if (r) { r.classList.toggle('on', S.reh.on); r.textContent = S.reh.on ? 'Stop rehearsal' : 'Rehearse'; }
}

function viewJoin() {
  view.innerHTML = `<div class="center"><div class="join"><span class="logo big"><i></i>cue</span><h1>Join a screen</h1>
    <p>Live screens on your account. Tap one to use this device as its remote.</p><ul class="sessions" id="sessions"><li class="empty">${CFG.lobby ? 'Looking for live screens...' : 'The session list needs CUE_LOBBY_KEY and a relay. Scan the QR code on the screen instead.'}</li></ul>
    <p style="margin-top:26px"><a href="#/">&larr; Use this device as the screen instead</a></p></div></div>`;
  if (!CFG.lobby) return;
  const watcher = openLobby({ config: CFG, onSessions: list => {
    const el = $('#sessions'); if (!el) { watcher.close(); return; }
    const others = list.filter(x => x.session !== session);
    el.innerHTML = others.length ? others.map(x => `<li><a href="/remote/#s=${encodeURIComponent(x.session)}"><i class="dot on"></i><div>${esc(x.deck || 'Waiting for a cartridge')}<small>Screen live since ${new Date(x.since).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div></a></li>`).join('') : '<li class="empty">No live screens right now.</li>';
  } });
}

function leavePlay() {
  if (!frame) return;
  if (S.reh.on) stopRehearsal();
  audienceStop();
  frame = null; S.cart = null; S.slides = []; S.total = 0; S.blackout = false;
  sendDeck(); sendState(); lobby && lobby.update(lobbyInfo());
}

function route() {
  const h = location.hash || '#/';
  closeModal();
  const play = /^#\/play\/(.+)$/.exec(h);
  if (!play) leavePlay();
  if (play) viewPlay(decodeURIComponent(play[1]));
  else if (h.startsWith('#/library')) viewLibrary();
  else if (h.startsWith('#/join')) viewJoin();
  else viewPair();
}
addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && !CFG.dev) navigator.serviceWorker.register('/sw.js').catch(() => {});
