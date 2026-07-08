// Owner reads and dismisses suggestions (auth = knowing the closet id hash,
// same trust model as sync itself).
const ID_RE = /^[a-f0-9]{64}$/;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

// GET ?id=… → [ suggestions ]
export async function onRequestGet({ request, env }) {
  if (!env.STYLEME_KV) return json({ error: 'Sync is not set up on the server yet.' }, 501);
  const id = new URL(request.url).searchParams.get('id');
  if (!ID_RE.test(id || '')) return json({ error: 'Bad id.' }, 400);
  let list = [];
  try { list = JSON.parse((await env.STYLEME_KV.get('sugg:' + id)) || '[]'); } catch { list = []; }
  return json(list);
}

// POST { id, removeId } → { ok }
export async function onRequestPost({ request, env }) {
  if (!env.STYLEME_KV) return json({ error: 'Sync is not set up on the server yet.' }, 501);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  if (!ID_RE.test(body.id || '') || !body.removeId) return json({ error: 'Expected { id, removeId }.' }, 400);
  const key = 'sugg:' + body.id;
  let list = [];
  try { list = JSON.parse((await env.STYLEME_KV.get(key)) || '[]'); } catch { list = []; }
  await env.STYLEME_KV.put(key, JSON.stringify(list.filter(s => s.id !== body.removeId)));
  return json({ ok: true });
}
