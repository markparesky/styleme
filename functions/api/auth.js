// Magic-link sign-in via Resend. Requires the RESEND_API_KEY secret on the
// Pages project; without it, this endpoint reports itself unconfigured and
// the app's email UI explains what's missing.
//
// POST { action:'start', email }  → sends a sign-in link (15 min expiry)
// POST { action:'finish', token } → { id, secret, email }
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randToken(len = 24) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = crypto.getRandomValues(new Uint8Array(len));
  return [...rnd].map(b => abc[b % abc.length]).join('');
}

export async function onRequestPost({ request, env }) {
  if (!env.STYLEME_KV) return json({ error: 'Sync is not set up on the server yet.' }, 501);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }

  if (body.action === 'start') {
    if (!env.RESEND_API_KEY) return json({ error: 'Email sign-in is not configured yet (RESEND_API_KEY missing).' }, 501);
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'That does not look like an email address.' }, 400);
    const token = randToken();
    await env.STYLEME_KV.put('auth:' + token, email, { expirationTtl: 900 });
    const link = new URL(request.url).origin + '/#/login/' + token;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.MAIL_FROM || 'StyleMe <onboarding@resend.dev>',
        to: email,
        subject: 'Your StyleMe sign-in link',
        html: `<p>Tap to open your closet:</p><p><a href="${link}">${link}</a></p><p style="color:#888">The link works once and expires in 15 minutes. If you didn't ask for this, ignore it.</p>`,
      }),
    });
    if (!res.ok) {
      const msg = (await res.text()).slice(0, 200);
      return json({ error: 'The email service refused to send: ' + msg }, 502);
    }
    return json({ ok: true });
  }

  if (body.action === 'finish') {
    const token = String(body.token || '');
    const email = await env.STYLEME_KV.get('auth:' + token);
    if (!email) return json({ error: 'That sign-in link has expired — request a new one.' }, 410);
    await env.STYLEME_KV.delete('auth:' + token);
    const id = await sha256hex('styleme-email:' + email);
    const secret = randToken(40);
    await env.STYLEME_KV.put('sess:' + secret, id);
    await env.STYLEME_KV.put('owner:' + id, 'email');
    return json({ id, secret, email });
  }

  return json({ error: 'Unknown action.' }, 400);
}
