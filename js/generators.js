/* Procedural question generators (construct-the-answer edition).

   The player no longer picks from multiple choices — they BUILD the answer
   panel, which game.js grades against `next` via panelEq(). So every generator
   returns:

     { type: 'sequence'|'matrix', frames, next, rule, answerSpec }

   `answerSpec` tells builder.js what to render and which constrained palettes to
   offer (so grading is fair, not a needle-in-a-haystack). Kinds:

     center        { shapes, fills, sizes? }                  one centered shape
     centerNested  { shapes, fills }                          outer + inner shape
     dots          { dotToken, grid3, cellPositions }          dot patterns
     nested        { colors, textures }                       nested-squares puzzle

   Difficulty scales by stacking simultaneous rules and lowering rule salience.
   Every generator takes (R, level) where R = rngHelpers(random) so the daily
   challenge can run on a shared seed. */

import { SHAPES, COLOR_NAMES, TEXTURES } from './panels.js';

const SEQ_LEN = 4; // frames shown before the "?"

/* Quadrant indices run clockwise TL→TR→BR→BL, so +1 is one clockwise step. */
const cwq = (i, k) => (((i + k) % 4) + 4) % 4;
/* 3x3 border cells in clockwise order. */
const BORDER8 = [0, 1, 2, 5, 8, 7, 6, 3];
/* Fill order for counting patterns — border first, centre last (9 slots). */
const FILL9 = [0, 1, 2, 5, 8, 7, 6, 3, 4];

/* Ordered color triples with strong luminance spread (colorblind-safe). */
const COLOR_CYCLES = [
  ['yellow', 'orange', 'blue'],
  ['sky', 'red', 'green'],
  ['yellow', 'green', 'purple'],
];

const flip = f => (f === 'solid' ? 'outline' : 'solid');
const uniq = arr => [...new Set(arr)];

function rotateQuadrants(quads, k) {
  const out = [null, null, null, null];
  for (let i = 0; i < 4; i++) out[cwq(i, k)] = quads[i];
  return out;
}

/* A few decoy shapes added to a palette alongside the shape(s) actually in play. */
function shapePalette(R, inPlay, extra = 2) {
  const others = R.sample(SHAPES.filter(k => !inPlay.includes(k)), extra);
  return R.shuffle(uniq([...inPlay, ...others]));
}

/* ============================================================
   Sequence generators
   ============================================================ */

/* ---------- Dot puzzles: randomized sub-modes so no two feel alike ----------
   Every mode emits explicit cell sets per panel; the answer is clicked
   straight into the inline 3x3 grid. */

/* 3x3 index transforms — used to randomize any traversal order's
   orientation, so the same logical rule reads differently every time. */
const rot90 = p => {
  const r = Math.floor(p / 3), c = p % 3;
  return c * 3 + (2 - r);
};
const flipH = p => {
  const r = Math.floor(p / 3), c = p % 3;
  return r * 3 + (2 - c);
};
function randomOrientation(R, order) {
  let out = order.slice();
  const turns = R.int(4);
  for (let t = 0; t < turns; t++) out = out.map(rot90);
  if (R.chance(0.5)) out = out.map(flipH);
  return out;
}

const SCAN_ORDERS = [
  { name: 'spiral', order: [0, 1, 2, 5, 8, 7, 6, 3, 4], desc: 'spiralling in toward the centre' },
  { name: 'columns', order: [0, 3, 6, 1, 4, 7, 2, 5, 8], desc: 'column by column' },
  { name: 'diagonals', order: [0, 1, 3, 2, 4, 6, 5, 7, 8], desc: 'diagonal by diagonal' },
  { name: 'snake', order: [0, 1, 2, 5, 4, 3, 6, 7, 8], desc: 'snaking through the rows' },
];

function genDots(R, level) {
  const color = level >= 3 ? R.pick(['blue', 'red', 'green']) : 'solid';
  const dotToken = { kind: 'circle', fill: color, scale: 0.8 };
  const mode = R.pick(['scan', 'march', 'mirror', 'blink']);
  let cellsAt, rule;

  if (mode === 'scan') {
    // Dots accumulate along a hidden traversal order, in a random orientation.
    const scan = R.pick(SCAN_ORDERS);
    const order = randomOrientation(R, scan.order);
    const step = level >= 2 ? R.pick([1, 2]) : 1;
    const start = 1 + R.int(Math.max(1, 9 - step * SEQ_LEN));
    cellsAt = i => order.slice(0, Math.min(9, start + step * i));
    rule = `${step === 1 ? 'One dot is' : 'Two dots are'} added each panel, filling the grid ${scan.desc}.`;
  } else if (mode === 'march') {
    // A cluster slides one cell per panel (wrapping), leaving a trail dot at
    // each spot its anchor visited. The trail keeps the answer from ever
    // matching an earlier panel (a pure wrap-slide repeats every 3 panels).
    const shapes = [[0, 1, 3], [0, 1, 4], [1, 3, 4]];
    const base = randomOrientation(R, R.pick(shapes));
    const [dr, dc] = R.pick([[0, 1], [1, 0], [1, 1]]);
    const shift = (p, i) => {
      const r = (Math.floor(p / 3) + dr * i) % 3;
      const c = (p % 3 + dc * i) % 3;
      return r * 3 + c;
    };
    cellsAt = i => {
      const cluster = base.map(p => shift(p, i));
      const trail = [];
      for (let k = 0; k < i; k++) trail.push(shift(base[0], k));
      return [...new Set([...cluster, ...trail])];
    };
    rule = `The dot cluster slides ${dr && dc ? 'diagonally' : dr ? 'down' : 'right'} one cell each panel (wrapping around), and leaves one trail dot behind at each stop.`;
  } else if (mode === 'mirror') {
    // Dots grow in mirrored pairs around the centre column.
    const additions = R.shuffle([[0, 2], [3, 5], [6, 8], [1], [7]]);
    const base = [4];
    cellsAt = i => base.concat(additions.slice(0, i + 1).flat());
    rule = 'Each panel adds dots symmetrically around the centre column — the grid stays mirrored.';
  } else {
    // Two clusters take turns growing. One shared orientation keeps the two
    // groups on opposite sides (independent transforms could collide them).
    const turns = R.int(4), flip = R.chance(0.5);
    const orient = p => {
      let q = p;
      for (let t = 0; t < turns; t++) q = rot90(q);
      return flip ? flipH(q) : q;
    };
    const left = [0, 3, 6, 1].map(orient);
    const right = [2, 5, 8, 7].map(orient);
    const countsA = [1, 2, 2, 3, 3];
    const countsB = [1, 1, 2, 2, 3];
    cellsAt = i => left.slice(0, countsA[i]).concat(right.slice(0, countsB[i]));
    rule = 'Two clusters take turns: one grows on the odd panels, the other on the even panels.';
  }

  const panelAt = i => {
    const cells = Array(9).fill(null);
    for (const p of cellsAt(i)) cells[p] = { ...dotToken };
    return { grid3: true, cells };
  };
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule,
    answerSpec: { kind: 'dots', dotToken, grid3: true, cellPositions: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  };
}

/* Fill cycles through three colors; harder levels alternate the shape too.
   (Size rules were removed — relative size is unjudgeable in a blank slot.) */
function genColorCycle(R, level) {
  const cycle = R.pick(COLOR_CYCLES);
  const kinds = level >= 3 ? R.sample(SHAPES, 2) : [R.pick(SHAPES)];
  const phase = R.int(3);
  const panelAt = i => ({
    center: {
      kind: kinds[i % kinds.length],
      fill: cycle[(phase + i) % 3],
    },
  });
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: `The color repeats every three panels (${cycle.join(' → ')})`
      + (kinds.length > 1 ? ', while the shape alternates' : '') + '.',
    answerSpec: { kind: 'center', shapes: shapePalette(R, kinds), fills: cycle.slice() },
  };
}

/* Polygon morphs through the side-count ladder. */
function genPolygonMorph(R, level) {
  const ladder = ['triangle', 'square', 'pentagon', 'hexagon'];
  const startIdx = R.int(2);
  const dir = R.chance(0.5) ? 1 : -1;
  const panelAt = i => {
    const idx = (((startIdx + dir * i) % ladder.length) + ladder.length) % ladder.length;
    return { center: { kind: ladder[idx], fill: 'solid' } };
  };
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: `The shape cycles ${dir === 1 ? 'up' : 'down'} the ladder triangle → square → pentagon → hexagon.`,
    answerSpec: { kind: 'center', shapes: ladder.slice(), fills: ['solid', 'outline'], sizes: null },
  };
}

/* Nesting conveyor: outer shape leaves, inner is promoted, a new shape enters. */
function genNesting(R, level) {
  // 5-shape cycle so the answer panel isn't an exact copy of frame 1.
  const cycle = R.shuffle(SHAPES).slice(0, 5);
  const fills = level >= 3 ? ['outline', R.pick(['blue', 'orange', 'green'])] : ['outline', 'outline'];
  const shapeAt = i => cycle[((i % cycle.length) + cycle.length) % cycle.length];
  const panelAt = i => ({
    center: {
      kind: shapeAt(i), fill: fills[0],
      inner: { kind: shapeAt(i + 1), fill: fills[1] },
    },
  });
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: 'Each panel, the outer shape leaves, the inner shape grows to take its place, and the next shape in the cycle appears inside.',
    answerSpec: { kind: 'centerNested', shapes: cycle.slice(), fills: uniq(['outline', 'solid', fills[1]]) },
  };
}

/* Layered alternation: fill flips every panel, shape every two. */
function genAlternation(R, level) {
  const kinds = R.sample(SHAPES, level >= 2 ? 2 : 1);
  const startFill = R.chance(0.5) ? 'solid' : 'outline';
  const shapePeriod = level >= 3 ? 2 : 1; // shape changes every `period` panels
  const panelAt = i => ({
    center: {
      kind: kinds.length > 1 ? kinds[Math.floor(i / shapePeriod) % 2] : kinds[0],
      fill: i % 2 === 0 ? startFill : flip(startFill),
    },
  });
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: kinds.length > 1
      ? `The fill flips every panel, while the shape changes every ${shapePeriod === 2 ? 'two panels' : 'panel'} — two cycles running at once.`
      : 'The fill alternates between solid and outline.',
    answerSpec: { kind: 'center', shapes: shapePalette(R, kinds), fills: ['solid', 'outline'], sizes: null },
  };
}

/* Nested shapes: an outer shape split into sections with a smaller copy
   inside, also split. Outer follows one rule across the row, inner another —
   both only inferable from multiple frames. The answer arrangement is never
   shown, so it can't be pattern-matched.

   The builder is tap-to-cycle: tapping a section steps through the exact
   combined color+texture states this puzzle uses (answerSpec.states).

   Variants by tier:
   - square (easy):    outer colors rotate · inner fills one more section per step
   - circle (medium):  outer colors rotate one way · inner colors rotate the other
   - triangle (hard):  outer rotates AND its texture alternates per step ·
                       inner counter-rotates */
/* Every nested variant runs on a shared FIVE-state cycle (the owner's "5
   pattern texture examples"): each section steps through the same 5 fills,
   offset from its neighbours. A 5-cycle over 4 shown panels + 1 answer means
   the answer can never repeat a shown frame (period 5 > 4) — the old pure
   rotations had period n=3/4 and provably repeated frame 1 or 2.

   NOTE: the deeper pattern-logic redesign is awaiting the owner's reference
   picture; this is the approved interim. */
function genNestedShape(R, level, shape) {
  const n = shape === 'triangle' ? 3 : 4;
  // Hard variants and all triangles are single-layer (no inner shape — owner).
  const single = shape === 'triangle' || level >= 3;
  const dir = R.chance(0.5) ? 1 : -1;
  const at = (cycle, k) => cycle[(((k % 5) + 5) % 5)];
  const dirWord = dir === 1 ? 'forward' : 'backward';

  let frameAt, rule, states;

  if (level <= 1) {
    // Easy (square): outer sections walk a 5-cycle of 4 colours + a gap (the
    // blank slides around the ring); inner fills one more section per panel.
    const colors = R.sample(COLOR_NAMES, 4);
    const cycle = [...colors.map(c => ({ color: c })), null];
    const innerState = { color: R.pick(COLOR_NAMES.filter(c => !colors.includes(c))), texture: R.pick(TEXTURES) };
    frameAt = s => {
      const inner = Array(n).fill(null);
      for (let k = 0; k < Math.min(n, s); k++) inner[k] = { ...innerState };
      return {
        nested: {
          shape,
          outer: Array(n).fill(null).map((_, j) => { const v = at(cycle, dir * s + j); return v ? { ...v } : null; }),
          inner,
        },
      };
    };
    rule = 'Outer ring: the four colours and one gap slide one step around a five-fill cycle each panel. '
      + 'Inner shape: one more section fills in each panel.';
    states = [...colors.map(c => ({ color: c })), innerState];
  } else if (level === 2) {
    // Medium (circle): outer walks a 5-cycle of 3 colours + 2 gaps; the inner
    // sections walk a different 5-cycle (2 textured fills + 3 gaps) the
    // opposite way.
    const colors = R.sample(COLOR_NAMES, 3);
    const tex = R.pick(TEXTURES);
    const texColors = R.sample(COLOR_NAMES.filter(c => !colors.includes(c)), 2);
    const outerCycle = [...colors.map(c => ({ color: c })), null, null];
    const innerCycle = [...texColors.map(c => ({ color: c, texture: tex })), null, null, null];
    frameAt = s => ({
      nested: {
        shape,
        outer: Array(n).fill(null).map((_, j) => { const v = at(outerCycle, dir * s + j); return v ? { ...v } : null; }),
        inner: Array(n).fill(null).map((_, j) => { const v = at(innerCycle, -dir * s + j); return v ? { ...v } : null; }),
      },
    });
    rule = `Outer ring: three colours and two gaps slide ${dirWord} through a five-fill cycle each panel. `
      + 'Inner ring: two patterned fills slide through their own five-cycle the opposite way.';
    states = [...colors.map(c => ({ color: c })), ...texColors.map(c => ({ color: c, texture: tex }))];
  } else {
    // Hard (triangle, single layer): all five fills are distinct colour+texture
    // combos; each of the three sections steps through the same 5-cycle but
    // sits TWO steps from its neighbour, so the motion is hard to eyeball.
    const colors = R.sample(COLOR_NAMES, 5);
    const texs = [null, ...R.sample(TEXTURES, 4)];
    const cycle = colors.map((c, i) => (texs[i] ? { color: c, texture: texs[i] } : { color: c }));
    frameAt = s => ({
      nested: {
        shape,
        outer: Array(n).fill(null).map((_, j) => ({ ...at(cycle, dir * s + 2 * j) })),
        inner: [],
      },
    });
    rule = 'All three sections step through the same five-fill cycle each panel — but each section sits two steps ahead of its neighbour.';
    states = cycle.map(v => ({ ...v }));
  }

  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(frameAt(i));
  return {
    type: 'sequence', frames, next: frameAt(SEQ_LEN),
    rule,
    instruction: single
      ? 'The five fills below cycle through the sections. Drag (or tap-then-tap) a fill onto each section.'
      : 'Outer and inner follow separate patterns built from the five fills below. Drag a fill onto each section.',
    answerSpec: { kind: 'nested', shape, n, single, states },
  };
}

const genNestedSquare = (R, level) => genNestedShape(R, 1, 'square');
const genNestedCircle = (R, level) => genNestedShape(R, 2, 'circle');
const genNestedTriangle = (R, level) => genNestedShape(R, 3, 'triangle');

/* ============================================================
   Matrix (3x3) generators — Raven's style. The answer is the empty cell.
   ============================================================ */

function matrixFrames(cellAt) {
  const frames = [];
  for (let i = 0; i < 8; i++) frames.push(cellAt(Math.floor(i / 3), i % 3));
  return { frames, next: cellAt(2, 2) };
}

/* Distribution of three: each row/column holds each value exactly once. */
function genMatrixLatin(R, level) {
  const shapes = R.sample(SHAPES, 3);
  const fills = R.chance(0.5)
    ? ['outline', 'solid', R.pick(['blue', 'orange', 'green', 'purple'])]
    : R.pick(COLOR_CYCLES).slice();
  const shapeLatin = level >= 2; // easy: shape constant per row; medium+: shapes Latin too
  const sizeLatin = level >= 4;
  const sizes = [0.65, 0.95, 1.25];
  const pairA = R.pick([[1, 1], [2, 2]]);
  const pairB = R.pick([[1, 2], [2, 1]]);
  const [shapeCoef, fillCoef] = R.chance(0.5) ? [pairA, pairB] : [pairB, pairA];
  const sizeCoef = [3 - shapeCoef[0], 3 - shapeCoef[1]];
  const idx = (k, r, c) => (k[0] * r + k[1] * c) % 3;
  const cellAt = (r, c) => ({
    center: {
      kind: shapeLatin ? shapes[idx(shapeCoef, r, c)] : shapes[r],
      fill: fills[idx(fillCoef, r, c)],
      scale: sizeLatin ? sizes[idx(sizeCoef, r, c)] : 1,
    },
  });
  const { frames, next } = matrixFrames(cellAt);
  return {
    type: 'matrix', frames, next,
    rule: shapeLatin
      ? 'Every row and column contains each shape and each fill exactly once (a Latin square on both).'
      : 'Each row keeps one shape; each fill appears exactly once per row and column.',
    answerSpec: { kind: 'center', shapes: shapes.slice(), fills: fills.slice(), sizes: sizeLatin ? sizes.slice() : null },
  };
}

/* Quantitative pairwise progression: dot count climbs across each row. */
function genMatrixRowCount(R, level) {
  const base = 1 + R.int(2);
  const d1 = 1 + R.int(2);
  const rowStart = [base, base + d1, base + d1 + 1 + R.int(2)];
  const color = level >= 3 ? R.pick(['blue', 'green', 'red']) : 'solid';
  const dotToken = { kind: 'circle', fill: color, scale: 0.8 };
  // Randomized ring orientation: the fill can start at any corner and run
  // either way, so the board reads differently each time.
  const ring = randomOrientation(R, BORDER8);
  const cellAt = (r, c) => {
    const n = rowStart[r] + c;
    const cells = Array(9).fill(null);
    for (let k = 0; k < n && k < 8; k++) cells[ring[k]] = { ...dotToken };
    return { cells };
  };
  const { frames, next } = matrixFrames(cellAt);
  return {
    type: 'matrix', frames, next,
    rule: 'In every row the dot count rises by one from left to right; dots fill around the ring in the same order every cell.',
    answerSpec: { kind: 'dots', dotToken, grid3: false, cellPositions: BORDER8.slice() },
  };
}

/* Boolean overlay: third column = col1 OR col2 (hard) or XOR (expert-tier rule). */
function genMatrixOverlay(R, level) {
  const xor = level >= 4;
  const positions = [0, 1, 2, 3, 5, 6, 7, 8]; // 3x3 minus centre
  const orSet = (a, b) => new Set([...a, ...b]);
  const xorSet = (a, b) => {
    const out = new Set();
    for (const x of a) if (!b.has(x)) out.add(x);
    for (const x of b) if (!a.has(x)) out.add(x);
    return out;
  };
  const rows = [];
  for (let r = 0; r < 3; r++) {
    let a, b;
    for (let tries = 0; tries < 60; tries++) {
      a = new Set(R.sample(positions, 3 + R.int(2)));
      b = new Set(R.sample(positions, 3 + R.int(2)));
      const inter = [...a].filter(x => b.has(x)).length;
      if (inter >= 1 && a.size - inter >= 1 && b.size - inter >= 1) break;
    }
    rows.push([a, b]);
  }
  const combine = xor ? xorSet : orSet;
  const dotToken = { kind: 'circle', fill: 'solid', scale: 0.85 };
  const setToPanel = s => {
    const cells = Array(9).fill(null);
    for (const p of s) cells[p] = { ...dotToken };
    return { grid3: true, cells };
  };
  const cellAt = (r, c) => setToPanel(c === 0 ? rows[r][0] : c === 1 ? rows[r][1] : combine(rows[r][0], rows[r][1]));
  const { frames, next } = matrixFrames(cellAt);
  return {
    type: 'matrix', frames, next,
    rule: xor
      ? 'Third column = the first two combined, but dots appearing in BOTH cancel out (XOR).'
      : 'Third column = all dots from the first two cells combined (union).',
    answerSpec: { kind: 'dots', dotToken, grid3: true, cellPositions: positions.slice() },
  };
}

/* ============================================================
   Number / calendar / scheduling families (hard tier)
   ============================================================ */

/* Number sequences driven by % growth and simple arithmetic. All answers are
   integers by construction. */
function genNumberSeq(R, level) {
  const kind = R.pick(['percent', 'altops', 'accel']);
  let seq, rule;

  if (kind === 'percent') {
    // ratio num/den with a start that keeps five terms integral
    const [num, den, label] = R.pick([[3, 2, '50%'], [5, 4, '25%'], [2, 1, '100%']]);
    const k = den === 4 ? 1 : den === 2 ? 1 + R.int(5) : 3 + R.int(6);
    let x = Math.pow(den, SEQ_LEN) * k;
    seq = [x];
    for (let i = 0; i < SEQ_LEN; i++) { x = (x * num) / den; seq.push(x); }
    rule = `Each number grows by ${label} (×${num}/${den}).`;
  } else if (kind === 'altops') {
    // alternate +a, ×2
    const a = 2 + R.int(6);
    let x = 2 + R.int(5);
    seq = [x];
    const ops = [];
    for (let i = 0; i < SEQ_LEN; i++) {
      if (i % 2 === 0) { x += a; ops.push(`+${a}`); } else { x *= 2; ops.push('×2'); }
      seq.push(x);
    }
    rule = `Two alternating steps: +${a}, then ×2, repeating.`;
  } else {
    // growing difference: +d, +d+s, +d+2s…
    const d = 2 + R.int(4);
    const s = 1 + R.int(3);
    let x = 1 + R.int(9);
    seq = [x];
    for (let i = 0; i < SEQ_LEN; i++) { x += d + i * s; seq.push(x); }
    rule = `The gap between numbers grows by ${s} each step (+${d}, +${d + s}, +${d + 2 * s}…).`;
  }

  const frames = seq.slice(0, SEQ_LEN).map(v => ({ text: String(v) }));
  return {
    type: 'sequence', family: 'number', frames, next: { text: String(seq[SEQ_LEN]) },
    rule,
    instruction: 'The numbers follow a hidden rule. Work it out, then type the next number.',
    answerSpec: { kind: 'number', maxLen: String(seq[SEQ_LEN]).length + 2 },
  };
}

/* Calendar requirements: a month grid (days 1..N starting on a Monday, a few
   ★/◆ event days), three requirements, and a blank calendar — the player
   marks EVERY day that satisfies all three. Solver-built; the qualifying set
   is regenerated until it's a thoughtful size (2–6 days). */
function genMonthReqs(R, level) {
  const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const days = R.pick([28, 30, 31]);
  const wd = d => (d - 1) % 7; // day 1 is a Monday; 5/6 = weekend

  for (let attempt = 0; attempt < 80; attempt++) {
    const all = Array.from({ length: days }, (_, i) => i + 1);
    const starDays = R.sample(all, 2 + R.int(2));
    const diamondDays = R.sample(all.filter(d => !starDays.includes(d)), 2 + R.int(2));
    const marks = {};
    starDays.forEach(d => { marks[d] = 'star'; });
    diamondDays.forEach(d => { marks[d] = 'diamond'; });
    const lastStar = Math.max(...starDays);

    const categoryReqs = [
      ...[0, 1, 2, 3, 4].map(w => ({ text: `It must be a ${WEEKDAY_NAMES[w]}.`, test: d => wd(d) === w })),
      { text: 'It must be a weekend day.', test: d => wd(d) >= 5 },
      { text: 'It must be a Monday, Wednesday, or Friday.', test: d => [0, 2, 4].includes(wd(d)) },
    ];
    const rangeReqs = [
      { text: 'It must be after the 15th.', test: d => d > 15 },
      { text: 'It must be on or before the 15th.', test: d => d <= 15 },
      { text: 'It must fall between the 8th and the 22nd.', test: d => d >= 8 && d <= 22 },
    ];
    const extraReqs = [
      { text: 'It must be an odd-numbered day.', test: d => d % 2 === 1 },
      { text: 'It must be an even-numbered day.', test: d => d % 2 === 0 },
      { text: 'It must not be next to a ◆ day (the day before or after one).', test: d => !diamondDays.includes(d - 1) && !diamondDays.includes(d + 1) },
      { text: 'It must come after the last ★ of the month.', test: d => d > lastStar },
    ];
    const reqs = [R.pick(categoryReqs), R.pick(rangeReqs), R.pick(extraReqs)];
    const solution = all.filter(d => reqs.every(r => r.test(d)));
    if (solution.length < 2 || solution.length > 6) continue;

    return {
      type: 'single', family: 'month',
      frames: [],
      next: { month: { days, marks: solution } },
      rule: `The qualifying days are ${solution.join(', ')} — the only ones passing all three requirements.`,
      instruction: `Mark every day that fits ALL the requirements: ① ${reqs[0].text} ② ${reqs[1].text} ③ ${reqs[2].text}`,
      answerSpec: { kind: 'month', days, marks },
    };
  }
  return genSchedule(R, level); // vanishingly unlikely fallback
}

/* Grid placement: a 3x3 board with a fixed ★; place dots so every rule holds.
   Constraints are solver-verified to admit exactly ONE arrangement. */
function genGridPlace(R, level) {
  const row = p => Math.floor(p / 3), col = p => p % 3;
  const adjacent = (a, b) => Math.abs(row(a) - row(b)) <= 1 && Math.abs(col(a) - col(b)) <= 1 && a !== b;
  const CORNERS = [0, 2, 6, 8];

  for (let attempt = 0; attempt < 120; attempt++) {
    const star = R.int(9);
    const free = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(p => p !== star);
    const candidates = [
      { text: 'Exactly one dot in each row.', test: s => [0, 1, 2].every(r => s.filter(p => row(p) === r).length === 1) },
      { text: 'Exactly one dot in each column.', test: s => [0, 1, 2].every(c => s.filter(p => col(p) === c).length === 1) },
      { text: 'No dot may touch the ★ (not even diagonally).', test: s => s.every(p => !adjacent(p, star)) },
      { text: 'No two dots may touch each other (not even diagonally).', test: s => s.every(a => s.every(b => a === b || !adjacent(a, b))) },
      { text: 'Exactly one dot in a corner.', test: s => s.filter(p => CORNERS.includes(p)).length === 1 },
      { text: 'The centre cell stays empty.', test: s => !s.includes(4) },
      { text: `No dot in the ★'s row.`, test: s => s.every(p => row(p) !== row(star)) },
    ];
    const reqs = R.sample(candidates, 3);

    // Enumerate all 3-dot placements on the free cells; demand a unique fit.
    const fits = [];
    for (let a = 0; a < free.length - 2 && fits.length < 2; a++)
      for (let b = a + 1; b < free.length - 1 && fits.length < 2; b++)
        for (let c = b + 1; c < free.length && fits.length < 2; c++) {
          const s = [free[a], free[b], free[c]];
          if (reqs.every(r => r.test(s))) fits.push(s);
        }
    if (fits.length !== 1) continue;

    const starPanel = { grid3: true, cells: Array(9).fill(null) };
    starPanel.cells[star] = { kind: 'star', fill: 'orange', scale: 0.7 };
    const answer = { grid3: true, cells: Array(9).fill(null) };
    for (const p of fits[0]) answer.cells[p] = { kind: 'circle', fill: 'solid', scale: 0.8 };

    return {
      type: 'single', family: 'dots',
      frames: [starPanel],
      next: answer,
      rule: 'Only one arrangement of three dots satisfies every rule at once.',
      instruction: `Place exactly 3 dots in the answer grid (the ★ stays where it is): ① ${reqs[0].text} ② ${reqs[1].text} ③ ${reqs[2].text}`,
      answerSpec: { kind: 'dots', dotToken: { kind: 'circle', fill: 'solid', scale: 0.8 }, grid3: true, cellPositions: free },
    };
  }
  return genSchedule(R, level);
}

/* Ratio / percent word problems — typed integer answers, built so the
   arithmetic always lands on whole numbers. */
function genRatioWord(R, level) {
  const variant = R.pick(['ratio', 'percent', 'rate']);
  let prompt, answer;

  if (variant === 'ratio') {
    const pairs = [[2, 1], [3, 2], [5, 3], [7, 4], [18, 13], [9, 5]];
    const [a, b] = R.pick(pairs);
    const k = 2 + R.int(5);
    const total = k * (a + b);
    const first = R.chance(0.5);
    prompt = `Two businesses split ${total} units of product A in the ratio ${a}:${b}. How many units does business ${first ? 'one' : 'two'} hold?`;
    answer = k * (first ? a : b);
  } else if (variant === 'percent') {
    const opts = [[25, 4], [50, 2], [20, 5], [10, 10], [100, 1]];
    const [p, den] = R.pick(opts);
    const base = den * (3 + R.int(20));
    const grew = R.chance(0.5);
    const result = grew ? base + (base * p) / 100 : base - (base * p) / 100;
    if (R.chance(0.5)) {
      prompt = `A price ${grew ? 'rose' : 'fell'} by ${p}% and is now ${result}. What was it before the change?`;
      answer = base;
    } else {
      prompt = `A price of ${base} ${grew ? 'rises' : 'falls'} by ${p}%. What is it after the change?`;
      answer = result;
    }
  } else {
    const per = 3 + R.int(9);
    const n1 = 2 + R.int(4);
    const n2 = n1 + 2 + R.int(5);
    prompt = `${n1} crates hold ${n1 * per} units. At the same rate, how many units do ${n2} crates hold?`;
    answer = n2 * per;
  }

  return {
    type: 'single', family: 'word',
    frames: [],
    next: { text: String(answer) },
    prompt,
    rule: `The answer is ${answer}.`,
    instruction: 'Whole-number answer — type it on the pad.',
    answerSpec: { kind: 'number', maxLen: String(answer).length + 2 },
  };
}

/* Interactive ratio bars: drag each bar to the exact values the prompt pins
   down. Built so exactly one integer assignment works. */
function genRatioBars(R, level) {
  const variant = R.pick(['split', 'percent']);
  let labels, values, prompt;

  if (variant === 'split') {
    const pairs = [[2, 1], [3, 1], [3, 2], [5, 3], [4, 3]];
    const [a, b] = R.pick(pairs);
    const k = 2 + R.int(5);
    values = [a * k, b * k];
    labels = ['A', 'B'];
    prompt = `Split ${values[0] + values[1]} between bar A and bar B in the ratio ${a}:${b} (A gets the bigger share).`;
  } else {
    const p = R.pick([25, 50, 100]);
    const base = R.pick([8, 12, 16, 20, 24]);
    values = [base, base + (base * p) / 100];
    labels = ['A', 'B'];
    prompt = `Set bar A to ${base}, and bar B to ${p}% more than A.`;
  }

  const max = Math.max(...values) + 4 + R.int(6);
  return {
    type: 'single', family: 'bars',
    frames: [],
    next: { bars: values },
    prompt,
    rule: `Bar A = ${values[0]}, bar B = ${values[1]}.`,
    instruction: prompt,
    answerSpec: { kind: 'bars', labels, max },
  };
}

/* Constraint scheduling: one week with symbol days; exactly one day satisfies
   every rule. Solver-verified during generation. */
function genSchedule(R, level) {
  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  for (let attempt = 0; attempt < 80; attempt++) {
    const days = Array(7).fill(null);
    const starDays = R.sample([0, 1, 2, 3, 4, 5, 6], 1 + R.int(2));
    starDays.forEach(d => { days[d] = 'star'; });
    const free = [0, 1, 2, 3, 4, 5, 6].filter(d => !days[d]);
    const diamondDays = R.sample(free, 1 + R.int(2));
    diamondDays.forEach(d => { days[d] = 'diamond'; });

    const lastStar = Math.max(...starDays);
    const candidates = [
      { text: 'Not on a weekend.', ok: d => d < 5 },
      { text: 'Not on a ★ or ◆ day.', ok: d => !days[d] },
      { text: 'Not the day right after a ★ day.', ok: d => !starDays.includes(d - 1) },
      { text: 'Not next to a ◆ day (either side).', ok: d => !diamondDays.includes(d - 1) && !diamondDays.includes(d + 1) },
      { text: 'After the last ★ day of the week.', ok: d => d > lastStar },
      { text: 'Before the first ◆ day of the week.', ok: d => d < Math.min(...diamondDays) },
      { text: 'In the first half of the week (Mon–Thu).', ok: d => d <= 3 },
    ];

    const rules = R.sample(candidates, 3);
    const valid = [0, 1, 2, 3, 4, 5, 6].filter(d => rules.every(r => r.ok(d)));
    if (valid.length !== 1) continue;

    const answerDays = Array(7).fill(null);
    answerDays[valid[0]] = 'mark';
    return {
      type: 'sequence', family: 'schedule',
      frames: [{ week: { days } }],
      next: { week: { days: answerDays } },
      rule: `Only ${DAY_NAMES[valid[0]]} passes every rule: ${rules.map(r => r.text.toLowerCase().replace(/\.$/, '')).join('; ')}.`,
      instruction: `Pick the one day that satisfies all three rules: ① ${rules[0].text} ② ${rules[1].text} ③ ${rules[2].text}`,
      answerSpec: { kind: 'pickday' },
    };
  }
  // Solver couldn't land a unique day (vanishingly unlikely) — fall back.
  return genNumberSeq(R, level);
}

/* ============================================================
   Question assembly
   ============================================================ */

/* Easy targets ~1-minute solves: every entry is a meaty 2-rule level (or the
   nested square, whose two patterns take several frames to confirm) — no
   single-glance answers. */
const POOLS = {
  easy: [
    [genNestedSquare, 1], [genDots, 2], [genColorCycle, 2], [genAlternation, 3], [genPolygonMorph, 2],
  ],
  medium: [
    [genNestedCircle, 2], [genColorCycle, 3], [genNesting, 2], [genDots, 3],
    [genMatrixRowCount, 2], [genMatrixLatin, 2],
  ],
  hard: [
    [genNestedTriangle, 3], [genNumberSeq, 3], [genMonthReqs, 3], [genSchedule, 3],
    [genGridPlace, 3], [genRatioWord, 3], [genRatioBars, 3],
    [genMatrixLatin, 4], [genMatrixOverlay, 3], [genMatrixOverlay, 4],
    [genMatrixRowCount, 3], [genNesting, 3],
  ],
};

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

function packQuestion(q, difficulty) {
  return {
    type: q.type,
    family: q.family || (q.type === 'matrix' ? 'matrix'
      : q.answerSpec.kind === 'nested' ? 'nested'
      : q.answerSpec.kind === 'dots' ? 'dots' : 'shapes'),
    frames: q.frames,
    next: q.next,
    rule: q.rule,
    instruction: q.instruction || null,
    prompt: q.prompt || null,
    answerSpec: q.answerSpec,
    difficulty,
  };
}

/* The daily's fifth puzzle is always a hard nested shape — the flagship finale. */
export function generateNestedFinale(R) {
  const shape = R.pick(['circle', 'triangle']);
  return packQuestion(genNestedShape(R, 3, shape), 'hard');
}

export function generateProblem(R, difficulty) {
  const pool = POOLS[difficulty] || POOLS.medium;
  const [gen, level] = R.pick(pool);
  return packQuestion(gen(R, level), difficulty);
}
