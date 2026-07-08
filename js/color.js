// Color engine: named fashion colors, image analysis, white-balance correction, background cut-out.

// tone: 'warm' | 'cool' | 'neutral'; neutral flag = plays with anything
export const NAMED_COLORS = [
  { name: 'White',      hex: '#FFFFFF', neutral: true,  tone: 'neutral' },
  { name: 'Ivory',      hex: '#F2EFE9', neutral: true,  tone: 'warm' },
  { name: 'Cream',      hex: '#EDE3CE', neutral: true,  tone: 'warm' },
  { name: 'Beige',      hex: '#D9C7A7', neutral: true,  tone: 'warm' },
  { name: 'Stone',      hex: '#C6BFB1', neutral: true,  tone: 'warm' },
  { name: 'Light grey', hex: '#C9CCD1', neutral: true,  tone: 'cool' },
  { name: 'Grey',       hex: '#8A8D93', neutral: true,  tone: 'cool' },
  { name: 'Charcoal',   hex: '#3A3D42', neutral: true,  tone: 'cool' },
  { name: 'Black',      hex: '#17181A', neutral: true,  tone: 'neutral' },
  { name: 'Navy',       hex: '#1F2A44', neutral: true,  tone: 'cool' },
  { name: 'Indigo',     hex: '#2E3A4E', neutral: true,  tone: 'cool' },
  { name: 'Denim',      hex: '#4A6A8F', neutral: true,  tone: 'cool' },
  { name: 'Camel',      hex: '#B3906A', neutral: true,  tone: 'warm' },
  { name: 'Tan',        hex: '#B98F5F', neutral: true,  tone: 'warm' },
  { name: 'Brown',      hex: '#6B4F3A', neutral: true,  tone: 'warm' },
  { name: 'Chocolate',  hex: '#4A3527', neutral: true,  tone: 'warm' },
  { name: 'Olive',      hex: '#6B6B3F', neutral: true,  tone: 'warm' },
  { name: 'Sage',       hex: '#A3AD93', neutral: false, tone: 'cool' },
  { name: 'Forest',     hex: '#2F4A38', neutral: false, tone: 'cool' },
  { name: 'Green',      hex: '#3E7C4F', neutral: false, tone: 'cool' },
  { name: 'Teal',       hex: '#2F6E6B', neutral: false, tone: 'cool' },
  { name: 'Sky blue',   hex: '#A6C3D9', neutral: false, tone: 'cool' },
  { name: 'Steel blue', hex: '#5E7189', neutral: false, tone: 'cool' },
  { name: 'Cobalt',     hex: '#2F5FA3', neutral: false, tone: 'cool' },
  { name: 'Lavender',   hex: '#A99AC9', neutral: false, tone: 'cool' },
  { name: 'Purple',     hex: '#5E4A7D', neutral: false, tone: 'cool' },
  { name: 'Burgundy',   hex: '#6E2B33', neutral: false, tone: 'warm' },
  { name: 'Red',        hex: '#B3372F', neutral: false, tone: 'warm' },
  { name: 'Rust',       hex: '#A65A3A', neutral: false, tone: 'warm' },
  { name: 'Orange',     hex: '#D07A3A', neutral: false, tone: 'warm' },
  { name: 'Mustard',    hex: '#C99A3C', neutral: false, tone: 'warm' },
  { name: 'Yellow',     hex: '#E3C13F', neutral: false, tone: 'warm' },
  { name: 'Blush',      hex: '#E8C9C9', neutral: false, tone: 'warm' },
  { name: 'Pink',       hex: '#D9A3B3', neutral: false, tone: 'warm' },
  { name: 'Hot pink',   hex: '#C94F7C', neutral: false, tone: 'warm' },
];

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s, l];
}

// Perceptually weighted RGB distance
export function colorDist(a, b) {
  const rmean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
}

export function nearestNamed(rgb, n = 3) {
  return NAMED_COLORS
    .map(c => ({ ...c, dist: colorDist(rgb, hexToRgb(c.hex)) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n);
}

export function metaForColorName(name) {
  return NAMED_COLORS.find(c => c.name === name) || NAMED_COLORS[0];
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

// Analyze an uploaded photo:
// 1. Estimate background from border pixels.
// 2. If background should be neutral (bright, low-sat), white-balance the whole image against it.
// 3. If background is uniform, flood-fill from the borders to cut the item out (transparent PNG).
// 4. Extract dominant item color(s) from the remaining pixels.
export async function analyzeImage(srcDataUrl) {
  const img = await loadImage(srcDataUrl);
  const MAX = 560;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  let data = ctx.getImageData(0, 0, w, h);
  let px = data.data;

  // --- border sample ---
  const border = [];
  const step = 3;
  for (let x = 0; x < w; x += step) { border.push(idx(x, 0), idx(x, h - 1)); }
  for (let y = 0; y < h; y += step) { border.push(idx(0, y), idx(w - 1, y)); }
  function idx(x, y) { return (y * w + x) * 4; }

  let br = 0, bg = 0, bb = 0;
  for (const i of border) { br += px[i]; bg += px[i + 1]; bb += px[i + 2]; }
  br /= border.length; bg /= border.length; bb /= border.length;
  const bgColor = [br, bg, bb];

  // border uniformity (mean distance from average)
  let spread = 0;
  for (const i of border) spread += colorDist([px[i], px[i + 1], px[i + 2]], bgColor);
  spread /= border.length;
  const uniformBg = spread < 90;

  // --- white balance against a bright, near-neutral background ---
  // Chroma (max-min spread), not HSL saturation: a warm-lit white wall reads as
  // HSL saturation ~1.0 even though it is visually near-white.
  const bgChroma = (Math.max(...bgColor) - Math.min(...bgColor)) / 255;
  const bgLum = (Math.max(...bgColor) + Math.min(...bgColor)) / 510;
  let corrected = false;
  if (uniformBg && bgLum > 0.62 && bgChroma < 0.24) {
    const target = Math.max(br, bg, bb);
    const gains = [target / (br || 1), target / (bg || 1), target / (bb || 1)].map(g => Math.max(0.8, Math.min(1.3, g)));
    if (gains.some(g => Math.abs(g - 1) > 0.02)) {
      corrected = true;
      for (let i = 0; i < px.length; i += 4) {
        px[i] = Math.min(255, px[i] * gains[0]);
        px[i + 1] = Math.min(255, px[i + 1] * gains[1]);
        px[i + 2] = Math.min(255, px[i + 2] * gains[2]);
      }
      bgColor[0] *= gains[0]; bgColor[1] *= gains[1]; bgColor[2] *= gains[2];
    }
  }

  // --- background removal by flood fill from borders ---
  // Two passes: if the loose tolerance eats the item (light item on light
  // background, e.g. ivory on white paper), retry with a tight tolerance.
  let cutout = false;
  let removed = new Uint8Array(w * h);
  if (uniformBg) {
    const flood = (TOL) => {
      const rem = new Uint8Array(w * h);
      const visited = new Uint8Array(w * h);
      const queue = [];
      for (let x = 0; x < w; x++) { queue.push(x, (h - 1) * w + x); }
      for (let y = 0; y < h; y++) { queue.push(y * w, y * w + w - 1); }
      while (queue.length) {
        const p = queue.pop();
        if (visited[p]) continue;
        visited[p] = 1;
        const i = p * 4;
        if (colorDist([px[i], px[i + 1], px[i + 2]], bgColor) > TOL) continue;
        rem[p] = 1;
        const x = p % w, y = (p / w) | 0;
        if (x > 0) queue.push(p - 1);
        if (x < w - 1) queue.push(p + 1);
        if (y > 0) queue.push(p - w);
        if (y < h - 1) queue.push(p + w);
      }
      let n = 0;
      for (let p = 0; p < rem.length; p++) n += rem[p];
      return { rem, frac: n / (w * h) };
    };
    let pass = flood(68);
    if (pass.frac >= 0.9) pass = flood(30);
    removed = pass.rem;
    const frac = pass.frac;
    if (frac > 0.15 && frac < 0.9) {
      cutout = true;
      for (let p = 0; p < removed.length; p++) if (removed[p]) px[p * 4 + 3] = 0;
      // feather: soften pixels adjacent to transparency
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          if (removed[p]) continue;
          if (removed[p - 1] || removed[p + 1] || removed[p - w] || removed[p + w]) px[p * 4 + 3] = 140;
        }
      }
    }
  }

  // --- dominant item colors (skip removed + near-bg pixels) ---
  const buckets = new Map();
  let counted = 0;
  const tally = (i) => {
    const c = [px[i], px[i + 1], px[i + 2]];
    const key = ((c[0] >> 5) << 10) | ((c[1] >> 5) << 5) | (c[2] >> 5);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += c[0]; b.g += c[1]; b.b += c[2];
    buckets.set(key, b);
    counted++;
  };
  for (let p = 0; p < w * h; p += 2) {
    if (removed[p]) continue;
    const i = p * 4;
    if (!cutout && colorDist([px[i], px[i + 1], px[i + 2]], bgColor) < 60) continue; // no cutout: skip background-ish pixels
    tally(i);
  }
  // Fallback: exclusions ate nearly everything (item ≈ background color).
  // Sample the center third — items are framed center, so it is item-dominated.
  if (counted < (w * h) * 0.02) {
    buckets.clear(); counted = 0;
    for (let y = (h / 3) | 0; y < (2 * h / 3) | 0; y++) {
      for (let x = (w / 3) | 0; x < (2 * w / 3) | 0; x++) {
        if (!removed[y * w + x]) tally((y * w + x) * 4);
      }
    }
  }
  const clusters = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 6)
    .map(b => ({ rgb: [b.r / b.n, b.g / b.n, b.b / b.n], n: b.n }));
  const total = clusters.reduce((s, c) => s + c.n, 0) || 1;
  // merge clusters that are visually the same color
  const merged = [];
  for (const c of clusters) {
    const twin = merged.find(m => colorDist(m.rgb, c.rgb) < 70);
    if (twin) { twin.n += c.n; } else merged.push({ ...c });
  }
  const domRgb = merged.length ? merged[0].rgb : [128, 128, 128];
  const secondary = merged[1] && merged[1].n / total > 0.22 ? merged[1].rgb : null;

  if (cutout || corrected) ctx.putImageData(data, 0, 0);

  return {
    dataUrl: canvas.toDataURL('image/png'),
    cutout,
    corrected,
    dominantHex: rgbToHex(domRgb),
    named: nearestNamed(domRgb, 3),
    secondaryNamed: secondary ? nearestNamed(secondary, 1) : null,
    bgUniform: uniformBg,
  };
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}
