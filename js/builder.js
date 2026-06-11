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
  const sortedSizes = spec.sizes ? spec.sizes.slice().sort((a, b) => a - b) : null;
  const sizeRow = sortedSizes ? `
    <div class="bld-controls">
      <span class="bld-ctl-label">Size</span>
      ${sortedSizes.map((s, i) => `<button type="button" class="bld-size" data-size="${s}" title="Size ${i + 1}"><span style="font-size:${9 + i * 4}px;line-height:1">●</span></button>`).join('')}
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
  // The canvas itself is the tap target: an invisible 3x3 grid is laid over the
  // preview in wire(), so players add/remove dots by tapping inside the box.
  if (spec.dotMode === 'count') {
    return `
      <div class="bld-stage bld-stage-center">
        <div class="bld-canvas-wrap">
          <div class="bld-dotbox"><div class="bld-canvas"></div></div>
          <div class="bld-controls">
            <button type="button" class="bld-step" data-step="-1" aria-label="Remove a dot">−</button>
            <span class="bld-count" aria-live="polite">0 dots</span>
            <button type="button" class="bld-step" data-step="1" aria-label="Add a dot">+</button>
          </div>
          <div class="bld-hint">Tap inside the box to add or remove a dot.</div>
        </div>
      </div>`;
  }
  return `
    <div class="bld-stage bld-stage-center">
      <div class="bld-canvas-wrap">
        <div class="bld-dotbox"><div class="bld-canvas"></div></div>
        <div class="bld-hint">Tap inside the box to add or remove a dot.</div>
      </div>
    </div>`;
}

/* Drag-and-drop (with a tap fallback): the palette below holds one draggable
   swatch per fill. Drag a swatch onto a section, or tap a swatch to pick it up
   then tap a section to drop it. Tapping a section with no swatch picked clears
   it. */
function nestedShell(spec) {
  const legend = spec.states.map((s, k) =>
    `<button type="button" class="bld-legend-chip" data-state="${k}" draggable="true" aria-label="Fill ${k + 1}">${textureSwatchSvg(s.texture || null, s.color || null, 24)}</button>`).join('');
  return `
    <div class="bld-stage bld-stage-center">
      <div class="bld-canvas-wrap">
        <div class="bld-nested-wrap">
          <div class="bld-canvas"></div>
        </div>
        <div class="bld-hint">Drag a fill into a section — or tap a fill, then a section. Tap a filled section to clear it.</div>
        <div class="bld-legend" aria-label="Available fills — drag onto a section">${legend}</div>
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
    // An invisible 3x3 grid laid over the preview turns "tap inside the box"
    // into add/remove. Cells outside the puzzle's usable positions are inert.
    const box = root.querySelector('.bld-dotbox');
    const overlay = document.createElement('div');
    overlay.className = 'bld-dotgrid-overlay';
    const usable = p => (spec.dotMode === 'cells' ? spec.cellPositions.includes(p) : spec.order.includes(p));
    overlay.innerHTML = [0, 1, 2, 3, 4, 5, 6, 7, 8]
      .map(p => `<button type="button" class="bld-cellhit${usable(p) ? '' : ' disabled'}" data-cell="${p}" ${usable(p) ? '' : 'disabled'} aria-label="Cell ${p + 1}"></button>`)
      .join('');
    box.appendChild(overlay);

    overlay.querySelectorAll('[data-cell]:not([disabled])').forEach(b => b.addEventListener('click', () => {
      const p = parseInt(b.dataset.cell, 10);
      if (spec.dotMode === 'count') {
        // Dots fill in a fixed order; tapping sets how far the fill reaches.
        // Tap an empty cell → fill through it; tap a filled cell → stop before it.
        const idx = spec.order.indexOf(p);
        st.count = idx < st.count ? idx : Math.min(spec.maxCount, idx + 1);
      } else if (st.cells.has(p)) {
        st.cells.delete(p);
      } else {
        st.cells.add(p);
      }
      repaint();
    }));

    if (spec.dotMode === 'count') {
      root.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
        const next = st.count + parseInt(b.dataset.step, 10);
        st.count = Math.max(0, Math.min(spec.maxCount, next));
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

    // The "brush": a fill picked up from the palette, applied on tap or drop.
    // -1 means no brush, so a section tap clears it instead.
    let brush = -1;
    const swatches = root.querySelectorAll('.bld-legend-chip[data-state]');
    const reflectBrush = () => swatches.forEach(s => s.classList.toggle('sel', parseInt(s.dataset.state, 10) === brush));
    swatches.forEach(s => {
      const k = parseInt(s.dataset.state, 10);
      s.addEventListener('click', () => { brush = brush === k ? -1 : k; reflectBrush(); });
      s.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', String(k));
        e.dataTransfer.effectAllowed = 'copy';
      });
    });

    const apply = (group, i, val) => { st[group][i] = val; repaint(); };
    overlay.querySelectorAll('.bld-sect').forEach(p => {
      const group = p.dataset.group, i = parseInt(p.dataset.i, 10);
      p.addEventListener('click', () => apply(group, i, brush));
      p.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(group, i, brush); } });
      p.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; p.classList.add('drop'); });
      p.addEventListener('dragleave', () => p.classList.remove('drop'));
      p.addEventListener('drop', e => {
        e.preventDefault();
        p.classList.remove('drop');
        const k = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!Number.isNaN(k)) apply(group, i, k);
      });
    });
    root.querySelector('[data-clear]').addEventListener('click', () => {
      st.outer.fill(-1);
      st.inner.fill(-1);
      brush = -1;
      reflectBrush();
      repaint();
    });
  }
}
