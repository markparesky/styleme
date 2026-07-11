// A reviewer submits a rating for a posted look, by share token.
// POST { token, lookId, rating: { by, outfit, items: {itemId: verdict},
//        tags: {itemId: [..]}, comment } } → { ok }
import { notifyOwner } from './_push.js';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.STYLEME_KV) return json({ error: 'Sync is not set up on the server yet.' }, 501);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const { token, lookId, rating } = body || {};
  if (!token || !lookId || !rating || !rating.outfit) return json({ error: 'Expected { token, lookId, rating }.' }, 400);
  const closetId = await env.STYLEME_KV.get('sharetok:' + token);
  if (!closetId) return json({ error: 'That link is no longer active.' }, 404);
  const key = 'look:' + closetId;
  let list = [];
  try { list = JSON.parse((await env.STYLEME_KV.get(key)) || '[]'); } catch { list = []; }
  const look = list.find(l => l.id === lookId);
  if (!look) return json({ error: 'That look is gone.' }, 404);
  const by = String(rating.by || 'Someone').slice(0, 40);
  const clean = {
    by, at: Date.now(),
    outfit: Math.max(1, Math.min(5, Number(rating.outfit) || 3)),
    items: {}, tags: {}, itemComments: {},
    comment: String(rating.comment || '').slice(0, 300),
  };
  for (const [k, v] of Object.entries(rating.items || {})) {
    if (['love', 'ok', 'no'].includes(v)) clean.items[String(k)] = v;
  }
  for (const [k, v] of Object.entries(rating.tags || {})) {
    if (Array.isArray(v)) clean.tags[String(k)] = v.map(String).slice(0, 4);
  }
  look.ratings = (look.ratings || []).filter(r => r.by !== by || r.ai); // latest per person wins
  look.ratings.push(clean);
  await env.STYLEME_KV.put(key, JSON.stringify(list));
  context.waitUntil(notifyOwner(env, closetId, {
    title: `${by} rated your look`,
    body: `${'♥'.repeat(clean.outfit)}${'♡'.repeat(5 - clean.outfit)}${clean.comment ? ` — “${clean.comment.slice(0, 80)}”` : ''}`,
    url: '/#/lookbook',
  }));
  return json({ ok: true });
}
