/* Panel model + SVG rendering.

   A panel is one square tile in a sequence or matrix:
   {
     divider:  true            — quadrant cross lines
     grid3:    true            — 3x3 cell lines
     shaded:   [0..3, ...]     — solid-filled quadrants (TL, TR, BR, BL)
     quadrants:[t, t, t, t]    — token per quadrant (or null)
     center:   t               — single centered token
     cells:    [t x 9]         — tokens on a 3x3 sub-grid (row-major)
   }

   A token:
   {
     kind:  'triangle'|'square'|'circle'|'pentagon'|'hexagon'|'diamond'|
            'star'|'cross'|'arrow'|'dots'
     fill:  'outline'|'solid'|<palette name>
     rot:   degrees
     count: dots only
     scale: size multiplier (default 1)
     inner: nested token drawn at 45% size inside this one
   }

   Colors are a colorblind-safe palette (Okabe–Ito). Generators must never
   encode a rule in hue alone — color rules always ride on ordered palettes
   with luminance contrast, or pair with a second attribute. */

export const COLORS = {
  blue:   '#0072B2',
  orange: '#E69F00',
  green:  '#009E73',
  yellow: '#F0E442',
  red:    '#D55E00',
  purple: '#CC79A7',
  sky:    '#56B4E9',
};

export const COLOR_NAMES = Object.keys(COLORS);

export const SHAPES = ['triangle', 'square', 'circle', 'pentagon', 'hexagon', 'diamond', 'star', 'cross'];

export function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function canonicalToken(t) {
  if (!t) return null;
  const out = { kind: t.kind };
  if (t.fill) out.fill = t.fill;
  if (t.rot) out.rot = ((t.rot % 360) + 360) % 360;
  if (t.count) out.count = t.count;
  if (t.scale && t.scale !== 1) out.scale = Math.round(t.scale * 100) / 100;
  if (t.inner) out.inner = canonicalToken(t.inner);
  return out;
}

export function canonicalPanel(p) {
  const out = {};
  if (p.divider) out.divider = true;
  if (p.grid3) out.grid3 = true;
  if (p.shaded && p.shaded.length) out.shaded = [...p.shaded].sort((a, b) => a - b);
  if (p.quadrants && p.quadrants.some(q => q)) out.quadrants = p.quadrants.map(canonicalToken);
  if (p.center) out.center = canonicalToken(p.center);
  if (p.cells && p.cells.some(c => c)) out.cells = p.cells.map(canonicalToken);
  return out;
}

export function panelEq(a, b) {
  return JSON.stringify(canonicalPanel(a)) === JSON.stringify(canonicalPanel(b));
}

function fillAttr(fill, invert) {
  if (!fill || fill === 'outline') return invert ? '#111' : 'white';
  if (fill === 'solid') return invert ? 'white' : '#111';
  return COLORS[fill] || fill; // palette name or raw value
}

function shapePoints(kind, cx, cy, r) {
  if (kind === 'triangle')
    return `${cx},${cy - r} ${cx - r},${cy + r * 0.85} ${cx + r},${cy + r * 0.85}`;
  if (kind === 'diamond')
    return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
  if (kind === 'pentagon' || kind === 'hexagon') {
    const n = kind === 'pentagon' ? 5 : 6;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const ang = (2 * Math.PI / n) * i - Math.PI / 2;
      pts.push(`${(cx + r * Math.cos(ang)).toFixed(2)},${(cy + r * Math.sin(ang)).toFixed(2)}`);
    }
    return pts.join(' ');
  }
  if (kind === 'star') {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const ang = (Math.PI / 5) * i - Math.PI / 2;
      pts.push(`${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`);
    }
    return pts.join(' ');
  }
  if (kind === 'arrow')
    return `${cx - r * 0.6},${cy - r * 0.7} ${cx + r * 0.7},${cy} ${cx - r * 0.6},${cy + r * 0.7}`;
  return '';
}

export function tokenSvg(token, cx, cy, size, invert = false) {
  if (!token) return '';
  const { kind, rot = 0, count, inner } = token;
  const stroke = invert ? 'white' : '#111';
  const sw = 2;
  const f = fillAttr(token.fill, invert);
  const r = (size / 2) * (token.scale || 1);
  const transform = rot ? `transform="rotate(${rot} ${cx} ${cy})"` : '';
  let svg = '';

  if (kind === 'circle') {
    svg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${f}" stroke="${stroke}" stroke-width="${sw}"/>`;
  } else if (kind === 'square') {
    svg = `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" fill="${f}" stroke="${stroke}" stroke-width="${sw}" ${transform}/>`;
  } else if (kind === 'cross') {
    const a = r * 0.36;
    const pts = [
      [cx - a, cy - r], [cx + a, cy - r], [cx + a, cy - a], [cx + r, cy - a],
      [cx + r, cy + a], [cx + a, cy + a], [cx + a, cy + r], [cx - a, cy + r],
      [cx - a, cy + a], [cx - r, cy + a], [cx - r, cy - a], [cx - a, cy - a],
    ].map(p => p.map(v => v.toFixed(2)).join(',')).join(' ');
    svg = `<polygon points="${pts}" fill="${f}" stroke="${stroke}" stroke-width="${sw}" ${transform}/>`;
  } else if (kind === 'dots') {
    const n = count || 1;
    const dotR = 4, spacing = 9;
    const start = cx - ((n - 1) * spacing) / 2;
    for (let i = 0; i < n; i++)
      svg += `<circle cx="${start + i * spacing}" cy="${cy}" r="${dotR}" fill="${invert ? 'white' : (token.fill && token.fill !== 'solid' && token.fill !== 'outline' ? fillAttr(token.fill, false) : '#111')}"/>`;
  } else {
    const pts = shapePoints(kind, cx, cy, r);
    if (!pts) return '';
    svg = `<polygon points="${pts}" fill="${f}" stroke="${stroke}" stroke-width="${sw}" ${transform}/>`;
  }

  if (inner) svg += tokenSvg(inner, cx, cy, size * 0.45, invert);
  return svg;
}

export function renderPanel(panel, size = 120) {
  const s = size;
  const half = s / 2;
  const inset = 6;
  const tokenSize = 28;
  const quadCenters = [
    [half / 2 + inset / 2, half / 2 + inset / 2],
    [half + half / 2 - inset / 2, half / 2 + inset / 2],
    [half + half / 2 - inset / 2, half + half / 2 - inset / 2],
    [half / 2 + inset / 2, half + half / 2 - inset / 2],
  ];
  // shaded[] uses quadrant rect order TL, TR, BR, BL (matches quadCenters)
  const quadRects = [[0, 0], [half, 0], [half, half], [0, half]];

  let bg = '';
  if (panel.shaded && panel.shaded.length) {
    for (const q of panel.shaded) {
      const [x, y] = quadRects[q];
      bg += `<rect x="${x}" y="${y}" width="${half}" height="${half}" fill="#111"/>`;
    }
  }

  let lines = '';
  if (panel.divider) {
    lines += `<line x1="${half}" y1="0" x2="${half}" y2="${s}" stroke="#111" stroke-width="1.5"/>` +
             `<line x1="0" y1="${half}" x2="${s}" y2="${half}" stroke="#111" stroke-width="1.5"/>`;
  }
  if (panel.grid3) {
    const t1 = s / 3, t2 = (s / 3) * 2;
    lines += `<line x1="${t1}" y1="0" x2="${t1}" y2="${s}" stroke="#bbb" stroke-width="1"/>` +
             `<line x1="${t2}" y1="0" x2="${t2}" y2="${s}" stroke="#bbb" stroke-width="1"/>` +
             `<line x1="0" y1="${t1}" x2="${s}" y2="${t1}" stroke="#bbb" stroke-width="1"/>` +
             `<line x1="0" y1="${t2}" x2="${s}" y2="${t2}" stroke="#bbb" stroke-width="1"/>`;
  }

  let content = '';
  if (panel.quadrants) {
    for (let i = 0; i < 4; i++) {
      const tok = panel.quadrants[i];
      if (!tok) continue;
      const [cx, cy] = quadCenters[i];
      const onShaded = panel.shaded && panel.shaded.includes(i);
      content += tokenSvg(tok, cx, cy, tokenSize, onShaded);
    }
  }
  if (panel.cells) {
    const step = s / 3;
    for (let i = 0; i < 9; i++) {
      const tok = panel.cells[i];
      if (!tok) continue;
      const cx = (i % 3) * step + step / 2;
      const cy = Math.floor(i / 3) * step + step / 2;
      content += tokenSvg(tok, cx, cy, 22);
    }
  }
  if (panel.center) content += tokenSvg(panel.center, half, half, 38);

  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" role="img" aria-hidden="true">${bg}${lines}${content}</svg>`;
}
