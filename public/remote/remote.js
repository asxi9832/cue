// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rampant LLC
// Cue remote: presenter notes and controls on a phone, tablet, or a presenter window on the same computer.
// It never holds its own position. It renders the state the screen broadcasts and sends commands back.
import { openRelay, relayConfigured } from './lib/relay.js';
import { renderNotes } from './lib/md.js';
import { randomId, deviceLabel, fmtTime, esc } from './lib/util.js';

const CFG = window.CUE_CONFIG || {};
const $ = s => document.querySelector(s);
const app = $('#app');

const params = new URLSearchParams(location.hash.slice(1));
const session = params.get('s');
const local = params.get('l') === '1';
const kind = local ? 'presenter' : 'remote';
let rid = sessionStorage.getItem('cue:rid');
if (!rid) { rid = randomId(12); sessionStorage.setItem('cue:rid', rid); }
const name = local ? 'Presenter window' : deviceLabel();

const prefs = Object.assign({ arrows: true, size: 0 }, JSON.parse(localStorage.getItem('cue:prefs') || '{}'));
const savePrefs = () => localStorage.setItem('cue:prefs', JSON.stringify(prefs));
function applyPrefs() {
  app.classList.toggle('noarrows', !prefs.arrows);
  document.documentElement.style.setProperty('--notes', prefs.size ? prefs.size + 'px' : '');
}
applyPrefs();

let aud = null;
let relay = null, deck = null, state = null, stateAt = 0, lastHeard = 0, shownIndex = -1, helloAt = 0, ended = false, away = false;

/* ---------------- connect ---------------- */
if (!session) gate('Join a screen', 'Scan the QR code on the presenting screen with your camera.');
else if (!local && !relayConfigured(CFG)) gate('Remote unavailable', 'This Cue has no relay configured, so phones cannot connect yet. A presenter window on the same computer still works.');
else connect();

function connect() {
  relay = openRelay({
    session, config: CFG, useLocal: local, useRemote: !local, onMessage,
    onStatus: st => { const s = local ? st.local : st.remote; paintLink(s); if (s === 'on') hello(); },
  });
  setInterval(() => send({ t: 'ping' }), 10000);
  setInterval(paintClock, 500);
  addEventListener('pagehide', () => send({ t: 'bye' }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { hello(); wake(); } });
}
const send = m => relay && relay.send({ ...m, rid, name, kind, from: rid });
function hello() { helloAt = Date.now(); send({ t: 'hello' }); }
const cmd = (c, extra = {}) => { if (!state || !state.deck) return; send({ t: 'cmd', cmd: c, ...extra }); haptic(); };

function onMessage(m) {
  if (!m || m.from === rid) return;
  lastHeard = Date.now();
  if (away && (m.t === 'deck' || m.t === 'state')) { away = false; $('#gate').hidden = true; toast('Screen is back'); }
  if (m.t === 'deck') { deck = m.deck; shownIndex = -1; paint(); }
  else if (m.t === 'state') {
    state = m; stateAt = Date.now();
    if (state.deck && (!deck || deck.id !== state.deck) && Date.now() - helloAt > 3000) hello(); // missed the deck: ask again
    paint();
  }
  else if (m.t === 'who') hello(); // the screen (re)connected and is asking who is here
  else if (m.t === 'aud') { aud = m.aud; paintAud(); }
  else if (m.t === 'report') showReport(m.report);
  else if (m.t === 'denied' && m.rid === rid) toast('Another device is in control');
  else if (m.t === 'end') { away = true; gate('Screen disconnected', 'Waiting for it to come back. This happens when the screen reloads. If Cue was closed there, scan the new QR code.'); }
}

/* ---------------- paint ---------------- */
function paintLink(s) {
  const el = $('#link');
  el.className = 'dot ' + (s === 'on' ? (lastHeard && Date.now() - lastHeard < 40000 ? 'on' : 'warn') : s === 'connecting' ? 'warn' : 'off');
  if (!state) setMsg(s === 'on' ? '<b>Connected</b>Waiting for the screen. Make sure Cue is open on it.' : s === 'error' ? '<b>Connection problem</b>Retrying. Check this device has internet.' : 'Connecting to the screen...');
}
function setMsg(html) { $('#notes').innerHTML = `<div class="msg">${html}</div>`; }

function paint() {
  if (ended || !state) return;
  $('#deckTitle').textContent = deck ? deck.title : 'Cue';
  const isCtl = local || state.controller === rid || !state.controller;
  app.classList.toggle('readonly', !isCtl && !!state.deck);
  $('#bBlack').classList.toggle('on', !!state.blackout);
  const reh = $('#bReh'); reh.classList.toggle('on', state.rehearsal.on); reh.querySelector('span').textContent = state.rehearsal.on ? 'Stop' : 'Rehearse';
  const tag = $('#tag');
  tag.className = 'tag' + (state.blackout ? ' black' : state.rehearsal.on ? ' reh' : '');
  tag.textContent = state.blackout ? 'Blackout' : state.rehearsal.on ? 'Rehearsing' : '';

  if (!state.deck || !deck) {
    $('#pos').textContent = '-'; $('#dots').innerHTML = ''; $('#slideTitle').textContent = 'No cartridge loaded';
    $('#nextTitle').textContent = '-';
    setMsg('<b>Paired</b>Pick a cartridge on the screen. Notes appear here as soon as it loads.');
    shownIndex = -1;
    paintClock();
    return;
  }
  const s = deck.slides[state.index] || {};
  $('#pos').textContent = `${state.index + 1} / ${deck.slides.length}`;
  $('#dots').innerHTML = Array.from({ length: state.builds }, (_, k) => `<i class="${k < state.build ? 'on' : ''}"></i>`).join('');
  $('#slideTitle').textContent = s.title || '';
  const nx = state.build < state.builds ? `Click ${state.build + 1} of ${state.builds} on this slide` : (deck.slides[state.index + 1] || {}).title || 'End of deck';
  $('#nextTitle').textContent = nx;
  if (shownIndex !== state.index) {
    shownIndex = state.index;
    $('#notes').innerHTML = '<div id="qaq"></div>' + (s.notes ? renderNotes(s.notes) : '<div class="msg">No notes for this slide.</div>');
    paintAud();
    $('#notes').scrollTop = 0;
  }
  paintClicks();
  paintClock();
}
function paintClicks() {
  const b = state.build;
  let up = null;
  document.querySelectorAll('#notes li.click').forEach(li => {
    const from = +li.dataset.from, to = +li.dataset.to;
    li.classList.toggle('done', to < b);
    li.classList.toggle('cur', from <= b && b <= to);
    const isUp = from === b + 1;
    li.classList.toggle('up', isUp);
    if (isUp && !up) up = li;
  });
  const cur = document.querySelector('#notes li.click.cur') || up;
  if (cur && b > 0) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function paintClock() {
  $('#clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (relay) paintLink(local ? relay.status.local : relay.status.remote);
  if (!state) return;
  const el = $('#timer');
  const elapsed = state.timer.elapsed + (state.timer.running ? Date.now() - stateAt : 0);
  $('#timerText').textContent = fmtTime(elapsed);
  $('#timerOf').textContent = deck && deck.duration ? `/ ${deck.duration}m` : '';
  el.classList.toggle('run', state.timer.running);
  el.classList.toggle('over', !!(deck && deck.duration && elapsed > deck.duration * 60000));
}

/* ---------------- input ---------------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  wake();
  const a = b.dataset.act;
  if (a === 'next' || a === 'prev') { flash(b); cmd(a); }
  else if (a === 'blackout') cmd('blackout');
  else if (a === 'rehearse') cmd('rehearse', { action: state && state.rehearsal.on ? 'stop' : 'start' });
  else if (a === 'reset') cmd('timer', { action: 'reset' });
  else if (a === 'slides') showSlides();
  else if (a === 'more') showMore();
  else if (a === 'take') { send({ t: 'take' }); haptic(); }
});
$('#timer').addEventListener('click', () => cmd('timer', { action: 'toggle' }));
document.addEventListener('keydown', e => { // presenter window on a laptop, or a tablet keyboard
  if (/input/i.test(e.target.tagName)) return;
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); cmd('next'); }
  else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); cmd('prev'); }
  else if (e.key === 'b' || e.key === 'B' || e.key === '.') cmd('blackout');
});
function flash(b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 120); }
function haptic() { if (navigator.vibrate) navigator.vibrate(8); }

let lock = null;
async function wake() { try { if ('wakeLock' in navigator && (!lock || lock.released)) lock = await navigator.wakeLock.request('screen'); } catch { } }
document.addEventListener('pointerdown', wake, { once: true });

/* ---------------- sheets ---------------- */
function sheet(html) {
  $('#sheetBody').innerHTML = html;
  const sh = $('#sheet'); sh.hidden = false;
  sh.onclick = e => { if (e.target === sh) sh.hidden = true; };
}
const closeSheet = () => { $('#sheet').hidden = true; };

function showSlides() {
  if (!deck || !state) return;
  sheet(`<h3>Slides</h3><ul class="list">${deck.slides.map((s, i) => `<li><button data-go="${i}" class="${i === state.index ? 'cur' : ''}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${esc(s.title)}</span><span class="b">${s.builds ? s.builds + ' clicks' : ''}</span></button></li>`).join('')}</ul>`);
  $('#sheetBody').onclick = e => { const g = e.target.closest('[data-go]'); if (g) { cmd('goto', { index: +g.dataset.go }); closeSheet(); } };
  const cur = $('#sheetBody .cur'); if (cur) cur.scrollIntoView({ block: 'center' });
}

function showMore() {
  const isCtl = local || (state && state.controller === rid);
  sheet(`<h3>Settings</h3>
    <div class="row"><span>Arrows on the tap areas</span><button class="tgl ${prefs.arrows ? 'on' : ''}" data-p="arrows">${prefs.arrows ? 'On' : 'Off'}</button></div>
    <div class="row"><span>Notes text size</span><div class="seg"><button data-p="smaller">A&minus;</button><button data-p="bigger">A+</button></div></div>
    ${!isCtl ? '<div class="row"><span>Control</span><button class="tgl" data-p="take">Take control</button></div>' : '<div class="row"><span>Control</span><span style="color:var(--go)">This device</span></div>'}
    <div class="row"><span>Sync</span><button class="tgl" data-p="resync">Resync with screen</button></div>
    <div class="row danger"><span>${esc(name)}</span><button class="tgl" data-p="leave">Leave session</button></div>
    <p class="lic">Cue is free software under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">AGPL-3.0</a>. <a href="https://github.com/asxi9832/cue" target="_blank" rel="noopener">Source code</a></p>`);
  $('#sheetBody').onclick = e => {
    const p = e.target.closest('[data-p]'); if (!p) return;
    const k = p.dataset.p;
    const cur = prefs.size || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--notes')) || 19;
    if (k === 'arrows') { prefs.arrows = !prefs.arrows; savePrefs(); applyPrefs(); showMore(); }
    else if (k === 'smaller') { prefs.size = Math.max(14, cur - 2); savePrefs(); applyPrefs(); }
    else if (k === 'bigger') { prefs.size = Math.min(34, cur + 2); savePrefs(); applyPrefs(); }
    else if (k === 'take') { send({ t: 'take' }); closeSheet(); }
    else if (k === 'resync') { send({ t: 'cmd', cmd: 'resync' }); hello(); closeSheet(); }
    else if (k === 'leave') { send({ t: 'bye' }); ended = true; closeSheet(); gate('Left the session', 'Scan the QR code again to rejoin.'); }
  };
}

function showReport(r) {
  const max = Math.max(...r.rows.map(x => x.ms), 1);
  sheet(`<h3>Rehearsal</h3><div class="sum"><div><b>${fmtTime(r.total)}</b>total</div>${r.duration ? `<div><b>${r.duration}:00</b>target</div>` : ''}</div>
    <ul class="rep">${r.rows.map(x => `<li><span class="t">${esc(x.title)}</span><span class="ms">${fmtTime(x.ms)}</span><span class="bar"><i style="width:${(x.ms / max) * 100}%"></i></span></li>`).join('')}</ul>`);
}

/* ---------------- gate (no session) ---------------- */
function gate(title, text) {
  $('#gate').hidden = false; $('#gateTitle').textContent = title; $('#gateText').textContent = text;
}
$('#joinForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#joinCode').value.trim();
  const m = /[#&]s=([a-z0-9]+)/i.exec(v) || /^([a-z0-9]{20,})$/i.exec(v);
  if (m) { location.hash = 's=' + m[1]; location.reload(); }
  else toast('That does not look like a Cue session link');
});

function toast(t) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = t;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 2600);
}

/* ---------------- audience: count and the question queue ---------------- */
function paintAud() {
  const n = $('#audN');
  n.hidden = !aud;
  if (aud) n.textContent = `👥 ${aud.count}`;
  const box = $('#qaq');
  if (!box) return;
  if (!aud || !aud.step || aud.step.type !== 'qa') { box.innerHTML = ''; box._sig = ''; return; }
  const items = (aud.questions && aud.questions.items) || [], feat = aud.questions && aud.questions.featured;
  const sig = feat + '|' + aud.auto + '|' + items.map(q => q.id + q.status + q.votes).join();
  if (box._sig === sig && box.innerHTML) return; // redraw only on change, so taps are never lost
  box._sig = sig;
  const pending = items.filter(q => q.status === 'pending');
  const live = items.filter(q => q.status === 'approved');
  const done = items.filter(q => q.status === 'answered');
  const hidden = items.filter(q => q.status === 'hidden');
  const row = q => `<div class="qi ${q.id === feat ? 'feat' : ''} ${q.status}"><div class="qb">${esc(q.body)}<small>${esc(q.emoji)} ${esc(q.name)} &middot; ${q.votes} vote${q.votes === 1 ? '' : 's'}${q.flagged ? ' &middot; filtered' : ''}</small></div>
    <div class="qa-acts">${q.status === 'hidden' ? `<button data-qa="restore" data-id="${q.id}">Restore</button>`
      : q.status === 'pending' ? `<button data-qa="approve" data-id="${q.id}" class="pri">Approve</button><button data-qa="feature" data-id="${q.id}">Show now</button><button data-qa="hide" data-id="${q.id}">Hide</button>`
      : q.id === feat ? `<button data-qa="answered" data-id="${q.id}" class="pri">Done</button><button data-qa="clear" data-id="${q.id}">Off screen</button>`
      : `<button data-qa="feature" data-id="${q.id}" class="pri">Show</button>${q.status !== 'answered' ? `<button data-qa="answered" data-id="${q.id}">Answered</button>` : ''}<button data-qa="hide" data-id="${q.id}">Hide</button>`}</div></div>`;
  box.innerHTML = `<div class="qhead"><b>Questions</b><span>${live.length} live</span><button data-qa="next" class="pri">${feat ? 'Next question' : 'Show top question'}</button></div>
    <label class="qauto"><span>${aud.auto ? 'New questions go live automatically' : 'New questions wait for your approval'}</span><button data-qa="auto" data-value="${aud.auto ? '0' : '1'}" class="tgl ${aud.auto ? 'on' : ''}">${aud.auto ? 'Auto' : 'Approve'}</button></label>
    ${pending.length ? `<div class="qpend"><b>Needs approval (${pending.length})</b>${pending.map(row).join('')}</div>` : ''}
    ${live.length ? live.map(row).join('') : '<p class="qempty">No questions yet. They appear here ranked by upvotes.</p>'}
    ${done.length ? `<details><summary>Answered (${done.length})</summary>${done.map(row).join('')}</details>` : ''}
    ${hidden.length ? `<details><summary>Hidden or filtered (${hidden.length})</summary>${hidden.map(row).join('')}</details>` : ''}`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-qa]');
  if (!b) return;
  e.stopPropagation();
  send({ t: 'cmd', cmd: 'qa', action: b.dataset.qa, id: b.dataset.id || null, value: b.dataset.value === '1' });
  haptic();
}, true);
