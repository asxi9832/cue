// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rampant LLC
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Random id from an unambiguous alphabet. 26 characters is about 128 bits. */
export function randomId(len = 26) {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return [...b].map(x => ALPHA[x % ALPHA.length]).join('');
}

export function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'Device';
}

export function fmtTime(ms) {
  const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
