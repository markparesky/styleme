// Stylist sharing: the closet owner creates a share token; whoever holds the
// link can VIEW items and submit outfit suggestions — nothing else. The
// token never reveals the closet id, so a stylist can't write to the closet.
const ID_RE = /^[a-f0-9]{64}$/;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

// POST { id } → { token }   (owner; regenerating invalidates the old link)
export async function onRequestPost({ request, env }) {
  if (!env.STYLEME_KV) return json({ error: 'Sync is not set up on the server yet.' }, 501);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  if (!ID_RE.test(body.id || '')) return json({ error: 'Bad id.' }, 400);
  const old = await env.STYLEME_KV.get('share:' + body.id);
  if (old) await env.STYLEME_KV.delete('sharetok:' + old);
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const rnd = new Uint8Array(14);
  crypto.getRandomValues(rnd);
  const token = [...rnd].map(b => abc[b % abc.length]).join('');
  await env.STYLEME_KV.put('share:' + body.id, token);
  await env.STYLEME_KV.put('sharetok:' + token, body.id);
  return json({ token });
}

// GET ?token=… → { items }   (stylist; items only — no wears, no city)
export async function onRequestGet({ request, env }) {
  if (!env.STYLEME_KV) return json({ error: 'Sync is not set up on the server yet.' }, 501);
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return json({ error: 'Missing token.' }, 400);
  const closetId = await env.STYLEME_KV.get('sharetok:' + token);
  if (!closetId) return json({ error: 'That styling link is no longer active.' }, 404);
  const raw = await env.STYLEME_KV.get('closet:' + closetId);
  if (!raw) return json({ error: 'This closet has nothing in it yet.' }, 404);
  let data;
  try { data = JSON.parse(raw); } catch { return json({ error: 'Closet unreadable.' }, 500); }
  return json({ items: data.items || [] });
}
