// Cloudflare Pages Function: product image search by name.
// For brands that block page scraping (Madewell, Lululemon…): type the item's
// name, we search the web's images for it, the user picks the right photo.
// DuckDuckGo images first (unofficial vqd flow), Bing images HTML as fallback.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

async function ddgImages(q) {
  const seed = await fetch('https://duckduckgo.com/?q=' + encodeURIComponent(q) + '&iax=images&ia=images', {
    headers: { 'User-Agent': UA },
  });
  const html = await seed.text();
  const m = html.match(/vqd=["']?([\d-]+)["']?/);
  if (!m) return null;
  const res = await fetch(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${m[1]}&p=1`,
    { headers: { 'User-Agent': UA, 'Referer': 'https://duckduckgo.com/' } },
  );
  if (!res.ok) return null;
  const j = await res.json();
  const out = (j.results || []).slice(0, 12).map(x => ({
    title: x.title || null,
    image: x.image,
    thumbnail: x.thumbnail || x.image,
    source: x.url || null,
  })).filter(x => x.image);
  return out.length ? out : null;
}

async function bingImages(q) {
  const res = await fetch('https://www.bing.com/images/search?q=' + encodeURIComponent(q) + '&form=HDRSC2', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const out = [];
  for (const m of html.matchAll(/class="iusc"[^>]+m="([^"]+)"/g)) {
    try {
      const meta = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      if (meta.murl) out.push({ title: meta.t || null, image: meta.murl, thumbnail: meta.turl || meta.murl, source: meta.purl || null });
    } catch { /* skip malformed */ }
    if (out.length >= 12) break;
  }
  return out.length ? out : null;
}

export async function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams.get('q');
  if (!q || q.trim().length < 3) return json({ error: 'Type at least a few characters.' }, 400);
  let results = null;
  try { results = await ddgImages(q.trim()); } catch { /* try bing */ }
  if (!results) {
    try { results = await bingImages(q.trim()); } catch { /* both down */ }
  }
  if (!results) return json({ error: 'Image search is unavailable right now — try a direct link or a photo instead.' }, 502);
  return json({ results });
}
