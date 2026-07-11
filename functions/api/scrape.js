// Cloudflare Pages Function: product-page scraper for "Add by URL".
// Given a product PAGE (not a direct image), extracts the product photo,
// title, and declared color from Open Graph tags and JSON-LD Product data.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

import { sameOrigin, forbidden } from './_guard.js';

export async function onRequestGet({ request }) {
  if (!sameOrigin(request)) return forbidden();
  const target = new URL(request.url).searchParams.get('url');
  if (!target || !/^https?:\/\//i.test(target)) return json({ error: 'Provide ?url=https://…' }, 400);

  // Shopify stores (a huge share of fashion brands) expose product data at
  // <product-url>.json even when the HTML page is bot-protected. Try it first.
  try {
    const u = new URL(target);
    if (/\/products\/[^/]+\/?$/.test(u.pathname)) {
      const jres = await fetch(u.origin + u.pathname.replace(/\/$/, '') + '.json', {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        redirect: 'follow',
      });
      if (jres.ok && (jres.headers.get('content-type') || '').includes('json')) {
        const j = await jres.json();
        const p = j.product;
        if (p) {
          const image = (p.images && p.images[0] && p.images[0].src) || (p.image && p.image.src) || null;
          let color = null;
          let colors = null;
          let sizes = null;
          if (Array.isArray(p.options)) {
            const oi = p.options.findIndex(o => /colou?r/i.test(o.name || ''));
            if (oi >= 0 && Array.isArray(p.variants)) {
              colors = [...new Set(p.variants.map(v => v['option' + (oi + 1)]).filter(Boolean))];
              color = colors[0] || null;
            }
            const si = p.options.findIndex(o => /size/i.test(o.name || ''));
            if (si >= 0 && Array.isArray(p.variants)) {
              sizes = [...new Set(p.variants.map(v => v['option' + (si + 1)]).filter(Boolean))];
            }
          }
          if (image) return json({ image, title: p.title || null, color, colors, sizes });
        }
      }
    }
  } catch { /* not Shopify — fall through to HTML scrape */ }

  let res;
  try {
    res = await fetch(target, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,image/*;q=0.8' },
      redirect: 'follow',
    });
  } catch (err) {
    return json({ error: 'Fetch failed: ' + err.message }, 502);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.startsWith('image/')) return json({ image: target, title: null, color: null });
  if (!ct.includes('text/html')) return json({ error: 'Not a page or an image (' + ct + ')' }, 415);
  if (res.status >= 400) return json({ error: 'The site answered ' + res.status + ' — it may block automated readers.' }, 502);

  const html = await res.text();

  const meta = (prop) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i');
    const tag = (html.match(re) || [])[0];
    if (!tag) return null;
    const c = tag.match(/content=["']([^"']+)["']/i);
    return c ? c[1] : null;
  };

  let image = meta('og:image') || meta('og:image:secure_url') || meta('twitter:image');
  let title = meta('og:title') || ((html.match(/<title[^>]*>([^<]+)</i) || [])[1] || '').trim() || null;
  let color = null;

  // JSON-LD Product blocks are the richest source (name, image, exact color)
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const nodes = Array.isArray(data) ? data : (data['@graph'] || [data]);
      for (const d of nodes) {
        const type = d && d['@type'];
        const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
        if (!isProduct) continue;
        title = d.name || title;
        color = typeof d.color === 'string' ? d.color : color;
        const img = Array.isArray(d.image) ? d.image[0] : d.image;
        if (img) image = typeof img === 'string' ? img : (img.url || image);
        if (!color && d.offers) {
          const offers = Array.isArray(d.offers) ? d.offers : [d.offers];
          for (const o of offers) if (o && typeof o.itemOffered === 'object' && o.itemOffered.color) color = o.itemOffered.color;
        }
      }
    } catch { /* malformed JSON-LD — skip */ }
  }

  if (image) {
    if (image.startsWith('//')) image = 'https:' + image;
    else if (image.startsWith('/')) image = new URL(target).origin + image;
  }
  if (title) title = title.split(/\s*[|•]\s*/)[0].trim().slice(0, 80);

  if (!image) return json({ error: 'No product image found on that page.' }, 404);
  return json({ image, title, color, colors: color ? [color] : null });
}
