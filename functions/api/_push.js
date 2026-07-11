// Web Push from Pages Functions with zero external services.
// VAPID keys self-provision into KV on first use; payloads are encrypted
// per RFC 8291 (aes128gcm) so notifications can carry real text.
// Files starting with "_" are not routed — this is a shared library.

const SUB_CONTACT = 'mailto:mark@crimsonpeak.com';

const b64u = {
  encode(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const pad = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
    return Uint8Array.from(atob(pad), c => c.charCodeAt(0));
  },
};

export async function getVapid(env) {
  let stored = null;
  try { stored = JSON.parse((await env.STYLEME_KV.get('vapid')) || 'null'); } catch { /* regenerate */ }
  if (!stored) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    stored = {
      publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
      privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
    };
    await env.STYLEME_KV.put('vapid', JSON.stringify(stored));
  }
  const publicKey = await crypto.subtle.importKey('jwk', stored.publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  const privateKey = await crypto.subtle.importKey('jwk', stored.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const publicRaw = await crypto.subtle.exportKey('raw', publicKey);
  return { privateKey, publicRaw, publicB64u: b64u.encode(publicRaw) };
}

async function vapidAuthHeader(vapid, endpoint) {
  const aud = new URL(endpoint).origin;
  const enc = new TextEncoder();
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u.encode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUB_CONTACT })));
  const signing = `${header}.${payload}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.privateKey, enc.encode(signing));
  return `vapid t=${signing}.${b64u.encode(sig)}, k=${vapid.publicB64u}`;
}

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

// RFC 8291 message encryption (aes128gcm)
async function encryptPayload(subscription, plaintext) {
  const uaPublic = b64u.decode(subscription.keys.p256dh);
  const authSecret = b64u.decode(subscription.keys.auth);
  const asPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asPair.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPair.privateKey, 256));

  const enc = new TextEncoder();
  const keyInfo = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const padded = new Uint8Array([...enc.encode(plaintext), 2]); // 0x02 = last record
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  // header: salt(16) | record size uint32 | keyid length | as_public(65)
  const headerBuf = new Uint8Array(16 + 4 + 1 + asPublic.length + cipher.length);
  headerBuf.set(salt, 0);
  new DataView(headerBuf.buffer).setUint32(16, 4096);
  headerBuf[20] = asPublic.length;
  headerBuf.set(asPublic, 21);
  headerBuf.set(cipher, 21 + asPublic.length);
  return headerBuf;
}

async function sendPush(env, vapid, subscription, payloadObj) {
  const body = await encryptPayload(subscription, JSON.stringify(payloadObj));
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'TTL': '86400',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Urgency': 'normal',
      'Authorization': await vapidAuthHeader(vapid, subscription.endpoint),
    },
    body,
  });
  return res.status;
}

// Send { title, body, url } to every subscribed device of a closet.
// Dead subscriptions (404/410) are pruned.
export async function notifyOwner(env, closetId, payload) {
  try {
    if (!env.STYLEME_KV) return;
    let subs = [];
    try { subs = JSON.parse((await env.STYLEME_KV.get('push:' + closetId)) || '[]'); } catch { subs = []; }
    if (!subs.length) return;
    const vapid = await getVapid(env);
    const alive = [];
    for (const sub of subs) {
      try {
        const status = await sendPush(env, vapid, sub, payload);
        if (status !== 404 && status !== 410) alive.push(sub);
      } catch { alive.push(sub); /* transient — keep it */ }
    }
    if (alive.length !== subs.length) await env.STYLEME_KV.put('push:' + closetId, JSON.stringify(alive));
  } catch { /* notifications are best-effort, never break the caller */ }
}
