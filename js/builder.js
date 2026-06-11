/* The "construct your answer" UI. Instead of picking from A–E, the player builds
   the answer panel: a live-preview canvas flanked by palettes (shapes on one
   side, colors on the other), plus contextual controls per puzzle kind.

   renderBuilder(container, spec, onSubmit) renders the UI and calls
   onSubmit(builtPanel) when the player commits. Grading lives in game.js, which
   compares the built panel to the question's correct `next` panel via panelEq.

   answerSpec kinds (produced by generators.js):
     center        { shapes, fills, sizes? }                 single centered shape
     centerNested  { shapes, fills }                         outer + inner shape
     dots          { dotMode:'count'|'cells', dotToken, grid3,
                     order?, maxCount?, cellPositions? }      dot patterns
     nested        { colors, textures }                      the nested-squares puzzle
*/

import { renderPanel, textureSwatchSvg, nestedSectionPaths } from './panels.js';

const SHAPE_LABEL = {
  triangle: 'Triangle', square: 'Square', circle: 'Circle', pentagon: 'Pentagon',
  hexagon: 'Hexagon', diamond: 'Diamond', star: 'Star', cross: 'Cross',
};
const PREVIEW_SIZE = 150;

/* ---------- shared bits ---------- */

function shapeBtn(kind, selected) {
  const label = SHAPE_LABEL[kind] || kind;
  return `<button type="button" class="bld-chip${selected ? ' sel' : ''}" data-shape="${kind}" title="${label}">
    ${renderPanel({ center: { kind, fill: 'outline' } }, 44)}<span class="bld-chip-label">${label}</span></button>`;
}

function fillBtn(fill, selected) {
  const swatch = fill === 'outline'
    ? textureSwatchSvg(null, null, 34)
    : fill === 'solid'
      ? `<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><rect x="1" y="1" width="32" height="32" fill="#111"/></svg>`
      : textureSwatchSvg(null, fill, 34);
  const label = fill === 'outline' ? 'Outline' : fill === 'solid' ? 'Solid' : fill;
  return `<button type="button" class="bld-chip${selected ? ' sel' : ''}" data-fill="${fill}" title="${label}">${swatch}<span class="bld-chip-label">${label}</span></button>`;
}

/* ---------- panel assembly from builder state ---------- */

function toPanel(spec, st) {
  if (spec.kind === 'center' || spec.kind === 'centerNested') {
    if (!st.outer.kind) return {}; // nothing built yet
    const center = { kind: st.outer.kind, fill: st.outer.fill };
    if (spec.sizes) center.scale = st.outer.scale;
    if (spec.kind === 'centerNested' && st.inner.kind) {
      center.inner = { kind: st.inner.kind, fill: st.inner.fill };
    }
    return { center };
  }
  if (spec.kind === 'dots') {
    const cells = Array(9).fill(null);
    if (spec.dotMode === 'count') {
      for (let k = 0; k < st.count && k < spec.order.length; k++) cells[spec.order[k]] = { ...spec.dotToken };
    } else {
      for (const p of st.cells) cells[p] = { ...spec.dotToken };
    }
    return spec.grid3 ? { grid3: true, cells } : { cells };
  }
  if (spec.kind === 'nested') {
    // st.outer/st.inner hold cycle indices: -1 = blank, k = spec.states[k].
    const toSections = idxs => idxs.map(k => (k < 0 ? null : { ...spec.states[k] }));
    return { nested: { shape: spec.shape, outer: toSections(st.outer), inner: toSections(st.inner) } };
  }
  if (spec.kind === 'number') return { text: st.value };
  if (spec.kind === 'week') return { week: { days: st.days.map(on => (on ? 'mark' : null)) } };
  if (spec.kind === 'pickday') {
    const days = Array(7).fill(null);
    if (st.day >= 0) days[st.day] = 'mark';
    return { week: { days } };
  }
  return {};
}

function initialState(spec) {
  if (spec.kind === 'center' || spec.kind === 'centerNested') {
    return {
      slot: 'outer',
      outer: { kind: null, fill: spec.fills[0], scale: spec.sizes ? spec.sizes[Math.floor(spec.sizes.length / 2)] : 1 },
      inner: { kind: null, fill: spec.fills[0] },
    };
  }
  if (spec.kind === 'dots') {
    return spec.dotMode === 'count' ? { count: 0 } : { cells: new Set() };
  }
  if (spec.kind === 'nested') {
    return {
      outer: Array(spec.n).fill(-1),
      inner: Array(spec.n).fill(-1),
    };
  }
  if (spec.kind === 'number') return { value: '' };
  if (spec.kind === 'week') return { days: Array(7).fill(false) };
  if (spec.kind === 'pickday') return { day: -1 };
  return {};
}

/* ---------- per-kind shells + wiring ---------- */

function centerShell(spec) {
  const nested = spec.kind === 'centerNested';
  const sizeRow = spec.sizes ? `
    <div class="bld-controls">
      <span class="bld-ctl-label">Size</span>
      ${spec.sizes.map((s, i) => `<button type="button" class="bld-size" data-size="${s}" title="Size ${i + 1}"><span style="font-size:${9 + i * 4}px;line-height:1">●</span></button>`).join('')}
    </div>` : '';
  const slotRow = nested ? `
    <div class="bld-controls">
      <span class="bld-ctl-label">Editing</span>
      <button type="button" class="bld-slot sel" data-slot="outer">Outer shape</button>
      <button type="button" class="bld-slot" data-slot="inner">Inner shape</button>
    </div>` : '';
  return `
    <div class="bld-stage">
      <div class="bld-palette bld-shapes">
        <div class="bld-palette-title">Shapes</div>
        ${spec.shapes.map(k => shapeBtn(k, false)).join('')}
      </div>
      <div class="bld-canvas-wrap">
        <div class="bld-canvas"></div>
        ${slotRow}
        ${sizeRow}
      </div>
      <div class="bld-palette bld-fills">
        <div class="bld-palette-title">Fill</div>
        ${spec.fills.map(f => fillBtn(f, false)).join('')}
      </div>
    </div>`;
}

function dotsShell(spec) {
  if (spec.dotMode === 'count') {
    return `
      <div class="bld-stage bld-stage-center">
        <div class="bld-canvas-wrap">
          <div class="bld-canvas"></div>
          <div class="bld-controls">
            <button type="button" class="bld-step" data-step="-1" aria-label="Remove a dot">−</button>
            <span class="bld-count" aria-live="polite">0 dots</span>
            <button type="button" class="bld-step" data-step="1" aria-label="Add a dot">+</button>
          </div>
        </div>
      </div>`;
  }
  return `
    <div class="bld-stage bld-stage-center">
      <div class="bld-canvas-wrap">
        <div class="bld-canvas"></div>
        <div class="bld-hint">Tap the cells to place dots.</div>
      </div>
    </div>`;
}

/* Tap-to-cycle: each section of the preview is a click target that steps
   through blank → state1 → state2 → … → blank. A passive legend shows the
   cycle order so players know what's coming. */
function nestedShell(spec) {
  const legend = spec.states.map(s => `<span class="bld-legend-chip">${textureSwatchSvg(s.texture || null, s.color || null, 24)}</span>`).join('');
  return `
    <div class="bld-stage bld-stage-center">
      <div class="bld-canvas-wrap">
        <div class="bld-nested-wrap">
          <div class="bld-canvas"></div>
        </div>
        <div class="bld-hint">Tap any section to cycle its fill.</div>
        <div class="bld-legend" aria-label="Available fills">${legend}</div>
        <button type="button" class="bld-clear" data-clear="1">Clear all</button>
      </div>
    </div>`;
}

function numberShell() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
  return `
    <div class="bld-stage bld-stage-center">
      <div class="bld-canvas-wrap">
        <div class="bld-numpad-display" aria-live="polite">&nbsp;</div>
        <div class="bld-numpad">
          ${keys.map(k => `<button type="button" class="bld-key" data-key="${k}">${k}</button>`).join('')}
        </div>
      </div>
    </div>`;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function weekShell(single) {
  return `
    <div class="bld-stage bld-stage-center">
      <div class="bld-canvas-wrap">
        <div class="bld-canvas bld-canvas-wide"></div>
        <div class="bld-weekrow">
          ${DAY_LABELS.map((d, i) => `<button type="button" class="bld-day" data-day="${i}">${d}</button>`).join('')}
        </div>
        <div class="bld-hint">${single ? 'Pick the one day that fits every rule.' : 'Tap the days to mark them good.'}</div>
      </div>
    </div>`;
}

function shellFor(spec) {
  if (spec.kind === 'dots') return dotsShell(spec);
  if (spec.kind === 'nested') return nestedShell(spec);
  if (spec.kind === 'number') return numberShell();
  if (spec.kind === 'week') return weekShell(false);
  if (spec.kind === 'pickday') return weekShell(true);
  return centerShell(spec);
}

/* ---------- public entry ---------- */

export function renderBuilder(container, spec, onSubmit) {
  const st = initialState(spec);
  container.innerHTML = `
    <div class="builder" data-kind="${spec.kind}">
      ${shellFor(spec)}
      <button type="button" class="bld-submit next">Submit answer</button>
    </div>`;

  const root = container.querySelector('.builder');
  const canvas = root.querySelector('.bld-canvas');

  function setSel(selector, attr, value) {
    root.querySelectorAll(selector).forEach(b => b.classList.toggle('sel', b.dataset[attr] === String(value)));
  }

  function repaint() {
    if (spec.kind === 'number') {
      root.querySelector('.bld-numpad-display').textContent = st.value || ' ';
      return;
    }
    const size = spec.kind === 'week' || spec.kind === 'pickday' ? 330 : PREVIEW_SIZE;
    canvas.innerHTML = renderPanel(toPanel(spec, st), size);
    if (spec.kind === 'dots' && spec.dotMode === 'count') {
      root.querySelector('.bld-count').textContent = `${st.count} ${st.count === 1 ? 'dot' : 'dots'}`;
    }
  }

  wire(root, spec, st, repaint, setSel);

  // Reflect initial state in the palette highlights.
  if (spec.kind === 'center' || spec.kind === 'centerNested') {
    setSel('[data-fill]', 'fill', st.outer.fill);
    if (spec.sizes) setSel('[data-size]', 'size', st.outer.scale);
  }

  root.querySelector('.bld-submit').addEventListener('click', () => onSubmit(toPanel(spec, st)));
  repaint();
}

function wire(root, spec, st, repaint, setSel) {
  if (spec.kind === 'center' || spec.kind === 'centerNested') {
    const target = () => (spec.kind === 'centerNested' ? st[st.slot] : st.outer);
    root.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => {
      st.slot = b.dataset.slot;
      setSel('[data-slot]', 'slot', st.slot);
      // reflect the active slot's current fill selection
      setSel('[data-fill]', 'fill', target().fill);
    }));
    root.querySelectorAll('[data-shape]').forEach(b => b.addEventListener('click', () => {
      target().kind = b.dataset.shape;
      setSel('[data-shape]', 'shape', b.dataset.shape);
      repaint();
    }));
    root.querySelectorAll('[data-fill]').forEach(b => b.addEventListener('click', () => {
      target().fill = b.dataset.fill;
      setSel('[data-fill]', 'fill', b.dataset.fill);
      repaint();
    }));
    root.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => {
      target().scale = parseFloat(b.dataset.size);
      setSel('[data-size]', 'size', b.dataset.size);
      repaint();
    }));
    return;
  }

  if (spec.kind === 'dots') {
    if (spec.dotMode === 'count') {
      root.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
        const next = st.count + parseInt(b.dataset.step, 10);
        st.count = Math.max(0, Math.min(spec.maxCount, next));
        repaint();
      }));
    } else {
      const canvas = root.querySelector('.bld-canvas');
      // Overlay a clickable 3x3 grid aligned to the preview.
      const grid = document.createElement('div');
      grid.className = 'bld-dotgrid';
      grid.innerHTML = [0, 1, 2, 3, 4, 5, 6, 7, 8]
        .map(p => `<button type="button" class="bld-cell${spec.cellPositions.includes(p) ? '' : ' disabled'}" data-cell="${p}" ${spec.cellPositions.includes(p) ? '' : 'disabled'}></button>`)
        .join('');
      canvas.parentElement.insertBefore(grid, canvas.nextSibling);
      grid.querySelectorAll('[data-cell]').forEach(b => b.addEventListener('click', () => {
        const p = parseInt(b.dataset.cell, 10);
        if (st.cells.has(p)) st.cells.delete(p); else st.cells.add(p);
        b.classList.toggle('on', st.cells.has(p));
        repaint();
      }));
    }
    return;
  }

  if (spec.kind === 'number') {
    root.querySelectorAll('.bld-key').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.key;
      if (k === 'C') st.value = '';
      else if (k === '⌫') st.value = st.value.slice(0, -1);
      else if (st.value.length < (spec.maxLen || 8)) st.value += k;
      repaint();
    }));
    return;
  }

  if (spec.kind === 'week') {
    root.querySelectorAll('.bld-day').forEach(b => b.addEventListener('click', () => {
      const i = parseInt(b.dataset.day, 10);
      st.days[i] = !st.days[i];
      b.classList.toggle('sel', st.days[i]);
      repaint();
    }));
    return;
  }

  if (spec.kind === 'pickday') {
    root.querySelectorAll('.bld-day').forEach(b => b.addEventListener('click', () => {
      st.day = parseInt(b.dataset.day, 10);
      root.querySelectorAll('.bld-day').forEach(x => x.classList.toggle('sel', x === b));
      repaint();
    }));
    return;
  }

  if (spec.kind === 'nested') {
    // Transparent SVG overlay with the exact section geometry as tap targets.
    const wrap = root.querySelector('.bld-nested-wrap');
    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('viewBox', `0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}`);
    overlay.setAttribute('class', 'bld-nested-overlay');
    overlay.innerHTML = nestedSectionPaths(spec.shape, PREVIEW_SIZE)
      .map(sec => `<path d="${sec.d}" data-group="${sec.group}" data-i="${sec.i}" class="bld-sect"
        role="button" tabindex="0" aria-label="${sec.group} section ${sec.i + 1}"/>`)
      .join('');
    wrap.appendChild(overlay);

    const cycle = (group, i) => {
      // -1 (blank) → 0 → 1 → … → states.length-1 → -1
      st[group][i] = st[group][i] + 1 >= spec.states.length ? -1 : st[group][i] + 1;
      repaint();
    };
    overlay.querySelectorAll('.bld-sect').forEach(p => {
      const go = () => cycle(p.dataset.group, parseInt(p.dataset.i, 10));
      p.addEventListener('click', go);
      p.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    root.querySelector('[data-clear]').addEventListener('click', () => {
      st.outer.fill(-1);
      st.inner.fill(-1);
      repaint();
    });
  }
}
