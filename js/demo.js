// Demo closet — 14 items so the stylist, packing and lookbook are try-able instantly.
import { garmentDataUrl } from './garments.js';
import { metaForColorName } from './color.js';
import { uid } from './db.js';

const DEFS = [
  ['Ivory poplin shirt',    'top',    'Ivory',      3],
  ['Black poplin shirt',    'top',    'Black',      3],
  ['Cream knit tee',        'top',    'Cream',      2],
  ['Steel blue tee',        'top',    'Steel blue', 2],
  ['Navy oxford shirt',     'top',    'Navy',       4],
  ['Burgundy knit polo',    'top',    'Burgundy',   3],
  ['Indigo jeans',          'bottom', 'Indigo',     2],
  ['Charcoal trousers',     'bottom', 'Charcoal',   4],
  ['Stone chinos',          'bottom', 'Stone',      3],
  ['Camel overshirt',       'layer',  'Camel',      3],
  ['Navy blazer',           'layer',  'Navy',       4],
  ['White leather sneakers','shoes',  'White',      2],
  ['Tan suede loafers',     'shoes',  'Tan',        3],
  ['Black derby shoes',     'shoes',  'Black',      4],
];

export function demoItems() {
  return DEFS.map(([name, category, colorName, dressiness]) => {
    const c = metaForColorName(colorName);
    return {
      id: uid(),
      name,
      category,
      colors: [{ name: c.name, hex: c.hex }],
      dressiness,
      img: garmentDataUrl(category, c.hex, name),
      imgKind: 'silhouette',
      laundry: false,
      wearCount: 0,
      lastWorn: null,
      createdAt: Date.now(),
      demo: true,
    };
  });
}
