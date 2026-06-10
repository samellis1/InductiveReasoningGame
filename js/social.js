/* Supabase auth (Google OAuth), global + group leaderboards, friend groups.
   Local-first: nothing here ever blocks play; network failures degrade to
   friendly messages. All user-supplied strings are esc()'d before innerHTML. */

import { esc, openModal, closeModal, alertModal, showScreen } from './ui.js';
import { wasWelcomed, markWelcomed, getPendingJoin, setPendingJoin, clearPendingJoin,
  getUnpostedScores, markScorePosted } from './storage.js';
import { todayKey } from './daily.js';

const SUPABASE_URL = 'https://lfbsratbyfgjufjpqfvi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxmYnNyYXRieWZnanVmanBxZnZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1ODgwMTcsImV4cCI6MjA5NjE2NDAxN30.oM5o7WXKt_1wQEEDpzfdqqk5U6Ocis50VKwqkQ0PbuI';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export let currentUser = null; // { id, sub, name, email, picture }

const GOOGLE_BTN = `
  <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

const PERSON_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6"></path></svg>`;

export function googleButtonHtml(label = 'Sign in with Google') {
  return `${GOOGLE_BTN}<span>${esc(label)}</span>`;
}

function userFromSession(session) {
  if (!session || !session.user) return null;
  const u = session.user;
  const m = u.user_metadata || {};
  return {
    id: u.id,
    sub: m.sub || m.provider_id || u.id,
    name: m.full_name || m.name || m.email || u.email || 'Player',
    email: m.email || u.email || '',
    picture: m.avatar_url || m.picture || '',
  };
}

export async function signInWithGoogle() {
  await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
}

export async function signOut() {
  await sb.auth.signOut();
  currentUser = null;
  renderAccountBar();
  showScreen('menu');
}

function maybeWelcome() {
  if (!currentUser || wasWelcomed(currentUser.id)) return;
  markWelcomed(currentUser.id);
  openModal(`
    ${currentUser.picture ? `<img class="avatar" src="${esc(currentUser.picture)}" alt="" referrerpolicy="no-referrer">` : ''}
    <h3>Welcome, ${esc(currentUser.name)}!</h3>
    <p>Your rounds are now saved to your account, and your times appear on the global leaderboard.</p>
    <div class="modal-actions"><button class="primary" id="modal-ok">Let's go</button></div>`);
  document.getElementById('modal-ok').addEventListener('click', closeModal);
}

export function renderAccountBar() {
  const bar = document.getElementById('account-bar');
  if (!bar) return;

  if (!currentUser) {
    bar.innerHTML = `
      <button class="account-trigger" id="account-toggle" aria-label="Account">${PERSON_ICON}</button>
      <div class="account-panel">
        <div class="signin-text">Sign in to save your stats &amp; compete.</div>
        <button class="btn-google" id="btn-acct-google">${googleButtonHtml()}</button>
      </div>`;
    document.getElementById('btn-acct-google').addEventListener('click', signInWithGoogle);
  } else {
    const triggerInner = currentUser.picture
      ? `<img src="${esc(currentUser.picture)}" alt="" referrerpolicy="no-referrer">`
      : PERSON_ICON;
    bar.innerHTML = `
      <button class="account-trigger" id="account-toggle" aria-label="Account">${triggerInner}</button>
      <div class="account-panel">
        <div class="account-info">
          ${currentUser.picture ? `<img class="avatar" src="${esc(currentUser.picture)}" alt="" referrerpolicy="no-referrer">` : ''}
          <div class="who"><div class="name">${esc(currentUser.name)}</div><div class="sub">Account active</div></div>
        </div>
        <button class="btn-small" id="btn-signout">Sign out</button>
      </div>`;
    document.getElementById('btn-signout').addEventListener('click', signOut);
  }

  bar.classList.remove('open');
  document.getElementById('account-toggle').addEventListener('click', e => {
    e.stopPropagation();
    bar.classList.toggle('open');
  });
}

document.addEventListener('click', e => {
  const bar = document.getElementById('account-bar');
  if (bar && bar.classList.contains('open') && !bar.contains(e.target)) {
    bar.classList.remove('open');
  }
});

/* Prompts sign-in for account-only features; returns true when signed in. */
export function requireAccount(featureName) {
  if (currentUser) return true;
  openModal(`
    <h3>Sign in required</h3>
    <p>Sign in with Google to access ${esc(featureName)}.</p>
    <div class="modal-actions">
      <button class="btn-google" id="modal-signin">${googleButtonHtml()}</button>
      <button id="modal-close">Close</button>
    </div>`);
  document.getElementById('modal-signin').addEventListener('click', signInWithGoogle);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  return false;
}

/* ---------- Score posting ---------- */

/* `local` (optional) is a { kind, key } handle to the saved local result, so a
   successful insert marks it posted and a later backfill won't re-submit it. */
export function postScore({ difficulty, avgMs, accuracy, local }) {
  if (!currentUser) return Promise.resolve();
  return sb.from('scores').insert({
    user_id: currentUser.id,
    display_name: currentUser.name,
    difficulty,
    avg_solve_ms: Math.round(avgMs),
    accuracy,
  }).then(({ error }) => {
    if (error) { console.error('Leaderboard insert failed:', error.message); return; }
    if (local) markScorePosted(local.kind, local.key);
  });
}

/* Submit any locally-saved results that never reached the leaderboard — e.g. a
   round finished while signed out, then the player signs in. Idempotent: each
   posted result is tagged locally, and an in-flight guard stops the SIGNED_IN
   and initial-session paths from racing into a double insert. */
let backfilling = false;
export async function backfillScores() {
  if (!currentUser || backfilling) return;
  backfilling = true;
  try {
    for (const p of getUnpostedScores(todayKey())) {
      await postScore({
        difficulty: p.difficulty, avgMs: p.avgMs, accuracy: p.accuracy,
        local: { kind: p.kind, key: p.key },
      });
    }
  } finally {
    backfilling = false;
  }
}

/* ---------- Leaderboard ---------- */

/* One tab per difficulty. "Daily" is special: it shows only today's daily-
   challenge runs, so the board naturally refreshes at each local midnight. */
const LEADERBOARD_TABS = [
  { key: 'daily', label: 'Daily' },
  { key: 'easy', label: 'Easy' },
  { key: 'medium', label: 'Medium' },
  { key: 'hard', label: 'Hard' },
  { key: 'expert', label: 'Expert' },
];

let activeLeaderboardTab = 'daily';

function cap(s) {
  s = String(s || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* Local midnight as an ISO timestamp — the cutoff for "today's" daily board.
   Matches daily.js, where the puzzle rolls over at the player's local midnight. */
function startOfTodayISO() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
}

export async function openLeaderboard() {
  if (!requireAccount('the leaderboard')) return;
  showScreen('leaderboard');
  renderLeaderboardTabs();
  loadLeaderboardTab(activeLeaderboardTab);
}

function renderLeaderboardTabs() {
  const tabs = document.getElementById('leaderboard-tabs');
  if (!tabs) return;
  tabs.innerHTML = LEADERBOARD_TABS.map(t => `
    <button class="lb-tab${t.key === activeLeaderboardTab ? ' active' : ''}" role="tab"
      aria-selected="${t.key === activeLeaderboardTab}" data-tab="${esc(t.key)}">${esc(t.label)}</button>`).join('');
  tabs.querySelectorAll('.lb-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.tab;
      if (key === activeLeaderboardTab) return;
      activeLeaderboardTab = key;
      renderLeaderboardTabs();
      loadLeaderboardTab(key);
    });
  });
}

async function loadLeaderboardTab(diff) {
  const container = document.getElementById('leaderboard-content');
  const subtitle = document.getElementById('leaderboard-subtitle');
  if (subtitle) {
    subtitle.textContent = diff === 'daily'
      ? "Today's daily challenge — fastest average solve times. Resets at midnight."
      : `${cap(diff)} difficulty — fastest average solve times across all players. Lower is better.`;
  }
  container.innerHTML = `<div class="history-empty">Loading…</div>`;

  let query = sb
    .from('scores')
    .select('user_id, display_name, difficulty, avg_solve_ms, accuracy')
    .eq('difficulty', diff)
    .order('avg_solve_ms', { ascending: true })
    .limit(500);
  if (diff === 'daily') query = query.gte('created_at', startOfTodayISO());

  const { data, error } = await query;
  // Ignore results for a tab the user has since navigated away from.
  if (activeLeaderboardTab !== diff) return;

  const emptyMessage = diff === 'daily'
    ? "No scores yet today — be the first to finish today's daily challenge."
    : `No ${cap(diff)} scores yet — play a round to be the first on the board.`;
  renderLeaderboard(container, data ? dedupBestPerUser(data) : null, error,
    { showDifficulty: false, emptyMessage });
}

function dedupBestPerUser(rows) {
  const seen = new Set();
  return rows.filter(r => !seen.has(r.user_id) && seen.add(r.user_id)).slice(0, 50);
}

function renderLeaderboard(container, rows, error, opts = {}) {
  const showDifficulty = opts.showDifficulty !== false;
  const emptyMessage = opts.emptyMessage || 'No scores yet — play a round to be the first on the board.';
  if (error) {
    container.innerHTML = `<div class="history-empty">Couldn't load the leaderboard. ${esc(error.message)}</div>`;
    return;
  }
  if (!rows || !rows.length) {
    container.innerHTML = `<div class="history-empty">${esc(emptyMessage)}</div>`;
    return;
  }
  const rowClass = showDifficulty ? '' : ' no-diff';
  const body = rows.map((r, i) => {
    const mine = currentUser && r.user_id === currentUser.id;
    const diffCell = showDifficulty ? `<div class="num col-problems">${esc(cap(r.difficulty))}</div>` : '';
    return `
      <div class="history-row${rowClass}${mine ? ' me' : ''}">
        <div class="rank">${i + 1}</div>
        <div class="who-name">${esc(r.display_name)}${mine ? ' <span class="you">you</span>' : ''}</div>
        ${diffCell}
        <div class="num">${Math.round((r.accuracy || 0) * 100)}%</div>
        <div class="avg">${(r.avg_solve_ms / 1000).toFixed(2)}s avg</div>
      </div>`;
  }).join('');
  container.innerHTML = `
    <div class="history-list">
      <div class="history-row head${rowClass}">
        <div class="rank">#</div>
        <div>Player</div>
        ${showDifficulty ? '<div class="col-problems">Difficulty</div>' : ''}
        <div>Accuracy</div>
        <div>Avg Time</div>
      </div>
      ${body}
    </div>`;
}

/* ---------- Friend groups ---------- */

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I

function genInviteCode(len = 8) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return out;
}

function inviteLinkFor(code) {
  return window.location.origin + window.location.pathname + '#join=' + code;
}

async function lookupGroupByCode(code) {
  return await sb.from('groups').select('id, name').eq('invite_code', code).maybeSingle();
}

async function createGroup(name) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genInviteCode();
    const { data, error } = await sb
      .from('groups')
      .insert({ name, invite_code: code, created_by: currentUser.id })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') continue; // invite_code collision — regenerate
      return { error };
    }
    const memberRes = await sb
      .from('group_members')
      .insert({ group_id: data.id, user_id: currentUser.id, display_name: currentUser.name });
    return { error: memberRes.error || null, id: data.id };
  }
  return { error: { message: 'Could not generate a unique invite code. Try again.' } };
}

async function joinGroup(groupId) {
  const { error } = await sb
    .from('group_members')
    .insert({ group_id: groupId, user_id: currentUser.id, display_name: currentUser.name });
  if (error) {
    if (error.code === '23505') return { ok: true, already: true };
    return { ok: false, error };
  }
  return { ok: true, already: false };
}

async function leaveGroup(groupId) {
  return await sb.from('group_members').delete().eq('group_id', groupId).eq('user_id', currentUser.id);
}

async function loadMyGroups() {
  const { data, error } = await sb
    .from('group_members')
    .select('group_id, groups(id, name, invite_code)')
    .eq('user_id', currentUser.id);
  if (error) return { error };
  const groups = (data || [])
    .map(r => r.groups)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { groups };
}

export function openGroups() {
  if (!requireAccount('friend groups')) return;
  showScreen('groups');
  renderGroupsList();
}

async function renderGroupsList() {
  document.getElementById('groups-title').textContent = 'Friend Groups';
  document.getElementById('groups-subtitle').textContent = 'Create a group and invite friends to compete on your own leaderboard.';
  const container = document.getElementById('groups-content');
  container.innerHTML = `<div class="history-empty">Loading…</div>`;

  const { groups, error } = await loadMyGroups();
  if (error) {
    container.innerHTML = `<div class="history-empty">Couldn't load your groups. ${esc(error.message)}</div>`;
    return;
  }

  const list = groups.length
    ? groups.map(g => `
        <div class="group-item" data-group="${esc(g.id)}">
          <div class="group-name">${esc(g.name)}</div>
          <div class="group-actions">
            <button class="primary" data-act="board" data-id="${esc(g.id)}">View board</button>
            <button data-act="copy" data-code="${esc(g.invite_code)}">Copy invite link</button>
            <button data-act="leave" data-id="${esc(g.id)}" data-name="${esc(g.name)}">Leave</button>
          </div>
        </div>`).join('')
    : `<div class="history-empty">You're not in any groups yet. Create one above and share the invite link.</div>`;

  container.innerHTML = `
    <div class="group-create">
      <input id="group-name-input" type="text" maxlength="60" placeholder="New group name" />
      <button id="btn-create-group">Create</button>
    </div>
    ${list}`;

  const input = document.getElementById('group-name-input');
  const createBtn = document.getElementById('btn-create-group');
  async function submitCreate() {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';
    const { error: err } = await createGroup(name);
    if (err) {
      createBtn.disabled = false;
      createBtn.textContent = 'Create';
      alertModal("Couldn't create group", err.message);
      return;
    }
    renderGroupsList();
  }
  createBtn.addEventListener('click', submitCreate);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submitCreate(); });

  container.querySelectorAll('.group-actions button').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'board') openGroupBoard(btn.dataset.id);
      else if (act === 'copy') copyInviteLink(btn.dataset.code, btn);
      else if (act === 'leave') confirmLeaveGroup(btn.dataset.id, btn.dataset.name);
    });
  });
}

async function copyInviteLink(code, btn) {
  const link = inviteLinkFor(code);
  try {
    await navigator.clipboard.writeText(link);
    const prev = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = prev; }, 1500);
  } catch {
    openModal(`<h3>Invite link</h3><p>Copy this link and send it to a friend:</p>
      <p style="word-break:break-all; color:var(--text);">${esc(link)}</p>
      <div class="modal-actions"><button class="primary" id="modal-ok">Close</button></div>`);
    document.getElementById('modal-ok').addEventListener('click', closeModal);
  }
}

function confirmLeaveGroup(groupId, name) {
  openModal(`<h3>Leave group?</h3><p>You'll stop appearing on the “${esc(name)}” leaderboard. You can rejoin with an invite link.</p>
    <div class="modal-actions">
      <button class="primary" id="modal-leave">Leave group</button>
      <button id="modal-cancel">Cancel</button>
    </div>`);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-leave').addEventListener('click', async () => {
    const { error } = await leaveGroup(groupId);
    closeModal();
    if (error) {
      alertModal("Couldn't leave", error.message);
      return;
    }
    renderGroupsList();
  });
}

async function openGroupBoard(groupId) {
  showScreen('groups');
  const container = document.getElementById('groups-content');
  document.getElementById('groups-subtitle').textContent = 'Fastest average solve times in this group. Lower is better.';
  container.innerHTML = `<div class="history-empty">Loading…</div>`;

  const titleEl = document.getElementById('groups-title');
  const { data: memberRows, error: memberErr } = await sb
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId);
  if (memberErr) {
    renderGroupBoardShell(container, () => renderLeaderboard(container, null, memberErr));
    return;
  }
  const ids = (memberRows || []).map(r => r.user_id);
  titleEl.textContent = 'Group Leaderboard';
  if (!ids.length) {
    renderGroupBoardShell(container, () => renderLeaderboard(container, [], null));
    return;
  }

  const { data, error } = await sb
    .from('scores')
    .select('user_id, display_name, difficulty, avg_solve_ms, accuracy')
    .in('user_id', ids)
    .order('avg_solve_ms', { ascending: true })
    .limit(500);
  renderGroupBoardShell(container, () => renderLeaderboard(container, data ? dedupBestPerUser(data) : null, error));
}

function renderGroupBoardShell(container, renderBoard) {
  renderBoard();
  const back = document.createElement('button');
  back.className = 'back-link';
  back.textContent = '← Groups';
  back.style.marginBottom = '14px';
  back.addEventListener('click', () => openGroups());
  container.insertBefore(back, container.firstChild);
}

/* ---------- Invite-link capture / restore (survives the OAuth redirect) ---------- */

export function capturePendingInvite() {
  const m = window.location.hash.match(/[#&]join=([A-Za-z0-9_-]+)/);
  if (!m) return;
  setPendingJoin(m[1]);
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

export async function resolvePendingInvite() {
  if (!currentUser) return;
  const code = getPendingJoin();
  if (!code) return;
  const { data: group, error } = await lookupGroupByCode(code);
  if (error || !group) {
    clearPendingJoin();
    alertModal('Invite link not valid', 'This group invite link is invalid or no longer exists.');
    return;
  }
  openModal(`<h3>Join “${esc(group.name)}”?</h3><p>You've been invited to compete on this group's leaderboard.</p>
    <div class="modal-actions">
      <button class="primary" id="modal-join">Join this group</button>
      <button id="modal-notnow">Not now</button>
    </div>`);
  document.getElementById('modal-notnow').addEventListener('click', () => {
    clearPendingJoin();
    closeModal();
  });
  document.getElementById('modal-join').addEventListener('click', async () => {
    const res = await joinGroup(group.id);
    clearPendingJoin();
    closeModal();
    if (!res.ok) {
      alertModal("Couldn't join", res.error.message);
      return;
    }
    openGroupBoard(group.id);
  });
}

/* Pre-auth landing shown when a guest opens an invite link. Returns true if shown. */
export async function showInviteLanding() {
  const code = getPendingJoin();
  if (!code) return false;
  showScreen('invite');
  const sub = document.getElementById('invite-subtitle');
  const { data, error } = await sb.rpc('invite_preview', { code });
  const row = data && data[0];
  if (error || !row) {
    clearPendingJoin();
    showScreen('menu');
    return false;
  }
  sub.innerHTML = `<strong>${esc(row.inviter_name)}</strong> invited you to join `
    + `<strong>${esc(row.group_name)}</strong> and compete on its leaderboard.`;
  return true;
}

/* ---------- Boot ---------- */

export function initAuth({ onUserChanged }) {
  sb.auth.onAuthStateChange((event, session) => {
    currentUser = userFromSession(session);
    renderAccountBar();
    if (event === 'SIGNED_IN') {
      maybeWelcome();
      resolvePendingInvite();
      backfillScores();
    }
    if (onUserChanged) onUserChanged(currentUser);
  });

  return sb.auth.getSession().then(({ data }) => {
    currentUser = userFromSession(data.session);
    renderAccountBar();
    if (currentUser) backfillScores(); // recover any prior drops for an already-signed-in player
    return currentUser;
  });
}
