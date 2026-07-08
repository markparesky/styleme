// Cloudflare Pages Function: server-side image fetcher for "Add by URL".
// Browsers can't read cross-site images (CORS); this fetches them server-side,
// same as any Workers-based app does. Deploys automatically with the site on
// Cloudflare Pages — no config needed.
export async function onRequestGet({ request }) {
  const target = new URL(request.url).searchParams.get('url');
  if (!target || !/^https?:\/\//i.test(target)) {
    return new Response('Provide ?url=https://…', { status: 400 });
  }
  let upstream;
  try {
    upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StyleMe/1.0)',
        'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
      },
      redirect: 'follow',
    });
  } catch (err) {
    return new Response('Upstream fetch failed: ' + err.message, { status: 502 });
  }
  const ct = upstream.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) {
    return new Response('That URL is not a direct image (got ' + (ct || 'unknown') + ').', { status: 415 });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': ct,
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=86400',
    },
  });
}
