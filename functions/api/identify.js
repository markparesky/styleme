// Identify the garments worn in a mirror photo (Workers AI vision).
// POST { photo } → { garments: [{ name, category, color }] }
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('AI timeout')), ms))]);
}

import { sameOrigin, forbidden } from './_guard.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return forbidden();
  if (!env.AI) return json({ error: 'The AI is not set up on the server yet (AI binding missing).' }, 501);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const photo = body && body.photo;
  if (!photo || !photo.startsWith('data:image')) return json({ error: 'Expected { photo }.' }, 400);
  if (photo.length > 800000) return json({ error: 'Photo too large.' }, 413);
  try {
    const bytes = Uint8Array.from(atob(photo.split(',')[1]), c => c.charCodeAt(0));
    const prompt =
      `You are cataloging clothes from a mirror photo of a person. List EVERY garment they are WEARING, head to toe ` +
      `(skip background objects). A typical outfit has a top, bottoms, and shoes — always include the footwear if feet are visible, ` +
      `even partially (sneakers, loafers, boots, sandals). ` +
      `Reply ONLY with JSON, no other text: {"garments": [{"name": "short description e.g. white button-up shirt", ` +
      `"category": "top"|"bottom"|"dress"|"layer"|"shoes"|"accessory", "color": "one main color word", ` +
      `"box": {"x": left edge 0-1, "y": top edge 0-1, "w": width 0-1, "h": height 0-1} the garment's region in the image}]}`;
    let res;
    try {
      res = await withTimeout(env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', { prompt, image: [...bytes] }), 30000);
    } catch {
      res = await withTimeout(env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', { prompt, image: [...bytes], max_tokens: 512 }), 30000);
    }
    const text = res.response || res.description || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return json({ garments: [] });
    const j = JSON.parse(m[0]);
    const CATS = ['top', 'bottom', 'dress', 'layer', 'shoes', 'accessory'];
    const garments = (j.garments || [])
      .filter(g => g && g.name)
      .slice(0, 8)
      .map(g => {
        let box = null;
        const b = g.box;
        if (b && [b.x, b.y, b.w, b.h].every(v => typeof v === 'number' && v >= 0 && v <= 1) && b.w > 0.04 && b.h > 0.04) {
          box = { x: b.x, y: b.y, w: Math.min(b.w, 1 - b.x), h: Math.min(b.h, 1 - b.y) };
        }
        return {
          name: String(g.name).slice(0, 60),
          category: CATS.includes(g.category) ? g.category : 'top',
          color: String(g.color || '').slice(0, 30),
          box,
        };
      });
    return json({ garments });
  } catch (err) {
    return json({ error: 'Could not read the photo: ' + err.message }, 502);
  }
}
