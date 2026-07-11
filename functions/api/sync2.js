// Per-record sync: each item and wear is its own KV entry, with a manifest
// of revisions. Removes the whole-closet size ceiling and lets two devices
// merge instead of overwriting each other.
//
// GET  ?id=                     → manifest { items:{rid:rev}, wears:{rid:rev}, homeCity, updatedAt }
// GET  ?id=&kind=item&rid=      → the record
// POST { id, putItems, putWears, delItems, delWears, homeCity } → { ok, manifest }
import { authorized, denied } from './_auth.js';

const ID_RE = /^[a-f0-9]{64}$/;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

const mKey = id => 'c2m:' + id;
const rKey = (id, kind, rid) => (kind === 'item' ? 'c2i:' : 'c2w:') + id + ':' + rid;

async function readManifest(env, id) {
  try {
    const m = JSON.parse((await env.STYLEME_KV.get(mKey(id))) || 'null');
    if (m && m.items && m.wears) return m;
  } catch { /* corrupt — start fresh */ }
  return null;
}

export async function onRequestGet({ request, env }) {
  if (!env.STYLEME_KV) return json({ error: 'Sync is not set up on the server yet.' }, 501);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!ID_RE.test(id || '')) return json({ error: 'Bad id.' }, 400);
  if (!(await authorized(env, request, id))) return denied();
  const kind = url.searchParams.get('kind');
  const rid = url.searchParams.get('rid');
  if (kind && rid) {
    if (!['item', 'wear'].includes(kind)) return json({ error: 'Bad kind.' }, 400);
    const rec = await env.STYLEME_KV.get(rKey(id, kind, rid));
    if (!rec) return json({ error: 'Not found.' }, 404);
    return new Response(rec, { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
  }
  const m = await readManifest(env, id);
  if (!m) return json({ error: 'No sharded closet yet.' }, 404);
  return json(m);
}

export async function onRequestPost({ request, env }) {
  if (!env.STYLEME_KV) return json({ error: 'Sync is not set up on the server yet.' }, 501);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const { id } = body || {};
  if (!ID_RE.test(id || '')) return json({ error: 'Bad id.' }, 400);
  if (!(await authorized(env, request, id))) return denied();

  const m = (await readManifest(env, id)) || { items: {}, wears: {}, homeCity: null, updatedAt: 0 };
  const putItems = (body.putItems || []).slice(0, 500);
  const putWears = (body.putWears || []).slice(0, 500);
  for (const it of putItems) {
    if (!it || !it.id) continue;
    await env.STYLEME_KV.put(rKey(id, 'item', it.id), JSON.stringify(it));
    m.items[it.id] = it._rev || Date.now();
  }
  for (const w of putWears) {
    if (!w || !w.id) continue;
    await env.STYLEME_KV.put(rKey(id, 'wear', w.id), JSON.stringify(w));
    m.wears[w.id] = w._rev || Date.now();
  }
  for (const rid of (body.delItems || [])) {
    await env.STYLEME_KV.delete(rKey(id, 'item', rid));
    delete m.items[rid];
  }
  for (const rid of (body.delWears || [])) {
    await env.STYLEME_KV.delete(rKey(id, 'wear', rid));
    delete m.wears[rid];
  }
  if (body.homeCity !== undefined) m.homeCity = body.homeCity;
  m.updatedAt = Date.now();
  await env.STYLEME_KV.put(mKey(id), JSON.stringify(m));
  return json({ ok: true, manifest: m });
}
