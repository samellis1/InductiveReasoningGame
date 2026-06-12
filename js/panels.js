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

/* Rotational symmetry per shape, in degrees — rotations that are a multiple
   of this render pixel-identically, so canonical form folds them together.
   (A cross at 90° IS a cross at 0°; without this, distractor dedup can pass
   a "different" panel that draws exactly like the correct answer.)
   Triangle/arrow are asymmetric as drawn; dots render as a horizontal row. */
const ROT_SYMMETRY = {
  circle: 1, square: 90, diamond: 90, cross: 90,
  hexagon: 60, pentagon: 72, star: 72, dots: 180,
};

function canonicalToken(t) {
  if (!t) return null;
  const out = { kind: t.kind };
  if (t.fill) out.fill = t.fill;
  if (t.rot) {
    const sym = ROT_SYMMETRY[t.kind] || 360;
    const r = ((t.rot % sym) + sym) % sym;
    if (r) out.rot = r;
  }
  if (t.count) out.count = t.count;
  if (t.scale && t.scale !== 1) out.scale = Math.round(t.scale * 100) / 100;
  if (t.texture) out.texture = t.texture;
  if (t.inner) out.inner = canonicalToken(t.inner);
  return out;
}

/* A nested section is blank unless it has a color or texture. */
function canonicalSection(sec) {
  if (!sec || (!sec.color && !sec.texture)) return null;
  const out = {};
  if (sec.color) out.color = sec.color;
  if (sec.texture) out.texture = sec.texture;
  return out;
}

export function canonicalPanel(p) {
  const out = {};
  if (p.divider) out.divider = true;
  if (p.grid3) out.grid3 = true;
  if (p.text != null && p.text !== '') {
    // Numeric text compares by value ('081' === '81'); non-numeric verbatim.
    const n = Number(p.text);
    out.text = Number.isFinite(n) ? String(n) : String(p.text);
  }
  if (p.week) out.week = p.week.days.map(d => d || null);
  if (p.month) out.month = { days: p.month.days, marks: [...(p.month.marks || [])].sort((a, b) => a - b) };
  if (p.bars) out.bars = p.bars.slice();
  if (p.shaded && p.shaded.length) out.shaded = [...p.shaded].sort((a, b) => a - b);
  if (p.quadrants && p.quadrants.some(q => q)) out.quadrants = p.quadrants.map(canonicalToken);
  if (p.center) out.center = canonicalToken(p.center);
  if (p.cells && p.cells.some(c => c)) out.cells = p.cells.map(canonicalToken);
  if (p.nested) out.nested = {
    shape: p.nested.shape || 'square',
    outer: p.nested.outer.map(canonicalSection),
    inner: p.nested.inner.map(canonicalSection),
  };
  return out;
}

export function panelEq(a, b) {
  return JSON.stringify(canonicalPanel(a)) === JSON.stringify(canonicalPanel(b));
}

/* Section textures for the nested-squares puzzle. A section is a solid color
   and/or one of these textures, or blank. */
export const TEXTURES = ['stripes', 'dots', 'crosshatch', 'checker'];

/* Pattern element ids must be unique per inline <svg> — duplicate ids across
   inline SVGs make url(#id) resolve to the wrong (first) pattern in document
   order. Every renderPanel call salts its ids with a fresh prefix. */
let _patternUid = 0;

function texturePattern(id, texture, color) {
  const base = color ? (COLORS[color] || color) : 'white';
  const ink = '#111';
  if (texture === 'stripes') {
    return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="8" height="8">`
      + `<rect width="8" height="8" fill="${base}"/>`
      + `<path d="M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6" stroke="${ink}" stroke-width="1.5"/></pattern>`;
  }
  if (texture === 'dots') {
    return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="8" height="8">`
      + `<rect width="8" height="8" fill="${base}"/>`
      + `<circle cx="4" cy="4" r="1.6" fill="${ink}"/></pattern>`;
  }
  if (texture === 'crosshatch') {
    return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="8" height="8">`
      + `<rect width="8" height="8" fill="${base}"/>`
      + `<path d="M0,0 L0,8 M0,0 L8,0" stroke="${ink}" stroke-width="1"/></pattern>`;
  }
  // checker
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="10" height="10">`
    + `<rect width="10" height="10" fill="${base}"/>`
    + `<rect width="5" height="5" fill="${ink}"/><rect x="5" y="5" width="5" height="5" fill="${ink}"/></pattern>`;
}

/* A standalone swatch for builder palettes: a square filled with a color, a
   texture, or a textured color. Used for the color/texture picker buttons. */
export function textureSwatchSvg(texture, color, size = 30) {
  const id = 'sw' + (_patternUid++);
  const def = texture ? texturePattern(id, texture, color) : '';
  const fill = texture ? `url(#${id})` : (color ? (COLORS[color] || color) : 'white');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">`
    + `${def ? `<defs>${def}</defs>` : ''}`
    + `<rect x="1" y="1" width="${size - 2}" height="${size - 2}" fill="${fill}" stroke="#111" stroke-width="1"/></svg>`;
}

/* Section geometry for nested panels. A nested panel is an outer shape split
   into sections with a smaller copy of the same shape (also split) centered
   inside. Squares/circles have 4 sections (TL,TR,BR,BL — clockwise, matching
   quadrant rotation semantics); triangles have 3 (top, bottom-right,
   bottom-left). Returns [{ group: 'outer'|'inner', i, d }] — exported so the
   builder can lay the same paths over the preview as tap targets. */
export function nestedSectionPaths(shape, size) {
  const c = size / 2;
  const paths = [];

  if (shape === 'circle') {
    const sectors = (R, group) => {
      // Quarter-disc sectors, clockwise from top-left.
      const pts = [[c - R, c], [c, c - R], [c + R, c], [c, c + R]]; // W,N,E,S
      const order = [[0, 1], [1, 2], [2, 3], [3, 0]]; // TL,TR,BR,BL
      order.forEach(([a, b], i) => {
        paths.push({
          group, i,
          d: `M ${c} ${c} L ${pts[a][0]} ${pts[a][1]} A ${R} ${R} 0 0 1 ${pts[b][0]} ${pts[b][1]} Z`,
        });
      });
    };
    sectors(c - 2, 'outer');
    sectors((c - 2) * 0.52, 'inner');
    return paths;
  }

  if (shape === 'triangle') {
    const tri = (R, group) => {
      // Vertices at -90°, 30°, 150°; sections fan out from the centroid.
      const v = [-90, 30, 150].map(deg => {
        const a = (deg * Math.PI) / 180;
        return [c + R * Math.cos(a), c + R * Math.sin(a)];
      });
      for (let i = 0; i < 3; i++) {
        const a = v[i], b = v[(i + 1) % 3];
        paths.push({
          group, i,
          d: `M ${c} ${c} L ${a[0].toFixed(2)} ${a[1].toFixed(2)} L ${b[0].toFixed(2)} ${b[1].toFixed(2)} Z`,
        });
      }
    };
    tri(c - 2, 'outer');
    tri((c - 2) * 0.48, 'inner');
    return paths;
  }

  // square (default)
  const quads = (ox, oy, sq, group) => {
    const hw = sq / 2;
    const rects = [[ox, oy], [ox + hw, oy], [ox + hw, oy + hw], [ox, oy + hw]];
    rects.forEach(([x, y], i) => {
      paths.push({ group, i, d: `M ${x} ${y} h ${hw} v ${hw} h ${-hw} Z` });
    });
  };
  quads(0, 0, size, 'outer');
  const innerSize = size * 0.52;
  const io = (size - innerSize) / 2;
  quads(io, io, innerSize, 'inner');
  return paths;
}

/* One nested section ({color, texture} | null) → { fill, def }. The def (if any)
   is an SVG <pattern> the caller must place in the panel's <defs>. */
function sectionFill(section, idPrefix, tag) {
  if (!section || (!section.color && !section.texture)) return { fill: 'white', def: '' };
  if (!section.texture) {
    return { fill: COLORS[section.color] || section.color, def: '' };
  }
  const id = `${idPrefix}${tag}`;
  return { fill: `url(#${id})`, def: texturePattern(id, section.texture, section.color) };
}

function fillAttr(fill, invert) {
  if (!fill || fill === 'outline') return invert ? '#111' : 'white';
  if (fill === 'solid') return invert ? 'white' : '#111';
  return COLORS[fill] || fill; // palette name or raw value
}

function starPts(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`);
  }
  return pts.join(' ');
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

  const pid = 'pat' + (_patternUid++) + '_';
  let defs = '';
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
  if (panel.text != null && panel.text !== '') {
    const str = String(panel.text);
    const fs = str.length <= 3 ? 44 : str.length <= 5 ? 32 : 24;
    content += `<text x="${half}" y="${half}" text-anchor="middle" dominant-baseline="central"
      font-size="${fs}" font-weight="600" fill="#111" font-family="inherit">${str}</text>`;
  }
  if (panel.week) {
    // One week as 7 cells with day initials; a cell can hold a mark (solid
    // dot), a star, or a diamond. Wide panel: callers render it at full width.
    const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const cw = s / 7;
    for (let i = 0; i < 7; i++) {
      const x = i * cw;
      content += `<rect x="${x.toFixed(2)}" y="0" width="${cw.toFixed(2)}" height="${s / 7 * 2}" fill="white" stroke="#bbb" stroke-width="1"/>`
        + `<text x="${(x + cw / 2).toFixed(2)}" y="${s / 7 * 0.55}" text-anchor="middle" font-size="${cw * 0.38}" fill="#888" font-family="inherit">${labels[i]}</text>`;
      const d = panel.week.days[i];
      const cy = s / 7 * 1.35, r = cw * 0.26;
      const cx = x + cw / 2;
      if (d === 'mark') content += `<circle cx="${cx.toFixed(2)}" cy="${cy}" r="${r.toFixed(2)}" fill="${COLORS.green}" stroke="#111" stroke-width="1"/>`;
      else if (d === 'star') content += `<polygon points="${starPts(cx, cy, r * 1.25)}" fill="${COLORS.orange}" stroke="#111" stroke-width="1"/>`;
      else if (d === 'diamond') content += `<polygon points="${cx},${(cy - r * 1.2).toFixed(2)} ${(cx + r * 1.2).toFixed(2)},${cy} ${cx},${(cy + r * 1.2).toFixed(2)} ${(cx - r * 1.2).toFixed(2)},${cy}" fill="${COLORS.blue}" stroke="#111" stroke-width="1"/>`;
    }
  }
  if (panel.month) {
    // Month calendar (reveal rendering): 7 columns, day numbers, marked days
    // filled green. Day 1 is a Monday.
    const cols = 7;
    const rows = Math.ceil(panel.month.days / cols);
    const cw = s / cols;
    const ch = cw * 0.9;
    const markSet = new Set(panel.month.marks || []);
    for (let d = 1; d <= panel.month.days; d++) {
      const r = Math.floor((d - 1) / cols), c = (d - 1) % cols;
      const x = c * cw, y = r * ch;
      const marked = markSet.has(d);
      content += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}"
        fill="${marked ? COLORS.green : 'white'}" stroke="#bbb" stroke-width="1"/>`
        + `<text x="${(x + cw / 2).toFixed(2)}" y="${(y + ch / 2).toFixed(2)}" text-anchor="middle" dominant-baseline="central"
        font-size="${(cw * 0.34).toFixed(1)}" fill="${marked ? '#fff' : '#555'}" font-family="inherit">${d}</text>`;
    }
    return `<svg width="${s}" height="${(rows * ch).toFixed(2)}" viewBox="0 0 ${s} ${(rows * ch).toFixed(2)}" role="img" aria-hidden="true">${content}</svg>`;
  }
  if (panel.bars) {
    // Bar pair/triple (reveal rendering): heights proportional, values on top.
    const n = panel.bars.length;
    const maxV = Math.max(...panel.bars, 1);
    const bw = Math.min(56, (s - 40) / n - 16);
    const h = s * 0.66;
    const baseY = h + 24;
    panel.bars.forEach((v, i) => {
      const x = (s / (n + 1)) * (i + 1) - bw / 2;
      const bh = (v / maxV) * h;
      content += `<rect x="${x.toFixed(2)}" y="${(baseY - bh).toFixed(2)}" width="${bw}" height="${bh.toFixed(2)}" fill="${COLORS.green}" stroke="#111" stroke-width="1"/>`
        + `<text x="${(x + bw / 2).toFixed(2)}" y="${(baseY - bh - 8).toFixed(2)}" text-anchor="middle" font-size="14" font-weight="600" fill="#111" font-family="inherit">${v}</text>`
        + `<text x="${(x + bw / 2).toFixed(2)}" y="${baseY + 14}" text-anchor="middle" font-size="12" fill="#555" font-family="inherit">${String.fromCharCode(65 + i)}</text>`;
    });
    const totalH = baseY + 20;
    return `<svg width="${s}" height="${totalH}" viewBox="0 0 ${s} ${totalH}" role="img" aria-hidden="true">${content}</svg>`;
  }
  if (panel.nested) {
    const shape = panel.nested.shape || 'square';
    // Single-layer panels (empty inner) draw no inner sections at all.
    const hasInner = (panel.nested.inner || []).length > 0;
    const sections = nestedSectionPaths(shape, s).filter(sec => hasInner || sec.group !== 'inner');
    let innerOutline = '';
    for (const sec of sections) {
      const state = (panel.nested[sec.group] || [])[sec.i];
      const { fill, def } = sectionFill(state, pid, sec.group[0] + sec.i);
      if (def) defs += def;
      content += `<path d="${sec.d}" fill="${fill}" stroke="#111" stroke-width="1"/>`;
      if (sec.group === 'inner') innerOutline += `<path d="${sec.d}" fill="none" stroke="#111" stroke-width="1.6"/>`;
    }
    content += innerOutline; // heavier inner border drawn on top so it reads as its own shape
  }

  // Week panels are wide (7 cells), not square.
  const h = panel.week ? (s / 7) * 2 : s;
  return `<svg width="${s}" height="${h}" viewBox="0 0 ${s} ${h}" role="img" aria-hidden="true">${defs ? `<defs>${defs}</defs>` : ''}${bg}${lines}${content}</svg>`;
}
