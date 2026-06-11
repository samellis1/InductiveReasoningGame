/* Game feel: shake, sounds, streak heat.

   Research-backed constraints (see plan):
   - Shake the puzzle panel, never the viewport: ≤5px, ~500ms, decaying.
   - prefers-reduced-motion: no shake animation (CSS handles the swap to a
     static outline) and no glow pulsing.
   - Sounds: short (<300ms), quiet, synthesized via WebAudio (no asset files),
     created lazily after a user gesture. Mute persists in localStorage.
   - Streak heat: a radial glow behind the play panel whose color walks
     green → gold and intensity grows with consecutive solves. Opacity-only
     animation. Resets on a miss. */

const MUTE_KEY = 'irt-muted-v1';

export const reducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- shake ---------- */

export function shake(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth; // restart the animation on back-to-back wrongs
  el.classList.add('shake');
  el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
}

/* ---------- sound ---------- */

let muted;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { muted = false; }

let ctx = null;
function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function isMuted() { return muted; }

export function setMuted(m) {
  muted = m;
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* ignore */ }
}

/* Call from a user-gesture handler (the GO button) so the context unlocks. */
export function primeAudio() {
  if (!muted) audioCtx();
}

function tone(freq, { start = 0, dur = 0.12, type = 'sine', gain = 0.08, slide = 0 } = {}) {
  const ac = audioCtx();
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function playSound(kind) {
  if (muted) return;
  try {
    if (kind === 'correct') {
      tone(660, { dur: 0.09, gain: 0.07 });
      tone(880, { start: 0.07, dur: 0.12, gain: 0.07 });
    } else if (kind === 'wrong') {
      tone(180, { dur: 0.16, type: 'triangle', gain: 0.09, slide: -60 });
    } else if (kind === 'round') {
      tone(523, { dur: 0.1, gain: 0.06 });
      tone(659, { start: 0.09, dur: 0.1, gain: 0.06 });
      tone(784, { start: 0.18, dur: 0.2, gain: 0.07 });
    }
  } catch { /* audio is decorative — never let it break play */ }
}

/* ---------- streak heat ---------- */

/* Hue walk: cool green → warm gold as the streak climbs. Capped at level 6. */
const HEAT = [
  { hue: null, opacity: 0 },                 // 0 — off
  { hue: '#5bb450', opacity: 0.10 },         // 1
  { hue: '#7cb83f', opacity: 0.16 },         // 2
  { hue: '#a9b832', opacity: 0.22 },         // 3
  { hue: '#cfa928', opacity: 0.28 },         // 4
  { hue: '#e69f00', opacity: 0.34 },         // 5
  { hue: '#f08c00', opacity: 0.42 },         // 6+
];

let glowEl = null;

function ensureGlow() {
  if (glowEl && document.body.contains(glowEl)) return glowEl;
  glowEl = document.createElement('div');
  glowEl.className = 'streak-glow';
  glowEl.setAttribute('aria-hidden', 'true');
  document.body.prepend(glowEl);
  return glowEl;
}

export function setStreakHeat(level) {
  const el = ensureGlow();
  const h = HEAT[Math.max(0, Math.min(HEAT.length - 1, level))];
  if (!h.hue) {
    el.style.opacity = '0';
    return;
  }
  el.style.background =
    `radial-gradient(ellipse at 50% 30%, ${h.hue} 0%, transparent 60%)`;
  el.style.opacity = String(h.opacity);
  if (!reducedMotion()) {
    el.classList.remove('glow-tick');
    void el.offsetWidth;
    el.classList.add('glow-tick');
  }
}
