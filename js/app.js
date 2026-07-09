import { putRecord, deleteRecord, getAllRecords, getSetting, setSetting, uid, clearStore } from './db.js';
import { pullCloud, pushCloud, createShareLink, fetchSharedCloset, sendSuggestion, fetchSuggestions, dismissSuggestion, postLook, fetchLooksOwner, fetchLooksByToken, submitRating } from './sync.js';
import { analyzeImage, fileToDataUrl, NAMED_COLORS, metaForColorName } from './color.js';
import { CATEGORIES, garmentDataUrl } from './garments.js';
import { OCCASIONS, DRESS_CODES, DRESS_LABELS, targetFromText, generateOutfits, swapAlternatives, capsulePlan, ACTIVITIES, scoreOutfit, computePrefs } from './stylist.js';
import { geocode, forecast, describeWmo } from './weather.js';
import { demoItems } from './demo.js';

const S = {
  route: 'home',
  items: [],
  wears: [],
  drafts: [],
  stylist: { chip: null, text: '', results: [], shown: new Set(), title: '' },
  pack: { result: null, form: { dest: '', start: '', days: 5, work: 2, dinners: 1, acts: {}, themes: '', bag: 'carryon', laundry: 0 } },
  homeCity: null,
  syncCode: null,
  looks: [],
  prefs: null,
};

// Learned taste: recompute whenever ratings arrive. Also auto-flag fit notes
// from "too small/too big" tags so future sizing advice sticks to the item.
async function refreshPrefs() {
  if (S.syncCode) S.looks = await fetchLooksOwner(S.syncCode);
  S.prefs = computePrefs(S.looks, S.wears);
  for (const look of S.looks) {
    for (const r of (look.ratings || [])) {
      for (const [id, tags] of Object.entries(r.tags || {})) {
        const item = S.items.find(i => i.id === id);
        if (!item || item.fitNote) continue;
        if (tags.includes('Too small')) { item.fitNote = `${r.by} says it runs small`; await putRecord('items', item); }
        else if (tags.includes('Too big')) { item.fitNote = `${r.by} says it runs big`; await putRecord('items', item); }
      }
    }
  }
}

// One stable share token per closet, reused for stylist + rating links
async function ensureShareToken() {
  let token = await getSetting('shareToken');
  if (token) return token;
  const r = await createShareLink(S.syncCode);
  if (r.error) return null;
  token = r.url.split('/stylist-for/')[1];
  await setSetting('shareToken', token);
  return token;
}

function downscalePhoto(dataUrl, maxDim = 900, quality = 0.72) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ---------- cloud sync ----------
let syncTimer = null;
function dirty() {
  if (!S.syncCode) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushNow, 4000);
}
async function pushNow() {
  if (!S.syncCode) return;
  const payload = { items: S.items, wears: S.wears, homeCity: S.homeCity, updatedAt: Date.now() };
  const r = await pushCloud(S.syncCode, payload);
  if (r.ok) await setSetting('lastSyncAt', payload.updatedAt);
  else if (r.unconfigured) toast('Sync isn’t set up on the server yet — see the README (KV binding).');
  else if (r.error) toast('Sync failed: ' + r.error);
}
async function adoptCloud(data) {
  await clearStore('items'); await clearStore('wears');
  S.items = data.items || []; S.wears = data.wears || [];
  for (const i of S.items) await putRecord('items', i);
  for (const w of S.wears) await putRecord('wears', w);
  if (data.homeCity) { S.homeCity = data.homeCity; await setSetting('homeCity', data.homeCity); }
  await setSetting('lastSyncAt', data.updatedAt || Date.now());
}
async function pullOnBoot() {
  const r = await pullCloud(S.syncCode);
  if (!r.data) return;
  const last = (await getSetting('lastSyncAt')) || 0;
  if ((r.data.updatedAt || 0) > last) {
    await adoptCloud(r.data);
    toast('Closet updated from your other device');
    render();
  }
}

const $view = document.getElementById('view');
const $modal = document.getElementById('modal-root');

// ---------- utilities ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function catLabel(id) { return (CATEGORIES.find(c => c.id === id) || {}).label || id; }

function itemImg(item) {
  return item.img || garmentDataUrl(item.category, item.colors[0].hex, item.name);
}

// ---------- flat-lay ----------
const SLOTS = {
  top:    { style: 'left:3%;top:5%;width:44%;height:64%;transform:rotate(-5deg)' },
  dress:  { style: 'left:6%;top:3%;width:48%;height:92%;transform:rotate(-4deg)' },
  bottom: { style: 'left:45%;top:3%;width:38%;height:74%;transform:rotate(7deg)' },
  layer:  { style: 'left:22%;top:38%;width:42%;height:60%;transform:rotate(-3deg)' },
  shoes:  { style: 'right:2%;bottom:4%;width:27%;height:40%;transform:rotate(-10deg)' },
  accessory: { style: 'right:5%;top:6%;width:15%;height:22%;transform:rotate(0deg)' },
};
function flatlayHtml(items) {
  return `<div class="flatlay">` + items.map(i => {
    const slot = SLOTS[i.category] || SLOTS.top;
    return `<div class="fl-item" style="${slot.style}"><img src="${itemImg(i)}" alt="${esc(i.name)}"></div>`;
  }).join('') + `</div>`;
}
function colorStoryHtml(outfit) {
  const sw = outfit.palette.map(p => `<span style="background:${p.hex}" title="${esc(p.name)}"></span>`).join('');
  const tones = new Set(outfit.palette.map(p => p.tone));
  const accents = outfit.palette.filter(p => !p.neutral);
  let label;
  if (accents.length === 0) label = tones.has('warm') && !tones.has('cool') ? 'Warm neutrals' : (!tones.has('warm') && tones.has('cool') ? 'Cool neutrals' : 'Mixed neutrals');
  else if (accents.length === 1) label = `${accents[0].name} on neutrals`;
  else label = `${accents.map(a => a.name).join(' + ')}`;
  return `<div class="colorstory"><div class="cs-swatches">${sw}</div><div class="cs-label"><b style="color:var(--ink);display:block">${esc(label)}</b>${outfit.palette.map(p => esc(p.name)).join(' · ')}</div></div>`;
}

// ---------- router ----------
function nav(route) {
  S.route = route;
  location.hash = '#/' + route;
  render();
}
function parseRoute() {
  const h = location.hash.replace('#/', '') || 'home';
  if (h.startsWith('stylist-for/')) {
    S.shareToken = h.slice('stylist-for/'.length);
    return 'stylist-for';
  }
  if (h.startsWith('rate/')) {
    S.shareToken = h.slice('rate/'.length);
    return 'rate';
  }
  return h;
}
window.addEventListener('hashchange', () => {
  const r = parseRoute();
  if (r !== S.route) { S.route = r; render(); }
});
document.querySelector('.topbar').addEventListener('click', e => {
  const b = e.target.closest('[data-nav]');
  if (b) nav(b.dataset.nav);
});

function render() {
  document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.nav === S.route));
  const views = { home: viewHome, add: viewAdd, closet: viewCloset, stylist: viewStylist, pack: viewPack, lookbook: viewLookbook, 'stylist-for': viewStylistFor, rate: viewRate };
  (views[S.route] || viewHome)();
  window.scrollTo(0, 0);
}

// ============================================================ HOME
async function viewHome() {
  const n = S.items.length;
  if (n === 0) {
    $view.innerHTML = `
      <div class="pagehead"><h1>StyleMe</h1><p>Your personal stylist. Outfits from your own closet, built on color theory.</p></div>
      <div class="card" style="max-width:640px">
        <h2>Start with your closet</h2>
        <p class="muted" style="margin:10px 0 4px">Add your clothes with photos — colors are read automatically and corrected for bad lighting. Or try everything instantly with a demo closet.</p>
        <div class="hero-cta">
          <button class="btn primary" data-nav-inline="add">Add my clothes</button>
          <button class="btn line" id="seed-demo">Load demo closet (14 items)</button>
        </div>
      </div>
      <div class="morning" id="synccard"></div>`;
    renderSyncCard();
    document.getElementById('seed-demo').addEventListener('click', async () => {
      const items = demoItems();
      for (const it of items) await putRecord('items', it);
      S.items.push(...items);
      toast('Demo closet loaded — 14 items');
      dirty();
      nav('closet');
    });
    bindInlineNav();
    return;
  }

  const wearsThisWeek = S.wears.filter(w => w.date > Date.now() - 7 * 864e5).length;
  $view.innerHTML = `
    <div class="pagehead"><h1>StyleMe</h1><p>Your personal stylist.</p></div>
    <p class="statline">You have <b>${n} item${n === 1 ? '' : 's'}</b> in your closet · <b>${S.wears.length}</b> look${S.wears.length === 1 ? '' : 's'} in your Lookbook${wearsThisWeek ? ` · <b>${wearsThisWeek}</b> worn this week` : ''}.</p>
    <div class="hero-cta">
      <button class="btn primary" data-nav-inline="stylist">Style me</button>
      <button class="btn line" data-nav-inline="add">Add items</button>
    </div>
    <div class="morning" id="morning"></div>
    <div class="morning" id="synccard"></div>`;
  bindInlineNav();
  renderMorningCard();
  renderSyncCard();
}

function bindBackupButtons() {
  document.getElementById('bk-export').addEventListener('click', exportCloset);
  document.getElementById('bk-import').addEventListener('click', () => document.getElementById('bk-file').click());
  document.getElementById('bk-file').addEventListener('change', e => {
    if (e.target.files[0]) importCloset(e.target.files[0]);
    e.target.value = '';
  });
}

function exportCloset() {
  const payload = { app: 'styleme', exportedAt: new Date().toISOString(), items: S.items, wears: S.wears, homeCity: S.homeCity };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `styleme-closet-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  toast(`Backup saved — ${S.items.length} items, ${S.wears.length} looks`);
}

async function importCloset(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('That file is not a StyleMe backup.'); return; }
  if (!data || data.app !== 'styleme' || !Array.isArray(data.items)) { toast('That file is not a StyleMe backup.'); return; }
  const replace = S.items.length === 0 ||
    window.confirm('Replace this device’s closet with the backup?\n\nOK = replace everything\nCancel = merge (adds what’s missing)');
  if (replace) {
    await clearStore('items'); await clearStore('wears');
    S.items = []; S.wears = [];
  }
  let added = 0;
  const haveItems = new Set(S.items.map(i => i.id));
  for (const it of data.items) if (!haveItems.has(it.id)) { S.items.push(it); await putRecord('items', it); added++; }
  const haveWears = new Set(S.wears.map(w => w.id));
  for (const w of (data.wears || [])) if (!haveWears.has(w.id)) { S.wears.push(w); await putRecord('wears', w); }
  if (data.homeCity && !S.homeCity) { S.homeCity = data.homeCity; await setSetting('homeCity', data.homeCity); }
  toast(`Imported ${added} item${added === 1 ? '' : 's'}`);
  dirty();
  render();
}

function renderSyncCard() {
  const box = document.getElementById('synccard');
  if (!box) return;
  const backupHtml = `
    <div class="card" style="max-width:640px;margin-top:20px">
      <h3>Backup &amp; transfer</h3>
      <p class="muted" style="margin:8px 0 12px">Save your closet as a file, or load one saved on another device or browser. Works with no setup.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn line" id="bk-export">Export closet</button>
        <button class="btn line" id="bk-import">Import closet</button>
        <input type="file" id="bk-file" accept=".json,application/json" hidden>
      </div>
    </div>`;
  if (S.syncCode) {
    box.innerHTML = `
      <div class="card" style="max-width:640px">
        <h3>Sync is on</h3>
        <p class="muted" style="margin:8px 0 12px">Enter the same closet code on any device to open this closet there. Changes sync automatically.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn line" id="sync-push">Sync now</button>
          <button class="btn quiet" id="sync-off">Turn off on this device</button>
        </div>
      </div>
      <div class="card" style="max-width:640px;margin-top:20px">
        <h3>Let someone style you</h3>
        <p class="muted" style="margin:8px 0 12px">Send a private link to your wife, a friend, or a stylist. They see your closet (view only) and send you outfits — you'll find them under "Picked for you" in the Stylist tab. Making a new link turns off the old one.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn line" id="share-make">Create stylist link</button>
          <span id="share-out" class="muted" style="font-size:12.5px;word-break:break-all"></span>
        </div>
      </div>` + backupHtml;
    document.getElementById('sync-push').addEventListener('click', async () => { await pushNow(); toast('Synced'); });
    document.getElementById('sync-off').addEventListener('click', async () => {
      S.syncCode = null; await setSetting('syncCode', null); renderSyncCard();
    });
    document.getElementById('share-make').addEventListener('click', async () => {
      await pushNow(); // make sure the cloud copy is current before sharing
      const r = await createShareLink(S.syncCode);
      if (r.error) { toast(r.error); return; }
      await setSetting('shareToken', r.url.split('/stylist-for/')[1]);
      document.getElementById('share-out').textContent = r.url;
      if (navigator.share) {
        try { await navigator.share({ title: 'Style my closet', url: r.url }); } catch { /* user closed the sheet */ }
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(r.url).catch(() => {});
        toast('Link copied — send it to your stylist');
      }
    });
    bindBackupButtons();
    return;
  }
  box.innerHTML = `
    <div class="card" style="max-width:640px">
      <h3>Your closet on every device</h3>
      <p class="muted" style="margin:8px 0 12px">Make up a closet code (like a password — at least 6 characters) and enter it here. Enter the same code on your phone or laptop and your closet appears there. Only a scrambled version of the code ever leaves this device.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <input class="input" id="sync-code-in" type="password" placeholder="Your closet code" style="max-width:260px" autocomplete="off">
        <button class="btn primary" id="sync-on">Turn on sync</button>
        <button class="btn quiet" id="sync-suggest">Suggest a strong code</button>
      </div>
      <p class="muted" style="font-size:12px;margin-top:10px">Treat it like a password — anyone who knows the code opens this closet. Write it down: it can't be recovered.</p>
    </div>
    <div class="card" style="max-width:640px;margin-top:20px;opacity:.75">
      <h3>Let someone style you</h3>
      <p class="muted" style="margin:8px 0 0">Send a private link to your wife or a stylist — they see your closet (view only) and send you outfits. <b>Turn on sync above first</b>, and this unlocks.</p>
    </div>` + backupHtml;
  bindBackupButtons();
  document.getElementById('sync-suggest').addEventListener('click', () => {
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789'; // no lookalikes
    const rnd = new Uint8Array(12);
    crypto.getRandomValues(rnd);
    const code = [...rnd].map((b, i) => abc[b % abc.length] + ((i + 1) % 4 === 0 && i < 11 ? '-' : '')).join('');
    const input = document.getElementById('sync-code-in');
    input.type = 'text';
    input.value = code;
    toast('Save this code somewhere safe — you’ll type it on your other devices.');
  });
  document.getElementById('sync-on').addEventListener('click', async () => {
    const code = document.getElementById('sync-code-in').value.trim();
    if (code.length < 6) { toast('Use at least 6 characters.'); return; }
    const r = await pullCloud(code);
    if (r.unconfigured) { toast('Sync isn’t set up on the server yet — see the README (KV binding).'); return; }
    if (r.error) { toast('Could not reach sync: ' + r.error); return; }
    S.syncCode = code;
    await setSetting('syncCode', code);
    if (r.data && (r.data.items || []).length && S.items.length &&
        !window.confirm('A closet already exists under this code.\n\nOK = load it here (replaces this device’s closet)\nCancel = keep this device’s closet and overwrite the cloud copy')) {
      await pushNow();
    } else if (r.data && (r.data.items || []).length) {
      await adoptCloud(r.data);
      toast('Closet loaded from the cloud');
    } else {
      await pushNow();
      toast('Sync is on — use this code on your other devices');
    }
    render();
  });
}

async function renderMorningCard() {
  const box = document.getElementById('morning');
  if (!box) return;
  if (!S.homeCity) {
    box.innerHTML = `
      <div class="card" style="max-width:640px">
        <h3>Tomorrow, ready before your coffee</h3>
        <p class="muted" style="margin:8px 0 12px">Tell StyleMe your city once, and the morning card pairs the forecast with your closet every day.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <input class="input" id="city-in" placeholder="e.g. Boston" style="max-width:260px">
          <button class="btn primary" id="city-save">Set my city</button>
        </div>
      </div>`;
    document.getElementById('city-save').addEventListener('click', async () => {
      const q = document.getElementById('city-in').value.trim();
      if (!q) return;
      try {
        const c = await geocode(q);
        S.homeCity = c;
        await setSetting('homeCity', c);
        toast(`Home set to ${c.name}`);
        dirty();
        renderMorningCard();
      } catch (err) { toast(err.message); }
    });
    return;
  }
  box.innerHTML = `<div class="card" style="max-width:640px"><p class="muted">Checking tomorrow's weather in ${esc(S.homeCity.name)}…</p></div>`;
  try {
    const days = await forecast(S.homeCity.lat, S.homeCity.lon, 2);
    const d = days[1] || days[0];
    const w = describeWmo(d.code);
    const outfits = generateOutfits(S.items, { target: 2.5, temp: d.tMax, wears: S.wears, count: 1, prefs: S.prefs });
    if (!outfits.length) {
      box.innerHTML = `<div class="card" style="max-width:640px"><h3>Tomorrow</h3><p class="muted" style="margin-top:6px">${w.icon} ${w.text}, ${d.tMin}–${d.tMax}° in ${esc(S.homeCity.name)}. Add a top, bottom and shoes to get a morning outfit here.</p></div>`;
      return;
    }
    const o = outfits[0];
    box.innerHTML = `
      <div class="outfit-card" style="max-width:640px">
        <div class="oc-head"><span class="oc-title">Tomorrow</span><span class="oc-meta">${w.icon} ${w.text} · ${d.tMin}–${d.tMax}° · ${esc(S.homeCity.name)}${d.rainProb > 50 ? ' · bring a layer for rain' : ''}</span></div>
        ${flatlayHtml(o.items)}
        ${colorStoryHtml(o)}
        <div class="why"><b>Why this works:</b> ${esc(o.why[0] || 'Balanced colors and formality.')}</div>
        <div class="oc-actions">
          <button class="btn primary" data-wear='${esc(JSON.stringify(o.items.map(i => i.id)))}' data-occ="Everyday">Wear it → Mirror check</button>
          <button class="btn quiet" data-nav-inline="stylist">More options</button>
        </div>
      </div>`;
    bindWearButtons();
    bindInlineNav();
  } catch (err) {
    box.innerHTML = `<div class="card" style="max-width:640px"><p class="muted">Weather unavailable right now (${esc(err.message)}). The Stylist still works.</p></div>`;
  }
}

function bindInlineNav() {
  $view.querySelectorAll('[data-nav-inline]').forEach(b => b.addEventListener('click', () => nav(b.dataset.navInline)));
}

// ============================================================ ADD
function viewAdd() {
  $view.innerHTML = `
    <div class="pagehead"><h1>Add items</h1><p>Drop in photos — color is read and corrected automatically. Tip: lay the item on a white surface or sheet of paper for perfect color.</p></div>
    <div class="dropzone" id="dz">
      <p class="big">Add photos — several at once is fine</p>
      <p>Drag &amp; drop, or</p>
      <p style="margin-top:12px"><button class="btn line" id="pick-files">Choose photos</button></p>
      <input type="file" id="file-in" accept="image/*" multiple hidden>
    </div>
    <div class="divider">or scan the barcode of a purchased item</div>
    <div class="card" style="max-width:640px">
      <p class="muted" style="margin-bottom:12px">Point the camera at the tag's barcode (or photograph it). If the product is in a public database, details fill in — either way the barcode is saved on the item.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn line" id="bc-live">📷 Scan with camera</button>
        <button class="btn line" id="bc-photo-btn">Photo of the barcode</button>
        <input type="file" id="bc-photo" accept="image/*" capture="environment" hidden>
      </div>
      <p class="muted" id="bc-status" style="font-size:13px;margin-top:10px"></p>
    </div>
    <div class="divider">or add by link — or just type the item's name</div>
    <div style="max-width:640px">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <input class="input" id="url-in" placeholder="Paste a product link, or type a name (e.g. lululemon Metal Vent Tech shirt)" style="flex:1;min-width:220px">
        <button class="btn line" id="url-go">Find it</button>
      </div>
      <p class="muted" style="font-size:12.5px;margin-top:8px">Names work even for brands that block links — you'll pick the right photo from search results.</p>
    </div>
    <div id="draft-list" style="margin-top:34px"></div>`;

  const dz = document.getElementById('dz');
  const fileIn = document.getElementById('file-in');
  document.getElementById('pick-files').addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', () => handleFiles([...fileIn.files]));
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('over');
    handleFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('image/')));
  });
  document.getElementById('url-go').addEventListener('click', handleUrl);
  document.getElementById('bc-live').addEventListener('click', scanBarcodeLive);
  document.getElementById('bc-photo-btn').addEventListener('click', () => document.getElementById('bc-photo').click());
  document.getElementById('bc-photo').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (f) await scanBarcodeFromFile(f);
    e.target.value = '';
  });
  renderDrafts();
}

// ---------- barcode ----------
// The native BarcodeDetector API is defined on Windows/iOS but often has no
// OS backend — it "works" while detecting nothing. We probe it once; if the
// probe fails we load a WebAssembly decoder (zbar) that works everywhere.
const BC_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
let detectorPromise = null;

function bcStatus(msg) {
  const el = document.getElementById('bc-status');
  if (el) el.textContent = msg;
}

function frameToCanvas(src) {
  if (src instanceof HTMLCanvasElement) return src;
  const w = src.videoWidth || src.width, h = src.videoHeight || src.height;
  const scale = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function getDetector() {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    if ('BarcodeDetector' in window) {
      try {
        const native = new BarcodeDetector({ formats: BC_FORMATS });
        const probe = document.createElement('canvas');
        probe.width = probe.height = 32;
        await native.detect(probe); // rejects on platforms with no backend
        return async src => (await native.detect(src)).map(c => c.rawValue);
      } catch { /* fall through to wasm */ }
    }
    const zbar = await import('https://cdn.jsdelivr.net/npm/@undecaf/zbar-wasm/+esm');
    return async src => {
      const c = frameToCanvas(src);
      const data = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
      const syms = await zbar.scanImageData(data);
      return syms.map(s => s.decode());
    };
  })();
  detectorPromise.catch(() => { detectorPromise = null; }); // retry next time
  return detectorPromise;
}

async function scanBarcodeFromFile(file) {
  bcStatus('Reading the photo…');
  let detect;
  try { detect = await getDetector(); }
  catch { bcStatus('No barcode reader could be loaded in this browser — photograph the item itself instead.'); return; }
  try {
    const bmp = await createImageBitmap(file);
    const codes = await detect(bmp);
    if (!codes.length) { bcStatus('No barcode found — fill the frame with the bars, flat and well-lit.'); return; }
    await handleBarcode(codes[0]);
  } catch (err) { bcStatus(`Could not read that photo (${err.message}).`); }
}

async function scanBarcodeLive() {
  bcStatus('Loading the barcode reader…');
  let detect;
  try { detect = await getDetector(); }
  catch { bcStatus('No barcode reader could be loaded in this browser — try "Photo of the barcode".'); return; }
  bcStatus('');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch { bcStatus('Camera unavailable — try "Photo of the barcode" instead.'); return; }
  $modal.innerHTML = `
    <div class="modal-back" id="bcback">
      <div class="modal" style="max-width:440px;text-align:center">
        <h2>Scan the barcode</h2>
        <p class="muted" style="margin:6px 0 12px">Hold the tag steady — it reads automatically.</p>
        <video id="bc-video" autoplay playsinline style="width:100%;border-radius:12px;background:#000"></video>
        <div style="margin-top:14px"><button class="btn quiet" id="bc-cancel">Cancel</button></div>
      </div>
    </div>`;
  const video = document.getElementById('bc-video');
  video.srcObject = stream;
  let alive = true;
  const stop = () => { alive = false; stream.getTracks().forEach(t => t.stop()); $modal.innerHTML = ''; };
  document.getElementById('bc-cancel').addEventListener('click', stop);
  document.getElementById('bcback').addEventListener('click', e => { if (e.target.id === 'bcback') stop(); });
  const started = Date.now();
  const tick = async () => {
    if (!alive) return;
    if (Date.now() - started > 45000) { stop(); bcStatus('Gave up after 45s — try a photo of the barcode instead.'); return; }
    try {
      if (video.readyState >= 2) {
        const codes = await detect(video);
        if (codes.length) { const v = codes[0]; stop(); await handleBarcode(v); return; }
      }
    } catch { /* keep scanning */ }
    setTimeout(tick, 350);
  };
  tick();
}

async function lookupBarcode(code) {
  // Apparel UPCs are spotty in public databases — try two, accept the first hit.
  try {
    const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`);
    if (res.ok) {
      const j = await res.json();
      const item = j.items && j.items[0];
      if (item) return { name: item.title || null, image: (item.images && item.images[0]) || null };
    }
  } catch { /* CORS or network — fall through */ }
  try {
    const res = await fetch(`https://www.brocade.io/api/items/${encodeURIComponent(code)}`);
    if (res.ok) {
      const j = await res.json();
      if (j && j.name) return { name: j.name, image: null };
    }
  } catch { /* fall through */ }
  return null;
}

async function handleBarcode(code) {
  bcStatus(`Barcode ${code} — looking it up…`);
  const found = await lookupBarcode(code);
  if (found && found.image) {
    try {
      const res = await fetch(found.image);
      const blob = await res.blob();
      const dataUrl = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
      const a = await analyzeImage(dataUrl);
      addDraft(a);
      const d = S.drafts[S.drafts.length - 1];
      d.barcode = code;
      if (found.name) d.name = found.name.slice(0, 60);
      renderDrafts();
      bcStatus(`Found "${found.name || code}" — product photo and color pulled in. Review below.`);
      return;
    } catch { /* image fetch blocked — fall through to name-only */ }
  }
  S.pendingBarcode = { code, name: found ? found.name : null };
  if (found && found.name) {
    bcStatus(`Found "${found.name}". Now add one photo of the item so the color is true — the barcode is saved with it.`);
  } else {
    bcStatus(`Barcode ${code} saved — apparel codes are rarely in public databases. Snap the item itself and it attaches automatically.`);
  }
  document.getElementById('file-in').click();
}

async function handleFiles(files) {
  if (!files.length) return;
  toast(`Reading ${files.length} photo${files.length > 1 ? 's' : ''}…`);
  for (const f of files) {
    try {
      const dataUrl = await fileToDataUrl(f);
      const a = await analyzeImage(dataUrl);
      addDraft(a);
    } catch (err) { toast(err.message); }
  }
  renderDrafts();
}

async function fetchImageBlob(url) {
  // 1. direct (works for CORS-friendly hosts)
  try {
    const res = await fetch(url);
    if (res.ok) { const b = await res.blob(); if (b.type.startsWith('image/')) return b; }
  } catch { /* blocked — try the server function */ }
  // 2. via the Pages Function (server-side fetch, no CORS limits; available when hosted)
  try {
    const res = await fetch('/api/fetch?url=' + encodeURIComponent(url));
    if (res.ok) { const b = await res.blob(); if (b.type.startsWith('image/')) return b; }
  } catch { /* not hosted or upstream failed */ }
  return null;
}

// Type a name ("lululemon Metal Vent Tech shirt") → image search → pick the photo
async function handleNameSearch(query) {
  toast(`Searching for "${query}"…`);
  let results = null;
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(query));
    const j = await res.json();
    if (!res.ok) { toast(j.error || 'Search failed.'); return; }
    results = j.results;
  } catch {
    toast('Search needs the hosted app — it isn’t available on this local copy.');
    return;
  }
  $modal.innerHTML = `
    <div class="modal-back" id="isback">
      <div class="modal" style="max-width:680px">
        <h2>Pick your item</h2>
        <p class="muted" style="margin:6px 0 14px">Best photo wins — a studio shot on a plain background gives the truest color.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;max-height:56vh;overflow-y:auto">
          ${results.map((r, i) => `
            <button data-is-pick="${i}" style="border:1.5px solid var(--line);border-radius:12px;overflow:hidden;background:#fff;display:flex;flex-direction:column;padding:0">
              <img src="${esc(r.thumbnail)}" alt="" style="width:100%;height:130px;object-fit:cover" loading="lazy">
              <span style="font-size:10.5px;color:var(--stone);padding:6px 8px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${esc((r.title || '').slice(0, 60))}</span>
            </button>`).join('')}
        </div>
        <div style="margin-top:16px"><button class="btn quiet" id="is-cancel">Cancel</button></div>
      </div>
    </div>`;
  const close = () => { $modal.innerHTML = ''; };
  document.getElementById('isback').addEventListener('click', e => { if (e.target.id === 'isback') close(); });
  document.getElementById('is-cancel').addEventListener('click', close);
  document.querySelectorAll('[data-is-pick]').forEach(b => b.addEventListener('click', async () => {
    const r = results[+b.dataset.isPick];
    close();
    toast('Reading the photo…');
    let blob = await fetchImageBlob(r.image);
    if (!blob) blob = await fetchImageBlob(r.thumbnail);
    if (!blob) { toast('That photo can’t be read — try another result.'); await handleNameSearch(query); return; }
    const dataUrl = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(blob); });
    try {
      const a = await analyzeImage(dataUrl);
      addDraft(a);
      const d = S.drafts[S.drafts.length - 1];
      d.name = query;
      renderDrafts();
      document.getElementById('url-in').value = '';
      toast('Added — confirm the color and size below.');
    } catch { toast('Could not read that image — try another result.'); }
  }));
}

// Product PAGE → { image, title, color } via the server-side scraper
async function scrapeProductPage(url) {
  try {
    const res = await fetch('/api/scrape?url=' + encodeURIComponent(url));
    if (res.ok) return await res.json();
  } catch { /* not hosted or scrape failed */ }
  return null;
}

async function handleUrl() {
  const url = document.getElementById('url-in').value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) { await handleNameSearch(url); return; }
  toast('Fetching…');
  let blob = await fetchImageBlob(url);
  let scraped = null;
  if (!blob) {
    // Not a direct image — treat it as a product page and scrape it
    scraped = await scrapeProductPage(url);
    if (scraped && scraped.image) blob = await fetchImageBlob(scraped.image);
  }
  if (blob) {
    const dataUrl = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
    try {
      const a = await analyzeImage(dataUrl);
      document.getElementById('url-in').value = '';
      const manyColors = scraped && scraped.colors && scraped.colors.length > 1;
      const manySizes = scraped && scraped.sizes && scraped.sizes.length > 1;
      if (manyColors || manySizes) {
        // Ask which colorways Mark owns and what size he takes
        if (!scraped.colors || !scraped.colors.length) scraped.colors = [scraped.color || 'As shown'];
        openColorwayModal(scraped, a);
        return;
      }
      addDraft(a);
      const d = S.drafts[S.drafts.length - 1];
      if (scraped) {
        if (scraped.title) d.name = scraped.title;
        applyDeclaredColor(d, scraped.color);
      }
      renderDrafts();
      toast(scraped && scraped.title ? `Found "${scraped.title}"` : 'Image added — review below.');
      return;
    } catch { /* unreadable image data — fall through */ }
  }
  // Fallback: the site blocks fetching. Show the image straight from their server
  // (browsers may display what they won't let us read) and ask for the color.
  const canDisplay = await new Promise(res => {
    const img = new Image();
    img.onload = () => res(true);
    img.onerror = () => res(false);
    img.src = url;
    setTimeout(() => res(false), 6000);
  });
  if (!canDisplay) {
    toast('This retailer blocks readers. On the product page, right-click the photo → "Copy image address" and paste that here — or save the photo and upload it.');
    return;
  }
  S.drafts.push({
    id: uid(),
    img: url,
    imgKind: 'remote',
    corrected: false,
    cutout: false,
    manualColor: true,
    options: NAMED_COLORS,
    colorIdx: 0,
    category: 'top',
    name: 'New item',
    dressiness: 3,
    barcode: null,
  });
  renderDrafts();
  document.getElementById('url-in').value = '';
  toast('Image added — this site hides its colors from us, so pick the color below.');
}

// A retailer-declared color name ("Heather Navy") outranks the pixel guess,
// and is kept verbatim as the brand color — the rebuy reference.
function applyDeclaredColor(d, declaredName) {
  if (!declaredName) return;
  d.brandColor = declaredName;
  const named = NAMED_COLORS.find(c =>
    declaredName.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase() === declaredName.toLowerCase());
  if (named) {
    if (!d.options.some(o => o.name === named.name)) d.options = [named, ...d.options].slice(0, 3);
    d.colorIdx = d.options.findIndex(o => o.name === named.name);
  }
}

// "Which colors do you have?" — one closet item per selected colorway
function openColorwayModal(scraped, analysis) {
  $modal.innerHTML = `
    <div class="modal-back" id="cwback">
      <div class="modal" role="dialog" aria-label="Choose your colors">
        <h2>Which colors do you have?</h2>
        <p class="muted" style="margin:6px 0 14px">${esc(scraped.title || 'This item')} comes in ${scraped.colors.length} colors. Select every one you own — each becomes its own closet item.</p>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:38vh;overflow-y:auto">
          ${scraped.colors.map((c, i) => `<label style="display:flex;gap:10px;align-items:center;font-size:14.5px"><input type="checkbox" data-cw="${i}" ${scraped.colors.length === 1 || (scraped.color && c === scraped.color) ? 'checked' : ''}> ${esc(c)}</label>`).join('')}
        </div>
        ${scraped.sizes && scraped.sizes.length ? `
        <div class="field" style="margin-top:16px"><label class="lab">Your size</label>
          <select class="input" id="cw-size"><option value="">— pick a size —</option>${scraped.sizes.map(s => `<option>${esc(s)}</option>`).join('')}</select>
        </div>` : ''}
        <div style="display:flex;gap:10px;margin-top:20px">
          <button class="btn primary" id="cw-add">Add selected</button>
          <button class="btn quiet" id="cw-cancel">Cancel</button>
        </div>
      </div>
    </div>`;
  const close = () => { $modal.innerHTML = ''; };
  document.getElementById('cwback').addEventListener('click', e => { if (e.target.id === 'cwback') close(); });
  document.getElementById('cw-cancel').addEventListener('click', close);
  document.getElementById('cw-add').addEventListener('click', () => {
    const picked = [...document.querySelectorAll('[data-cw]:checked')].map(cb => scraped.colors[+cb.dataset.cw]);
    if (!picked.length) { toast('Select at least one color.'); return; }
    const size = document.getElementById('cw-size') ? document.getElementById('cw-size').value || null : null;
    for (const label of picked) {
      addDraft(analysis);
      const d = S.drafts[S.drafts.length - 1];
      if (scraped.title) d.name = scraped.title;
      if (label !== 'As shown') applyDeclaredColor(d, label);
      d.size = size;
    }
    close();
    renderDrafts();
    toast(`${picked.length} colorway${picked.length > 1 ? 's' : ''} added — review below.`);
  });
}

function addDraft(a) {
  const best = a.named[0];
  const draft = {
    id: uid(),
    img: a.dataUrl,
    imgKind: a.cutout ? 'cutout' : 'photo',
    corrected: a.corrected,
    cutout: a.cutout,
    options: a.named,
    colorIdx: 0,
    category: 'top',
    name: `${best.name} top`,
    dressiness: 3,
    barcode: null,
    brandColor: null,
    size: null,
  };
  if (S.pendingBarcode) {
    draft.barcode = S.pendingBarcode.code;
    if (S.pendingBarcode.name) draft.name = S.pendingBarcode.name.slice(0, 60);
    S.pendingBarcode = null;
  }
  S.drafts.push(draft);
}

function renderDrafts() {
  const box = document.getElementById('draft-list');
  if (!box) return;
  if (!S.drafts.length) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="card">
      <h2 style="margin-bottom:6px">Review · ${S.drafts.length} item${S.drafts.length > 1 ? 's' : ''}</h2>
      <p class="muted" style="margin-bottom:10px">Confirm the color by name — navy-vs-black is where outfits go wrong.</p>
      <div id="rows">${S.drafts.map(draftRowHtml).join('')}</div>
      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="btn primary" id="add-all">Add ${S.drafts.length} to closet</button>
        <button class="btn quiet" id="clear-drafts">Clear</button>
      </div>
    </div>`;

  box.querySelectorAll('[data-d-color]').forEach(b => b.addEventListener('click', () => {
    const d = S.drafts.find(x => x.id === b.dataset.dId);
    d.colorIdx = +b.dataset.dColor;
    const chosen = d.options[d.colorIdx];
    if (new RegExp(`^(${d.options.map(o => o.name).join('|')}) `).test(d.name)) {
      d.name = `${chosen.name} ${catLabel(d.category).toLowerCase()}`;
    }
    renderDrafts();
  }));
  box.querySelectorAll('[data-d-more]').forEach(b => b.addEventListener('click', () => {
    const d = S.drafts.find(x => x.id === b.dataset.dMore);
    const current = d.options[d.colorIdx];
    d.manualColor = true;
    d.options = NAMED_COLORS;
    d.colorIdx = Math.max(0, NAMED_COLORS.findIndex(c => c.name === current.name));
    renderDrafts();
  }));
  box.querySelectorAll('[data-d-colorsel]').forEach(sel => sel.addEventListener('change', () => {
    const d = S.drafts.find(x => x.id === sel.dataset.dColorsel);
    d.colorIdx = +sel.value;
    if (d.name === 'New item' || NAMED_COLORS.some(c => d.name.startsWith(c.name + ' '))) {
      d.name = `${d.options[d.colorIdx].name} ${catLabel(d.category).toLowerCase()}`;
    }
    renderDrafts();
  }));
  box.querySelectorAll('[data-d-name]').forEach(inp => inp.addEventListener('input', () => {
    S.drafts.find(x => x.id === inp.dataset.dName).name = inp.value;
  }));
  box.querySelectorAll('[data-d-brandcolor]').forEach(inp => inp.addEventListener('input', () => {
    S.drafts.find(x => x.id === inp.dataset.dBrandcolor).brandColor = inp.value;
  }));
  box.querySelectorAll('[data-d-size]').forEach(inp => inp.addEventListener('input', () => {
    S.drafts.find(x => x.id === inp.dataset.dSize).size = inp.value;
  }));
  box.querySelectorAll('[data-d-cat]').forEach(sel => sel.addEventListener('change', () => {
    const d = S.drafts.find(x => x.id === sel.dataset.dCat);
    d.category = sel.value;
    d.name = `${d.options[d.colorIdx].name} ${catLabel(d.category).toLowerCase()}`;
    renderDrafts();
  }));
  box.querySelectorAll('[data-d-dress]').forEach(r => r.addEventListener('input', () => {
    const d = S.drafts.find(x => x.id === r.dataset.dDress);
    d.dressiness = +r.value;
    r.closest('.review-fields').querySelector('.dress-out').textContent = DRESS_LABELS[+r.value];
  }));
  box.querySelectorAll('[data-d-del]').forEach(b => b.addEventListener('click', () => {
    S.drafts = S.drafts.filter(x => x.id !== b.dataset.dDel);
    renderDrafts();
  }));
  box.querySelectorAll('[data-d-dup]').forEach(b => b.addEventListener('click', () => {
    const d = S.drafts.find(x => x.id === b.dataset.dDup);
    const idx = S.drafts.indexOf(d);
    // duplicate with a free-choice color picker — you own it in another color
    S.drafts.splice(idx + 1, 0, { ...d, id: uid(), manualColor: true, options: NAMED_COLORS, colorIdx: 0 });
    renderDrafts();
  }));
  document.getElementById('add-all').addEventListener('click', async () => {
    for (const d of S.drafts) {
      const c = d.options[d.colorIdx];
      const item = {
        id: d.id, name: d.name.trim() || `${c.name} ${catLabel(d.category).toLowerCase()}`,
        category: d.category,
        colors: [{ name: c.name, hex: c.hex }],
        dressiness: d.dressiness,
        img: d.img, imgKind: d.imgKind, barcode: d.barcode || null,
        brandColor: (d.brandColor || '').trim() || null,
        size: (d.size || '').trim() || null,
        fitNote: null,
        laundry: false, wearCount: 0, lastWorn: null, createdAt: Date.now(),
      };
      await putRecord('items', item);
      S.items.push(item);
    }
    const added = S.drafts.length;
    S.drafts = [];
    toast(`${added} item${added > 1 ? 's' : ''} added to your closet`);
    dirty();
    nav('closet');
  });
  document.getElementById('clear-drafts').addEventListener('click', () => { S.drafts = []; renderDrafts(); });
}

function draftRowHtml(d) {
  const notes = [];
  if (d.corrected) notes.push('Warm cast removed ✓');
  if (d.cutout) notes.push('Background cut out ✓');
  if (d.barcode) notes.push(`Barcode ${d.barcode} attached ✓`);
  const noteHtml = d.manualColor
    ? `<span class="qnote warn">This site hides its image data, so the color can't be read — pick it below.</span>`
    : notes.length ? `<span class="qnote">${notes.join(' · ')}</span>` :
    `<span class="qnote warn">Shot on a busy background — color read from the center. A white surface reads truer.</span>`;
  const colorPicker = d.manualColor
    ? `<span class="swatch" style="background:${d.options[d.colorIdx].hex};width:26px;height:26px"></span><select class="input" data-d-colorsel="${d.id}" aria-label="Color">${d.options.map((o, i) => `<option value="${i}" ${i === d.colorIdx ? 'selected' : ''}>${o.name}</option>`).join('')}</select>`
    : d.options.map((o, i) => `<button class="sw-opt ${i === d.colorIdx ? 'sel' : ''}" data-d-id="${d.id}" data-d-color="${i}"><span class="swatch" style="background:${o.hex}"></span>${esc(o.name)}${i === d.colorIdx ? ' ✓' : ''}</button>`).join('') +
      `<button class="sw-opt" data-d-more="${d.id}" title="Pick from all colors">More colors…</button>`;
  return `
    <div class="review-row">
      <div class="review-thumb"><img src="${d.img}" alt=""></div>
      <div class="review-fields">
        <div class="row">${noteHtml}</div>
        <div class="row">${colorPicker}</div>
        <div class="row">
          <input class="input" style="max-width:240px" value="${esc(d.name)}" data-d-name="${d.id}" aria-label="Item name">
          <select class="input" data-d-cat="${d.id}" aria-label="Category">
            ${CATEGORIES.map(c => `<option value="${c.id}" ${c.id === d.category ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>
          <button class="btn quiet" data-d-dup="${d.id}" title="I have this in another color too">＋ Another color</button>
          <button class="btn quiet" data-d-del="${d.id}">Remove</button>
        </div>
        <div class="row">
          <input class="input" style="max-width:220px" value="${esc(d.brandColor || '')}" data-d-brandcolor="${d.id}" placeholder="Brand's color name (e.g. Heather Fog)" aria-label="Brand color name">
          <input class="input" style="max-width:120px" value="${esc(d.size || '')}" data-d-size="${d.id}" placeholder="Size" aria-label="Size">
        </div>
        <div class="row" style="max-width:380px;flex:1">
          <input type="range" min="1" max="5" step="1" value="${d.dressiness}" data-d-dress="${d.id}" aria-label="Dressiness">
          <span class="dress-out muted" style="font-size:12.5px;width:120px">${DRESS_LABELS[d.dressiness]}</span>
        </div>
      </div>
    </div>`;
}

// ============================================================ CLOSET
function viewCloset() {
  const q = (S._closetQ || '').toLowerCase();
  const dressF = S._closetDress || 0;
  let items = S.items;
  if (q) items = items.filter(i => i.name.toLowerCase().includes(q) || i.colors[0].name.toLowerCase().includes(q));
  if (dressF) items = items.filter(i => i.dressiness === dressF);

  const shelves = CATEGORIES.map(cat => {
    const inCat = items.filter(i => i.category === cat.id);
    if (!inCat.length && (q || dressF)) return '';
    const cards = inCat.length
      ? `<div class="shelf-row">${inCat.map(itemCardHtml).join('')}</div>`
      : `<div class="empty-shelf">Nothing here yet — <a href="#/add" data-nav-inline="add">add your first ${cat.label.toLowerCase()}</a></div>`;
    return `<div class="shelf"><div class="shelf-head"><h3>${cat.label}s</h3><span class="count">${inCat.length}</span></div>${cards}</div>`;
  }).join('');

  $view.innerHTML = `
    <div class="pagehead"><h1>My Closet</h1><p>Everything you own, in one place.</p></div>
    <div class="closet-tools">
      <input class="input" id="closet-q" placeholder="Search your closet" value="${esc(S._closetQ || '')}">
      <div class="chiprow">${[1, 2, 3, 4, 5].map(d => `<button class="chip ${dressF === d ? 'on' : ''}" data-dress-f="${d}">${DRESS_LABELS[d]}</button>`).join('')}</div>
    </div>
    ${S.items.length ? shelves : `<div class="empty-shelf" style="padding:48px">Your closet is empty. <a href="#/add">Add items</a> or load the demo closet from Home.</div>`}`;

  document.getElementById('closet-q').addEventListener('input', e => { S._closetQ = e.target.value; viewCloset(); });
  const qEl = document.getElementById('closet-q');
  qEl.focus(); qEl.setSelectionRange(qEl.value.length, qEl.value.length);
  $view.querySelectorAll('[data-dress-f]').forEach(b => b.addEventListener('click', () => {
    S._closetDress = S._closetDress === +b.dataset.dressF ? 0 : +b.dataset.dressF;
    viewCloset();
  }));
  $view.querySelectorAll('[data-item]').forEach(c => c.addEventListener('click', () => openItemModal(c.dataset.item)));
  bindInlineNav();
}

function itemCardHtml(i) {
  return `
    <button class="item-card" data-item="${i.id}">
      <div class="item-img"><img src="${itemImg(i)}" alt="">${i.laundry ? '<span class="laundry-badge">In wash</span>' : ''}</div>
      <div class="item-name">${esc(i.name)}</div>
      <div class="item-sub"><span class="swatch" style="background:${i.colors[0].hex}"></span>${esc(i.colors[0].name)}${i.size ? ' · ' + esc(i.size) : ''} · ${DRESS_LABELS[i.dressiness]}</div>
    </button>`;
}

function openItemModal(id) {
  const item = S.items.find(i => i.id === id);
  if (!item) return;
  $modal.innerHTML = `
    <div class="modal-back" id="mback">
      <div class="modal" role="dialog" aria-label="Item details">
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <div class="review-thumb" style="width:150px;height:150px"><img src="${itemImg(item)}" alt=""></div>
          <div style="flex:1;min-width:220px">
            <div class="field"><label class="lab">Name</label><input class="input" id="mi-name" value="${esc(item.name)}"></div>
            <div class="field"><label class="lab">Color</label>
              <select class="input" id="mi-color">${NAMED_COLORS.map(c => `<option ${c.name === item.colors[0].name ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
            </div>
            <div class="field" style="display:flex;gap:10px">
              <div style="flex:1"><label class="lab">Brand's color name</label><input class="input" id="mi-brandcolor" value="${esc(item.brandColor || '')}" placeholder="e.g. Heather Fog"></div>
              <div style="width:110px"><label class="lab">Size</label><input class="input" id="mi-size" value="${esc(item.size || '')}" placeholder="M"></div>
            </div>
            <div class="field"><label class="lab">Fit note</label><input class="input" id="mi-fitnote" value="${esc(item.fitNote || '')}" placeholder="e.g. runs small — sized up"></div>
            <div class="field"><label class="lab">Dressiness — <span id="mi-dress-out">${DRESS_LABELS[item.dressiness]}</span></label>
              <input type="range" min="1" max="5" step="1" value="${item.dressiness}" id="mi-dress" style="width:100%">
            </div>
            <div class="field"><label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" id="mi-laundry" ${item.laundry ? 'checked' : ''}> In the wash (won't be suggested)</label></div>
            <p class="muted" style="font-size:13px">Worn ${item.wearCount || 0} time${item.wearCount === 1 ? '' : 's'}${item.lastWorn ? ` · last on ${fmtDate(item.lastWorn)}` : ''}${item.barcode ? ` · barcode ${esc(item.barcode)}` : ''}</p>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:22px;flex-wrap:wrap">
          <button class="btn primary" id="mi-save">Save</button>
          <button class="btn quiet" id="mi-close">Cancel</button>
          <button class="btn danger" id="mi-del" style="margin-left:auto">Delete item</button>
        </div>
      </div>
    </div>`;
  const close = () => { $modal.innerHTML = ''; };
  document.getElementById('mback').addEventListener('click', e => { if (e.target.id === 'mback') close(); });
  document.getElementById('mi-close').addEventListener('click', close);
  document.getElementById('mi-dress').addEventListener('input', e => {
    document.getElementById('mi-dress-out').textContent = DRESS_LABELS[+e.target.value];
  });
  document.getElementById('mi-save').addEventListener('click', async () => {
    item.name = document.getElementById('mi-name').value.trim() || item.name;
    const c = metaForColorName(document.getElementById('mi-color').value);
    const colorChanged = c.name !== item.colors[0].name;
    item.colors = [{ name: c.name, hex: c.hex }];
    item.dressiness = +document.getElementById('mi-dress').value;
    item.laundry = document.getElementById('mi-laundry').checked;
    item.brandColor = document.getElementById('mi-brandcolor').value.trim() || null;
    item.size = document.getElementById('mi-size').value.trim() || null;
    item.fitNote = document.getElementById('mi-fitnote').value.trim() || null;
    if (colorChanged && item.imgKind === 'silhouette') item.img = garmentDataUrl(item.category, c.hex, item.name);
    await putRecord('items', item);
    close(); toast('Saved'); render(); dirty();
  });
  document.getElementById('mi-del').addEventListener('click', async () => {
    await deleteRecord('items', item.id);
    S.items = S.items.filter(i => i.id !== item.id);
    close(); toast('Item deleted'); render(); dirty();
  });
}

// ============================================================ STYLIST
function viewStylist() {
  const st = S.stylist;
  $view.innerHTML = `
    <div class="pagehead"><h1>The Stylist</h1><p>Generate outfits for any occasion.</p></div>
    <div class="card" style="max-width:760px">
      <div class="field"><label class="lab">What are you dressing for?</label>
        <input class="input" id="st-text" placeholder="e.g. a summer wedding, a job interview, brunch with friends" value="${esc(st.text)}">
      </div>
      <div class="field"><label class="lab">Occasions</label>
        <div class="chiprow">${OCCASIONS.map(o => `<button class="chip ${st.chip === o.label ? 'on' : ''}" data-occ-chip="${esc(o.label)}" data-occ-target="${o.target}">${o.label}</button>`).join('')}</div>
      </div>
      <div class="field"><label class="lab">Dress codes</label>
        <div class="chiprow">${DRESS_CODES.map(o => `<button class="chip ${st.chip === o.label ? 'on' : ''}" data-occ-chip="${esc(o.label)}" data-occ-target="${o.target}">${o.label}</button>`).join('')}</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn primary" id="st-go">✦ Style me</button>
        <button class="btn line" id="st-build">Build one myself</button>
      </div>
    </div>
    <div id="st-picked" style="margin-top:26px"></div>
    <div id="st-builder-wrap" style="margin-top:26px;display:none"><div class="card" style="max-width:760px"><h3 style="margin-bottom:14px">Build an outfit by hand</h3><div id="st-builder"></div></div></div>
    <div class="outfits" id="st-results"></div>`;

  $view.querySelectorAll('[data-occ-chip]').forEach(b => b.addEventListener('click', () => {
    st.chip = st.chip === b.dataset.occChip ? null : b.dataset.occChip;
    st.chipTarget = +b.dataset.occTarget;
    viewStylist();
  }));
  document.getElementById('st-text').addEventListener('input', e => { st.text = e.target.value; });
  document.getElementById('st-go').addEventListener('click', runStylist);
  document.getElementById('st-build').addEventListener('click', () => {
    const wrap = document.getElementById('st-builder-wrap');
    const show = wrap.style.display === 'none';
    wrap.style.display = show ? 'block' : 'none';
    if (show) {
      renderBuilder(document.getElementById('st-builder'), S.items.filter(i => !i.laundry), {
        submitLabel: 'Wear it → Mirror check',
        nameField: false,
        prefs: S.prefs,
        onSubmit: ({ items, note }) => openMirrorModal(items.map(i => i.id), note || 'Styled by hand'),
      });
    }
  });
  renderOutfits();
  renderPickedForYou();
}

async function renderPickedForYou() {
  const box = document.getElementById('st-picked');
  if (!box || !S.syncCode) return;
  const suggs = await fetchSuggestions(S.syncCode);
  if (!suggs.length) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="sec-head" style="margin-bottom:14px"><h2 style="font-family:var(--serif);font-size:24px">Picked for you</h2></div>
    <div class="outfits">
      ${suggs.map(s => {
        const items = s.itemIds.map(id => S.items.find(i => i.id === id)).filter(Boolean);
        if (!items.length) return '';
        return `
          <div class="outfit-card">
            <div class="oc-head"><span class="oc-title">From ${esc(s.from)}</span><span class="oc-meta">${fmtDate(s.at)}</span></div>
            ${flatlayHtml(items)}
            ${s.note ? `<div class="why">“${esc(s.note)}”</div>` : ''}
            <div class="slotrow">${items.map(i => `<span class="slot">${esc(catLabel(i.category))} · ${esc(i.name)}</span>`).join('')}</div>
            <div class="oc-actions">
              <button class="btn primary" data-wear='${esc(JSON.stringify(items.map(i => i.id)))}' data-occ="Picked by ${esc(s.from)}">Wear it → Mirror check</button>
              <button class="btn quiet" data-sugg-dismiss="${esc(s.id)}">Dismiss</button>
            </div>
          </div>`;
      }).join('')}
    </div>`;
  bindWearButtons();
  box.querySelectorAll('[data-sugg-dismiss]').forEach(b => b.addEventListener('click', async () => {
    await dismissSuggestion(S.syncCode, b.dataset.suggDismiss);
    renderPickedForYou();
  }));
}

function stylistTarget() {
  const st = S.stylist;
  if (st.chip) return st.chipTarget;
  if (st.text.trim()) return targetFromText(st.text);
  return 3;
}

function runStylist() {
  const st = S.stylist;
  st.title = st.text.trim() || st.chip || 'Styled for you';
  st.shown = new Set();
  st.results = generateOutfits(S.items, { target: stylistTarget(), wears: S.wears, count: 3, prefs: S.prefs });
  st.results.forEach(o => st.shown.add(o.key));
  renderOutfits();
  if (!st.results.length) toast('Not enough items — you need a top, bottom and shoes (or a dress and shoes).');
}

function renderOutfits() {
  const box = document.getElementById('st-results');
  if (!box) return;
  const st = S.stylist;
  if (!st.results.length) { box.innerHTML = ''; return; }
  box.innerHTML = st.results.map((o, idx) => outfitCardHtml(o, idx, st.title)).join('');

  box.querySelectorAll('[data-swap]').forEach(b => b.addEventListener('click', () => {
    const [idx, itemId] = b.dataset.swap.split(':');
    const o = st.results[+idx];
    const alts = swapAlternatives(S.items, o, itemId, stylistTarget(), S.wears, S.prefs);
    if (!alts.length) { toast('No alternative for that slot in your closet.'); return; }
    const next = alts.find(a => !st.shown.has(a.items.map(i => i.id).sort().join('|'))) || alts[0];
    const key = next.items.map(i => i.id).sort().join('|');
    st.results[+idx] = { items: next.items, key, score: next.score, why: next.why, palette: next.palette };
    st.shown.add(key);
    renderOutfits();
  }));
  box.querySelectorAll('[data-shuffle]').forEach(b => b.addEventListener('click', () => {
    const idx = +b.dataset.shuffle;
    const fresh = generateOutfits(S.items, { target: stylistTarget(), wears: S.wears, count: 1, exclude: st.shown, prefs: S.prefs });
    if (!fresh.length) { toast('That was everything your closet can make for this occasion.'); return; }
    st.results[idx] = fresh[0];
    st.shown.add(fresh[0].key);
    renderOutfits();
  }));
  bindWearButtons();
}

function outfitCardHtml(o, idx, title) {
  const grade = o.score >= 85 ? 'Excellent match' : o.score >= 65 ? 'Strong match' : 'Workable';
  return `
    <div class="outfit-card">
      <div class="oc-head"><span class="oc-title">${esc(title)}${S.stylist.results.length > 1 ? ` · Look ${idx + 1}` : ''}</span><span class="score-pill">${grade}</span></div>
      ${flatlayHtml(o.items)}
      ${colorStoryHtml(o)}
      <div class="why"><b>Why this works:</b> ${o.why.slice(0, 2).map(esc).join(' ')}</div>
      <div class="slotrow">
        ${o.items.map(i => `<span class="slot">${esc(catLabel(i.category))} · ${esc(i.name)}<button class="swapbtn" data-swap="${idx}:${i.id}" title="Swap this piece" aria-label="Swap ${esc(i.name)}">⇄</button></span>`).join('')}
      </div>
      <div class="oc-actions">
        <button class="btn primary" data-wear='${esc(JSON.stringify(o.items.map(i => i.id)))}' data-occ="${esc(title)}">Wear it → Mirror check</button>
        <button class="btn line" data-shuffle="${idx}">Shuffle</button>
      </div>
    </div>`;
}

// ============================================================ OUTFIT BUILDER (human styling)
// Shared by the invited-stylist view and "Build one myself".
const BUILDER_SLOTS = [
  { cat: 'top', label: 'Top' }, { cat: 'bottom', label: 'Bottom' },
  { cat: 'dress', label: 'Dress (instead of top + bottom)' },
  { cat: 'layer', label: 'Layer (optional)' }, { cat: 'shoes', label: 'Shoes' },
  { cat: 'accessory', label: 'Accessory (optional)' },
];

function renderBuilder(container, items, opts) {
  const sel = {}; // cat -> item
  const draw = () => {
    const chosen = Object.values(sel);
    const complete = sel.shoes && (sel.dress || (sel.top && sel.bottom));
    let hint = '';
    if (chosen.length >= 2) {
      const s = scoreOutfit(chosen, 3, null, opts.prefs || null);
      const grade = s.score >= 85 ? 'Excellent' : s.score >= 65 ? 'Strong' : 'Workable';
      hint = `<div class="harmony-hint"><b>${grade} colors.</b> ${esc(s.why[0] || '')}</div>`;
    }
    container.innerHTML = `
      ${chosen.length ? flatlayHtml(chosen) : '<div class="flatlay" style="display:flex;align-items:center;justify-content:center;color:var(--stone);font-size:14px">Tap pieces below to build the look</div>'}
      ${hint}
      ${BUILDER_SLOTS.map(slot => {
        const inCat = items.filter(i => i.category === slot.cat);
        if (!inCat.length) return '';
        return `
          <div class="builder-slot">
            <label class="lab">${slot.label}</label>
            <div class="strip">
              ${inCat.map(i => `
                <button class="pick ${sel[slot.cat] && sel[slot.cat].id === i.id ? 'sel' : ''}" data-b-pick="${slot.cat}:${i.id}">
                  <img src="${itemImg(i)}" alt=""><span>${esc(i.name)}</span>
                </button>`).join('')}
            </div>
          </div>`;
      }).join('')}
      ${opts.nameField ? `<div class="field"><label class="lab">Your name</label><input class="input" id="b-from" placeholder="e.g. Rebecca" style="max-width:240px" value="${esc(opts.fromDefault || '')}"></div>` : ''}
      <div class="field"><label class="lab">Note (optional)</label><input class="input" id="b-note" placeholder="e.g. for the dinner on Friday — with the sleeves rolled"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn primary" id="b-submit" ${complete ? '' : 'disabled'}>${esc(opts.submitLabel)}</button>
        <span class="muted" style="font-size:12.5px;align-self:center">${complete ? '' : 'Needs shoes plus a top and bottom (or a dress).'}</span>
      </div>`;
    container.querySelectorAll('[data-b-pick]').forEach(b => b.addEventListener('click', () => {
      const [cat, id] = b.dataset.bPick.split(':');
      const item = items.find(i => i.id === id);
      const note = container.querySelector('#b-note').value;
      const from = container.querySelector('#b-from') ? container.querySelector('#b-from').value : null;
      if (sel[cat] && sel[cat].id === id) delete sel[cat];
      else {
        sel[cat] = item;
        if (cat === 'dress') { delete sel.top; delete sel.bottom; }
        if (cat === 'top' || cat === 'bottom') delete sel.dress;
      }
      draw();
      container.querySelector('#b-note').value = note;
      if (from !== null && container.querySelector('#b-from')) container.querySelector('#b-from').value = from;
    }));
    const submit = container.querySelector('#b-submit');
    if (submit) submit.addEventListener('click', () => {
      opts.onSubmit({
        items: Object.values(sel),
        note: container.querySelector('#b-note').value.trim(),
        from: container.querySelector('#b-from') ? container.querySelector('#b-from').value.trim() : null,
      });
    });
  };
  draw();
}

// The invited stylist's page — read-only closet, build & send
async function viewStylistFor() {
  $view.innerHTML = `<div class="pagehead"><h1>Style this closet</h1><p>Loading the closet…</p></div>`;
  const r = await fetchSharedCloset(S.shareToken);
  if (r.error) {
    $view.innerHTML = `<div class="pagehead"><h1>Style this closet</h1></div><div class="empty-shelf" style="padding:40px">${esc(r.error)}</div>`;
    return;
  }
  $view.innerHTML = `
    <div class="pagehead"><h1>Style this closet</h1><p>You've been invited to pick out an outfit — from their real clothes. Tap pieces, watch the look come together, send it with a note.</p></div>
    <div class="card" style="max-width:760px"><div id="builder"></div></div>`;
  renderBuilder(document.getElementById('builder'), r.items, {
    submitLabel: 'Send this outfit',
    nameField: true,
    onSubmit: async ({ items, note, from }) => {
      const res = await sendSuggestion(S.shareToken, { itemIds: items.map(i => i.id), note, from });
      if (res.error) { toast(res.error); return; }
      $view.innerHTML = `
        <div class="pagehead"><h1>Sent ✓</h1><p>Your pick is waiting in their Stylist tab.</p></div>
        <button class="btn primary" id="again">Style another outfit</button>`;
      document.getElementById('again').addEventListener('click', viewStylistFor);
    },
  });
}

// ============================================================ RATE A LOOK (invited reviewer)
const RATE_TAGS = ['Too small', 'Too big', 'Not with these'];

async function viewRate() {
  $view.innerHTML = `<div class="pagehead"><h1>Rate the look</h1><p>Loading…</p></div>`;
  const r = await fetchLooksByToken(S.shareToken);
  if (r.error) { $view.innerHTML = `<div class="pagehead"><h1>Rate the look</h1></div><div class="empty-shelf" style="padding:40px">${esc(r.error)}</div>`; return; }
  const myName = localStorage.getItem('raterName') || '';
  const unrated = r.looks.filter(l => !(l.ratings || []).some(x => !x.ai && x.by === myName && myName));
  const queue = unrated.length ? unrated : r.looks;
  if (!queue.length) { $view.innerHTML = `<div class="pagehead"><h1>Rate the look</h1></div><div class="empty-shelf" style="padding:40px">No looks waiting — you're all caught up.</div>`; return; }
  rateOne(queue, 0);
}

function rateOne(queue, idx) {
  const look = queue[idx];
  const verdicts = {}; // itemId -> love|ok|no
  const tags = {};     // itemId -> [..]
  let outfitRating = 0;
  $view.innerHTML = `
    <div class="pagehead"><h1>Rate the look</h1><p>${look.occasion ? `<b style="color:var(--ink)">Dressed for: ${esc(look.occasion)}</b> — does it work for that? · ` : ''}${fmtDate(look.at)}${queue.length > 1 ? ` · ${idx + 1} of ${queue.length}` : ''}</p></div>
    <div class="card" style="max-width:640px">
      <div style="text-align:center"><img src="${look.photo}" alt="Outfit photo" style="max-height:52vh;border-radius:14px"></div>
      <div class="field" style="margin-top:18px"><label class="lab">Each piece — tap your verdict</label>
        <div class="wear-items" id="r-items">
          ${look.items.map(i => `
            <div style="border-top:1px solid var(--line);padding:10px 0">
              <div class="row" style="display:flex;align-items:center;gap:10px;font-size:14px">
                <b style="flex:1">${esc(i.name)}</b>
                ${['love', 'ok', 'no'].map(v => `<button class="chip" data-r-v="${esc(i.id)}:${v}" style="padding:6px 12px">${v === 'love' ? '❤️' : v === 'ok' ? '😐' : '✕'}</button>`).join('')}
              </div>
              <div class="chiprow" style="margin-top:8px">
                ${RATE_TAGS.map(t => `<button class="chip" style="font-size:11.5px;padding:5px 11px" data-r-t="${esc(i.id)}:${esc(t)}">${t}</button>`).join('')}
              </div>
            </div>`).join('')}
        </div>
      </div>
      <div class="field"><label class="lab">The whole outfit</label>
        <div class="hearts-input" id="r-hearts">${[1, 2, 3, 4, 5].map(n => `<button data-h="${n}" aria-label="${n} hearts">♥</button>`).join('')}</div>
      </div>
      <div class="field"><label class="lab">Your name</label><input class="input" id="r-name" style="max-width:220px" value="${esc(localStorage.getItem('raterName') || '')}" placeholder="e.g. Rebecca"></div>
      <div class="field"><label class="lab">Anything to add? (optional)</label><input class="input" id="r-comment" placeholder="e.g. roll the sleeves and it's perfect"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn primary" id="r-send" disabled>Send rating</button>
        ${queue.length > idx + 1 ? `<button class="btn quiet" id="r-skip">Skip</button>` : ''}
      </div>
    </div>`;

  const gate = () => { document.getElementById('r-send').disabled = !(outfitRating && document.getElementById('r-name').value.trim()); };
  $view.querySelectorAll('[data-r-v]').forEach(b => b.addEventListener('click', () => {
    const [id, v] = b.dataset.rV.split(':');
    verdicts[id] = verdicts[id] === v ? undefined : v;
    if (!verdicts[id]) delete verdicts[id];
    $view.querySelectorAll(`[data-r-v^="${id}:"]`).forEach(x => x.classList.toggle('on', x.dataset.rV === `${id}:${verdicts[id]}`));
  }));
  $view.querySelectorAll('[data-r-t]').forEach(b => b.addEventListener('click', () => {
    const [id, t] = b.dataset.rT.split(':');
    tags[id] = tags[id] || [];
    if (tags[id].includes(t)) tags[id] = tags[id].filter(x => x !== t);
    else tags[id].push(t);
    b.classList.toggle('on', tags[id].includes(t));
  }));
  document.getElementById('r-hearts').addEventListener('click', e => {
    const b = e.target.closest('[data-h]');
    if (!b) return;
    outfitRating = +b.dataset.h;
    document.querySelectorAll('#r-hearts button').forEach(x => x.classList.toggle('on', +x.dataset.h <= outfitRating));
    gate();
  });
  document.getElementById('r-name').addEventListener('input', gate);
  const skip = document.getElementById('r-skip');
  if (skip) skip.addEventListener('click', () => rateOne(queue, idx + 1));
  document.getElementById('r-send').addEventListener('click', async () => {
    const by = document.getElementById('r-name').value.trim();
    localStorage.setItem('raterName', by);
    const res = await submitRating(S.shareToken, look.id, {
      by, outfit: outfitRating, items: verdicts, tags,
      comment: document.getElementById('r-comment').value.trim(),
    });
    if (res.error) { toast(res.error); return; }
    if (queue.length > idx + 1) { toast('Sent — next look'); rateOne(queue, idx + 1); }
    else {
      $view.innerHTML = `<div class="pagehead"><h1>Sent ✓</h1><p>Your ratings help their stylist learn what actually works.</p></div>`;
    }
  });
}

// ============================================================ MIRROR CHECK
function bindWearButtons() {
  document.querySelectorAll('[data-wear]').forEach(b => {
    if (b._bound) return; b._bound = true;
    b.addEventListener('click', () => openMirrorModal(JSON.parse(b.dataset.wear), b.dataset.occ || ''));
  });
}

const WEAR_OCCASIONS = ['Work', 'Restaurant dinner', 'Dinner party', 'Theme party', 'Wedding', 'Boating', 'Daytime weekend', 'Night out', 'Travel', 'Workout'];

function openMirrorModal(itemIds, occasion) {
  const items = itemIds.map(id => S.items.find(i => i.id === id)).filter(Boolean);
  let rating = 0;
  let photoData = null;
  let pickedOccasion = occasion || '';
  $modal.innerHTML = `
    <div class="modal-back" id="wback">
      <div class="modal" role="dialog" aria-label="Mirror check">
        <h2>Mirror check</h2>
        <p class="muted" style="margin-bottom:14px">One snap before you head out — it logs the wear, files the look, and teaches the stylist.</p>
        <div class="field">
          <button class="btn line" id="w-photo-btn">📷 Add a mirror photo (optional)</button>
          <input type="file" id="w-photo" accept="image/*" capture="user" hidden>
          <div id="w-photo-note" class="muted" style="font-size:13px;margin-top:6px"></div>
        </div>
        <div class="wear-items">
          ${items.map(i => `
            <div class="row"><img src="${itemImg(i)}" alt=""> <span style="color:var(--good);font-weight:700">✓</span> ${esc(i.name)}
              <label class="wash"><input type="checkbox" data-wash="${i.id}"> into the wash after</label>
            </div>`).join('')}
        </div>
        <div class="field"><label class="lab">Dressed for… (optional)</label>
          <div class="chiprow" id="w-occ">
            ${[...new Set([...(occasion && !WEAR_OCCASIONS.includes(occasion) ? [occasion] : []), ...WEAR_OCCASIONS])].map(o =>
              `<button class="chip ${o === occasion ? 'on' : ''}" data-w-occ="${esc(o)}" style="font-size:12px;padding:6px 13px">${esc(o)}</button>`).join('')}
          </div>
        </div>
        <div class="field"><label class="lab">How did it feel?</label>
          <div class="hearts-input" id="w-hearts">${[1, 2, 3, 4, 5].map(n => `<button data-h="${n}" aria-label="${n} hearts">♥</button>`).join('')}</div>
        </div>
        ${S.syncCode ? `<div class="field" id="w-rate-row" style="display:none">
          <label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" id="w-ask" checked> Ask for ratings — AI reviews it now, and you get a link to text your people</label>
        </div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn primary" id="w-save">Log to Lookbook</button>
          <button class="btn quiet" id="w-cancel">Cancel</button>
        </div>
      </div>
    </div>`;
  const close = () => { $modal.innerHTML = ''; };
  document.getElementById('wback').addEventListener('click', e => { if (e.target.id === 'wback') close(); });
  document.getElementById('w-cancel').addEventListener('click', close);
  document.getElementById('w-photo-btn').addEventListener('click', () => document.getElementById('w-photo').click());
  document.getElementById('w-photo').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    photoData = await downscalePhoto(await fileToDataUrl(f));
    document.getElementById('w-photo-note').textContent = 'Photo attached ✓ — saved to your Lookbook with this outfit.';
    const rateRow = document.getElementById('w-rate-row');
    if (rateRow) rateRow.style.display = 'block';
  });
  document.getElementById('w-occ').addEventListener('click', e => {
    const b = e.target.closest('[data-w-occ]');
    if (!b) return;
    pickedOccasion = pickedOccasion === b.dataset.wOcc ? (occasion || '') : b.dataset.wOcc;
    document.querySelectorAll('[data-w-occ]').forEach(x => x.classList.toggle('on', x.dataset.wOcc === pickedOccasion));
  });
  document.getElementById('w-hearts').addEventListener('click', e => {
    const b = e.target.closest('[data-h]');
    if (!b) return;
    rating = +b.dataset.h;
    document.querySelectorAll('#w-hearts button').forEach(x => x.classList.toggle('on', +x.dataset.h <= rating));
  });
  document.getElementById('w-save').addEventListener('click', async () => {
    const wear = { id: uid(), date: Date.now(), itemIds: items.map(i => i.id), occasion: pickedOccasion || occasion, rating, photo: photoData };
    const ask = document.getElementById('w-ask');
    if (photoData && ask && ask.checked && S.syncCode) {
      toast('Posting for ratings — the AI is looking…');
      const look = {
        photo: photoData, occasion: pickedOccasion || occasion,
        items: items.map(i => ({ id: i.id, name: i.name, category: i.category, color: i.colors[0].name })),
      };
      const res = await postLook(S.syncCode, look);
      if (res.ok) {
        wear.lookId = res.lookId;
        const token = await ensureShareToken();
        if (res.aiReview) {
          setTimeout(() => toast(`AI: ${'♥'.repeat(res.aiReview.outfit)} — “${res.aiReview.comment}”`), 3000);
        }
        if (token) {
          const url = `${location.origin}/#/rate/${token}`;
          if (navigator.share) { try { await navigator.share({ title: 'Rate my outfit', url }); } catch { /* sheet closed */ } }
          else if (navigator.clipboard) { await navigator.clipboard.writeText(url).catch(() => {}); toast('Rating link copied — text it to your people'); }
        }
      } else if (res.error) toast(res.error);
    }
    await putRecord('wears', wear);
    S.wears.push(wear);
    for (const i of items) {
      i.wearCount = (i.wearCount || 0) + 1;
      i.lastWorn = Date.now();
      const washEl = document.querySelector(`[data-wash="${i.id}"]`);
      if (washEl && washEl.checked) i.laundry = true;
      await putRecord('items', i);
    }
    close();
    toast('Logged to Lookbook — have a great one');
    dirty();
  });
}

// ============================================================ LOOKBOOK
function viewLookbook() {
  const wears = [...S.wears].sort((a, b) => b.date - a.date);
  $view.innerHTML = `
    <div class="pagehead"><h1>Lookbook</h1><p>Every look you've worn — with what the AI and your people thought.</p></div>
    ${wears.length ? `<div class="look-grid">${wears.map(lookCardHtml).join('')}</div>`
      : `<div class="empty-shelf" style="padding:48px">No looks yet. Generate an outfit in the <a href="#/stylist">Stylist</a> and tap "Wear it".</div>`}`;
  $view.querySelectorAll('[data-del-wear]').forEach(b => b.addEventListener('click', async () => {
    await deleteRecord('wears', b.dataset.delWear);
    S.wears = S.wears.filter(w => w.id !== b.dataset.delWear);
    dirty();
    viewLookbook();
  }));
  // pull fresh ratings, re-render once if new ones arrived
  if (S.syncCode) {
    const before = JSON.stringify(S.looks.map(l => (l.ratings || []).length));
    refreshPrefs().then(() => {
      if (S.route === 'lookbook' && JSON.stringify(S.looks.map(l => (l.ratings || []).length)) !== before) viewLookbook();
    });
  }
}

function ratingsHtml(w) {
  if (!w.lookId) return '';
  const look = S.looks.find(l => l.id === w.lookId);
  if (!look || !(look.ratings || []).length) return '';
  return look.ratings.map(r => {
    const itemNotes = [];
    for (const [id, v] of Object.entries(r.items || {})) {
      if (v === 'no') {
        const it = look.items.find(x => x.id === id);
        if (it) itemNotes.push(`✕ ${it.name}${(r.tags && r.tags[id] || []).length ? ` (${r.tags[id].join(', ')})` : ''}`);
      }
    }
    for (const [id, ts] of Object.entries(r.tags || {})) {
      if ((r.items || {})[id] !== 'no') {
        const it = look.items.find(x => x.id === id);
        if (it && ts.length) itemNotes.push(`${it.name}: ${ts.join(', ')}`);
      }
    }
    return `<div style="font-size:11.5px;color:var(--stone);margin-top:5px;line-height:1.45">
      <b style="color:var(--ink)">${esc(r.by)}</b> <span style="color:var(--slate-deep)">${'♥'.repeat(r.outfit || 0)}</span>
      ${r.comment ? `<br>“${esc(r.comment)}”` : ''}
      ${itemNotes.length ? `<br>${esc(itemNotes.join(' · '))}` : ''}
    </div>`;
  }).join('');
}

function lookCardHtml(w) {
  const items = w.itemIds.map(id => S.items.find(i => i.id === id)).filter(Boolean);
  const photo = w.photo
    ? `<img src="${w.photo}" alt="Mirror photo">`
    : `<div class="minilay">${items.slice(0, 4).map((i, n) => `<img src="${itemImg(i)}" style="left:${[6, 50, 18, 56][n]}%;top:${[8, 6, 50, 48][n]}%" alt="">`).join('')}</div>`;
  return `
    <div class="look-card">
      <div class="look-photo">${photo}</div>
      <div class="look-body">
        <div class="date">${fmtDate(w.date)}</div>
        <div class="occ">${esc(w.occasion || 'Worn')}</div>
        <div class="hearts">${'♥'.repeat(w.rating || 0)}<span style="color:#C9C6C0">${'♥'.repeat(5 - (w.rating || 0))}</span></div>
        ${ratingsHtml(w)}
        <div style="margin-top:6px"><button class="btn quiet" style="padding:4px 0;font-size:12px" data-del-wear="${w.id}">Remove</button></div>
      </div>
    </div>`;
}

// ============================================================ PACK
function viewPack() {
  const f = S.pack.form;
  $view.innerHTML = `
    <div class="pagehead"><h1>Pack for a trip</h1><p>The smallest bag that covers every day — with weather checked before you fly.</p></div>
    <div class="card" style="max-width:760px">
      <div class="grid2">
        <div class="field"><label class="lab">Destination</label><input class="input" id="pk-dest" placeholder="e.g. Lisbon" value="${esc(f.dest)}"></div>
        <div class="field"><label class="lab">First day</label><input class="input" type="date" id="pk-start" value="${esc(f.start)}"></div>
        <div class="field"><label class="lab">Days</label><input class="input" type="number" min="1" max="16" id="pk-days" value="${f.days}"></div>
        <div class="field"><label class="lab">Of which work days</label><input class="input" type="number" min="0" max="16" id="pk-work" value="${f.work}"></div>
        <div class="field"><label class="lab">Nice dinners</label><input class="input" type="number" min="0" max="16" id="pk-dinners" value="${f.dinners}"></div>
        <div class="field"><label class="lab">Bag</label>
          <select class="input" id="pk-bag" style="width:100%">
            <option value="carryon" ${f.bag === 'carryon' ? 'selected' : ''}>Carry-on only (~12 garments)</option>
            <option value="checked" ${f.bag === 'checked' ? 'selected' : ''}>Checked bag (~22 garments)</option>
          </select>
        </div>
        <div class="field"><label class="lab">Laundry on the trip?</label>
          <select class="input" id="pk-laundry" style="width:100%">
            <option value="0" ${f.laundry === 0 ? 'selected' : ''}>No laundry access</option>
            <option value="1" ${f.laundry === 1 ? 'selected' : ''}>One wash mid-trip</option>
            <option value="2" ${f.laundry === 2 ? 'selected' : ''}>Wash every few days</option>
          </select>
        </div>
      </div>
      <label class="lab" style="margin-top:8px">What's on the itinerary?</label>
      <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
        ${ACTIVITIES.map(a => `<div class="field" style="margin-bottom:8px"><label class="lab" style="font-weight:500;text-transform:none;letter-spacing:0;font-size:13px">${a.label}</label><input class="input" type="number" min="0" max="16" data-pk-act="${a.id}" value="${f.acts[a.id] || 0}"></div>`).join('')}
      </div>
      <div class="field"><label class="lab">Theme nights (optional)</label>
        <input class="input" id="pk-themes" placeholder="e.g. white party, 70s night — separate with commas" value="${esc(f.themes)}">
      </div>
      <button class="btn primary" id="pk-go">Build my capsule</button>
    </div>
    <div id="pk-result" style="margin-top:28px"></div>`;
  document.getElementById('pk-go').addEventListener('click', runPack);
  if (S.pack.result) renderPackResult();
}

async function runPack() {
  const f = S.pack.form;
  f.dest = document.getElementById('pk-dest').value.trim();
  f.start = document.getElementById('pk-start').value;
  f.days = Math.max(1, Math.min(16, +document.getElementById('pk-days').value || 5));
  f.work = Math.max(0, Math.min(f.days, +document.getElementById('pk-work').value || 0));
  f.dinners = Math.max(0, +document.getElementById('pk-dinners').value || 0);
  f.acts = {};
  document.querySelectorAll('[data-pk-act]').forEach(inp => { f.acts[inp.dataset.pkAct] = Math.max(0, +inp.value || 0); });
  f.themes = document.getElementById('pk-themes').value.trim();
  f.bag = document.getElementById('pk-bag').value;
  f.laundry = +document.getElementById('pk-laundry').value;
  const box = document.getElementById('pk-result');
  box.innerHTML = `<p class="muted">Building your capsule…</p>`;

  let weather = null, weatherNote = '';
  if (f.dest) {
    try {
      const place = await geocode(f.dest);
      const horizon = f.start ? Math.round((new Date(f.start) - Date.now()) / 864e5) : 0;
      if (horizon >= 0 && horizon + f.days <= 16) {
        weather = await forecast(place.lat, place.lon, f.days, f.start || null);
        weatherNote = place.name;
      } else {
        weatherNote = `${place.name} — too far out for a forecast; packing without weather.`;
      }
    } catch (err) { weatherNote = `Weather unavailable (${err.message}).`; }
  }

  const occs = [];
  for (let d = 0; d < f.days; d++) {
    occs.push(d < f.work ? { label: 'Work', target: 3.5 } : { label: 'Casual day', target: 2 });
  }
  for (let e = 0; e < f.dinners; e++) occs.push({ label: 'Dinner', target: 3.5 });

  const temps = weather ? weather.map(w => w.tMax) : [];
  const rainDays = weather ? weather.map((w, i) => (w.rainProb > 50 ? i : -1)).filter(i => i >= 0) : [];

  const activities = ACTIVITIES.map(a => ({ ...a, count: f.acts[a.id] || 0 })).filter(a => a.count > 0);
  const themes = f.themes ? f.themes.split(',').map(s => s.trim()).filter(Boolean) : [];
  const effDays = f.laundry > 0 ? Math.ceil(f.days / (f.laundry + 1)) : null;
  const itemCap = f.bag === 'carryon' ? 12 : 22;

  S.pack.result = {
    ...capsulePlan(S.items, { days: f.days, occasions: occs, temps, rainDays, activities, themes, effDays, itemCap }),
    weather, weatherNote, form: { ...f }, effDays, itemCap,
  };
  renderPackResult();
}

function renderPackResult() {
  const box = document.getElementById('pk-result');
  const r = S.pack.result;
  if (!box || !r) return;
  if (!r.capsule.length) {
    box.innerHTML = `<div class="empty-shelf" style="padding:40px">Not enough in the closet to build a capsule — add tops, bottoms and shoes first.</div>`;
    return;
  }
  const f = r.form;
  const weatherHtml = r.weather
    ? `<div class="trip-weather">${r.weather.map(w => { const d = describeWmo(w.code); return `<span class="wday"><b>${new Date(w.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })}</b>${d.icon} ${w.tMin}–${w.tMax}°${w.rainProb > 50 ? ' ☂' : ''}</span>`; }).join('')}</div>`
    : (r.weatherNote ? `<p class="muted" style="margin:12px 0">${esc(r.weatherNote)}</p>` : '');

  const byCat = {};
  for (const i of r.capsule) (byCat[i.category] = byCat[i.category] || []).push(i);

  box.innerHTML = `
    <h2>${esc(f.dest || 'Your trip')} · ${f.days} day${f.days > 1 ? 's' : ''}</h2>
    ${r.weather ? `<p class="muted" style="margin-top:4px">${esc(r.weatherNote)}</p>` : ''}
    ${weatherHtml}
    <div class="matrix-note"><span><b>${r.capsule.length} items → ${r.outfits.length} outfits.</b> ${r.capsule.length <= r.itemCap ? (f.bag === 'carryon' ? 'Fits a carry-on.' : 'Fits the bag easily.') : 'Over the bag budget — see gaps.'}${r.effDays ? ` Laundry resets everything every ${r.effDays} day${r.effDays > 1 ? 's' : ''}.` : ''}</span><span class="muted">${r.gaps.length ? `${r.gaps.length} gap${r.gaps.length > 1 ? 's' : ''} flagged before you fly` : 'No gaps found'}</span></div>
    ${r.gaps.map(g => `<div class="gapnote">${esc(g)}</div>`).join('')}
    <div class="capsule-grid">${r.capsule.map(i => `<div class="cap-tile" title="${esc(i.name)}"><img src="${itemImg(i)}" alt="${esc(i.name)}"></div>`).join('')}</div>
    <h3 style="margin-top:26px">Day by day</h3>
    <div>${r.plan.map(p => `
      <div class="plan-row">
        <span class="d">${p.day ? `Day ${p.day}` : '＋'}</span>
        <span class="muted" style="min-width:96px">${esc(p.occasion)}${p.rain ? ' ☂' : ''}${p.temp != null ? ` · ${p.temp}°` : ''}</span>
        ${p.outfit ? `<span class="mini">${p.outfit.items.map(i => `<img src="${itemImg(i)}" title="${esc(i.name)}" alt="">`).join('')}</span><span style="font-size:12.5px" class="muted">${p.outfit.items.map(i => esc(i.name)).join(' + ')}</span>` : '<span class="muted">no matching outfit — see gaps</span>'}
      </div>`).join('')}</div>
    <h3 style="margin-top:26px">Pack against this</h3>
    <div class="checklist">
      ${Object.entries(byCat).map(([cat, arr]) => arr.map(i => `<label><input type="checkbox"> ${esc(i.name)} <span class="muted" style="font-size:12px">(${catLabel(cat).toLowerCase()})</span></label>`).join('')).join('')}
      <label><input type="checkbox"> Underwear &amp; socks × ${(r.effDays || f.days) + 1}${r.effDays ? ' (laundry covers the rest)' : ''}</label>
      <label><input type="checkbox"> Toiletries${r.effDays ? ' + travel detergent' : ''}</label>
    </div>`;
}

// ---------- boot ----------
async function boot() {
  S.items = await getAllRecords('items');
  S.wears = await getAllRecords('wears');
  S.homeCity = await getSetting('homeCity');
  S.syncCode = await getSetting('syncCode');
  S.route = parseRoute();
  render();
  if (S.syncCode) { pullOnBoot(); refreshPrefs(); }
  else S.prefs = computePrefs([], S.wears);
}
boot();

// installable app: offline shell + home-screen behavior
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* http local dev — fine */ });
}

// Update notice: the home-screen app can sit suspended for days. Whenever it
// comes back to the foreground, compare the deployed code against what's
// running; if it changed, offer a one-tap update.
let shellFingerprint = null;
async function fetchFingerprint() {
  try {
    const [html, js] = await Promise.all([
      fetch('/index.html', { cache: 'no-store' }).then(r => r.text()),
      fetch('/js/app.js', { cache: 'no-store' }).then(r => r.text()),
    ]);
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html + js));
    return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}
async function checkForUpdate() {
  const fp = await fetchFingerprint();
  if (!fp) return;
  if (!shellFingerprint) { shellFingerprint = fp; return; }
  if (fp !== shellFingerprint) {
    const t = document.getElementById('toast');
    t.textContent = 'A new version is ready — tap to update';
    t.classList.add('show');
    t.style.pointerEvents = 'auto';
    t.style.cursor = 'pointer';
    t.onclick = () => location.reload();
    clearTimeout(t._h); // stays until tapped or replaced
  }
}
fetchFingerprint().then(fp => { shellFingerprint = fp; });
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
setInterval(checkForUpdate, 20 * 60 * 1000);
