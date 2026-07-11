// The compute-heavy endpoints (image proxy, scraper, search, AI) answer
// only requests coming from the app itself — otherwise anyone could use
// this Worker as a free scraping/AI proxy.
export function sameOrigin(request) {
  const host = new URL(request.url).host;
  const ref = request.headers.get('origin') || request.headers.get('referer') || '';
  if (!ref) return false;
  try { return new URL(ref).host === host; } catch { return false; }
}

export function forbidden() {
  return new Response(JSON.stringify({ error: 'This endpoint serves the StyleMe app only.' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });
}
