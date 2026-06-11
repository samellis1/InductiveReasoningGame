/* Procedural question generators (construct-the-answer edition).

   The player no longer picks from multiple choices — they BUILD the answer
   panel, which game.js grades against `next` via panelEq(). So every generator
   returns:

     { type: 'sequence'|'matrix', frames, next, rule, answerSpec }

   `answerSpec` tells builder.js what to render and which constrained palettes to
   offer (so grading is fair, not a needle-in-a-haystack). Kinds:

     center        { shapes, fills, sizes? }                  one centered shape
     centerNested  { shapes, fills }                          outer + inner shape
     dots          { dotMode, dotToken, grid3, order?,
                     maxCount?, cellPositions? }               dot patterns
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

/* Counting progression — filled cells accumulate along the border. */
function genCount(R, level) {
  const step = level >= 2 ? R.pick([1, 2]) : 1;
  const maxStart = 9 - step * SEQ_LEN; // answer count must fit in 9 cells
  const start = 1 + R.int(Math.max(1, maxStart));
  const color = level >= 3 ? R.pick(['blue', 'red', 'green']) : 'solid';
  const dotToken = { kind: 'circle', fill: color, scale: 0.85 };
  const panelAt = i => {
    const n = start + step * i;
    const cells = Array(9).fill(null);
    for (let k = 0; k < n && k < 9; k++) cells[FILL9[k]] = { ...dotToken };
    return { cells };
  };
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: `The number of dots grows by ${step} each panel.`,
    answerSpec: { kind: 'dots', dotMode: 'count', dotToken, order: FILL9, maxCount: 9, grid3: false },
  };
}

/* A centered shape grows steadily; harder levels alternate fill too. */
function genSizeScale(R, level) {
  const kind = R.pick(SHAPES);
  const grow = R.chance(0.5);
  const scales = grow ? [0.45, 0.65, 0.85, 1.05, 1.25] : [1.25, 1.05, 0.85, 0.65, 0.45];
  const fillToggles = level >= 3;
  const baseFill = level >= 2 ? R.pick(COLOR_CYCLES[R.int(COLOR_CYCLES.length)]) : 'outline';
  const panelAt = i => ({
    center: {
      kind,
      fill: fillToggles ? (i % 2 === 0 ? baseFill : 'outline') : baseFill,
      scale: scales[i],
    },
  });
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: `The ${kind} ${grow ? 'grows' : 'shrinks'} by the same amount each panel${fillToggles ? ' while its fill alternates' : ''}.`,
    answerSpec: { kind: 'center', shapes: shapePalette(R, [kind]), fills: uniq(['outline', 'solid', baseFill]), sizes: scales.slice() },
  };
}

/* Fill cycles through three colors; higher levels counter-cycle the size. */
function genColorCycle(R, level) {
  const cycle = R.pick(COLOR_CYCLES);
  const kinds = level >= 4 ? R.sample(SHAPES, 2) : [R.pick(SHAPES)];
  const sizeCycles = level >= 3;
  const sizes = [0.6, 0.9, 1.2];
  const phase = R.int(3);
  const panelAt = i => ({
    center: {
      kind: kinds[i % kinds.length],
      fill: cycle[(phase + i) % 3],
      scale: sizeCycles ? sizes[(2 - ((phase + i) % 3) + 3) % 3] : 1,
    },
  });
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: `The color repeats every three panels (${cycle.join(' → ')})`
      + (sizeCycles ? ', and the size cycles in the opposite order' : '')
      + (kinds.length > 1 ? ', while the shape alternates' : '') + '.',
    answerSpec: { kind: 'center', shapes: shapePalette(R, kinds), fills: cycle.slice(), sizes: sizeCycles ? sizes.slice() : null },
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

/* Nested squares: outer ring rotates; inner block fills one more section each
   step. Two different, both-inferable rules; the answer (inner fully filled) is
   never shown, so it can't be pattern-matched. The Hard/daily flagship. */
function genNestedSquares(R, level) {
  const outerColors = R.sample(COLOR_NAMES, 4);          // one distinct color per outer section
  const baseOuter = outerColors.map(c => ({ color: c }));
  const dir = R.chance(0.5) ? 1 : 3;                     // clockwise (+1) or counter (-1 ≡ +3)
  const innerColor = R.pick(COLOR_NAMES.filter(c => !outerColors.includes(c)));
  const innerTex = R.pick(TEXTURES);
  const squareAt = s => {
    const inner = [null, null, null, null];
    const filled = Math.min(4, s);                       // s=0..3 → 0..3 sections; answer s=4 → all 4
    for (let k = 0; k < filled; k++) inner[k] = { color: innerColor, texture: innerTex };
    return { nested: { outer: rotateQuadrants(baseOuter.map(x => ({ ...x })), dir * s), inner } };
  };
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(squareAt(i));
  return {
    type: 'sequence', frames, next: squareAt(SEQ_LEN),
    rule: `Outer ring: the four colours rotate one quarter ${dir === 1 ? 'clockwise' : 'counter-clockwise'} each square. `
      + 'Inner block: one more section fills in (clockwise from top-left) each square.',
    answerSpec: { kind: 'nested', colors: COLOR_NAMES.slice(), textures: TEXTURES.slice() },
  };
}

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
  const cellAt = (r, c) => {
    const n = rowStart[r] + c;
    const cells = Array(9).fill(null);
    for (let k = 0; k < n && k < 8; k++) cells[BORDER8[k]] = { ...dotToken };
    return { cells };
  };
  const { frames, next } = matrixFrames(cellAt);
  return {
    type: 'matrix', frames, next,
    rule: 'In every row the dot count rises by one from left to right.',
    answerSpec: { kind: 'dots', dotMode: 'count', dotToken, order: BORDER8, maxCount: 8, grid3: false },
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
    answerSpec: { kind: 'dots', dotMode: 'cells', dotToken, grid3: true, cellPositions: positions.slice() },
  };
}

/* ============================================================
   Question assembly
   ============================================================ */

const POOLS = {
  easy: [
    [genCount, 2], [genSizeScale, 2], [genColorCycle, 2], [genPolygonMorph, 2], [genAlternation, 2],
  ],
  medium: [
    [genColorCycle, 3], [genSizeScale, 3], [genPolygonMorph, 2], [genNesting, 2],
    [genMatrixRowCount, 2], [genMatrixLatin, 2], [genCount, 3], [genAlternation, 3],
  ],
  hard: [
    [genMatrixLatin, 4], [genMatrixOverlay, 3], [genMatrixOverlay, 4], [genMatrixRowCount, 3],
    [genNesting, 3], [genColorCycle, 4], [genNestedSquares, 1],
  ],
};

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

/* The nested-squares generator, exposed so the daily can force it as the finale. */
export function generateNestedSquares(R) {
  const q = genNestedSquares(R, 1);
  return { type: q.type, frames: q.frames, next: q.next, rule: q.rule, answerSpec: q.answerSpec, difficulty: 'hard' };
}

export function generateProblem(R, difficulty) {
  const pool = POOLS[difficulty] || POOLS.medium;
  const [gen, level] = R.pick(pool);
  const q = gen(R, level);
  return {
    type: q.type,
    frames: q.frames,
    next: q.next,
    rule: q.rule,
    answerSpec: q.answerSpec,
    difficulty,
  };
}
