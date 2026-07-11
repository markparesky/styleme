// Stylist submits an outfit suggestion by share token.
// POST { token, outfit: { itemIds: [], note, from } } → { ok }
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
  const { token, outfit } = body || {};
  if (!token || !outfit || !Array.isArray(outfit.itemIds) || !outfit.itemIds.length) {
    return json({ error: 'Expected { token, outfit: { itemIds } }.' }, 400);
  }
  const closetId = await env.STYLEME_KV.get('sharetok:' + token);
  if (!closetId) return json({ error: 'That styling link is no longer active.' }, 404);
  const key = 'sugg:' + closetId;
  let list = [];
  try { list = JSON.parse((await env.STYLEME_KV.get(key)) || '[]'); } catch { list = []; }
  list.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    itemIds: outfit.itemIds.slice(0, 8).map(String),
    note: String(outfit.note || '').slice(0, 300),
    from: String(outfit.from || 'Your stylist').slice(0, 40),
    at: Date.now(),
  });
  await env.STYLEME_KV.put(key, JSON.stringify(list.slice(0, 50)));
  context.waitUntil(notifyOwner(env, closetId, {
    title: 'Picked for you',
    body: `${list[0].from} styled an outfit for you${list[0].note ? ` — “${list[0].note.slice(0, 80)}”` : ''}`,
    url: '/#/stylist',
  }));
  return json({ ok: true });
}
