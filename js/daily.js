/* Daily challenge identity: local-date keyed (like Wordle/NYT — the puzzle
   rolls over at the player's local midnight). The seed feeds the shared PRNG
   so every player generates the identical 5 puzzles client-side — no server.

   DAILY_GEN_VERSION must be bumped if generator logic ever changes in a way
   that alters output for a given seed, so an old cached tab and a fresh tab
   never disagree about today's puzzle. */

export const DAILY_GEN_VERSION = 1;
export const DAILY_LENGTH = 5;

/* Day #1 — launch day of the daily challenge. */
const EPOCH = '2026-06-09';

export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dailyNumber(dayKey = todayKey()) {
  const diff = Math.round(
    (Date.parse(dayKey + 'T12:00:00Z') - Date.parse(EPOCH + 'T12:00:00Z')) / 86400000
  );
  return diff + 1;
}

export function dailySeed(dayKey = todayKey()) {
  return `irt-daily-v${DAILY_GEN_VERSION}-${dayKey}`;
}

/* Difficulty ramp within one daily — everyone meets the expert question last. */
export function dailyRamp() {
  return ['easy', 'medium', 'medium', 'hard', 'expert'];
}

/* ms until local midnight, for the "next puzzle in…" countdown. */
export function msUntilTomorrow(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next - now;
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* Spoiler-free share text — tiny, textual, platform-agnostic. */
export function shareText({ number, grid, score, total, timeMs, streak, url }) {
  const squares = grid.map(g => (g === 'g' ? '🟩' : '🟥')).join('');
  const t = Math.round(timeMs / 1000);
  const mins = Math.floor(t / 60);
  const secs = t % 60;
  const time = mins ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`;
  const lines = [
    `Inductive #${number} ${score}/${total} ⏱ ${time}`,
    squares,
  ];
  if (streak >= 2) lines.push(`🔥 ${streak}-day streak`);
  if (url) lines.push(url);
  return lines.join('\n');
}
