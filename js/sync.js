// Client-side sync: the closet code never leaves the device — only its
// SHA-256 hash is used as the cloud storage id.

export async function codeToId(code) {
  const data = new TextEncoder().encode('styleme:' + code.trim().toLowerCase());
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Returns { data } | { missing: true } | { unconfigured: true } | { error }
export async function pullCloud(code) {
  try {
    const id = await codeToId(code);
    const res = await fetch('/api/sync?id=' + id);
    if (res.status === 404) return { missing: true };
    if (res.status === 501) return { unconfigured: true };
    if (!res.ok) return { error: 'Sync read failed (' + res.status + ').' };
    return { data: await res.json() };
  } catch (err) {
    return { error: err.message };
  }
}

// Returns { ok: true } | { unconfigured: true } | { error }
export async function pushCloud(code, data) {
  try {
    const id = await codeToId(code);
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, data }),
    });
    if (res.status === 501) return { unconfigured: true };
    if (!res.ok) {
      let msg = 'Sync write failed (' + res.status + ').';
      try { msg = (await res.json()).error || msg; } catch { /* keep default */ }
      return { error: msg };
    }
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
}
