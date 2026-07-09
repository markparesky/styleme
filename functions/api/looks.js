// Posted looks: a mirror photo + its items, open for rating by invited
// people and by AI. Owner posts/reads by closet id; reviewers read by
// share token (same token as the stylist link).
const ID_RE = /^[a-f0-9]{64}$/;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('AI timeout')), ms))]);
}

async function aiReview(env, look) {
  if (!env.AI) return null;
  try {
    const b64 = (look.photo || '').split(',')[1];
    if (!b64) return null;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const itemList = look.items.map(i => `${i.id}: ${i.name} (${i.category}, ${i.color})`).join('; ');
    const occLine = look.occasion ? `They are dressed for: ${look.occasion}. Judge whether the outfit is APPROPRIATE for that occasion (too casual? too dressy? wrong for the setting?) as well as ` : `Judge `;
    const prompt =
      `You are an honest, kind fashion stylist reviewing a mirror photo of an outfit. ` +
      `The pieces are: ${itemList}. ${occLine}fit (too tight/loose/long), color harmony, and whether each piece works WITH the others. ` +
      `Reply ONLY with JSON, no other text: {"outfit": 1-5, "comment": "max 160 chars, specific and constructive", ` +
      `"items": [{"id": "<id>", "verdict": "love"|"ok"|"no", "comment": "max 80 chars"}]}`;
    let res;
    try {
      res = await withTimeout(env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', { prompt, image: [...bytes] }), 30000);
    } catch {
      res = await withTimeout(env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', { prompt, image: [...bytes], max_tokens: 512 }), 30000);
    }
    const text = res.response || res.description || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]);
    const items = {};
    const itemComments = {};
    for (const x of (j.items || [])) {
      if (x && x.id && ['love', 'ok', 'no'].includes(x.verdict)) items[x.id] = x.verdict;
      if (x && x.id && x.comment) itemComments[x.id] = String(x.comment).slice(0, 100);
    }
    return {
      by: 'StyleMe AI', ai: true, at: Date.now(),
      outfit: Math.max(1, Math.min(5, Number(j.outfit) || 3)),
      comment: String(j.comment || '').slice(0, 200),
      items, itemComments, tags: {},
    };
  } catch { return null; }
}

// The AI review must never block or sink the post: it runs after the
// response is sent (waitUntil) and attaches to the stored look when done.
async function reviewInBackground(env, key, lookId) {
  try {
    let list = JSON.parse((await env.STYLEME_KV.get(key)) || '[]');
    const look = list.find(l => l.id === lookId);
    if (!look) return;
    const review = await aiReview(env, look);
    if (!review) return;
    // re-read: a human rating may have landed while the AI was thinking
    list = JSON.parse((await env.STYLEME_KV.get(key)) || '[]');
    const fresh = list.find(l => l.id === lookId);
    if (!fresh) return;
    fresh.ratings = (fresh.ratings || []).filter(r => !r.ai);
    fresh.ratings.unshift(review);
    await env.STYLEME_KV.put(key, JSON.stringify(list));
  } catch { /* best effort */ }
}

// POST { id, look } → { ok, lookId } (owner posts a look for rating)
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.STYLEME_KV) return json({ error: 'Sync is not set up on the server yet.' }, 501);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const { id, look } = body || {};
  if (!ID_RE.test(id || '') || !look || !look.photo || !Array.isArray(look.items)) {
    return json({ error: 'Expected { id, look: { photo, items } }.' }, 400);
  }
  if (look.photo.length > 800000) return json({ error: 'Photo too large.' }, 413);
  const key = 'look:' + id;
  let list = [];
  try { list = JSON.parse((await env.STYLEME_KV.get(key)) || '[]'); } catch { list = []; }
  const entry = {
    id: look.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    at: Date.now(),
    photo: look.photo,
    items: look.items.slice(0, 8).map(i => ({ id: String(i.id), name: String(i.name || '').slice(0, 60), category: String(i.category || ''), color: String(i.color || '') })),
    occasion: String(look.occasion || '').slice(0, 80),
    ratings: [],
  };
  list.unshift(entry);
  await env.STYLEME_KV.put(key, JSON.stringify(list.slice(0, 20)));
  if (env.AI) context.waitUntil(reviewInBackground(env, key, entry.id));
  return json({ ok: true, lookId: entry.id, aiPending: !!env.AI });
}

// GET ?id=…  (owner)  |  GET ?token=…  (reviewer)
export async function onRequestGet({ request, env }) {
  if (!env.STYLEME_KV) return json({ error: 'Sync is not set up on the server yet.' }, 501);
  const url = new URL(request.url);
  let closetId = url.searchParams.get('id');
  const token = url.searchParams.get('token');
  if (token) closetId = await env.STYLEME_KV.get('sharetok:' + token);
  if (!ID_RE.test(closetId || '')) return json({ error: token ? 'That link is no longer active.' : 'Bad id.' }, token ? 404 : 400);
  let list = [];
  try { list = JSON.parse((await env.STYLEME_KV.get('look:' + closetId)) || '[]'); } catch { list = []; }
  return json(list);
}
