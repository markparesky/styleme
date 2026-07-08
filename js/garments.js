// Garment silhouettes — used for demo items and any item without a photo
// (an item never renders as a gray circle: it gets its silhouette in its own color).

export const CATEGORIES = [
  { id: 'top',       label: 'Top' },
  { id: 'bottom',    label: 'Bottom' },
  { id: 'dress',     label: 'Dress' },
  { id: 'layer',     label: 'Outerwear / Layer' },
  { id: 'shoes',     label: 'Shoes' },
  { id: 'accessory', label: 'Accessory' },
];

const PATHS = {
  top: {
    body: 'M31 9 L43 4 L50 13 L57 4 L69 9 L88 23 L79 39 L71 32 L71 93 L29 93 L29 32 L21 39 L12 23 Z',
    detail: 'M50 16 V90 M43 4 L47 10 M57 4 L53 10',
  },
  tee: {
    body: 'M32 9 Q50 18 68 9 L88 21 L80 37 L71 31 L71 92 L29 92 L29 31 L20 37 L12 21 Z',
    detail: 'M32 9 Q50 18 68 9',
  },
  bottom: {
    body: 'M31 5 H69 L74 95 H55 L50 40 L45 95 H26 Z',
    detail: 'M31 14 H69',
  },
  dress: {
    body: 'M36 6 L44 3 L50 10 L56 3 L64 6 L74 20 L66 30 L64 44 L78 92 L22 92 L36 44 L34 30 L26 20 Z',
    detail: 'M36 44 L64 44',
  },
  layer: {
    body: 'M30 8 L44 4 L50 14 L56 4 L70 8 L89 24 L80 40 L72 33 L72 93 L54 93 L50 40 L46 93 L28 93 L28 33 L20 40 L11 24 Z',
    detail: 'M44 4 L46 93 M56 4 L54 93',
  },
  shoes: {
    body: 'M9 61 Q9 44 27 44 L53 44 Q73 46 90 59 Q94 62 93 68 L92 71 L9 71 Z',
    detail: 'M9 64 L93 64 M34 44 Q40 52 52 52',
  },
  accessory: {
    body: 'M50 14 A36 36 0 1 1 49.9 14 Z M50 26 A24 24 0 1 0 50.1 26 Z',
    detail: '',
  },
};

export function pathsFor(category, name = '') {
  if (category === 'top' && /tee|t-shirt|knit|polo/i.test(name)) return PATHS.tee;
  return PATHS[category] || PATHS.top;
}

export function silhouetteSvg(category, hex, name = '') {
  const p = pathsFor(category, name);
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${p.body}" fill="${hex}" fill-rule="evenodd"/>` +
    (p.detail ? `<path d="${p.detail}" fill="none" stroke="rgba(0,0,0,.16)" stroke-width="1.6"/>` : '') +
    `</svg>`;
}

// Transparent PNG data-URL of a silhouette (behaves exactly like a photo cut-out in flat-lays)
export function garmentDataUrl(category, hex, name = '', size = 400) {
  const p = pathsFor(category, name);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(size / 100, size / 100);
  const body = new Path2D(p.body);
  ctx.fillStyle = hex;
  ctx.fill(body, 'evenodd');
  if (p.detail) {
    ctx.strokeStyle = 'rgba(0,0,0,.16)';
    ctx.lineWidth = 1.6;
    ctx.stroke(new Path2D(p.detail));
  }
  return canvas.toDataURL('image/png');
}
