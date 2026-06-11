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

import { renderPanel, textureSwatchSvg } from './panels.js';

const SHAPE_LABEL = {
  triangle: 'Triangle', square: 'Square', circle: 'Circle', pentagon: 'Pentagon',
  hexagon: 'Hexagon', diamond: 'Diamond', star: 'Star', cross: 'Cross',
};
const TEXTURE_LABEL = { stripes: 'Stripes', dots: 'Dots', crosshatch: 'Hatch', checker: 'Checker' };
const QUAD_LABEL = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];

const PREVIEW_SIZE = 150;

/* ---------- shared bits ---------- */

function shapeBtn(kind, selected) {
  return `<button type="button" class="bld-chip${selected ? ' sel' : ''}" data-shape="${kind}" title="${SHAPE_LABEL[kind] || kind}">
    ${renderPanel({ center: { kind, fill: 'outline' } }, 34)}</button>`;
}

function fillBtn(fill, selected) {
  const swatch = fill === 'outline'
    ? textureSwatchSvg(null, null, 28)
    : fill === 'solid'
      ? `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><rect x="1" y="1" width="26" height="26" fill="#111"/></svg>`
      : textureSwatchSvg(null, fill, 28);
  const label = fill === 'outline' ? 'Outline' : fill === 'solid' ? 'Solid' : fill;
  return `<button type="button" class="bld-chip${selected ? ' sel' : ''}" data-fill="${fill}" title="${label}">${swatch}</button>`;
}

function colorBtn(color, selected) {
  return `<button type="button" class="bld-chip${selected ? ' sel' : ''}" data-color="${color}" title="${color}">${textureSwatchSvg(null, color, 28)}</button>`;
}

function textureBtn(texture, selected) {
  return `<button type="button" class="bld-chip${selected ? ' sel' : ''}" data-texture="${texture}" title="${TEXTURE_LABEL[texture] || texture}">${textureSwatchSvg(texture, null, 28)}</button>`;
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
    return { nested: { outer: st.outer.map(cloneSec), inner: st.inner.map(cloneSec) } };
  }
  return {};
}

function cloneSec(s) {
  if (!s || (!s.color && !s.texture)) return null;
  const o = {};
  if (s.color) o.color = s.color;
  if (s.texture) o.texture = s.texture;
  return o;
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
      slot: { group: 'outer', i: 0 },
      outer: [null, null, null, null],
      inner: [null, null, null, null],
    };
  }
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

function nestedShell(spec) {
  const slotBtns = group => [0, 1, 2, 3].map(i =>
    `<button type="button" class="bld-slot${group === 'outer' && i === 0 ? ' sel' : ''}" data-group="${group}" data-i="${i}">${QUAD_LABEL[i]}</button>`).join('');
  return `
    <div class="bld-stage">
      <div class="bld-palette bld-colors">
        <div class="bld-palette-title">Color</div>
        ${spec.colors.map(c => colorBtn(c, false)).join('')}
        <button type="button" class="bld-chip bld-blank" data-color="">None</button>
      </div>
      <div class="bld-canvas-wrap">
        <div class="bld-canvas"></div>
        <div class="bld-controls bld-slot-row"><span class="bld-ctl-label">Outer</span>${slotBtns('outer')}</div>
        <div class="bld-controls bld-slot-row"><span class="bld-ctl-label">Inner</span>${slotBtns('inner')}</div>
        <button type="button" class="bld-clear" data-clear="1">Clear section</button>
      </div>
      <div class="bld-palette bld-textures">
        <div class="bld-palette-title">Texture</div>
        ${spec.textures.map(t => textureBtn(t, false)).join('')}
        <button type="button" class="bld-chip bld-blank" data-texture="">None</button>
      </div>
    </div>`;
}

function shellFor(spec) {
  if (spec.kind === 'dots') return dotsShell(spec);
  if (spec.kind === 'nested') return nestedShell(spec);
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
    canvas.innerHTML = renderPanel(toPanel(spec, st), PREVIEW_SIZE);
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

  if (spec.kind === 'nested') {
    const cur = () => st[st.slot.group][st.slot.i] || (st[st.slot.group][st.slot.i] = {});
    root.querySelectorAll('[data-group]').forEach(b => b.addEventListener('click', () => {
      st.slot = { group: b.dataset.group, i: parseInt(b.dataset.i, 10) };
      root.querySelectorAll('[data-group]').forEach(x =>
        x.classList.toggle('sel', x.dataset.group === b.dataset.group && x.dataset.i === b.dataset.i));
      const sec = st[st.slot.group][st.slot.i];
      setSel('[data-color]', 'color', sec && sec.color ? sec.color : '');
      setSel('[data-texture]', 'texture', sec && sec.texture ? sec.texture : '');
    }));
    root.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => {
      const sec = cur();
      sec.color = b.dataset.color || undefined;
      setSel('[data-color]', 'color', b.dataset.color);
      normalizeSlot(st);
      repaint();
    }));
    root.querySelectorAll('[data-texture]').forEach(b => b.addEventListener('click', () => {
      const sec = cur();
      sec.texture = b.dataset.texture || undefined;
      setSel('[data-texture]', 'texture', b.dataset.texture);
      normalizeSlot(st);
      repaint();
    }));
    root.querySelector('[data-clear]').addEventListener('click', () => {
      st[st.slot.group][st.slot.i] = null;
      setSel('[data-color]', 'color', '');
      setSel('[data-texture]', 'texture', '');
      repaint();
    });
  }
}

/* An all-undefined section collapses to blank (null) so grading is consistent. */
function normalizeSlot(st) {
  const sec = st[st.slot.group][st.slot.i];
  if (sec && !sec.color && !sec.texture) st[st.slot.group][st.slot.i] = null;
}
