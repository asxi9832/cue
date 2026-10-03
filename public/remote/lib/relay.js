// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rampant LLC
// Cue relay: one message bus for a session.
//   local  = BroadcastChannel, for windows on the same computer (presenter window). Works offline.
//   remote = Supabase Realtime broadcast, for phones and tablets anywhere.
// The session id is the channel name and acts as the key, so it must be long and random.
const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
let clientP = null;

const client = relay => (clientP ||= import(SUPABASE_ESM).then(m =>
  m.createClient(relay.url, relay.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 20 } } })));

export const relayConfigured = cfg => !!(cfg && cfg.relay && cfg.relay.url && cfg.relay.anonKey);

// channel: full channel name. Defaults to the private presenter channel for the session.
export function openRelay({ session, channel, config, useLocal = true, useRemote = true, onMessage, onStatus = () => {} }) {
  const name = channel || 'cue:' + session;
  const links = [];
  const status = { local: 'off', remote: 'off' };
  const emit = () => onStatus({ ...status });

  if (useLocal && 'BroadcastChannel' in window) {
    const bc = new BroadcastChannel(name);
    bc.onmessage = e => onMessage(e.data, 'local');
    status.local = 'on';
    links.push({ send: m => bc.postMessage(m), close: () => bc.close() });
  }

  if (useRemote && relayConfigured(config)) {
    let ch = null, closed = false;
    const queue = [];
    status.remote = 'connecting';
    const push = m => ch.send({ type: 'broadcast', event: 'm', payload: m });
    client(config.relay).then(sb => {
      if (closed) return;
      ch = sb.channel(name, { config: { broadcast: { self: false, ack: false } } });
      ch.on('broadcast', { event: 'm' }, ({ payload }) => onMessage(payload, 'remote'));
      ch.subscribe(st => {
        status.remote = st === 'SUBSCRIBED' ? 'on' : st === 'CLOSED' ? 'off' : 'error';
        if (st === 'SUBSCRIBED') while (queue.length) push(queue.shift());
        emit();
      });
    }).catch(() => { status.remote = 'error'; emit(); });
    links.push({
      send: m => { if (ch && status.remote === 'on') push(m); else if (queue.length < 20) queue.push(m); },
      close: () => { closed = true; if (ch) ch.unsubscribe(); },
    });
  }

  setTimeout(emit, 0);
  return { send: m => links.forEach(l => l.send(m)), close: () => links.forEach(l => l.close()), status };
}

// Lobby: lists live screens to devices that are logged in to the portal. Needs the lobby key,
// which only the logged-in app receives, never the public remote page.
export function openLobby({ config, key, info, onSessions }) {
  if (!relayConfigured(config) || !config.lobby) return null;
  let ch = null, closed = false, cur = info;
  client(config.relay).then(sb => {
    if (closed) return;
    ch = sb.channel('cue-lobby:' + config.lobby, { config: { presence: { key: key || 'viewer-' + Math.random().toString(36).slice(2) } } });
    if (onSessions) ch.on('presence', { event: 'sync' }, () => onSessions(Object.values(ch.presenceState()).map(a => a[0]).filter(x => x && x.session)));
    ch.subscribe(async st => { if (st === 'SUBSCRIBED' && cur) await ch.track(cur); });
  });
  return { update(i) { cur = i; if (ch) ch.track(i); }, close() { closed = true; if (ch) ch.unsubscribe(); } };
}

// Call a Cue database function (see supabase/schema.sql) over plain HTTPS, with no client library.
export async function rpc(config, fn, args = {}) {
  if (!relayConfigured(config)) throw new Error('No relay configured');
  const key = config.relay.anonKey;
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ') && !config.relay.rpcUrl) headers.Authorization = `Bearer ${key}`;
  const base = config.relay.rpcUrl || `${config.relay.url}/rest/v1`; // rpcUrl: local testing only
  const res = await fetch(`${base}/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { }
  if (!res.ok) { const e = new Error((data && (data.message || data.hint)) || res.statusText); e.code = data && data.code; throw e; }
  return data;
}
