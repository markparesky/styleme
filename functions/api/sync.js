// Cloudflare Pages Function: closet sync.
// The client hashes the user's closet code (SHA-256) and stores the whole
// closet JSON under it in KV. Same code on another device = same closet.
//
// Requires a KV namespace bound to the Pages project as STYLEME_KV:
//   Dashboard → Storage & databases → KV → Create namespace ("styleme-sync")
//   → Pages project → Settings → Bindings → Add → KV namespace,
//     variable name STYLEME_KV → save → redeploy.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

const ID_RE = /^[a-f0-9]{64}$/;

export async function onRequestGet({ request, env }) {
  if (!env.STYLEME_KV) return json({ error: 'Sync is not set up on the server yet (KV binding missing).' }, 501);
  const id = new URL(request.url).searchParams.get('id');
  if (!ID_RE.test(id || '')) return json({ error: 'Bad id.' }, 400);
  const val = await env.STYLEME_KV.get('closet:' + id);
  if (!val) return json({ error: 'No closet under that code yet.' }, 404);
  return new Response(val, { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
}

export async function onRequestPost({ request, env }) {
  if (!env.STYLEME_KV) return json({ error: 'Sync is not set up on the server yet (KV binding missing).' }, 501);
  let body;
  try { body = await request.text(); } catch { return json({ error: 'Bad request body.' }, 400); }
  if (body.length > 20 * 1024 * 1024) return json({ error: 'Closet too large to sync (20 MB limit).' }, 413);
  let parsed;
  try { parsed = JSON.parse(body); } catch { return json({ error: 'Not valid JSON.' }, 400); }
  if (!ID_RE.test(parsed.id || '') || typeof parsed.data !== 'object' || parsed.data === null) {
    return json({ error: 'Expected { id, data }.' }, 400);
  }
  await env.STYLEME_KV.put('closet:' + parsed.id, JSON.stringify(parsed.data));
  return json({ ok: true });
}
