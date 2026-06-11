/* Game orchestration: menu, daily challenge, practice rounds, results,
   stats, history — local-first; account features layer on top. */

import { makeRng, rngHelpers } from './rng.js';
import { renderPanel, panelEq } from './panels.js';
import { generateProblem, generateNestedSquares } from './generators.js';
import { renderBuilder } from './builder.js';
import {
  DAILY_GEN_VERSION, DAILY_LENGTH, todayKey, dailyNumber, dailySeed,
  dailyRamp, msUntilTomorrow, formatCountdown, shareText,
} from './daily.js';
import {
  loadHistory, saveHistoryEntry, getDailyResult, saveDailyResult,
  computeStreaks, getFlag, setFlag, loadDaily, getPendingJoin,
} from './storage.js';
import { esc, registerScreens, showScreen, activeScreen, openModal, closeModal } from './ui.js';
import {
  currentUser, initAuth, capturePendingInvite, resolvePendingInvite,
  showInviteLanding, openLeaderboard, openGroups, postScore,
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
  msg: document.getElementById('msg'),
  rule: document.getElementById('rule-note'),
  next: document.getElementById('next'),
  timer: document.getElementById('timer'),
  problemNum: document.getElementById('problemNum'),
  score: document.getElementById('score'),
  progress: document.getElementById('progress'),
  roundTitle: document.getElementById('round-title'),
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
  qs.push(generateNestedSquares(R)); // Hard finale — the nested-squares puzzle
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
    elapsedMs: 0,
    startTs: 0,
    timerId: null,
  };
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
    elapsedMs: 0,
    startTs: 0,
    timerId: null,
  };
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
  game.currentQ = null;
  const q = currentQuestion();
  const n = totalLength();

  ui.roundTitle.textContent = game.mode === 'daily'
    ? `Daily Challenge #${dailyNumber()}`
    : `Practice — ${practiceDifficulty[0].toUpperCase()}${practiceDifficulty.slice(1)}`;
  ui.problemNum.textContent = `${game.idx + 1}/${n}`;
  ui.score.textContent = game.results.filter(r => r.correct).length;
  ui.progress.style.width = (game.idx / n * 100) + '%';
  ui.msg.textContent = '';
  ui.msg.className = 'msg';
  ui.rule.hidden = true;
  ui.next.hidden = true;

  const label = document.getElementById('sequence-label');
  if (q.type === 'matrix') {
    label.textContent = 'Complete the grid. Which figure belongs in the empty cell?';
    ui.sequence.className = 'matrix';
    ui.sequence.innerHTML = q.frames
      .map(p => `<div class="tile">${renderPanel(p, 96)}</div>`)
      .join('') + `<div class="tile question">?</div>`;
  } else {
    label.textContent = 'Evaluate the sequence. Which figure comes NEXT?';
    ui.sequence.className = 'sequence';
    ui.sequence.innerHTML = q.frames
      .map(p => `<div class="tile">${renderPanel(p, 120)}</div>`)
      .join('<div class="arrow" aria-hidden="true">→</div>')
      + `<div class="arrow" aria-hidden="true">→</div><div class="tile question">?</div>`;
  }

  ui.answerLabel.textContent = q.type === 'matrix'
    ? 'Build the figure for the empty cell'
    : 'Build the figure that comes next';
  renderBuilder(ui.builder, q.answerSpec, built => handleSubmit(built));

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

function handleSubmit(built) {
  if (!game || game.answered) return;
  game.answered = true;
  const elapsed = stopTimer();
  const q = currentQuestion();
  const correct = panelEq(built, q.next);
  game.results.push({ correct, timeMs: Math.round(elapsed) });

  // Reveal what they built; when wrong, show the correct answer beside it.
  ui.builder.innerHTML = `
    <div class="reveal">
      <div class="reveal-item">
        <div class="reveal-label">Your answer</div>
        <div class="tile ${correct ? 'correct' : 'wrong'}">${renderPanel(built, 120)}</div>
      </div>
      ${correct ? '' : `
      <div class="reveal-item">
        <div class="reveal-label">Correct answer</div>
        <div class="tile correct">${renderPanel(q.next, 120)}</div>
      </div>`}
    </div>`;

  ui.msg.textContent = correct
    ? `Correct! ${(elapsed / 1000).toFixed(1)}s`
    : `Not quite — the correct answer is shown.`;
  ui.msg.className = 'msg ' + (correct ? 'correct' : 'wrong');
  ui.rule.innerHTML = `<b>The rule:</b> ${esc(q.rule)}`;
  ui.rule.hidden = false;

  ui.score.textContent = game.results.filter(r => r.correct).length;
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
  const correct = results.filter(r => r.correct).length;

  if (game.mode === 'daily') {
    const entry = {
      score: correct,
      total: DAILY_LENGTH,
      timeMs: totalMs,
      grid: results.map(r => (r.correct ? 'g' : 'r')),
      times: results.map(r => r.timeMs),
      number: dailyNumber(),
      date: new Date().toISOString(),
    };
    saveDailyResult(todayKey(), entry);
    clearDailyProgress();
    postScore({ difficulty: 'daily', avgMs: totalMs / DAILY_LENGTH, accuracy: correct / DAILY_LENGTH,
      local: { kind: 'daily', key: todayKey() } });
    game = null;
    renderMenu();
    showDailyResults(entry);
  } else {
    const entry = {
      sub: currentUser ? currentUser.sub : null,
      mode: 'practice',
      date: new Date().toISOString(),
      difficulty: practiceDifficulty,
      avg: totalMs / 1000 / results.length,
      totalTime: totalMs / 1000,
      correct,
      total: results.length,
      problems: results.map(r => ({ time: r.timeMs / 1000, correct: r.correct })),
    };
    saveHistoryEntry(entry);
    postScore({ difficulty: practiceDifficulty, avgMs: totalMs / results.length, accuracy: correct / results.length,
      local: { kind: 'history', key: entry.date } });
    game = null;
    renderPracticeResults(entry);
    showScreen('results');
  }
}

/* ---------- Results screens ---------- */

function squaresHtml(grid) {
  return grid.map(g => (g === 'g' ? '🟩' : '🟥')).join('');
}

function showDailyResults(entry) {
  const streaks = computeStreaks(todayKey());
  const perfect = entry.score === entry.total;
  const secs = Math.round(entry.timeMs / 1000);
  const container = document.getElementById('results-body');
  container.innerHTML = `
    <h2>${perfect ? 'Perfect!' : entry.score >= 3 ? 'Nice work!' : 'Round Complete'}</h2>
    <div class="big">${entry.score}/${entry.total}</div>
    <div class="big-label">Daily Challenge #${entry.number}</div>
    <div class="share-grid" aria-label="result grid">${squaresHtml(entry.grid)}</div>

    <div class="results-grid">
      <div class="result-stat"><div class="val">${secs}s</div><div class="lbl">Total Time</div></div>
      <div class="result-stat"><div class="val">🔥 ${streaks.current}</div><div class="lbl">Day Streak</div></div>
      <div class="result-stat"><div class="val">${streaks.max}</div><div class="lbl">Best Streak</div></div>
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
    grid: entry.grid,
    score: entry.score,
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
  const rows = entry.problems.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><span class="badge ${p.correct ? 'correct' : 'wrong'}">${p.correct ? 'Correct' : 'Wrong'}</span></td>
      <td class="right">${p.time.toFixed(2)}s</td>
    </tr>`).join('');
  container.innerHTML = `
    <h2>Round Complete</h2>
    <div class="big">${entry.avg.toFixed(2)}s</div>
    <div class="big-label">Average Solve Time</div>

    <div class="results-grid">
      <div class="result-stat"><div class="val">${entry.correct}/${entry.total}</div><div class="lbl">Correct</div></div>
      <div class="result-stat"><div class="val">${entry.totalTime.toFixed(1)}s</div><div class="lbl">Total Time</div></div>
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
  document.getElementById('btn-again').addEventListener('click', startPractice);
  document.getElementById('btn-results-history').addEventListener('click', openHistory);
  document.getElementById('btn-results-menu2').addEventListener('click', () => { renderMenu(); showScreen('menu'); });
}

/* ---------- Stats ---------- */

function openStats() {
  stopCountdown();
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
  openModal(`
    <h3>How to play</h3>
    <p class="howto-note">Each puzzle hides a rule. Spot it, then <b>build</b> the figure that comes next — tap a shape, a fill or color, and a size from the palettes, then submit.</p>
    <div class="howto-example">
      ${example.map(p => `<div class="tile">${renderPanel(p, 64)}</div>`).join('')}
      <div class="tile question" style="width:64px;height:64px;font-size:24px;">?</div>
    </div>
    <p class="howto-note">Here the fill alternates — so you'd build a <b>solid circle</b>. One new challenge every day; keep your streak alive and share your grid.</p>
    <div class="modal-actions">
      <button class="primary" id="modal-howto-play">${fromBoot ? "Play today's challenge" : 'Got it'}</button>
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
  const btn = document.getElementById('btn-daily');
  if (played) {
    btn.innerHTML = `Daily Challenge #${n} ✓<span class="sub-note">${squaresHtml(played.grid)} — view results</span>`;
  } else if (progress) {
    btn.innerHTML = `Resume Daily #${n}<span class="sub-note">Question ${progress.results.length + 1} of ${DAILY_LENGTH}</span>`;
  } else {
    btn.innerHTML = `Daily Challenge #${n}<span class="sub-note">5 puzzles · same for everyone</span>`;
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

registerScreens(['invite', 'menu', 'round', 'results', 'history', 'leaderboard', 'groups', 'stats']);

document.getElementById('btn-daily').addEventListener('click', startDaily);
document.getElementById('btn-practice').addEventListener('click', startPractice);
document.getElementById('btn-stats').addEventListener('click', openStats);
document.getElementById('btn-history').addEventListener('click', openHistory);
document.getElementById('btn-leaderboard').addEventListener('click', openLeaderboard);
document.getElementById('btn-groups').addEventListener('click', openGroups);
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
  renderMenu();
  showScreen('menu');
});

ui.next.addEventListener('click', nextOrFinish);

for (const id of ['btn-history-back', 'btn-leaderboard-back', 'btn-groups-back', 'btn-stats-back']) {
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
  showScreen('menu');
  if (!getFlag('howto-seen')) {
    setFlag('howto-seen');
    howToPlay(true);
  }
});
