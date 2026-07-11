// Access control. Code-based closets: knowing the hashed code IS the
// credential (it never leaves the device unhashed). Email-based closets are
// marked in KV and additionally require a session key issued at magic-link
// sign-in — a leaked closet id alone grants nothing.
export async function authorized(env, request, id) {
  if (!env.STYLEME_KV) return false;
  const owner = await env.STYLEME_KV.get('owner:' + id);
  if (owner !== 'email') return true;
  const s = request.headers.get('x-styleme-key') || '';
  if (!s) return false;
  return (await env.STYLEME_KV.get('sess:' + s)) === id;
}

export function denied() {
  return new Response(JSON.stringify({ error: 'Sign in to access this closet.' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}
