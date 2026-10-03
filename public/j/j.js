// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rampant LLC
// Cue audience page: join with a name and an emoji, then follow along. Polls, word clouds,
// questions and reactions appear as the presenter reaches them. Writes go through the
// database functions; the screen pushes everything the phone displays.
import { openRelay, relayConfigured, rpc } from '/remote/lib/relay.js';
import { randomId, esc } from '/remote/lib/util.js';

const CFG = window.CUE_CONFIG || {};
const $ = s => document.querySelector(s);
const view = $('#view');
const EMOJI = ['🦊', '🐼', '🦁', '🐙', '🦉', '🐝', '🦄', '🐢', '🐬', '🦖', '🌵', '🚀'];

let cid = localStorage.getItem('cue:cid');
if (!cid) { cid = randomId(20); localStorage.setItem('cue:cid', cid); }
let code = (location.hash.slice(1).match(/[A-Za-z0-9]{6}/) || [''])[0].toUpperCase();
const store = k => `cue:aud:${code}:${k}`;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(store(k))) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(store(k), JSON.stringify(v));

let me = null, stage = null, relay = null, lastKey = '';
const send = m => relay && relay.send({ ...m, cid });

/* ---------------- utilities ---------------- */
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2400); }
const haptic = () => navigator.vibrate && navigator.vibrate(8);
function theme(t) {
  if (!t) return;
  const r = document.documentElement.style;
  if (t.accent) r.setProperty('--acc', t.accent);
  if (t.background) {
    r.setProperty('--bg', t.background);
    const h = t.background.replace('#', ''), n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    document.documentElement.classList.toggle('light', lum > .6);
    document.querySelector('meta[name=theme-color]').content = t.background;
  }
}
async function call(fn, args) {
  try { return await rpc(CFG, fn, { p_code: code, p_client: cid, ...args }); }
  catch (e) {
    if (/not found or ended/i.test(e.message)) { ended(); throw e; }
    toast(/limit/i.test(e.message) ? 'You have reached the limit for this one' : /Invalid email/.test(e.message) ? 'That email does not look right' : /Invalid phone/.test(e.message) ? 'That phone number does not look right' : 'Something went wrong. Try again.');
    throw e;
  }
}

/* ---------------- screens ---------------- */
function enterCode(msg) {
  $('#hd').hidden = true; $('#react').hidden = true;
  view.innerHTML = `<div class="spacer"></div><span class="eyebrow">Join</span><h1>Enter the code<br>on the screen.</h1><p class="sub">${esc(msg || 'Six letters and numbers.')}</p>
    <div style="height:26px"></div><input class="field code" id="c" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text">
    <div style="height:12px"></div><button class="big" id="go" disabled>Continue</button><div class="spacer"></div>`;
  const c = $('#c'), go = $('#go');
  c.focus();
  c.oninput = () => { c.value = c.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); go.disabled = c.value.length !== 6; };
  go.onclick = () => { location.hash = c.value; location.reload(); };
}

function ended() {
  $('#react').hidden = true;
  view.innerHTML = `<div class="hello"><div class="em">👋</div><h2>This session has ended.</h2><p class="sub">Thanks for joining.</p></div>`;
}

function joinForm(title) {
  let pick = (me && me.emoji) || EMOJI[Math.floor(Math.random() * EMOJI.length)];
  $('#hd').hidden = true; $('#react').hidden = true; view.dataset.v = 'join';
  view.innerHTML = `<div class="spacer"></div><span class="eyebrow" id="jt">${esc(title || 'Join the conversation')}</span><h1>What should<br>we call you?</h1>
    <div style="height:18px"></div><input class="field" id="n" maxlength="24" placeholder="First name" autocomplete="given-name" enterkeyhint="go" value="${esc(me ? me.name : '')}">
    <div class="emojis">${EMOJI.map(e => `<button data-e="${e}" class="${e === pick ? 'on' : ''}">${e}</button>`).join('')}</div>
    <button class="big" id="go">Join</button><p class="fine">No account and no password. Just a name for the screen.</p><div class="spacer"></div>`;
  const n = $('#n'), go = $('#go');
  if (!me) n.focus();
  view.querySelector('.emojis').onclick = e => { const b = e.target.closest('[data-e]'); if (!b) return; pick = b.dataset.e; view.querySelectorAll('.emojis button').forEach(x => x.classList.toggle('on', x === b)); haptic(); };
  const submit = async () => {
    const name = n.value.trim();
    if (!name) { n.focus(); return; }
    go.disabled = true;
    try {
      const r = await call('cue_join', { p_name: name, p_emoji: pick });
      me = { name, emoji: pick }; save('me', me);
      haptic(); send({ t: 'joined' }); connected(r && r.title);
    } catch { go.disabled = false; }
  };
  go.onclick = submit;
  n.onkeydown = e => { if (e.key === 'Enter') submit(); };
}

function connected(title) {
  view.dataset.v = '';
  $('#hd').hidden = false; $('#react').hidden = false;
  $('#title').textContent = (stage && stage.title) || title || '';
  $('#me').innerHTML = `<b>${esc(me.emoji)}</b>${esc(me.name)}`;
  $('#me').onclick = () => joinForm(stage && stage.title);
  render(true);
}

/* ---------------- stage rendering ---------------- */
function render(force) {
  if (!me) return;
  $('#askBtn').hidden = !(stage && stage.qa);
  const st = stage && stage.step;
  const key = st ? `${st.type}:${st.id}:${st.state}` : 'idle';
  if (!force && key === lastKey) { update(); return; }
  lastKey = key;
  if (!st || st.type === 'join') return idle();
  if (st.type === 'poll') return poll(st);
  if (st.type === 'words') return words(st);
  if (st.type === 'qa') return qa();
  if (st.type === 'followup') return followup(st);
  idle();
}
function update() { // live data changed, same step: refresh in place
  const st = stage && stage.step;
  if (!st) return;
  if (st.type === 'words') paintPopular(st);
  if (st.type === 'poll') paintPoll(st);
  if (st.type === 'qa') paintQuestions();
}

function idle() {
  view.innerHTML = `<div class="hello"><div class="em">${esc(me.emoji)}</div><h1>You are in, ${esc(me.name)}.</h1><p class="sub">Keep an eye on the screen. Your phone lights up when it is your turn.</p></div>`;
}

function poll(st) {
  const mine = load('poll:' + st.id, null);
  view.innerHTML = `<span class="eyebrow">Poll</span><h2>${esc(st.prompt)}</h2><div class="opts">${st.options.map((o, i) =>
    `<button class="opt ${mine === i ? 'on' : ''}" data-i="${i}"><span class="fill" style="width:0"></span><span class="dot"></span><span>${esc(o)}</span><span class="pct"></span></button>`).join('')}</div>
    <p class="note" id="pn">${mine === null ? 'Tap one.' : 'Tap another to change your vote.'}</p>`;
  view.querySelector('.opts').onclick = async e => {
    const b = e.target.closest('.opt');
    if (!b || st.state === 'closed' || st.state === 'reveal') return;
    const i = +b.dataset.i;
    view.querySelectorAll('.opt').forEach(x => x.classList.toggle('on', x === b)); haptic();
    try { await call('cue_vote', { p_interaction: st.id, p_choice: i }); save('poll:' + st.id, i); $('#pn').textContent = 'Got it. Tap another to change your vote.'; send({ t: 'voted', id: st.id }); }
    catch { }
  };
  paintPoll(st);
}
function paintPoll(st) {
  const show = st.state === 'reveal' && st.results;
  const total = show ? st.results.reduce((a, b) => a + b, 0) || 1 : 1;
  view.querySelectorAll('.opt').forEach((b, i) => {
    b.querySelector('.fill').style.width = show ? (100 * (st.results[i] || 0) / total) + '%' : '0';
    b.querySelector('.pct').textContent = show ? Math.round(100 * (st.results[i] || 0) / total) + '%' : '';
  });
  if (show) $('#pn').textContent = 'Results are on the screen.';
}

function words(st) {
  const max = st.max || 3;
  view.innerHTML = `<span class="eyebrow">Word cloud</span><h2>${esc(st.prompt)}</h2>
    <div class="row"><input class="field" id="w" maxlength="24" placeholder="One word" autocomplete="off" autocapitalize="off" enterkeyhint="send"><button id="add">Add</button></div>
    <div class="chips" id="mine"></div><div class="label" id="popl" hidden>Popular in the room</div><div class="chips" id="pop"></div>`;
  const w = $('#w'), add = $('#add');
  const mineList = () => load('words:' + st.id, []);
  const paintMine = () => {
    const m = mineList();
    $('#mine').innerHTML = m.map(x => `<span class="chip mine">${esc(x)}</span>`).join('');
    const full = m.length >= max;
    w.disabled = add.disabled = full; w.placeholder = full ? `That is all ${max}. Thanks!` : m.length ? 'Another word' : 'One word';
  };
  const submit = async word => {
    word = (word || '').trim().split(/\s+/)[0];
    if (!word || mineList().length >= max) return;
    if (mineList().some(x => x.toLowerCase() === word.toLowerCase())) { toast('You already added that one'); return; }
    add.disabled = true;
    try {
      const r = await call('cue_add_words', { p_interaction: st.id, p_words: [word], p_max: max });
      if (r && r.added) { save('words:' + st.id, [...mineList(), word]); haptic(); send({ t: 'worded', id: st.id }); if (r.filtered) toast('That one will not show on the screen'); }
      w.value = '';
    } catch { }
    paintMine(); paintPopular(st);
  };
  add.onclick = () => submit(w.value);
  w.onkeydown = e => { if (e.key === 'Enter') submit(w.value); };
  $('#pop').onclick = e => { const c = e.target.closest('[data-w]'); if (c) submit(c.dataset.w); };
  paintMine(); paintPopular(st);
}
function paintPopular(st) {
  const el = $('#pop'); if (!el) return;
  const mine = load('words:' + st.id, []).map(x => x.toLowerCase());
  const top = (stage.words || []).filter(x => !mine.includes(x.word)).slice(0, 10);
  $('#popl').hidden = !top.length;
  el.innerHTML = top.map(x => `<button class="chip pop" data-w="${esc(x.word)}">${esc(x.word)}</button>`).join('');
}

function qa() {
  view.innerHTML = `<span class="eyebrow">Questions</span><h2>What do you want to know?</h2>
    <button class="big" id="ask2">Ask a question</button><div class="label">Vote up what you want answered</div><div class="qs" id="qs"></div>`;
  $('#ask2').onclick = askSheet;
  $('#qs').onclick = async e => {
    const b = e.target.closest('[data-q]'); if (!b || b.classList.contains('on')) return;
    b.classList.add('on'); b.textContent = (+b.textContent || 0) + 1; haptic();
    try { await call('cue_upvote', { p_question: b.dataset.q }); save('up', [...load('up', []), b.dataset.q]); send({ t: 'upvoted' }); } catch { }
  };
  paintQuestions();
}
function paintQuestions() {
  const el = $('#qs'); if (!el) return;
  const q = stage.questions || { items: [] }, up = load('up', []);
  el.innerHTML = q.items.length ? q.items.map(x => `<div class="q ${x.id === q.featured ? 'feat' : ''}"><div><div class="b">${esc(x.body)}</div><small>${esc(x.emoji)} ${esc(x.name)}${x.status === 'answered' ? ' · answered' : ''}</small></div>
    <button class="up ${up.includes(x.id) ? 'on' : ''}" data-q="${x.id}">${x.votes}</button></div>`).join('') : '<p class="note">No questions yet. Be the first.</p>';
}
function askSheet() {
  const sh = $('#sheet');
  $('#sheetBody').innerHTML = `<span class="eyebrow">Ask a question</span><h2 style="margin-top:8px">The presenter sees it right away.</h2>
    <textarea class="field" id="qt" maxlength="280" placeholder="Type your question"></textarea><div style="height:10px"></div>
    <button class="big" id="qs2">Send</button><div style="height:8px"></div><button class="ghost" id="qc">Cancel</button>`;
  sh.hidden = false; $('#qt').focus();
  const close = () => { sh.hidden = true; };
  $('#qc').onclick = close; sh.onclick = e => { if (e.target === sh) close(); };
  $('#qs2').onclick = async () => {
    const t = $('#qt').value.trim();
    if (t.length < 3) { $('#qt').focus(); return; }
    $('#qs2').disabled = true;
    try { await call('cue_ask', { p_body: t }); close(); toast('Thanks! Your question is in.'); haptic(); send({ t: 'asked' }); }
    catch { $('#qs2').disabled = false; }
  };
}

function followup(st) {
  const done = load('followup', false);
  if (done) {
    view.innerHTML = `<div class="hello"><div class="em">📬</div><h1>You are all set.</h1><p class="sub">${esc(st.thanks || 'We will send it to you shortly.')}</p></div>`;
    return;
  }
  const phone = (st.fields || ['email']).includes('phone');
  view.innerHTML = `<span class="eyebrow">Take it with you</span><h2>${esc(st.offer || 'Want the slides?')}</h2>
    <div class="stack"><input class="field" id="em" type="email" inputmode="email" autocomplete="email" placeholder="Email">
    ${phone ? '<input class="field" id="ph" type="tel" inputmode="tel" autocomplete="tel" placeholder="Mobile number (optional)">' : ''}</div>
    <label class="check"><input type="checkbox" id="ce"><span>${esc(st.consent || 'Email me what was offered, and occasional updates. Unsubscribe any time.')}</span></label>
    ${phone ? `<label class="check" id="csw" hidden><input type="checkbox" id="cs"><span>${esc(st.smsConsent || 'Text me about this. Message and data rates may apply. Reply STOP to opt out.')}</span></label>` : ''}
    <div style="height:18px"></div><button class="big" id="fs">${esc(st.button || 'Send it to me')}</button>
    <p class="fine">${st.privacy ? `See our <a href="${esc(st.privacy)}" target="_blank" rel="noopener">privacy notice</a>. ` : ''}We only use this for what you check above.</p>`;
  if (phone) $('#ph').oninput = () => { $('#csw').hidden = !$('#ph').value.trim(); };
  $('#fs').onclick = async () => {
    const email = $('#em').value.trim(), ph = phone ? $('#ph').value.trim() : '';
    if (!email && !ph) { $('#em').focus(); return; }
    if (!$('#ce').checked && !(phone && $('#cs') && $('#cs').checked)) { toast('Check a box so we know how to send it'); return; }
    const consent = [$('#ce').checked ? $('#ce').nextElementSibling.textContent : '', phone && $('#cs') && $('#cs').checked ? $('#cs').nextElementSibling.textContent : ''].filter(Boolean).join(' | ');
    $('#fs').disabled = true;
    try {
      await call('cue_follow_up', { p_name: me.name, p_email: email || null, p_phone: ph || null, p_consent_email: $('#ce').checked, p_consent_sms: !!(phone && $('#cs') && $('#cs').checked), p_consent_text: consent });
      save('followup', true); haptic(); send({ t: 'followed' }); followup(st);
    } catch { $('#fs').disabled = false; }
  };
}

/* ---------------- reactions ---------------- */
let lastReact = 0;
$('#react').onclick = e => {
  if (e.target.closest('#askBtn')) { askSheet(); return; }
  const b = e.target.closest('[data-e]'); if (!b) return;
  if (Date.now() - lastReact < 350) return;
  lastReact = Date.now();
  const f = document.createElement('div'); f.className = 'fly'; f.textContent = b.dataset.e;
  const r = b.getBoundingClientRect(); f.style.left = r.left + r.width / 2 - 17 + 'px'; f.style.top = r.top - 30 + 'px';
  document.body.appendChild(f); setTimeout(() => f.remove(), 1500);
  haptic(); send({ t: 'react', e: b.dataset.e });
};

/* ---------------- start ---------------- */
function onMessage(m) {
  if (!m || m.cid || m.t !== 'stage') return; // ignore other phones
  const first = !stage;
  stage = m; theme(m.theme);
  if (me) { if (first) connected(); else { $('#title').textContent = m.title || ''; render(); } }
  else if (view.dataset.v === 'join') { const jt = $('#jt'); if (jt && m.title) jt.textContent = m.title; }
  else if (first) joinForm(m.title);
}

(async () => {
  if (!code) return enterCode();
  if (!relayConfigured(CFG)) return enterCode('This Cue is not set up for audience participation yet.');
  me = load('me', null);
  relay = openRelay({ channel: 'cue-aud:' + code, config: CFG, useLocal: false, onMessage, onStatus: st => { if (st.remote === 'on') send({ t: 'hi' }); } });
  try {
    if (me) { await call('cue_join', { p_name: me.name, p_emoji: me.emoji }); connected(); }
    else { await rpc(CFG, 'cue_wall', { p_code: code }); joinForm(); }
  } catch (e) { if (!/ended/i.test(e.message)) enterCode('We could not find that code. Check the screen and try again.'); }
})();
