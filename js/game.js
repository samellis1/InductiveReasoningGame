/* Game orchestration: menu, daily challenge, practice rounds, results,
   stats, history — local-first; account features layer on top. */

import { makeRng, rngHelpers } from './rng.js';
import { renderPanel, panelEq } from './panels.js';
import { generateProblem, generateNestedFinale } from './generators.js';
import { renderBuilder } from './builder.js';
import { shake, playSound, setStreakHeat, primeAudio, isMuted, setMuted, reducedMotion } from './feel.js';
import {
  DAILY_GEN_VERSION, DAILY_LENGTH, todayKey, dailyNumber, dailySeed,
  dailyRamp, msUntilTomorrow, formatCountdown, shareText,
} from './daily.js';
import {
  loadHistory, saveHistoryEntry, getDailyResult, saveDailyResult,
  computeStreaks, loadDaily, getPendingJoin,
} from './storage.js';
import { esc, registerScreens, showScreen, activeScreen, openModal, closeModal } from './ui.js';
import {
  currentUser, initAuth, capturePendingInvite, resolvePendingInvite,
  showInviteLanding, openLeaderboard, postScore,
  signInWithGoogle, googleButtonHtml, requireAccount,
} from './social.js';

const PRACTICE_LENGTH = 5;
const DAILY_PROGRESS_KEY = 'irt-daily-progress-v1';

let practiceDifficulty = 'medium';
let game = null;
let countdownTimer = null;

const ui = {
  sequence: document.getElementById('sequence'),
  builder: document.getElementById('answer-builder'),
  answerLabel: document.getElementById('answer-label'),
  panel: document.querySelector('#screen-round .panel'),
  msg: document.getElementById('msg'),
  rule: document.getElementById('rule-note'),
  next: document.getElementById('next'),
  timer: document.getElementById('timer'),
  problemNum: document.getElementById('problemNum'),
  progress: document.getElementById('progress'),
};

/* ---------- Daily progress (mid-round persistence: no restart-scumming) ---------- */

function loadDailyProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(DAILY_PROGRESS_KEY));
    if (p && p.day === todayKey() && p.v === DAILY_GEN_VERSION) return p;
  } catch { /* ignore */ }
  return null;
}
function saveDailyProgress(results) {
  try {
    localStorage.setItem(DAILY_PROGRESS_KEY, JSON.stringify({
      day: todayKey(), v: DAILY_GEN_VERSION, results,
    }));
  } catch { /* ignore */ }
}
function clearDailyProgress() {
  try { localStorage.removeItem(DAILY_PROGRESS_KEY); } catch { /* ignore */ }
}

/* ---------- Round flow ---------- */

function dailyQuestions() {
  const R = rngHelpers(makeRng(dailySeed()));
  const qs = dailyRamp().map(diff => generateProblem(R, diff));
  qs.push(generateNestedFinale(R)); // hard nested-shape finale
  return qs;
}

function startDaily() {
  const existing = getDailyResult(todayKey());
  if (existing) { showDailyResults(existing); return; }

  const progress = loadDailyProgress();
  game = {
    mode: 'daily',
    questions: dailyQuestions(),
    idx: progress ? progress.results.length : 0,
    results: progress ? progress.results.slice() : [],
    answered: false,
    heat: 0,
    elapsedMs: 0,
    startTs: 0,
    timerId: null,
  };
  primeAudio();
  setStreakHeat(0);
  showScreen('round');
  loadQuestion();
}

function startPractice() {
  game = {
    mode: 'practice',
    questions: null, // generated lazily, unseeded
    idx: 0,
    results: [],
    answered: false,
    heat: 0,
    elapsedMs: 0,
    startTs: 0,
    timerId: null,
  };
  primeAudio();
  setStreakHeat(0);
  showScreen('round');
  loadQuestion();
}

function totalLength() { return game.mode === 'daily' ? DAILY_LENGTH : PRACTICE_LENGTH; }

function currentQuestion() {
  if (game.mode === 'daily') return game.questions[game.idx];
  if (!game.currentQ) {
    game.currentQ = generateProblem(rngHelpers(makeRng(null)), practiceDifficulty);
  }
  return game.currentQ;
}

function loadQuestion() {
  game.answered = false;
  game.tries = 0;
  game.currentQ = null;
  const q = currentQuestion();
  const n = totalLength();

  ui.problemNum.textContent = `${game.idx + 1}/${n}`;
  ui.progress.style.width = (game.idx / n * 100) + '%';
  ui.msg.textContent = '';
  ui.msg.className = 'msg';
  ui.rule.hidden = true;
  ui.next.hidden = true;

  const label = document.getElementById('sequence-label');
  const fam = q.family || (q.type === 'matrix' ? 'matrix' : 'shapes');
  ui.panel.dataset.family = fam; // drives per-family styling
  let answerLabel = 'Build the figure that comes next';

  // Sequence frames stack top-to-bottom (numbered 1→4) so the order is never
  // ambiguous, and the answer (frame 5) continues the column as a larger stage.
  // Everything is sized in viewport units to fit on one screen where it can,
  // and scrolls vertically when it can't.
  const frameStack = (frames, size) => `
    <div class="frame-stack">
      ${frames.map((p, i) => `<div class="tile frame-tile">${renderPanel(p, size)}<span class="frame-chip">${i + 1}</span></div>`).join('')}
    </div>`;
  const ANSWER_STAGE = `
    <div class="answer-stage">
      <div class="answer-wrap">
        <div class="tile question answer-big" id="answer-slot"></div>
        <span class="frame-chip chip-answer">5</span>
      </div>
    </div>`;
  const SLOT_WEEK = `<div class="week-row question-week"><span class="week-num">Wk 5</span><div id="answer-slot" class="week-slot"></div></div>`;

  if (fam === 'matrix') {
    label.textContent = 'Complete the grid. Build the figure for the empty cell.';
    ui.sequence.className = 'matrix';
    ui.sequence.innerHTML = q.frames
      .map(p => `<div class="tile">${renderPanel(p, 120)}</div>`)
      .join('') + `<div class="tile question" id="answer-slot"></div>`;
    answerLabel = 'Build the figure for the empty cell';
  } else if (fam === 'weeks') {
    label.textContent = 'Watch the weeks unfold.';
    ui.sequence.className = 'weeks';
    ui.sequence.innerHTML = q.frames
      .map((p, i) => `<div class="week-row"><span class="week-num">Wk ${i + 1}</span>${renderPanel(p, 330)}</div>`)
      .join('') + SLOT_WEEK;
    answerLabel = 'Mark the good days in week five';
  } else if (fam === 'schedule') {
    label.textContent = 'One week. Three rules. One right day.';
    ui.sequence.className = 'schedule';
    ui.sequence.innerHTML = `<div class="week-row">${renderPanel(q.frames[0], 330)}</div>`
      + `<div class="week-row question-week"><span class="week-num">You</span><div id="answer-slot" class="week-slot"></div></div>`;
    answerLabel = 'Pick the day';
  } else if (fam === 'month') {
    label.textContent = 'Read the requirements. Mark every day that fits.';
    ui.sequence.className = 'month-layout';
    ui.sequence.innerHTML = `<div id="answer-slot" class="month-slot"></div>`;
    answerLabel = 'Tap the qualifying days';
  } else if (fam === 'bars') {
    label.textContent = 'Read the prompt. Set the bars so the numbers work.';
    ui.sequence.className = 'bars-layout';
    ui.sequence.innerHTML = `<div id="answer-slot" class="bars-slot"></div>`;
    answerLabel = 'Drag the bars';
  } else if (fam === 'word') {
    label.textContent = 'Work the numbers.';
    ui.sequence.className = 'word-layout';
    ui.sequence.innerHTML = `<div class="word-prompt">${esc(q.prompt || '')}</div>` + ANSWER_STAGE;
    answerLabel = 'Type your answer';
  } else if (fam === 'number') {
    label.textContent = 'Evaluate the sequence. What number comes next?';
    ui.sequence.className = 'sequence';
    ui.sequence.innerHTML = frameStack(q.frames, 132) + ANSWER_STAGE;
    answerLabel = 'Type the next number';
  } else {
    label.textContent = 'Evaluate the sequence. Which figure comes NEXT?';
    ui.sequence.className = 'sequence';
    ui.sequence.innerHTML = frameStack(q.frames, 132) + ANSWER_STAGE;
    if (fam === 'nested') answerLabel = 'Fill in figure 5 — drag a fill into each section';
  }

  const instr = document.getElementById('instruction');
  instr.hidden = !q.instruction;
  instr.textContent = q.instruction || '';

  ui.answerLabel.textContent = answerLabel;
  renderBuilder(document.getElementById('answer-slot'), ui.builder, q.answerSpec,
    built => handleSubmit(built));

  startTimer();
}

/* Timer pauses while the tab is hidden so solve times stay honest. */
function startTimer() {
  game.elapsedMs = 0;
  game.startTs = performance.now();
  if (game.timerId) clearInterval(game.timerId);
  game.timerId = setInterval(() => {
    ui.timer.textContent = (currentElapsed() / 1000).toFixed(1) + 's';
  }, 100);
}
function currentElapsed() {
  return game.elapsedMs + (game.startTs ? performance.now() - game.startTs : 0);
}
function stopTimer() {
  if (game.timerId) clearInterval(game.timerId);
  game.timerId = null;
  const total = currentElapsed();
  game.startTs = 0;
  return total;
}

document.addEventListener('visibilitychange', () => {
  if (!game || !game.timerId) return;
  if (document.hidden) {
    game.elapsedMs = currentElapsed();
    game.startTs = 0;
  } else if (!game.answered) {
    game.startTs = performance.now();
  }
});

/* Up to MAX_TRIES per puzzle. You compete on solved count, then total
   attempts, then total time. A wrong submit (with tries left) keeps the
   builder editable and the timer running — a mistake costs an attempt, not
   the puzzle. */
export const MAX_TRIES = 3;

const totalAttempts = results => results.reduce((s, r) => s + r.tries, 0);
const totalSolved = results => results.filter(r => r.solved).length;

function handleSubmit(built) {
  if (!game || game.answered) return;
  const q = currentQuestion();
  const correct = panelEq(built, q.next);
  game.tries++;

  if (!correct && game.tries < MAX_TRIES) {
    const left = MAX_TRIES - game.tries;
    ui.msg.textContent = `Not quite — ${left} ${left === 1 ? 'try' : 'tries'} left.`;
    ui.msg.className = 'msg wrong';
    shake(ui.panel);
    playSound('wrong');
    return; // builder stays as-is; timer keeps running
  }

  // Resolved: solved, or out of tries.
  game.answered = true;
  if (correct) {
    // First-try solves heat the streak glow twice as fast.
    game.heat = (game.heat || 0) + (game.tries === 1 ? 2 : 1);
    playSound('correct');
  } else {
    game.heat = 0;
    shake(ui.panel);
    playSound('wrong');
  }
  setStreakHeat(game.heat);
  const elapsed = stopTimer();
  const r = { solved: correct, tries: game.tries, timeMs: Math.round(elapsed) };
  game.results.push(r);

  // Reveal in place: the slot (already showing what they built) goes green or
  // red and freezes; when unsolved, the correct answer renders in the tray.
  const slot = document.getElementById('answer-slot');
  if (slot) {
    slot.classList.add('resolved', correct ? 'correct' : 'wrong');
  }
  const correctTile = (p) => (p.week || p.month || p.bars
    ? `<div class="tile week-tile correct">${renderPanel(p, 300)}</div>`
    : `<div class="tile correct">${renderPanel(p, 120)}</div>`);
  ui.builder.innerHTML = correct ? '' : `
    <div class="reveal">
      <div class="reveal-item">
        <div class="reveal-label">Correct answer</div>
        ${correctTile(q.next)}
      </div>
    </div>`;

  ui.msg.textContent = correct
    ? `Correct${r.tries > 1 ? ` on try ${r.tries}` : ' first try'}! ${(elapsed / 1000).toFixed(1)}s`
    : `Out of tries — the correct answer is shown.`;
  ui.msg.className = 'msg ' + (correct ? 'correct' : 'wrong');
  ui.rule.innerHTML = `<b>The rule:</b> ${esc(q.rule)}`;
  ui.rule.hidden = false;
  ui.progress.style.width = ((game.idx + 1) / totalLength() * 100) + '%';

  if (game.mode === 'daily') saveDailyProgress(game.results);

  ui.next.textContent = game.idx + 1 >= totalLength() ? 'See Results →' : 'Next →';
  ui.next.hidden = false;
  ui.next.focus();
}

function nextOrFinish() {
  if (!game) return;
  if (game.idx + 1 >= totalLength()) { finishRound(); return; }
  game.idx++;
  loadQuestion();
}

function finishRound() {
  const results = game.results;
  const totalMs = results.reduce((s, r) => s + r.timeMs, 0);
  const solved = totalSolved(results);
  const attempts = totalAttempts(results);
  playSound('round');
  setStreakHeat(0);

  if (game.mode === 'daily') {
    const entry = {
      score: solved,
      total: DAILY_LENGTH,
      attempts,
      timeMs: totalMs,
      grid: results.map(r => (r.solved ? 'g' : 'r')),
      triesGrid: results.map(r => (r.solved ? r.tries : 'x')),
      times: results.map(r => r.timeMs),
      number: dailyNumber(),
      date: new Date().toISOString(),
    };
    saveDailyResult(todayKey(), entry);
    clearDailyProgress();
    postScore({ difficulty: 'daily', avgMs: totalMs / DAILY_LENGTH, accuracy: solved / DAILY_LENGTH,
      attempts, dayKey: todayKey(),
      local: { kind: 'daily', key: todayKey() } });
    game = null;
    renderMenu();
    showDailyResults(entry);
  } else {
    // Practice is personal training: saved locally, never posted to leaderboards.
    const entry = {
      sub: currentUser ? currentUser.sub : null,
      mode: 'practice',
      date: new Date().toISOString(),
      difficulty: practiceDifficulty,
      avg: totalMs / 1000 / results.length,
      totalTime: totalMs / 1000,
      correct: solved,
      total: results.length,
      attempts,
      problems: results.map(r => ({ time: r.timeMs / 1000, correct: r.solved, tries: r.tries })),
    };
    saveHistoryEntry(entry);
    game = null;
    renderPracticeResults(entry);
    showScreen('results');
  }
}

/* ---------- Results screens ---------- */

/* Legacy daily entries (pre-points) lack triesGrid — derive one from the old
   green/red grid so results and share still render. */
function triesGridOf(entry) {
  if (entry.triesGrid) return entry.triesGrid;
  return (entry.grid || []).map(g => (g === 'g' ? 1 : 'x'));
}

const TRY_BADGE = { 1: '1️⃣', 2: '2️⃣', 3: '3️⃣', x: '❌' };

function triesHtml(triesGrid) {
  return triesGrid.map(t => TRY_BADGE[t] || '❌').join('');
}

/* Ease-out count-up for the headline score (≈800ms); instant under
   reduced motion. Suffix (e.g. "/15") stays static. */
function countUp(el, target, suffix) {
  if (!el) return;
  if (reducedMotion()) { el.textContent = `${target}${suffix}`; return; }
  const dur = 800;
  const t0 = performance.now();
  const tick = now => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = `${Math.round(target * eased)}${suffix}`;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* Attempts for legacy entries that predate the field: solved = 1 try, missed = 3. */
function attemptsOf(entry) {
  if (entry.attempts != null) return entry.attempts;
  return triesGridOf(entry).reduce((s, t) => s + (t === 'x' ? MAX_TRIES : t), 0);
}

function showDailyResults(entry) {
  const streaks = computeStreaks(todayKey());
  const attempts = attemptsOf(entry);
  const perfect = entry.score === entry.total && attempts === entry.total;
  const secs = Math.round(entry.timeMs / 1000);
  const container = document.getElementById('results-body');
  container.innerHTML = `
    <h2>${perfect ? 'Perfect!' : entry.score >= 3 ? 'Nice work!' : 'Round Complete'}</h2>
    <div class="big" id="results-big">${entry.score}/${entry.total}</div>
    <div class="big-label">Solved — Daily Challenge #${entry.number}</div>
    <div class="share-grid" aria-label="result grid: try each puzzle was solved on">${triesHtml(triesGridOf(entry))}</div>

    <div class="results-grid">
      <div class="result-stat"><div class="val">${attempts}</div><div class="lbl">Attempts</div></div>
      <div class="result-stat"><div class="val">${secs}s</div><div class="lbl">Total Time</div></div>
      <div class="result-stat"><div class="val">🔥 ${streaks.current}</div><div class="lbl">Day Streak</div></div>
    </div>

    ${currentUser ? '' : `
      <div class="signin-upsell">
        Don't lose that streak — sign in to save your stats across devices.
        <br><button class="btn-google" id="btn-results-signin">${googleButtonHtml('Sign in with Google')}</button>
      </div>`}

    <div class="countdown-note">Next puzzle in <b id="countdown">--:--:--</b></div>

    <div class="results-actions">
      <button class="next" id="btn-share">Share</button>
      <button class="back-link" id="btn-results-stats">My Stats</button>
      <button class="back-link" id="btn-results-menu2">Main Menu</button>
    </div>`;
  showScreen('results');
  countUp(document.getElementById('results-big'), entry.score, `/${entry.total}`);

  document.getElementById('btn-share').addEventListener('click', () => shareDaily(entry, streaks.current));
  document.getElementById('btn-results-stats').addEventListener('click', openStats);
  document.getElementById('btn-results-menu2').addEventListener('click', () => { renderMenu(); showScreen('menu'); });
  const signinBtn = document.getElementById('btn-results-signin');
  if (signinBtn) signinBtn.addEventListener('click', signInWithGoogle);

  startCountdown();
}

async function shareDaily(entry, streak) {
  const text = shareText({
    number: entry.number,
    triesGrid: triesGridOf(entry),
    solved: entry.score,
    total: entry.total,
    timeMs: entry.timeMs,
    streak,
    url: window.location.origin + window.location.pathname,
  });
  const btn = document.getElementById('btn-share');
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch { /* user cancelled — fall through */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Share'; }, 1500); }
  } catch {
    openModal(`<h3>Share your result</h3><p style="white-space:pre-line; color:var(--text);">${esc(text)}</p>
      <div class="modal-actions"><button class="primary" id="modal-ok">Close</button></div>`);
    document.getElementById('modal-ok').addEventListener('click', closeModal);
  }
}

function startCountdown() {
  stopCountdown();
  const tick = () => {
    const el = document.getElementById('countdown');
    if (!el) { stopCountdown(); return; }
    el.textContent = formatCountdown(msUntilTomorrow());
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}
function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

function renderPracticeResults(entry) {
  const container = document.getElementById('results-body');
  const attempts = entry.attempts
    ?? entry.problems.reduce((s, p) => s + (p.tries || (p.correct ? 1 : MAX_TRIES)), 0);
  const rows = entry.problems.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><span class="badge ${p.correct ? 'correct' : 'wrong'}">${p.correct ? `Solved${p.tries ? ` (try ${p.tries})` : ''}` : 'Missed'}</span></td>
      <td class="right">${p.time.toFixed(2)}s</td>
    </tr>`).join('');
  container.innerHTML = `
    <h2>Round Complete</h2>
    <div class="big" id="results-big">${entry.correct}/${entry.total}</div>
    <div class="big-label">Solved</div>

    <div class="results-grid">
      <div class="result-stat"><div class="val">${attempts}</div><div class="lbl">Attempts</div></div>
      <div class="result-stat"><div class="val">${entry.avg.toFixed(2)}s</div><div class="lbl">Avg / Puzzle</div></div>
      <div class="result-stat"><div class="val">${esc(entry.difficulty[0].toUpperCase() + entry.difficulty.slice(1))}</div><div class="lbl">Difficulty</div></div>
    </div>

    <div class="per-problem">
      <table>
        <thead><tr><th>#</th><th>Result</th><th class="right">Time</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="results-actions">
      <button class="next" id="btn-again">Play Again</button>
      <button class="back-link" id="btn-results-history">View History</button>
      <button class="back-link" id="btn-results-menu2">Main Menu</button>
    </div>`;
  countUp(document.getElementById('results-big'), entry.correct, `/${entry.total}`);
  document.getElementById('btn-again').addEventListener('click', startPractice);
  document.getElementById('btn-results-history').addEventListener('click', openHistory);
  document.getElementById('btn-results-menu2').addEventListener('click', () => { renderMenu(); showScreen('menu'); });
}

/* ---------- Stats ---------- */

function openStats() {
  stopCountdown();
  document.getElementById('stats-signin-note').style.display = currentUser ? 'none' : '';
  const streaks = computeStreaks(todayKey());
  const daily = loadDaily().results;
  const days = Object.values(daily);
  const played = days.length;
  const perfect = days.filter(d => d.score === d.total).length;
  const avgScore = played ? (days.reduce((s, d) => s + d.score, 0) / played) : 0;

  const practice = loadHistory();
  const pRounds = practice.length;
  const pBest = pRounds ? Math.min(...practice.map(e => e.avg)) : null;

  const dist = [0, 0, 0, 0, 0, 0];
  days.forEach(d => { dist[Math.min(5, d.score)]++; });
  const maxDist = Math.max(1, ...dist);
  const distRows = dist.map((n, score) => `
    <div class="dist-row">
      <div class="k">${score}/5</div>
      <div class="bar-wrap"><div class="bar" style="width:${Math.max(8, Math.round(n / maxDist * 100))}%">${n || ''}</div></div>
    </div>`).join('');

  const cards = [
    [played, 'Dailies Played'],
    [`🔥 ${streaks.current}`, 'Current Streak'],
    [streaks.max, 'Best Streak'],
    [played ? avgScore.toFixed(1) : '—', 'Avg Score'],
    [perfect, 'Perfect Days'],
    [pRounds, 'Practice Rounds'],
    [pBest != null ? pBest.toFixed(2) + 's' : '—', 'Best Practice Avg'],
  ].map(([val, lbl]) => `<div class="result-stat"><div class="val">${val}</div><div class="lbl">${lbl}</div></div>`).join('');

  document.getElementById('stats-content').innerHTML = `
    <div class="stats-cards">${cards}</div>
    <div class="dist">
      <h3>Daily score distribution</h3>
      ${distRows}
    </div>`;
  showScreen('stats');
}

/* ---------- History (device-local; works for guests too) ---------- */

function openHistory() {
  stopCountdown();
  const h = loadHistory();
  const container = document.getElementById('history-content');
  if (!h.length) {
    container.innerHTML = `<div class="history-empty">No practice rounds yet. Play one to see your results here.</div>`;
  } else {
    const rows = h.map(e => {
      const date = new Date(e.date);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const diff = esc(e.difficulty[0].toUpperCase() + e.difficulty.slice(1));
      return `
        <div class="history-row">
          <div>
            <div style="font-weight:500;">${dateStr}</div>
            <div style="color:var(--muted); font-size:12px; margin-top:2px;">${diff}</div>
          </div>
          <div class="num col-problems">${e.correct}/${e.total} correct</div>
          <div class="num">${e.totalTime.toFixed(1)}s total</div>
          <div class="avg">${e.avg.toFixed(2)}s avg</div>
        </div>`;
    }).join('');
    container.innerHTML = `
      <div class="history-list">
        <div class="history-row head">
          <div>When</div>
          <div class="col-problems">Score</div>
          <div>Total</div>
          <div>Avg Time</div>
        </div>
        ${rows}
      </div>`;
  }
  showScreen('history');
}

/* ---------- How to play ---------- */

function howToPlay(fromBoot) {
  const example = [
    { center: { kind: 'circle', fill: 'solid' } },
    { center: { kind: 'circle', fill: 'outline' } },
    { center: { kind: 'circle', fill: 'solid' } },
    { center: { kind: 'circle', fill: 'outline' } },
  ];
  const nestedMini = {
    nested: {
      outer: [{ color: 'blue' }, { color: 'orange' }, { color: 'green' }, { color: 'red' }],
      inner: [{ color: 'red', texture: 'stripes' }, { color: 'red', texture: 'stripes' }, null, null],
    },
  };
  openModal(`
    <h3>Welcome to Inductive</h3>
    <p class="howto-note"><b>Every day, five pattern puzzles — the same five for everyone.</b>
      Each one hides a rule. Spot it, then <b>build</b> what comes next.</p>
    <div class="howto-example">
      ${example.map(p => `<div class="tile">${renderPanel(p, 56)}</div>`).join('')}
      <div class="tile question" style="width:56px;height:56px;font-size:22px;">?</div>
    </div>
    <p class="howto-note">Here the fill alternates — so you'd build a <b>solid circle</b> with the controls under the puzzle.</p>
    <p class="howto-note"><b>You get 3 tries per puzzle.</b> You compete on puzzles solved,
      then fewest total attempts, then time. A wrong try keeps your work so you can adjust.</p>
    <div class="howto-example">
      <div class="tile">${renderPanel(nestedMini, 56)}</div>
      <span class="howto-gallery-note">Some puzzles, like this one, you fill in by tapping sections.
      Number and calendar puzzles explain themselves with a hint line up top.</span>
    </div>
    <p class="howto-note">Finish daily challenges to build a 🔥 streak, then share your result and
      compare with friends on the leaderboard.</p>
    <div class="modal-actions">
      <button class="primary" id="modal-howto-play">${fromBoot ? "Start today's puzzles" : 'Got it'}</button>
    </div>`);
  document.getElementById('modal-howto-play').addEventListener('click', () => {
    closeModal();
    if (fromBoot) startDaily();
  });
}

/* ---------- Menu ---------- */

function renderMenu() {
  const n = dailyNumber();
  const played = getDailyResult(todayKey());
  const progress = loadDailyProgress();
  const note = document.getElementById('go-note');
  if (played) {
    note.innerHTML = `Daily #${n} done ${triesHtml(triesGridOf(played))} — view results`;
  } else if (progress) {
    note.textContent = `Resume Daily #${n} — question ${progress.results.length + 1} of ${DAILY_LENGTH}`;
  } else {
    note.textContent = `Daily #${n} · 5 puzzles · same for everyone`;
  }

  const streaks = computeStreaks(todayKey());
  const chip = document.getElementById('streak-chip');
  if (streaks.current > 0) {
    chip.hidden = false;
    chip.innerHTML = `🔥 <b>${streaks.current}</b>&nbsp;day streak`;
  } else {
    chip.hidden = true;
  }
}

/* ---------- Wiring ---------- */

registerScreens(['invite', 'daily-intro', 'menu', 'round', 'results', 'history', 'leaderboard', 'stats']);

/* Daily intro: the pre-round screen with the START button. The timer (and the
   round itself) only begins when START is pressed. */
function showDailyIntro() {
  const n = dailyNumber();
  const progress = loadDailyProgress();
  document.getElementById('intro-title').textContent = `Daily Challenge #${n}`;
  document.getElementById('intro-sub').textContent = progress
    ? `Resume — question ${progress.results.length + 1} of ${DAILY_LENGTH}`
    : '5 puzzles · 3 tries each · the same for everyone';
  showScreen('daily-intro');
}

/* GO: finished today → results; otherwise the intro (START begins the clock). */
function goDaily() {
  primeAudio();
  if (getDailyResult(todayKey())) { startDaily(); return; } // shows results
  showDailyIntro();
}

document.getElementById('btn-start-daily').addEventListener('click', () => { primeAudio(); startDaily(); });
document.getElementById('btn-intro-menu').addEventListener('click', () => { renderMenu(); showScreen('menu'); });
document.getElementById('btn-intro-howto').addEventListener('click', () => howToPlay(false));
document.getElementById('btn-daily').addEventListener('click', goDaily);
document.getElementById('btn-practice').addEventListener('click', startPractice);
document.getElementById('btn-stats').addEventListener('click', openStats);
document.getElementById('btn-history').addEventListener('click', openHistory);
document.getElementById('btn-leaderboard').addEventListener('click', openLeaderboard);
document.getElementById('btn-howto').addEventListener('click', () => howToPlay(false));

document.querySelectorAll('#diff-row button').forEach(btn => {
  btn.addEventListener('click', () => {
    practiceDifficulty = btn.dataset.diff;
    document.querySelectorAll('#diff-row button').forEach(b => b.classList.toggle('active', b === btn));
  });
});

document.getElementById('btn-quit').addEventListener('click', () => {
  if (game && game.timerId) clearInterval(game.timerId);
  game = null;
  setStreakHeat(0);
  renderMenu();
  showScreen('menu');
});

const muteBtn = document.getElementById('btn-mute');
function renderMuteBtn() { muteBtn.textContent = isMuted() ? '🔇' : '🔊'; }
muteBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  if (!isMuted()) primeAudio();
  renderMuteBtn();
});
renderMuteBtn();

ui.next.addEventListener('click', nextOrFinish);

for (const id of ['btn-history-back', 'btn-leaderboard-back', 'btn-stats-back']) {
  document.getElementById(id).addEventListener('click', () => { stopCountdown(); renderMenu(); showScreen('menu'); });
}

document.addEventListener('keydown', e => {
  if (activeScreen() !== 'round') return;
  if (e.key === 'Enter' && !ui.next.hidden) { nextOrFinish(); }
});

document.getElementById('btn-invite-google').innerHTML = googleButtonHtml('Sign in with Google to join');
document.getElementById('btn-invite-google').addEventListener('click', signInWithGoogle);
document.getElementById('btn-invite-skip').addEventListener('click', () => { renderMenu(); showScreen('menu'); });

/* ---------- Boot: guest-first, play within one tap ---------- */

capturePendingInvite();

initAuth({
  onUserChanged: () => {
    if (activeScreen() === 'invite' && currentUser) { renderMenu(); showScreen('menu'); }
  },
}).then(async user => {
  renderMenu();
  if (!user && getPendingJoin()) {
    const shown = await showInviteLanding();
    if (shown) return;
  } else if (user) {
    resolvePendingInvite();
  }
  // Daily unfinished → land straight on the daily intro so players hop right
  // in; finished → the normal menu.
  if (!getDailyResult(todayKey())) showDailyIntro();
  else showScreen('menu');
});
