import { putRecord, deleteRecord, getAllRecords, getSetting, setSetting, uid } from './db.js';
import { analyzeImage, fileToDataUrl, NAMED_COLORS, metaForColorName } from './color.js';
import { CATEGORIES, garmentDataUrl } from './garments.js';
import { OCCASIONS, DRESS_CODES, DRESS_LABELS, targetFromText, generateOutfits, swapAlternatives, capsulePlan, ACTIVITIES } from './stylist.js';
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
};

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
window.addEventListener('hashchange', () => {
  const r = location.hash.replace('#/', '') || 'home';
  if (r !== S.route) { S.route = r; render(); }
});
document.querySelector('.topbar').addEventListener('click', e => {
  const b = e.target.closest('[data-nav]');
  if (b) nav(b.dataset.nav);
});

function render() {
  document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.nav === S.route));
  const views = { home: viewHome, add: viewAdd, closet: viewCloset, stylist: viewStylist, pack: viewPack, lookbook: viewLookbook };
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
      </div>`;
    document.getElementById('seed-demo').addEventListener('click', async () => {
      const items = demoItems();
      for (const it of items) await putRecord('items', it);
      S.items.push(...items);
      toast('Demo closet loaded — 14 items');
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
    <div class="morning" id="morning"></div>`;
  bindInlineNav();
  renderMorningCard();
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
    const outfits = generateOutfits(S.items, { target: 2.5, temp: d.tMax, wears: S.wears, count: 1 });
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
    <div class="divider">or add by image URL</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;max-width:640px">
      <input class="input" id="url-in" placeholder="https://… direct image link" style="flex:1;min-width:220px">
      <button class="btn line" id="url-go">Use link</button>
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
const BC_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

function bcStatus(msg) {
  const el = document.getElementById('bc-status');
  if (el) el.textContent = msg;
}

function barcodeSupported() {
  if ('BarcodeDetector' in window) return true;
  bcStatus('This browser has no built-in barcode reader — use Chrome or Edge, or just photograph the item itself.');
  return false;
}

async function scanBarcodeFromFile(file) {
  if (!barcodeSupported()) return;
  try {
    const bmp = await createImageBitmap(file);
    const det = new BarcodeDetector({ formats: BC_FORMATS });
    const codes = await det.detect(bmp);
    if (!codes.length) { bcStatus('No barcode found in that photo — get closer so the bars fill the frame.'); return; }
    await handleBarcode(codes[0].rawValue);
  } catch (err) { bcStatus(`Could not read that photo (${err.message}).`); }
}

async function scanBarcodeLive() {
  if (!barcodeSupported()) return;
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
  const det = new BarcodeDetector({ formats: BC_FORMATS });
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
        const codes = await det.detect(video);
        if (codes.length) { const v = codes[0].rawValue; stop(); await handleBarcode(v); return; }
      }
    } catch { /* keep scanning */ }
    setTimeout(tick, 250);
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
      addDraft(a);
      const d = S.drafts[S.drafts.length - 1];
      if (scraped) {
        if (scraped.title) d.name = scraped.title;
        // The retailer's own declared color outranks our pixel guess
        if (scraped.color) {
          const declared = NAMED_COLORS.find(c => scraped.color.toLowerCase().includes(c.name.toLowerCase()));
          if (declared && !d.options.some(o => o.name === declared.name)) {
            d.options = [declared, ...d.options].slice(0, 3);
          }
          if (declared) d.colorIdx = d.options.findIndex(o => o.name === declared.name);
        }
      }
      renderDrafts();
      document.getElementById('url-in').value = '';
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
    toast('That site blocks its images entirely — save the photo to your device and upload it instead.');
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
  document.getElementById('add-all').addEventListener('click', async () => {
    for (const d of S.drafts) {
      const c = d.options[d.colorIdx];
      const item = {
        id: d.id, name: d.name.trim() || `${c.name} ${catLabel(d.category).toLowerCase()}`,
        category: d.category,
        colors: [{ name: c.name, hex: c.hex }],
        dressiness: d.dressiness,
        img: d.img, imgKind: d.imgKind, barcode: d.barcode || null,
        laundry: false, wearCount: 0, lastWorn: null, createdAt: Date.now(),
      };
      await putRecord('items', item);
      S.items.push(item);
    }
    const added = S.drafts.length;
    S.drafts = [];
    toast(`${added} item${added > 1 ? 's' : ''} added to your closet`);
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
    ? `<select class="input" data-d-colorsel="${d.id}" aria-label="Color">${d.options.map((o, i) => `<option value="${i}" ${i === d.colorIdx ? 'selected' : ''}>${o.name}</option>`).join('')}</select>`
    : d.options.map((o, i) => `<button class="sw-opt ${i === d.colorIdx ? 'sel' : ''}" data-d-id="${d.id}" data-d-color="${i}"><span class="swatch" style="background:${o.hex}"></span>${esc(o.name)}${i === d.colorIdx ? ' ✓' : ''}</button>`).join('');
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
          <button class="btn quiet" data-d-del="${d.id}">Remove</button>
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
      <div class="item-sub"><span class="swatch" style="background:${i.colors[0].hex}"></span>${esc(i.colors[0].name)} · ${DRESS_LABELS[i.dressiness]}</div>
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
    if (colorChanged && item.imgKind === 'silhouette') item.img = garmentDataUrl(item.category, c.hex, item.name);
    await putRecord('items', item);
    close(); toast('Saved'); render();
  });
  document.getElementById('mi-del').addEventListener('click', async () => {
    await deleteRecord('items', item.id);
    S.items = S.items.filter(i => i.id !== item.id);
    close(); toast('Item deleted'); render();
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
      <button class="btn primary" id="st-go">✦ Style me</button>
    </div>
    <div class="outfits" id="st-results"></div>`;

  $view.querySelectorAll('[data-occ-chip]').forEach(b => b.addEventListener('click', () => {
    st.chip = st.chip === b.dataset.occChip ? null : b.dataset.occChip;
    st.chipTarget = +b.dataset.occTarget;
    viewStylist();
  }));
  document.getElementById('st-text').addEventListener('input', e => { st.text = e.target.value; });
  document.getElementById('st-go').addEventListener('click', runStylist);
  renderOutfits();
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
  st.results = generateOutfits(S.items, { target: stylistTarget(), wears: S.wears, count: 3 });
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
    const alts = swapAlternatives(S.items, o, itemId, stylistTarget(), S.wears);
    if (!alts.length) { toast('No alternative for that slot in your closet.'); return; }
    const next = alts.find(a => !st.shown.has(a.items.map(i => i.id).sort().join('|'))) || alts[0];
    const key = next.items.map(i => i.id).sort().join('|');
    st.results[+idx] = { items: next.items, key, score: next.score, why: next.why, palette: next.palette };
    st.shown.add(key);
    renderOutfits();
  }));
  box.querySelectorAll('[data-shuffle]').forEach(b => b.addEventListener('click', () => {
    const idx = +b.dataset.shuffle;
    const fresh = generateOutfits(S.items, { target: stylistTarget(), wears: S.wears, count: 1, exclude: st.shown });
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

// ============================================================ MIRROR CHECK
function bindWearButtons() {
  document.querySelectorAll('[data-wear]').forEach(b => {
    if (b._bound) return; b._bound = true;
    b.addEventListener('click', () => openMirrorModal(JSON.parse(b.dataset.wear), b.dataset.occ || ''));
  });
}

function openMirrorModal(itemIds, occasion) {
  const items = itemIds.map(id => S.items.find(i => i.id === id)).filter(Boolean);
  let rating = 0;
  let photoData = null;
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
        <div class="field"><label class="lab">How did it feel?</label>
          <div class="hearts-input" id="w-hearts">${[1, 2, 3, 4, 5].map(n => `<button data-h="${n}" aria-label="${n} hearts">♥</button>`).join('')}</div>
        </div>
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
    photoData = await fileToDataUrl(f);
    document.getElementById('w-photo-note').textContent = 'Photo attached ✓ — saved to your Lookbook with this outfit.';
  });
  document.getElementById('w-hearts').addEventListener('click', e => {
    const b = e.target.closest('[data-h]');
    if (!b) return;
    rating = +b.dataset.h;
    document.querySelectorAll('#w-hearts button').forEach(x => x.classList.toggle('on', +x.dataset.h <= rating));
  });
  document.getElementById('w-save').addEventListener('click', async () => {
    const wear = { id: uid(), date: Date.now(), itemIds: items.map(i => i.id), occasion, rating, photo: photoData };
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
  });
}

// ============================================================ LOOKBOOK
function viewLookbook() {
  const wears = [...S.wears].sort((a, b) => b.date - a.date);
  $view.innerHTML = `
    <div class="pagehead"><h1>Lookbook</h1><p>Every look you've worn — searchable style memory.</p></div>
    ${wears.length ? `<div class="look-grid">${wears.map(lookCardHtml).join('')}</div>`
      : `<div class="empty-shelf" style="padding:48px">No looks yet. Generate an outfit in the <a href="#/stylist">Stylist</a> and tap "Wear it".</div>`}`;
  $view.querySelectorAll('[data-del-wear]').forEach(b => b.addEventListener('click', async () => {
    await deleteRecord('wears', b.dataset.delWear);
    S.wears = S.wears.filter(w => w.id !== b.dataset.delWear);
    viewLookbook();
  }));
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
  S.route = location.hash.replace('#/', '') || 'home';
  render();
}
boot();
