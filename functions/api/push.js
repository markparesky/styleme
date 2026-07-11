// Push subscription management.
// GET → { publicKey }   POST { id, subscription } → subscribe
// POST { id, remove: endpoint } → unsubscribe
import { getVapid } from './_push.js';
import { authorized, denied } from './_auth.js';

const ID_RE = /^[a-f0-9]{64}$/;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

export async function onRequestGet({ env }) {
  if (!env.STYLEME_KV) return json({ error: 'Sync is not set up on the server yet.' }, 501);
  const vapid = await getVapid(env);
  return json({ publicKey: vapid.publicB64u });
}

export async function onRequestPost({ request, env }) {
  if (!env.STYLEME_KV) return json({ error: 'Sync is not set up on the server yet.' }, 501);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  if (!ID_RE.test(body.id || '')) return json({ error: 'Bad id.' }, 400);
  if (!(await authorized(env, request, body.id))) return denied();
  const key = 'push:' + body.id;
  let subs = [];
  try { subs = JSON.parse((await env.STYLEME_KV.get(key)) || '[]'); } catch { subs = []; }
  if (body.remove) {
    subs = subs.filter(s => s.endpoint !== body.remove);
  } else if (body.subscription && body.subscription.endpoint && body.subscription.keys) {
    subs = subs.filter(s => s.endpoint !== body.subscription.endpoint);
    subs.push(body.subscription);
    if (subs.length > 10) subs = subs.slice(-10);
  } else {
    return json({ error: 'Expected { id, subscription } or { id, remove }.' }, 400);
  }
  await env.STYLEME_KV.put(key, JSON.stringify(subs));
  return json({ ok: true, devices: subs.length });
}
