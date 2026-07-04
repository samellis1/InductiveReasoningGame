/* Inline answer engine. The blank "?" slot inside the puzzle IS the answer:
   players click dots straight into it, drag fills onto its sections, or watch
   it fill as they type. A tray below the puzzle holds palettes/pads/submit.

   mountAnswer(slot, tray, spec, onSubmit):
     slot — the "?" element inside the sequence/matrix/weeks layout
     tray — the area under the puzzle (palettes, pads, submit button)
   Grading lives in game.js (panelEq against the question's `next`).

   answerSpec kinds (produced by generators.js):
     center        { shapes, fills }            single centered shape
     centerNested  { shapes, fills }            outer + inner shape
     dots          { cellPositions, dotToken, grid3 }  click cells in the slot
     nested        { shape, n, states }         drag/tap fills onto sections
     number        { maxLen }                   digit pad; slot shows the value
     week          {}                           tap day cells in the answer row
     pickday       {}                           tap the one valid day
     month         { days, marks? }             tap days on a month calendar
     bars          { labels, max, unit? }       drag bars up/down
*/

import { renderPanel, textureSwatchSvg, nestedSectionPaths } from './panels.js';

const SHAPE_LABEL = {
  triangle: 'Triangle', square: 'Square', circle: 'Circle', pentagon: 'Pentagon',
  hexagon: 'Hexagon', diamond: 'Diamond', star: 'Star', cross: 'Cross',
};
const SLOT_SIZE = 150;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ---------- chips ---------- */

function shapeBtn(kind) {
  const label = SHAPE_LABEL[kind] || kind;
  return `<button type="button" class="bld-chip" data-shape="${kind}" title="${label}">
    ${renderPanel({ center: { kind, fill: 'outline' } }, 44)}<span class="bld-chip-label">${label}</span></button>`;
}

function fillBtn(fill) {
  const swatch = fill === 'outline'
    ? textureSwatchSvg(null, null, 34)
    : fill === 'solid'
      ? `<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><rect x="1" y="1" width="32" height="32" fill="#111"/></svg>`
      : textureSwatchSvg(null, fill, 34);
  const label = fill === 'outline' ? 'Outline' : fill === 'solid' ? 'Solid' : fill;
  return `<button type="button" class="bld-chip" data-fill="${fill}" title="${label}">${swatch}<span class="bld-chip-label">${label}</span></button>`;
}

/* ---------- panel assembly ---------- */

function toPanel(spec, st) {
  if (spec.kind === 'center' || spec.kind === 'centerNested') {
    if (!st.outer.kind) return {};
    const center = { kind: st.outer.kind, fill: st.outer.fill };
    if (spec.kind === 'centerNested' && st.inner.kind) {
      center.inner = { kind: st.inner.kind, fill: st.inner.fill };
    }
    return { center };
  }
  if (spec.kind === 'dots') {
    const cells = Array(9).fill(null);
    for (const p of st.cells) cells[p] = { ...spec.dotToken };
    return spec.grid3 ? { grid3: true, cells } : { cells };
  }
  if (spec.kind === 'nested') {
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
  if (spec.kind === 'month') {
    return { month: { days: spec.days, marks: [...st.marked].sort((a, b) => a - b) } };
  }
  if (spec.kind === 'bars') return { bars: st.values.slice() };
  return {};
}

function initialState(spec) {
  if (spec.kind === 'center' || spec.kind === 'centerNested') {
    return {
      slot: 'outer',
      outer: { kind: null, fill: spec.fills[0] },
      inner: { kind: null, fill: spec.fills[0] },
    };
  }
  if (spec.kind === 'dots') return { cells: new Set() };
  if (spec.kind === 'nested') {
    return { outer: Array(spec.n).fill(-1), inner: spec.single ? [] : Array(spec.n).fill(-1) };
  }
  if (spec.kind === 'number') return { value: '' };
  if (spec.kind === 'week') return { days: Array(7).fill(false) };
  if (spec.kind === 'pickday') return { day: -1 };
  if (spec.kind === 'month') return { marked: new Set() };
  if (spec.kind === 'bars') return { values: spec.labels.map(() => 0) };
  return {};
}

/* ---------- tray markup per kind ---------- */

function trayFor(spec) {
  if (spec.kind === 'center' || spec.kind === 'centerNested') {
    const slotRow = spec.kind === 'centerNested' ? `
      <div class="bld-controls">
        <span class="bld-ctl-label">Editing</span>
        <button type="button" class="bld-slot sel" data-slot="outer">Outer shape</button>
        <button type="button" class="bld-slot" data-slot="inner">Inner shape</button>
      </div>` : '';
    return `
      ${slotRow}
      <div class="bld-tray-row">
        <div class="bld-palette bld-shapes">
          <div class="bld-palette-title">Shapes</div>
          ${spec.shapes.map(shapeBtn).join('')}
        </div>
        <div class="bld-palette bld-fills">
          <div class="bld-palette-title">Fill</div>
          ${spec.fills.map(fillBtn).join('')}
        </div>
      </div>`;
  }
  if (spec.kind === 'dots') {
    return `<div class="bld-hint">Tap inside the answer box to add or remove a dot.</div>`;
  }
  if (spec.kind === 'nested') {
    const legend = spec.states.map((s, k) =>
      `<button type="button" class="bld-legend-chip" data-state="${k}" aria-label="Fill ${k + 1}">${textureSwatchSvg(s.texture || null, s.color || null, 38)}</button>`).join('');
    return `
      <div class="bld-tray-head">
        <span class="bld-hint">Drag a fill into a section of the answer — or tap a fill, then a section.</span>
        <button type="button" class="bld-clear" data-clear="1">Clear all</button>
      </div>
      <div class="bld-legend" aria-label="Available fills — drag onto a section">${legend}</div>`;
  }
  if (spec.kind === 'number') {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
    return `
      <div class="bld-numpad">
        ${keys.map(k => `<button type="button" class="bld-key" data-key="${k}">${k}</button>`).join('')}
      </div>`;
  }
  if (spec.kind === 'week' || spec.kind === 'pickday') {
    return `<div class="bld-hint">${spec.kind === 'pickday'
      ? 'Tap the one day in the answer row that fits every rule.'
      : 'Tap the days in the answer row to mark them.'}</div>`;
  }
  if (spec.kind === 'month') {
    return `
      <div class="bld-tray-head">
        <span class="bld-hint">Tap every day on the calendar that fits all the requirements.</span>
        <button type="button" class="bld-clear" data-clear="1">Clear all</button>
      </div>`;
  }
  if (spec.kind === 'bars') {
    return `<div class="bld-hint">Drag each bar up or down to set its value.</div>`;
  }
  return '';
}

/* ---------- public entry ---------- */

export function mountAnswer(slot, tray, spec, onSubmit) {
  // Kill any document-level listener from the previous question. (The old
  // cleanup tagged the handler on the slot element, but the slot is rebuilt
  // every question — handlers piled up across rounds.)
  if (mountAnswer._docKeyHandler) {
    document.removeEventListener('keydown', mountAnswer._docKeyHandler);
    mountAnswer._docKeyHandler = null;
  }

  const st = initialState(spec);
  slot.classList.add('answer-slot');
  slot.innerHTML = '';

  tray.innerHTML = `
    <div class="builder" data-kind="${spec.kind}">
      ${trayFor(spec)}
      <button type="button" class="bld-submit next">Submit answer</button>
    </div>`;
  const root = tray.querySelector('.builder');

  /* The slot's live canvas. Interactive overlays mount on top of it. */
  const canvas = document.createElement('div');
  canvas.className = 'slot-canvas';
  slot.appendChild(canvas);

  function repaint() {
    if (spec.kind === 'number') {
      canvas.innerHTML = `<div class="slot-number">${st.value || '<span class="slot-ph">?</span>'}</div>`;
      return;
    }
    if (spec.kind === 'week' || spec.kind === 'pickday') {
      canvas.innerHTML = weekAnswerHtml(spec, st);
      wireWeekCells();
      return;
    }
    if (spec.kind === 'month') {
      canvas.innerHTML = monthAnswerHtml(spec, st);
      wireMonthCells();
      return;
    }
    if (spec.kind === 'bars') {
      canvas.innerHTML = barsHtml(spec, st);
      return; // bar drag handlers attach once, on the wrapper (delegated)
    }
    const panel = toPanel(spec, st);
    const empty = spec.kind !== 'nested' && !panel.center && !(panel.cells || []).some(c => c);
    canvas.innerHTML = empty && spec.kind !== 'dots'
      ? `<span class="slot-ph">?</span>`
      : renderPanel(panel, SLOT_SIZE);
  }

  function setSel(selector, attr, value) {
    root.querySelectorAll(selector).forEach(b => b.classList.toggle('sel', b.dataset[attr] === String(value)));
  }

  /* ----- per-kind wiring ----- */

  if (spec.kind === 'center' || spec.kind === 'centerNested') {
    const target = () => (spec.kind === 'centerNested' ? st[st.slot] : st.outer);
    root.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => {
      st.slot = b.dataset.slot;
      setSel('[data-slot]', 'slot', st.slot);
      setSel('[data-fill]', 'fill', target().fill);
      setSel('[data-shape]', 'shape', target().kind);
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
    setSel('[data-fill]', 'fill', st.outer.fill);
  }

  if (spec.kind === 'dots') {
    // Invisible 3x3 hit-grid over the slot: tap a cell to toggle its dot.
    const overlay = document.createElement('div');
    overlay.className = 'slot-dotgrid';
    const usable = p => spec.cellPositions.includes(p);
    overlay.innerHTML = [0, 1, 2, 3, 4, 5, 6, 7, 8]
      .map(p => `<button type="button" class="bld-cellhit${usable(p) ? '' : ' disabled'}" data-cell="${p}" ${usable(p) ? '' : 'disabled'} aria-label="Cell ${p + 1}"></button>`)
      .join('');
    slot.appendChild(overlay);
    overlay.querySelectorAll('[data-cell]:not([disabled])').forEach(b => b.addEventListener('click', () => {
      const p = parseInt(b.dataset.cell, 10);
      if (st.cells.has(p)) st.cells.delete(p); else st.cells.add(p);
      repaint();
    }));
  }

  if (spec.kind === 'nested') {
    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('viewBox', `0 0 ${SLOT_SIZE} ${SLOT_SIZE}`);
    overlay.setAttribute('class', 'bld-nested-overlay');
    overlay.innerHTML = nestedSectionPaths(spec.shape, SLOT_SIZE)
      .filter(sec => !spec.single || sec.group !== 'inner')
      .map(sec => `<path d="${sec.d}" data-group="${sec.group}" data-i="${sec.i}" class="bld-sect"
        role="button" tabindex="0" aria-label="${sec.group} section ${sec.i + 1}"/>`)
      .join('');
    slot.appendChild(overlay);

    // The "brush": a fill picked up from the tray, applied on tap or drag.
    // -1 = no brush, so tapping a section clears it.
    //
    // Dragging uses POINTER events (HTML5 drag-and-drop never fires on
    // iOS/Android): pointerdown on a chip arms it; moving past a small
    // threshold spawns a ghost swatch that follows the finger/cursor; release
    // hit-tests the section under the pointer. A press-and-release without
    // movement is a tap, which toggles the brush.
    let brush = -1;
    const swatches = root.querySelectorAll('.bld-legend-chip[data-state]');
    const reflectBrush = () => swatches.forEach(s => s.classList.toggle('sel', parseInt(s.dataset.state, 10) === brush));
    const apply = (group, i, val) => { st[group][i] = val; repaint(); };

    swatches.forEach(s => {
      const k = parseInt(s.dataset.state, 10);
      s.setAttribute('draggable', 'false'); // suppress native DnD on desktop
      s.addEventListener('pointerdown', e => {
        const startX = e.clientX, startY = e.clientY;
        let ghost = null;
        let hovered = null;
        const move = ev => {
          if (!ghost && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
            ghost = s.cloneNode(true);
            ghost.classList.add('bld-drag-ghost');
            document.body.appendChild(ghost);
          }
          if (ghost) {
            ghost.style.left = ev.clientX + 'px';
            ghost.style.top = ev.clientY + 'px';
            const el = document.elementFromPoint(ev.clientX, ev.clientY);
            const sect = el && el.closest ? el.closest('.bld-sect') : null;
            if (hovered && hovered !== sect) hovered.classList.remove('drop');
            hovered = sect;
            if (hovered) hovered.classList.add('drop');
            ev.preventDefault();
          }
        };
        const up = ev => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          document.removeEventListener('pointercancel', up);
          if (hovered) hovered.classList.remove('drop');
          if (ghost) {
            ghost.remove();
            const el = document.elementFromPoint(ev.clientX, ev.clientY);
            const sect = el && el.closest ? el.closest('.bld-sect') : null;
            if (sect) apply(sect.dataset.group, parseInt(sect.dataset.i, 10), k);
          } else {
            brush = brush === k ? -1 : k; // plain tap: pick up / put down the brush
            reflectBrush();
          }
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
        e.preventDefault();
      });
    });

    overlay.querySelectorAll('.bld-sect').forEach(p => {
      const group = p.dataset.group, i = parseInt(p.dataset.i, 10);
      p.addEventListener('click', () => apply(group, i, brush));
      p.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(group, i, brush); } });
    });
    root.querySelector('[data-clear]').addEventListener('click', () => {
      st.outer.fill(-1);
      st.inner.fill(-1);
      brush = -1;
      reflectBrush();
      repaint();
    });
  }

  if (spec.kind === 'number') {
    const press = k => {
      if (k === 'C') st.value = '';
      else if (k === '⌫') st.value = st.value.slice(0, -1);
      else if (st.value.length < (spec.maxLen || 8)) st.value += k;
      repaint();
    };
    root.querySelectorAll('.bld-key').forEach(b => b.addEventListener('click', () => press(b.dataset.key)));
    // Physical keyboard: digits type, Backspace deletes, Enter submits.
    // Registered module-level so the next mountAnswer call cleans it up.
    mountAnswer._docKeyHandler = e => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Enter' && st.value) {
        const btn = root.querySelector('.bld-submit');
        if (btn && document.contains(btn)) { e.preventDefault(); btn.click(); }
      }
    };
    document.addEventListener('keydown', mountAnswer._docKeyHandler);
  }

  function wireWeekCells() {
    canvas.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
      const i = parseInt(b.dataset.day, 10);
      if (spec.kind === 'pickday') st.day = st.day === i ? -1 : i;
      else st.days[i] = !st.days[i];
      repaint();
    }));
  }

  function wireMonthCells() {
    canvas.querySelectorAll('[data-mday]').forEach(b => b.addEventListener('click', () => {
      const d = parseInt(b.dataset.mday, 10);
      if (st.marked.has(d)) st.marked.delete(d); else st.marked.add(d);
      repaint();
    }));
  }

  if (spec.kind === 'month') {
    root.querySelector('[data-clear]').addEventListener('click', () => {
      st.marked.clear();
      repaint();
    });
  }

  if (spec.kind === 'bars') {
    // Pointer-drag on each bar column; values snap to integers in [0, max].
    let drag = null; // { idx, rect }
    canvas.addEventListener('pointerdown', e => {
      const col = e.target.closest('[data-bar]');
      if (!col) return;
      const idx = parseInt(col.dataset.bar, 10);
      const rect = canvas.querySelector(`.bar-track[data-track="${idx}"]`).getBoundingClientRect();
      drag = { idx, rect };
      canvas.setPointerCapture(e.pointerId);
      setFromY(e.clientY);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', e => { if (drag) setFromY(e.clientY); });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    function setFromY(y) {
      const { idx, rect } = drag;
      const frac = 1 - Math.max(0, Math.min(1, (y - rect.top) / rect.height));
      const v = Math.round(frac * spec.max);
      if (v === st.values[idx]) return;
      st.values[idx] = v;
      // Mutate in place — a full re-render per pointermove destroys the node
      // being dragged and stutters on phones.
      const col = canvas.querySelector(`[data-bar="${idx}"]`);
      if (col) {
        col.querySelector('.bar-fill').style.height = Math.round((v / spec.max) * 100) + '%';
        col.querySelector('.bar-val').textContent = `${v}${spec.unit || ''}`;
      }
    }
  }

  // Brief lockout so an accidental double-tap can't burn two tries.
  const submitBtn = root.querySelector('.bld-submit');
  submitBtn.addEventListener('click', () => {
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    setTimeout(() => { submitBtn.disabled = false; }, 400);
    onSubmit(toPanel(spec, st));
  });
  repaint();
}

/* Back-compat name used by game.js prior to the inline rework. */
export { mountAnswer as renderBuilder };

/* ---------- inline-slot markup helpers ---------- */

function weekAnswerHtml(spec, st) {
  const on = i => (spec.kind === 'pickday' ? st.day === i : st.days[i]);
  return `<div class="slot-week">${DAY_LABELS.map((d, i) =>
    `<button type="button" class="slot-day${on(i) ? ' sel' : ''}" data-day="${i}">
      <span class="slot-day-name">${d}</span><span class="slot-day-dot">${on(i) ? '●' : ''}</span>
    </button>`).join('')}</div>`;
}

function monthAnswerHtml(spec, st) {
  const marks = spec.marks || {};
  const head = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span class="m-head">${d}</span>`).join('');
  const cells = [];
  for (let d = 1; d <= spec.days; d++) {
    const sym = marks[d] === 'star' ? '★' : marks[d] === 'diamond' ? '◆' : '';
    cells.push(`<button type="button" class="m-day${st.marked.has(d) ? ' sel' : ''}" data-mday="${d}">
      <span class="m-num">${d}</span>${sym ? `<span class="m-sym">${sym}</span>` : ''}
    </button>`);
  }
  return `<div class="slot-month">${head}${cells.join('')}</div>`;
}

function barsHtml(spec, st) {
  return `<div class="slot-bars">${spec.labels.map((label, i) => {
    const v = st.values[i];
    const pct = Math.round((v / spec.max) * 100);
    return `
      <div class="bar-col" data-bar="${i}">
        <div class="bar-val">${v}${spec.unit || ''}</div>
        <div class="bar-track" data-track="${i}">
          <div class="bar-fill" style="height:${pct}%"></div>
        </div>
        <div class="bar-label">${label}</div>
      </div>`;
  }).join('')}</div>`;
}
