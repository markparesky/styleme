// The stylist engine: outfit generation, color-harmony scoring, "why it works", capsule packing.
import { metaForColorName, hexToRgb, rgbToHsl, colorDist, NAMED_COLORS } from './color.js';

export const DRESS_LABELS = ['', 'Very casual', 'Casual', 'Smart casual', 'Business / dressy', 'Formal'];

export const OCCASIONS = [
  { label: 'Work / Office',    target: 3.5 },
  { label: 'Everyday Casual',  target: 2 },
  { label: 'Date Night',       target: 3.5 },
  { label: 'Formal Event',     target: 5 },
  { label: 'Brunch / Social',  target: 2.5 },
  { label: 'Active / Weekend', target: 1.5 },
];

export const DRESS_CODES = [
  { label: 'White Tie', target: 5 }, { label: 'Black Tie', target: 5 },
  { label: 'Cocktail', target: 4 }, { label: 'Business Formal', target: 4 },
  { label: 'Business Casual', target: 3 }, { label: 'Smart Casual', target: 3 },
  { label: 'Athleisure', target: 1 }, { label: 'Relaxed / Lounge', target: 1.5 },
];

const KEYWORDS = [
  [/wedding|gala|black.?tie|ceremony/i, 4.6],
  [/interview|client|presentation|pitch/i, 4],
  [/office|work|meeting/i, 3.4],
  [/date|dinner|restaurant|cocktail/i, 3.5],
  [/brunch|coffee|lunch|party/i, 2.6],
  [/museum|gallery|theater|theatre/i, 3],
  [/hike|gym|run|beach|errand|travel|flight|lounge/i, 1.4],
];

export function targetFromText(text) {
  for (const [re, t] of KEYWORDS) if (re.test(text)) return t;
  return 3;
}

function meta(item) {
  const c = metaForColorName(item.colors[0].name);
  const [h, s, l] = rgbToHsl(hexToRgb(item.colors[0].hex || c.hex));
  return { name: c.name, hex: item.colors[0].hex || c.hex, neutral: c.neutral, tone: c.tone, h, s, l };
}

function hueDelta(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Score a set of items as one outfit. Returns { score, why, palette }
export function scoreOutfit(items, target, recentPairs) {
  const ms = items.map(meta);
  let score = 50;
  const why = [];

  const accents = ms.filter(m => !m.neutral);
  const neutrals = ms.filter(m => m.neutral);

  // ---- color logic ----
  if (accents.length === 0) {
    const lights = ms.map(m => m.l);
    const contrast = Math.max(...lights) - Math.min(...lights);
    if (contrast > 0.3) {
      score += 22;
      const darkest = ms.reduce((a, b) => (a.l < b.l ? a : b));
      const lightest = ms.reduce((a, b) => (a.l > b.l ? a : b));
      why.push(`An all-neutral palette lives or dies on contrast — the ${lightest.name.toLowerCase()} against the ${darkest.name.toLowerCase()} keeps it deliberate instead of flat.`);
    } else {
      score += 6;
      why.push(`All neutrals in a close value range — quiet and tonal. A lighter or darker piece would give it more intention.`);
    }
    const warmItems = ms.filter(m => m.tone === 'warm');
    const coolItems = ms.filter(m => m.tone === 'cool');
    const warms = warmItems.length, cools = coolItems.length;
    if (warms >= 2 && cools === 0) {
      score += 8;
      why.push(warms === ms.length
        ? `Everything sits on the warm side, so the pieces read as one family.`
        : `The ${warmItems.map(m => m.name.toLowerCase()).join(' and ')} share the same warm undertone, tying it together.`);
    }
    if (cools >= 2 && warms === 0) {
      score += 8;
      why.push(cools === ms.length
        ? `Everything sits on the cool side, so the pieces read as one family.`
        : `The ${coolItems.map(m => m.name.toLowerCase()).join(' and ')} share the same cool undertone, tying it together.`);
    }
    if (warms >= 1 && cools >= 1) {
      const anchor = ms.find(m => m.l < 0.3);
      if (anchor) { score += 5; why.push(`Warm and cool neutrals mix here, but the ${anchor.name.toLowerCase()} anchors it.`); }
      else score -= 4;
    }
  } else if (accents.length === 1) {
    score += 20;
    const a = accents[0];
    why.push(`One color — ${a.name.toLowerCase()} — carried by neutrals. The easiest outfit to get right, and this one is.`);
    if (neutrals.some(m => m.l < 0.3)) { score += 6; why.push(`The dark neutral grounds the ${a.name.toLowerCase()} so it pops without shouting.`); }
  } else if (accents.length === 2) {
    const d = hueDelta(accents[0].h, accents[1].h);
    if (d < 45) { score += 16; why.push(`${accents[0].name} and ${accents[1].name.toLowerCase()} are neighbors on the wheel — an analogous pair that reads calm and intentional.`); }
    else if (d > 150) { score += 12; why.push(`${accents[0].name} and ${accents[1].name.toLowerCase()} sit opposite each other — a complementary pairing with real energy.`); }
    else { score -= 10; why.push(`${accents[0].name} and ${accents[1].name.toLowerCase()} fight a little — neither neighbors nor opposites.`); }
  } else {
    score -= 16;
    why.push(`Three-plus colors is hard to keep coherent — consider letting one of these be the star.`);
  }

  // echo: shoes repeating a top-half hue family
  const shoes = items.find(i => i.category === 'shoes');
  if (shoes) {
    const sm = meta(shoes);
    const upper = items.filter(i => i !== shoes).map(meta);
    const echo = upper.find(u => hueDelta(u.h, sm.h) < 25 && Math.abs(u.l - sm.l) < 0.3 && u.tone === sm.tone && u.name !== sm.name);
    const match = upper.find(u => u.name === sm.name);
    if (echo || match) { score += 8; why.push(`The ${sm.name.toLowerCase()} shoes echo the ${(match || echo).name.toLowerCase()} up top — repetition is what makes it look styled rather than assembled.`); }
  }

  // ---- dressiness ----
  const ds = items.map(i => i.dressiness);
  const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
  const dev = Math.abs(avg - target);
  score -= dev * 9;
  const spread = Math.max(...ds) - Math.min(...ds);
  if (spread > 1.5) { score -= 8; why.push(`One piece is dressier than the rest — it may read as mismatched formality.`); }

  // ---- repetition guard ----
  const key = items.map(i => i.id).sort().join('|');
  if (recentPairs && recentPairs.has(key)) {
    score -= 25;
    why.push(`You wore this exact combination recently — swapped scoring against a repeat.`);
  }

  return { score, why, palette: ms };
}

function* combos(byCat, temp) {
  const layers = byCat.layer || [];
  const needLayer = temp != null && temp < 62;
  const layerOpts = layers.length ? (needLayer ? layers.map(l => [l]) : [[], ...layers.map(l => [l])]) : [[]];
  for (const top of byCat.top || []) {
    for (const bottom of byCat.bottom || []) {
      for (const shoes of byCat.shoes || []) {
        for (const layer of layerOpts) yield [top, bottom, shoes, ...layer];
      }
    }
  }
  for (const dress of byCat.dress || []) {
    for (const shoes of byCat.shoes || []) {
      for (const layer of layerOpts) yield [dress, shoes, ...layer];
    }
  }
}

export function recentPairKeys(wears, days = 14) {
  const cutoff = Date.now() - days * 864e5;
  const set = new Set();
  for (const w of wears) {
    if (w.date >= cutoff && w.itemIds && w.itemIds.length > 1) {
      set.add([...w.itemIds].sort().join('|'));
    }
  }
  return set;
}

export function generateOutfits(items, { target = 3, temp = null, wears = [], count = 3, exclude = new Set(), buildAroundId = null } = {}) {
  const avail = items.filter(i => !i.laundry);
  const byCat = {};
  for (const i of avail) (byCat[i.category] = byCat[i.category] || []).push(i);
  const recent = recentPairKeys(wears);
  const scored = [];
  for (const combo of combos(byCat, temp)) {
    if (buildAroundId && !combo.some(i => i.id === buildAroundId)) continue;
    const key = combo.map(i => i.id).sort().join('|');
    if (exclude.has(key)) continue;
    const s = scoreOutfit(combo, target, recent);
    scored.push({ items: combo, key, ...s });
  }
  scored.sort((a, b) => b.score - a.score);
  // diversity: don't lead with three outfits that share the same top
  const picked = [];
  for (const o of scored) {
    if (picked.length >= count) break;
    const lead = o.items[0].id;
    if (picked.filter(p => p.items[0].id === lead).length >= 1 && scored.length > count) continue;
    picked.push(o);
  }
  for (const o of scored) {
    if (picked.length >= count) break;
    if (!picked.includes(o)) picked.push(o);
  }
  return picked;
}

export function swapAlternatives(items, outfit, slotItemId, target, wears) {
  const slotItem = outfit.items.find(i => i.id === slotItemId);
  if (!slotItem) return [];
  const recent = recentPairKeys(wears);
  return items
    .filter(i => i.category === slotItem.category && i.id !== slotItem.id && !i.laundry)
    .map(alt => {
      const combo = outfit.items.map(i => (i.id === slotItemId ? alt : i));
      return { alt, ...scoreOutfit(combo, target, recent), items: combo };
    })
    .sort((a, b) => b.score - a.score);
}

// ---- activities & theme nights ----
export const ACTIVITIES = [
  { id: 'golf',    label: 'Golf',         target: 2, missing: 'golf-ready pieces (a polo, chinos or golf shorts, golf shoes or clean sneakers)',
    match: { top: /polo|golf/i, bottom: /chino|short|golf/i, shoes: /golf|sneaker|trainer|spike/i } },
  { id: 'tennis',  label: 'Tennis',       target: 1, missing: 'tennis / athletic wear', strictBottom: true,
    match: { top: /tee|tank|polo|tennis|athletic|jersey|training/i, bottom: /short|skirt|legging|jogger/i, shoes: /sneaker|trainer|tennis|running/i } },
  { id: 'workout', label: 'Workouts',     target: 1, missing: 'workout gear (a tee, shorts or joggers, trainers)', strictBottom: true,
    match: { top: /tee|tank|athletic|gym|training|jersey|sweat/i, bottom: /short|jogger|legging|track|sweat/i, shoes: /sneaker|trainer|running/i } },
  { id: 'beach',   label: 'Beach / pool', target: 1, missing: 'swimwear or sandals', strictBottom: true,
    match: { top: /linen|tee|shirt|rash|cover/i, bottom: /swim|trunk|board|short/i, shoes: /sandal|flip|slide|espadrille/i } },
  { id: 'hike',    label: 'Hiking',       target: 1, missing: 'trail-ready shoes',
    match: { top: /tee|fleece|flannel|hik|henley/i, bottom: /short|cargo|hik|jogger|jean/i, shoes: /boot|trail|hik|sneaker|trainer/i } },
];

function bestCombo(tops, bottoms, shoesArr, target) {
  let best = null;
  for (const t of tops) for (const b of bottoms) for (const s of shoesArr) {
    const sc = scoreOutfit([t, b, s], target, null);
    if (!best || sc.score > best.score) best = { items: [t, b, s], key: [t.id, b.id, s.id].sort().join('|'), ...sc };
  }
  return best;
}

export function activityOutfit(items, act) {
  const avail = items.filter(i => !i.laundry);
  const strict = cat => avail.filter(i => i.category === cat && act.match[cat].test(i.name));
  const casual = cat => avail.filter(i => i.category === cat && i.dressiness <= 2);
  const tops = strict('top').length ? strict('top') : casual('top');
  // Athletic activities never fall back to street bottoms — jeans don't work out.
  const bottoms = strict('bottom').length ? strict('bottom') : (act.strictBottom ? [] : casual('bottom'));
  const shoesArr = strict('shoes'); // shoes stay strict: derbies don't hike
  if (!tops.length || !bottoms.length || !shoesArr.length) return null;
  return bestCombo(tops, bottoms, shoesArr, act.target);
}

// "white party" → find the color word, dress the user in it (or flag the gap)
export function themeOutfit(items, themeText) {
  const avail = items.filter(i => !i.laundry);
  const gapNotes = [];
  const lower = themeText.toLowerCase();
  const color = NAMED_COLORS.find(c => lower.includes(c.name.toLowerCase()));
  if (!color) {
    const o = generateOutfits(avail, { target: 3.5, count: 1 });
    return o.length ? { outfit: o[0], color: null } : null;
  }
  const themed = avail.filter(i => colorDist(hexToRgb(i.colors[0].hex), hexToRgb(color.hex)) < 65);
  if (!themed.length) return { outfit: null, color, gap: `Nothing ${color.name.toLowerCase()} in the closet for "${themeText}" — that's a pre-trip buy.` };
  // Anchor on clothing before shoes/accessories: a "white party" needs a white
  // shirt on your back, not just white sneakers.
  const anchorOrder = { dress: 0, top: 1, bottom: 2, layer: 3, shoes: 4, accessory: 5 };
  themed.sort((a, b) => anchorOrder[a.category] - anchorOrder[b.category]);
  if (!themed.some(i => ['top', 'dress', 'bottom'].includes(i.category))) {
    gapNotes.push(`For "${themeText}" only your ${themed[0].name.toLowerCase()} ${themed.length > 1 ? 'and accessories are' : 'is'} ${color.name.toLowerCase()} — a ${color.name.toLowerCase()} top or dress would land the theme properly.`);
  }
  for (const anchor of themed) {
    const o = generateOutfits(avail, { target: 3.5, count: 1, buildAroundId: anchor.id });
    if (o.length) return { outfit: o[0], color, gap: gapNotes[0] || null };
  }
  return { outfit: null, color, gap: gapNotes[0] || `The ${color.name.toLowerCase()} pieces can't complete an outfit for "${themeText}".` };
}

// ---- capsule packing ----
// Greedy: pick the item set with the highest cross-compatibility that covers the trip's occasions.
// effDays: days between washes (laundry resets the closet mid-trip)
// itemCap: how many garments the bag actually holds
export function capsulePlan(items, { days, occasions, temps = [], rainDays = [], activities = [], themes = [], effDays = null, itemCap = Infinity }) {
  // Packing looks past today's laundry basket — you'd wash before the trip.
  // Items currently in the wash are usable but flagged "wash before you pack."
  const avail = items.map(i => (i.laundry ? { ...i, laundry: false, _washFirst: true } : i));
  const targets = occasions.map(o => o.target);
  const uniqueTargets = [...new Set(targets)];
  const coldest = temps.length ? Math.min(...temps) : null;

  // start: for each unique target, the best outfit
  const chosen = new Map();
  const outfitList = [];
  for (const t of uniqueTargets) {
    const best = generateOutfits(avail, { target: t, temp: coldest, count: 2 });
    for (const o of best) {
      outfitList.push({ ...o, target: t });
      o.items.forEach(i => chosen.set(i.id, i));
    }
  }
  // grow: add items that multiply outfits until we cover the trip or hit the bag's capacity.
  // With laundry mid-trip the same pieces come back fresh — variety only needs to
  // cover the days between washes.
  const coverDays = effDays || days;
  const want = Math.ceil(coverDays * 1.8);
  let guard = 0;
  while (outfitList.length < want && chosen.size < itemCap && guard++ < 20) {
    let bestAdd = null;
    for (const cand of avail) {
      if (chosen.has(cand.id)) continue;
      const trial = [...chosen.values(), cand];
      let gained = 0;
      for (const t of uniqueTargets) {
        gained += generateOutfits(trial, { target: t, temp: coldest, count: 6 })
          .filter(o => o.items.includes(cand) && o.score > 40).length;
      }
      if (!bestAdd || gained > bestAdd.gained) bestAdd = { cand, gained };
    }
    if (!bestAdd || bestAdd.gained === 0) break;
    chosen.set(bestAdd.cand.id, bestAdd.cand);
    for (const t of uniqueTargets) {
      for (const o of generateOutfits([...chosen.values()], { target: t, temp: coldest, count: 6 })) {
        if (!outfitList.some(x => x.key === o.key) && o.score > 40) outfitList.push({ ...o, target: t });
      }
    }
  }

  const gaps = [];

  // activities: dedicated outfits, items added to the bag
  const activityRows = [];
  for (const act of activities) {
    if (!act.count) continue;
    const ao = activityOutfit(avail, act);
    if (!ao) {
      gaps.push(`No ${act.missing} in the closet for ${act.label.toLowerCase()} — pack or pick up before the trip.`);
      for (let k = 0; k < act.count; k++) activityRows.push({ label: act.count > 1 ? `${act.label} ${k + 1}` : act.label, outfit: null });
      continue;
    }
    ao.items.forEach(i => chosen.set(i.id, i));
    for (let k = 0; k < act.count; k++) activityRows.push({ label: act.count > 1 ? `${act.label} ${k + 1}` : act.label, outfit: ao });
  }

  // theme nights: build around the theme color, or flag it
  const themeRows = [];
  for (const th of themes) {
    const t = themeOutfit(avail, th);
    if (!t) { themeRows.push({ label: th, outfit: null }); continue; }
    if (t.gap) gaps.push(t.gap);
    if (t.outfit) t.outfit.items.forEach(i => chosen.set(i.id, i));
    themeRows.push({ label: th, outfit: t.outfit || null });
  }

  const capsule = [...chosen.values()];
  const washFirst = capsule.filter(i => i._washFirst);
  if (washFirst.length) {
    gaps.push(`In the wash right now — run laundry before packing: ${washFirst.map(i => i.name).join(', ')}.`);
  }
  if (Number.isFinite(itemCap) && capsule.length > itemCap) {
    gaps.push(`${capsule.length} garments won't fit the bag (~${itemCap}) — drop an occasion, plan a wash, or check a bag.`);
  }
  if (!effDays && days >= 8 && Number.isFinite(itemCap) && itemCap <= 14) {
    gaps.push(`${days} days in a carry-on with no laundry is tight — one mid-trip wash would halve what you need to pack.`);
  }
  if (coldest != null && coldest < 62 && !capsule.some(i => i.category === 'layer')) {
    gaps.push('Cold days in the forecast and no outer layer in the closet — one layer would cover the whole trip.');
  }
  if (rainDays.length && !capsule.some(i => i.category === 'shoes' && meta(i).l < 0.4)) {
    gaps.push(`Rain expected on ${rainDays.length} day(s) — a dark, weather-friendly shoe would help.`);
  }
  for (const t of uniqueTargets) {
    if (!outfitList.some(o => o.target === t)) {
      gaps.push(`Nothing in the closet reaches "${DRESS_LABELS[Math.round(t)]}" — that occasion is uncovered.`);
    }
  }

  // day-by-day: assign outfits round-robin by each occasion.
  // Entries past `days` are extras (dinners etc.) — labeled, not day-numbered.
  const plan = [];
  const used = {};
  occasions.forEach((occ, d) => {
    const options = outfitList.filter(o => o.target === occ.target);
    const pick = options.length ? options[(used[occ.target] = (used[occ.target] || 0) + 1) % options.length] : null;
    const extra = d >= days;
    plan.push({
      day: extra ? null : d + 1,
      occasion: extra ? `${occ.label}${occasions.filter((o, i) => i >= days && o.label === occ.label).length > 1 ? ` ${d - days + 1}` : ''}` : occ.label,
      outfit: pick,
      temp: extra ? null : (temps[d] ?? null),
      rain: extra ? false : rainDays.includes(d),
    });
  });
  for (const row of activityRows) plan.push({ day: null, occasion: row.label, outfit: row.outfit, temp: null, rain: false });
  for (const row of themeRows) plan.push({ day: null, occasion: `Theme: ${row.label}`, outfit: row.outfit, temp: null, rain: false });

  return { capsule, outfits: outfitList, plan, gaps };
}
