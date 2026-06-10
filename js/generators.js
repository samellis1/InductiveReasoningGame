/* Procedural question generators.

   Rule families are modeled on professional inductive-reasoning tests
   (SHL next-in-series, Raven's matrices, cut-e conveyors):
   rotation, translation around positions, counting progressions, size
   scaling, color cycling, alternation layers, nesting conveyors,
   negative space, interleaved threads, Latin-square (distribution of
   three) matrices, and Boolean overlay (OR / XOR) matrices.

   Difficulty scales by stacking simultaneous rules and lowering rule
   salience, per the Carpenter/Just/Shell analysis of Raven's items.
   Distractors are named perturbations — each breaks exactly one rule —
   rather than random noise.

   Every generator takes (R, level) where R = rngHelpers(random) so the
   daily challenge can run on a shared seed, and returns:
   { type: 'sequence'|'matrix', frames, next, rule, distractors? } */

import { SHAPES, deepClone, panelEq } from './panels.js';

const SEQ_LEN = 4;       // frames shown before the "?"
const OPTION_COUNT = 5;

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

function rotateQuadrants(quads, k) {
  const out = [null, null, null, null];
  for (let i = 0; i < 4; i++) out[cwq(i, k)] = quads[i];
  return out;
}

/* ============================================================
   Sequence generators
   ============================================================ */

/* Shaded quadrant walks; harder levels add tokens that rotate with it. */
function genShadeRotate(R, level) {
  const dir = R.chance(0.5) ? 1 : -1;
  const start = R.int(4);
  const double = level >= 2 && R.chance(0.5);
  // Pair must be adjacent (offset 1): an opposite pair maps to itself every
  // two steps, so the walk degenerates and direction becomes unverifiable.
  const offset = double ? 1 : 0;
  let tokens = null;
  if (level >= 3) {
    tokens = [null, null, null, null];
    const kinds = R.sample(SHAPES, 2 + R.int(2));
    const spots = R.sample([0, 1, 2, 3], kinds.length);
    kinds.forEach((kind, i) => {
      tokens[spots[i]] = { kind, fill: R.chance(0.5) ? 'solid' : 'outline' };
    });
  }
  const panelAt = i => {
    const q1 = cwq(start, dir * i);
    const p = { divider: true, shaded: double ? [q1, cwq(q1, offset)] : [q1] };
    if (tokens) p.quadrants = rotateQuadrants(tokens, dir * i);
    return p;
  };
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: `The shaded quadrant${double ? ' pair' : ''} moves one step ${dir === 1 ? 'clockwise' : 'counter-clockwise'} each panel${tokens ? ', and the shapes rotate with it' : ''}.`,
  };
}

/* One token steps through the quadrants; harder levels alternate its fill. */
function genTokenWalk(R, level) {
  const dir = R.chance(0.5) ? 1 : -1;
  const start = R.int(4);
  const kind = R.pick(SHAPES);
  const baseFill = level >= 2 && R.chance(0.5) ? R.pick(COLOR_CYCLES[0]) : (R.chance(0.5) ? 'solid' : 'outline');
  const alternates = level >= 2;
  const altFill = baseFill === 'solid' ? 'outline' : 'solid';
  const panelAt = i => {
    const quads = [null, null, null, null];
    quads[cwq(start, dir * i)] = {
      kind,
      fill: alternates ? (i % 2 === 0 ? baseFill : altFill) : baseFill,
    };
    return { divider: true, quadrants: quads };
  };
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: `The ${kind} moves one quadrant ${dir === 1 ? 'clockwise' : 'counter-clockwise'} each panel${alternates ? ' while its fill alternates' : ''}.`,
  };
}

/* Two tokens orbit the quadrants in opposite directions. They start an odd
   number of steps apart, so their gap stays odd and they can never land on
   the same quadrant — every panel always shows both shapes. (Unequal speeds
   in a 4-cell cycle force a collision within 5 panels, which silently hides
   one shape and made the old level-3 variant ambiguous.) */
function genTwoMovers(R, level) {
  const kindA = R.pick(SHAPES);
  const kindB = R.pick(SHAPES.filter(k => k !== kindA));
  const fillA = R.chance(0.5) ? 'solid' : 'outline';
  const fillB = R.chance(0.5) ? 'solid' : 'outline';
  const startA = R.int(4);
  const startB = cwq(startA, R.chance(0.5) ? 1 : 3);
  const altFill = level >= 3; // level 3 stacks a fill alternation on top
  const panelAt = i => {
    const quads = [null, null, null, null];
    quads[cwq(startA, i)] = { kind: kindA, fill: altFill && i % 2 === 1 ? flip(fillA) : fillA };
    quads[cwq(startB, -i)] = { kind: kindB, fill: fillB };
    return { divider: true, quadrants: quads };
  };
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: altFill
      ? `The ${kindA} orbits clockwise with its fill alternating; the ${kindB} orbits counter-clockwise.`
      : `The ${kindA} orbits clockwise; the ${kindB} orbits counter-clockwise.`,
  };
}

/* A rotating arrow; fill alternation and accelerating steps at higher levels. */
function genArrowSpin(R, level) {
  const startRot = R.int(8) * 45;
  const dir = R.chance(0.5) ? 1 : -1;
  const accel = level >= 4;
  const step = level >= 2 ? 45 : 90;
  const fillToggles = level >= 2;
  const rotAt = i => {
    if (!accel) return (startRot + dir * step * i + 1440) % 360;
    let total = 0;
    for (let k = 1; k <= i; k++) total += 45 * k; // +45, +90, +135…
    return (startRot + dir * total + 14400) % 360;
  };
  const panelAt = i => ({
    center: { kind: 'arrow', fill: fillToggles ? (i % 2 === 0 ? 'solid' : 'outline') : 'solid', rot: rotAt(i) },
  });
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: accel
      ? 'The arrow turns a growing amount each panel (45°, then 90°, then 135°…) and its fill alternates.'
      : `The arrow rotates ${step}° ${dir === 1 ? 'clockwise' : 'counter-clockwise'} each panel${fillToggles ? ' while its fill alternates' : ''}.`,
  };
}

/* Counting progression — filled cells accumulate along the border. */
function genCount(R, level) {
  const step = level >= 2 ? R.pick([1, 2]) : 1;
  const maxStart = 9 - step * SEQ_LEN; // answer count must fit in 9 cells
  const start = 1 + R.int(Math.max(1, maxStart));
  const color = level >= 3 ? R.pick(['blue', 'red', 'green']) : 'solid';
  const panelAt = i => {
    const n = start + step * i;
    const cells = Array(9).fill(null);
    for (let k = 0; k < n && k < 9; k++) {
      cells[FILL9[k]] = { kind: 'circle', fill: color, scale: 0.85 };
    }
    return { cells };
  };
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: `The number of dots grows by ${step} each panel.`,
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
  };
}

/* Polygon morphs through the side-count ladder; medium adds a dot counter. */
function genPolygonMorph(R, level) {
  const ladder = ['triangle', 'square', 'pentagon', 'hexagon'];
  const startIdx = R.int(2);
  const dir = R.chance(0.5) ? 1 : -1;
  const withDots = level >= 2;
  const dotDir = R.chance(0.5) ? 1 : -1;
  const dotStart = dotDir === 1 ? 1 : 5;
  const panelAt = i => {
    const idx = (((startIdx + dir * i) % ladder.length) + ladder.length) % ladder.length;
    if (!withDots) return { center: { kind: ladder[idx], fill: 'solid' } };
    const quads = [null, null, null, null];
    quads[0] = { kind: ladder[idx], fill: 'solid' };
    quads[2] = { kind: 'dots', count: Math.max(1, Math.min(5, dotStart + dotDir * i)) };
    return { quadrants: quads };
  };
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: `The shape cycles ${dir === 1 ? 'up' : 'down'} the ladder triangle → square → pentagon → hexagon`
      + (withDots ? `, and the dot count ${dotDir === 1 ? 'rises' : 'falls'} by one` : '') + '.',
  };
}

/* Nesting conveyor: outer shape leaves, inner is promoted, a new shape enters. */
function genNesting(R, level) {
  // 5-shape cycle: with 4 shapes the answer panel would be an exact copy of
  // frame 1, letting players pattern-match instead of inferring the conveyor.
  const cycle = R.shuffle(SHAPES).slice(0, 5);
  const fills = level >= 3 ? ['outline', R.pick(['blue', 'orange', 'green'])] : ['outline', 'outline'];
  const shapeAt = i => cycle[((i % cycle.length) + cycle.length) % cycle.length];
  const panelAt = i => ({
    center: {
      kind: shapeAt(i), fill: fills[0], scale: 1.15,
      inner: { kind: shapeAt(i + 1), fill: fills[1] },
    },
  });
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: 'Each panel, the outer shape leaves, the inner shape grows to take its place, and the next shape in the cycle appears inside.',
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
  };
}

/* Negative space: the EMPTY cell walks around the border. */
function genNegativeSpace(R, level) {
  const dir = R.chance(0.5) ? 1 : -1;
  const start = R.int(8);
  const noisy = level >= 4;
  const fillColor = level >= 3 ? R.pick(['blue', 'green', 'red']) : 'solid';
  const panelAt = i => {
    const emptyPos = ((start + dir * i) % 8 + 8) % 8;
    const cells = Array(9).fill(null);
    for (let k = 0; k < 8; k++) {
      if (k === emptyPos) continue;
      cells[BORDER8[k]] = { kind: 'square', fill: fillColor, scale: 1.0 };
    }
    if (noisy) {
      // Center cell is pure noise — varies with no rule.
      cells[4] = { kind: R.pick(SHAPES), fill: R.chance(0.5) ? 'solid' : 'outline', scale: 0.85 };
    }
    return { grid3: true, cells };
  };
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  // The noisy center makes exact panel matching unfair — pin the answer's
  // center to a fresh noise token and let distractors perturb the gap only.
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: `The rule is in the gap: the empty cell moves one step ${dir === 1 ? 'clockwise' : 'counter-clockwise'} around the border. ${noisy ? 'The centre shape is a decoy with no rule.' : ''}`.trim(),
    matchKey: noisy ? p => JSON.stringify((p.cells || []).map((c, i2) => (i2 === 4 ? null : !!c))) : null,
  };
}

/* Interleaved threads: odd panels follow one rule, even panels another. */
function genInterleaved(R, level) {
  const dotColor = level >= 4 ? R.pick(['blue', 'red']) : 'solid';
  const arrowStart = R.int(4) * 90;
  const arrowStep = R.chance(0.5) ? 90 : -90;
  const panelAt = i => {
    if (i % 2 === 0) {
      // Thread A: growing dot count 1, 2, 3…
      const n = i / 2 + 1;
      const cells = Array(9).fill(null);
      for (let k = 0; k < n && k < 8; k++) cells[BORDER8[k]] = { kind: 'circle', fill: dotColor, scale: 0.85 };
      return { cells };
    }
    // Thread B: rotating arrow.
    const stepIdx = (i - 1) / 2;
    return { center: { kind: 'arrow', fill: 'solid', rot: (arrowStart + arrowStep * stepIdx + 1440) % 360 } };
  };
  const frames = [];
  for (let i = 0; i < SEQ_LEN; i++) frames.push(panelAt(i));
  // Primary lure: continuing the WRONG thread (the arrow's next step).
  const wrongThread = { center: { kind: 'arrow', fill: 'solid', rot: (arrowStart + arrowStep * 2 + 1440) % 360 } };
  return {
    type: 'sequence', frames, next: panelAt(SEQ_LEN),
    rule: 'Two interleaved sequences: the odd panels count up in dots, the even panels rotate an arrow. The answer continues the dots thread.',
    distractors: [wrongThread],
  };
}

/* ============================================================
   Matrix (3x3) generators — Raven's style
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
  /* Index squares are (a*r + b*c) % 3 with a,b in {1,2} — always Latin.
     Pairs split into two classes, {(1,1),(2,2)} and {(1,2),(2,1)}; squares
     from the SAME class are relabelings of each other. Shape and fill take
     one pair from each class so they are orthogonal — knowing the shape
     never tells you the fill. (Order 3 admits only 2 mutually orthogonal
     squares, so the size square reuses shape's class — a true Latin rule,
     just not independent of both others.) */
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
  };
}

/* Quantitative pairwise progression: dot count climbs across each row. */
function genMatrixRowCount(R, level) {
  // Strictly increasing starts keep all three rows visually distinct
  // (max count = 2+2+2+2 = 8, exactly filling the border ring).
  const base = 1 + R.int(2);
  const d1 = 1 + R.int(2);
  const rowStart = [base, base + d1, base + d1 + 1 + R.int(2)];
  const color = level >= 3 ? R.pick(['blue', 'green', 'red']) : 'solid';
  const cellAt = (r, c) => {
    const n = rowStart[r] + c;
    const cells = Array(9).fill(null);
    for (let k = 0; k < n && k < 8; k++) cells[BORDER8[k]] = { kind: 'circle', fill: color, scale: 0.8 };
    return { cells };
  };
  const { frames, next } = matrixFrames(cellAt);
  return {
    type: 'matrix', frames, next,
    rule: 'In every row the dot count rises by one from left to right.',
  };
}

/* Boolean overlay: third column = col1 OR col2 (hard) or XOR (expert). */
function genMatrixOverlay(R, level) {
  const xor = level >= 4;
  const positions = [0, 1, 2, 3, 5, 6, 7, 8]; // 3x3 minus centre
  const orSet = (a, b) => new Set([...a, ...b]);
  const andSet = (a, b) => new Set([...a].filter(x => b.has(x)));
  const xorSet = (a, b) => {
    const out = new Set();
    for (const x of a) if (!b.has(x)) out.add(x);
    for (const x of b) if (!a.has(x)) out.add(x);
    return out;
  };
  /* Each operand pair must overlap (so OR and XOR give different answers)
     AND each operand must keep dots of its own. Without the second
     constraint a subset pair degenerates — XOR collapses to a one-dot
     leftover and OR to a copy of one operand, which reads as nonsense. */
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
  const setToPanel = s => {
    const cells = Array(9).fill(null);
    for (const p of s) cells[p] = { kind: 'circle', fill: 'solid', scale: 0.85 };
    return { grid3: true, cells };
  };
  const cellAt = (r, c) => setToPanel(c === 0 ? rows[r][0] : c === 1 ? rows[r][1] : combine(rows[r][0], rows[r][1]));
  const { frames, next } = matrixFrames(cellAt);
  return {
    type: 'matrix', frames, next,
    rule: xor
      ? 'Third column = the first two combined, but dots appearing in BOTH cancel out (XOR).'
      : 'Third column = all dots from the first two cells combined (union).',
    // Classic lures: the OTHER Boolean op on the same operands, and AND.
    distractors: [
      setToPanel((xor ? orSet : xorSet)(rows[2][0], rows[2][1])),
      setToPanel(andSet(rows[2][0], rows[2][1])),
    ],
  };
}

/* ============================================================
   Distractor factory — named perturbations of the correct answer
   ============================================================ */

function perturbations(correct, frames, R) {
  const has = sel => sel(correct) != null;
  const list = [];

  // Copy lures (Raven's "repetition" distractor).
  list.push(() => deepClone(frames[frames.length - 1]));
  list.push(() => deepClone(frames[0]));

  if (correct.shaded) {
    list.push(() => { const p = deepClone(correct); p.shaded = p.shaded.map(q => cwq(q, 2)); return p; });
    list.push(() => { const p = deepClone(correct); p.shaded = p.shaded.map(q => cwq(q, 1)); return p; });
  }
  if (correct.quadrants && correct.quadrants.some(q => q)) {
    list.push(() => { const p = deepClone(correct); p.quadrants = rotateQuadrants(p.quadrants, 1); return p; });
    list.push(() => { const p = deepClone(correct); p.quadrants = rotateQuadrants(p.quadrants, 3); return p; });
    list.push(() => {
      const p = deepClone(correct);
      const idxs = p.quadrants.map((q, i) => (q && q.fill ? i : -1)).filter(i => i >= 0);
      if (idxs.length) { const i = R.pick(idxs); p.quadrants[i].fill = p.quadrants[i].fill === 'solid' ? 'outline' : 'solid'; }
      return p;
    });
    list.push(() => {
      const p = deepClone(correct);
      const idxs = p.quadrants.map((q, i) => (q && q.kind !== 'dots' ? i : -1)).filter(i => i >= 0);
      if (idxs.length) { const i = R.pick(idxs); p.quadrants[i].kind = R.pick(SHAPES.filter(k => k !== p.quadrants[i].kind)); }
      return p;
    });
    list.push(() => {
      const p = deepClone(correct);
      const idxs = p.quadrants.map((q, i) => (q && q.kind === 'dots' ? i : -1)).filter(i => i >= 0);
      if (idxs.length) { const i = R.pick(idxs); p.quadrants[i].count = Math.max(1, (p.quadrants[i].count || 1) + (R.chance(0.5) ? 1 : -1)); }
      return p;
    });
  }
  if (has(p => p.center)) {
    list.push(() => { const p = deepClone(correct); p.center.rot = ((p.center.rot || 0) + (R.chance(0.5) ? 45 : 90)) % 360; return p; });
    list.push(() => { const p = deepClone(correct); p.center.rot = ((p.center.rot || 0) + 270) % 360; return p; });
    list.push(() => {
      const p = deepClone(correct);
      p.center.fill = p.center.fill === 'solid' ? 'outline' : p.center.fill === 'outline' ? 'solid' : 'outline';
      return p;
    });
    list.push(() => { const p = deepClone(correct); p.center.kind = R.pick(SHAPES.filter(k => k !== p.center.kind)); return p; });
    list.push(() => {
      const p = deepClone(correct);
      const s = p.center.scale || 1;
      // Size lures are only fair when size is part of the question's rule.
      if (s === 1) return null;
      p.center.scale = Math.round((s + (R.chance(0.5) ? 0.3 : -0.3)) * 100) / 100;
      if (p.center.scale < 0.3) p.center.scale = s + 0.3;
      return p;
    });
    list.push(() => {
      const p = deepClone(correct);
      if (p.center.inner) { const t = p.center.inner.kind; p.center.inner.kind = p.center.kind; p.center.kind = t; }
      else p.center.kind = R.pick(SHAPES.filter(k => k !== p.center.kind));
      return p;
    });
  }
  if (correct.cells && correct.cells.some(c => c)) {
    list.push(() => { // shift every occupied cell one border step
      const p = deepClone(correct);
      const cells = Array(9).fill(null);
      for (let k = 0; k < 8; k++) {
        const tok = p.cells[BORDER8[k]];
        if (tok) cells[BORDER8[(k + 1) % 8]] = tok;
      }
      cells[4] = p.cells[4];
      p.cells = cells;
      return p;
    });
    list.push(() => { // add or remove one dot
      const p = deepClone(correct);
      const occupied = BORDER8.filter(i => p.cells[i]);
      const empty = BORDER8.filter(i => !p.cells[i]);
      if (R.chance(0.5) && empty.length) p.cells[R.pick(empty)] = deepClone(p.cells[occupied[0]] || { kind: 'circle', fill: 'solid', scale: 0.85 });
      else if (occupied.length > 1) p.cells[R.pick(occupied)] = null;
      return p;
    });
  }
  return list;
}

/* ============================================================
   Question assembly
   ============================================================ */

const POOLS = {
  easy: [
    [genShadeRotate, 1], [genTokenWalk, 1], [genArrowSpin, 1], [genCount, 1],
    [genPolygonMorph, 1], [genAlternation, 1], [genSizeScale, 1], [genMatrixLatin, 1],
  ],
  medium: [
    [genShadeRotate, 2], [genTokenWalk, 2], [genTwoMovers, 2], [genArrowSpin, 2],
    [genColorCycle, 2], [genNesting, 2], [genCount, 2], [genPolygonMorph, 2],
    [genAlternation, 2], [genMatrixLatin, 2], [genMatrixRowCount, 2], [genSizeScale, 2],
  ],
  hard: [
    [genShadeRotate, 3], [genTwoMovers, 3], [genInterleaved, 3], [genNegativeSpace, 3],
    [genColorCycle, 3], [genMatrixOverlay, 3], [genMatrixLatin, 3], [genMatrixRowCount, 3],
    [genSizeScale, 3], [genNesting, 3], [genCount, 3],
  ],
  expert: [
    [genMatrixOverlay, 4], [genNegativeSpace, 4], [genArrowSpin, 4], [genColorCycle, 4],
    [genInterleaved, 4], [genMatrixLatin, 4], [genTwoMovers, 3], [genNesting, 3],
  ],
};

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];

/* Two panels are confusable when they differ only by a scale gap too small
   to judge without a reference — unfair as separate answer options. */
function confusable(a, b) {
  if (panelEq(a, b)) return true;
  if (a.center && b.center) {
    const ca = a.center, cb = b.center;
    if (ca.kind === cb.kind
        && (ca.fill || 'outline') === (cb.fill || 'outline')
        && (((ca.rot || 0) % 360) + 360) % 360 === (((cb.rot || 0) % 360) + 360) % 360
        && JSON.stringify(ca.inner || null) === JSON.stringify(cb.inner || null)) {
      if (Math.abs((ca.scale || 1) - (cb.scale || 1)) < 0.19) return true;
    }
  }
  return false;
}

export function generateProblem(R, difficulty) {
  const pool = POOLS[difficulty] || POOLS.medium;
  const [gen, level] = R.pick(pool);
  const q = gen(R, level);

  const eq = q.matchKey
    ? (a, b) => q.matchKey(a) === q.matchKey(b) || confusable(a, b)
    : confusable;

  const options = [deepClone(q.next)];
  // Generator-supplied targeted lures first (e.g. OR-when-XOR).
  for (const d of q.distractors || []) {
    if (options.length >= OPTION_COUNT) break;
    if (!options.some(o => eq(o, d))) options.push(d);
  }
  const perturbs = perturbations(q.next, q.frames, R);
  let guard = 0;
  while (options.length < OPTION_COUNT && guard++ < 120) {
    const d = R.pick(perturbs)();
    if (!d) continue;
    if (options.some(o => eq(o, d))) continue;
    options.push(d);
  }
  // Deterministic fallback so we always reach 5 unique options — matched to
  // the question's panel style so a fallback never stands out as the odd one.
  const fallbacks = [];
  if (q.next.cells && q.next.cells.some(c => c)) {
    for (let k = 1; k <= 8; k++) {
      const cells = Array(9).fill(null);
      for (let j = 0; j < k; j++) cells[FILL9[j]] = { kind: 'circle', fill: 'solid', scale: 0.85 };
      fallbacks.push(q.next.grid3 ? { grid3: true, cells } : { cells });
    }
  } else if (q.next.center) {
    for (const kind of SHAPES) fallbacks.push({ center: { kind, fill: 'solid' } });
  } else {
    for (let qd = 0; qd < 4; qd++) fallbacks.push({ divider: true, shaded: [qd] });
    for (let qd = 0; qd < 4; qd++) fallbacks.push({ divider: true, shaded: [qd, cwq(qd, 1)] });
  }
  for (const f of fallbacks) {
    if (options.length >= OPTION_COUNT) break;
    if (!options.some(o => eq(o, f))) options.push(f);
  }

  const shuffled = R.shuffle(options.map((p, i) => ({ p, isAnswer: i === 0 })));
  return {
    type: q.type,
    frames: q.frames,
    options: shuffled.map(o => o.p),
    answerIndex: shuffled.findIndex(o => o.isAnswer),
    rule: q.rule,
    difficulty,
  };
}
