/* Local-first persistence. Every read/write is wrapped so a full quota or a
   blocked localStorage (some embedded webviews) degrades to in-memory play
   instead of crashing the game. */

const mem = new Map();

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) return JSON.parse(raw);
  } catch { /* fall through to memory */ }
  return mem.has(key) ? mem.get(key) : null;
}

function write(key, value) {
  mem.set(key, value);
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota/blocked */ }
}

/* ---------- Practice history (legacy key kept so existing players keep their data) ---------- */

const HISTORY_KEY = 'irt-history-v1';

export function loadHistory() {
  const h = read(HISTORY_KEY);
  return Array.isArray(h) ? h : [];
}

export function saveHistoryEntry(entry) {
  const h = loadHistory();
  h.unshift(entry);
  write(HISTORY_KEY, h.slice(0, 200));
}

/* ---------- Daily challenge results ---------- */

const DAILY_KEY = 'irt-daily-v1';

/* shape: { results: { 'YYYY-MM-DD': { score, total, timeMs, grid: ['g'|'r', ...] } } } */
export function loadDaily() {
  const d = read(DAILY_KEY);
  return d && typeof d === 'object' && d.results ? d : { results: {} };
}

export function saveDailyResult(dayKey, result) {
  const d = loadDaily();
  d.results[dayKey] = result;
  write(DAILY_KEY, d);
}

export function getDailyResult(dayKey) {
  return loadDaily().results[dayKey] || null;
}

/* Streak = consecutive calendar days (ending today or yesterday) with a completed daily. */
export function computeStreaks(todayKey) {
  const results = loadDaily().results;
  const days = Object.keys(results).sort();
  if (!days.length) return { current: 0, max: 0, played: days.length };

  let max = 1, run = 1;
  for (let i = 1; i < days.length; i++) {
    run = (diffDays(days[i - 1], days[i]) === 1) ? run + 1 : 1;
    if (run > max) max = run;
  }

  // Walk back from the most recent played day; streak is alive only if that
  // day is today or yesterday.
  const last = days[days.length - 1];
  const gap = diffDays(last, todayKey);
  let current = 0;
  if (gap <= 1) {
    current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      if (diffDays(days[i - 1], days[i]) === 1) current++;
      else break;
    }
  }
  return { current, max, played: days.length };
}

function diffDays(a, b) {
  // Keys are local-date strings; parse as UTC noon to dodge DST edges.
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

/* ---------- One-time flags ---------- */

const FLAGS_KEY = 'irt-flags-v1';

export function getFlag(name) {
  const f = read(FLAGS_KEY) || {};
  return !!f[name];
}

export function setFlag(name) {
  const f = read(FLAGS_KEY) || {};
  f[name] = true;
  write(FLAGS_KEY, f);
}

/* Welcome-modal bookkeeping (legacy key preserved). */
const WELCOMED_KEY = 'irt-welcomed-v1';

export function wasWelcomed(userId) {
  const seen = read(WELCOMED_KEY);
  return Array.isArray(seen) && seen.includes(userId);
}

export function markWelcomed(userId) {
  const seen = read(WELCOMED_KEY);
  const list = Array.isArray(seen) ? seen : [];
  if (!list.includes(userId)) list.push(userId);
  write(WELCOMED_KEY, list);
}

/* Pending group-invite code (survives the OAuth redirect). */
const PENDING_JOIN_KEY = 'irt-pending-join-v1';

export function getPendingJoin() { return read(PENDING_JOIN_KEY); }
export function setPendingJoin(code) { write(PENDING_JOIN_KEY, code); }
export function clearPendingJoin() {
  mem.delete(PENDING_JOIN_KEY);
  try { localStorage.removeItem(PENDING_JOIN_KEY); } catch { /* ignore */ }
}
