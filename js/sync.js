// Client-side sync + auth.
// auth = { id, headers } — id is the closet id; headers carry the session
// key for email sign-in (empty for closet-code mode, where the hashed code
// itself is the credential and never leaves the device unhashed).

export async function codeToId(code) {
  const data = new TextEncoder().encode('styleme:' + code.trim().toLowerCase());
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function hdr(auth, extra = {}) {
  return { ...(auth.headers || {}), ...extra };
}

// ---- magic-link sign-in ----
export async function authStart(email) {
  const res = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', email }) });
  const j = await res.json();
  return res.ok ? { ok: true } : { error: j.error || 'Could not send the link.', unconfigured: res.status === 501 };
}

export async function authFinish(token) {
  const res = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'finish', token }) });
  const j = await res.json();
  return res.ok ? j : { error: j.error || 'Sign-in failed.' };
}

// ---- sharded sync (per-item records + manifest) ----
export async function fetchManifest(auth) {
  try {
    const res = await fetch('/api/sync2?id=' + auth.id, { headers: hdr(auth) });
    if (res.status === 404) return { missing: true };
    if (res.status === 501) return { unconfigured: true };
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: 'Sync read failed (' + res.status + ').' };
    return { manifest: await res.json() };
  } catch (err) { return { error: err.message }; }
}

export async function fetchRecord(auth, kind, rid) {
  try {
    const res = await fetch(`/api/sync2?id=${auth.id}&kind=${kind}&rid=${encodeURIComponent(rid)}`, { headers: hdr(auth) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export async function pushRecords(auth, body) {
  try {
    const res = await fetch('/api/sync2', {
      method: 'POST',
      headers: hdr(auth, { 'content-type': 'application/json' }),
      body: JSON.stringify({ ...body, id: auth.id }),
    });
    const j = await res.json();
    return res.ok ? { ok: true, manifest: j.manifest } : { error: j.error || ('Sync write failed (' + res.status + ').'), unconfigured: res.status === 501 };
  } catch (err) { return { error: err.message }; }
}

// legacy whole-blob read — used once to migrate old closets into shards
export async function pullLegacy(auth) {
  try {
    const res = await fetch('/api/sync?id=' + auth.id, { headers: hdr(auth) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ---- stylist sharing ----
export async function createShareLink(auth) {
  const res = await fetch('/api/share', { method: 'POST', headers: hdr(auth, { 'content-type': 'application/json' }), body: JSON.stringify({ id: auth.id }) });
  const j = await res.json();
  if (!res.ok) return { error: j.error || ('Failed (' + res.status + ')') };
  return { url: location.origin + '/#/stylist-for/' + j.token };
}

export async function fetchSharedCloset(token) {
  const res = await fetch('/api/share?token=' + encodeURIComponent(token));
  const j = await res.json();
  if (!res.ok) return { error: j.error || 'That link did not work.' };
  return { items: j.items };
}

export async function sendSuggestion(token, outfit) {
  const res = await fetch('/api/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, outfit }) });
  const j = await res.json();
  return res.ok ? { ok: true } : { error: j.error || 'Could not send.' };
}

export async function fetchSuggestions(auth) {
  try {
    const res = await fetch('/api/suggestions?id=' + auth.id, { headers: hdr(auth) });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function dismissSuggestion(auth, removeId) {
  await fetch('/api/suggestions', { method: 'POST', headers: hdr(auth, { 'content-type': 'application/json' }), body: JSON.stringify({ id: auth.id, removeId }) }).catch(() => {});
}

// ---- push notifications ----
export async function subscribePush(auth) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { error: 'unsupported' };
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { error: 'denied' };
  const reg = await navigator.serviceWorker.ready;
  const keyRes = await fetch('/api/push');
  if (!keyRes.ok) return { error: 'Server not ready for notifications yet.' };
  const { publicKey } = await keyRes.json();
  const pad = publicKey.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((publicKey.length + 3) % 4);
  const appKey = Uint8Array.from(atob(pad), c => c.charCodeAt(0));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
  const res = await fetch('/api/push', {
    method: 'POST', headers: hdr(auth, { 'content-type': 'application/json' }),
    body: JSON.stringify({ id: auth.id, subscription: sub.toJSON() }),
  });
  return res.ok ? { ok: true } : { error: 'Could not register this device.' };
}

export async function pushStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  } catch { return 'off'; }
}

// ---- posted looks & ratings ----
export async function postLook(auth, look) {
  const res = await fetch('/api/looks', { method: 'POST', headers: hdr(auth, { 'content-type': 'application/json' }), body: JSON.stringify({ id: auth.id, look }) });
  const j = await res.json();
  return res.ok ? { ok: true, lookId: j.lookId, aiPending: j.aiPending } : { error: j.error || 'Could not post the look.' };
}

export async function fetchLooksOwner(auth) {
  try {
    const res = await fetch('/api/looks?id=' + auth.id, { headers: hdr(auth) });
    return res.ok ? await res.json() : [];
  } catch { return []; }
}

export async function fetchLooksByToken(token) {
  const res = await fetch('/api/looks?token=' + encodeURIComponent(token));
  const j = await res.json();
  return res.ok ? { looks: j } : { error: j.error || 'That link did not work.' };
}

export async function submitRating(token, lookId, rating) {
  const res = await fetch('/api/rate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, lookId, rating }) });
  const j = await res.json();
  return res.ok ? { ok: true } : { error: j.error || 'Could not send the rating.' };
}
