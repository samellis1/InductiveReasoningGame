/* Shared UI helpers: screen switching, modal, HTML escaping.

   esc() must wrap EVERY user-controlled string that goes through innerHTML —
   display names, group names, error messages. A Google display name is
   attacker-controlled input for every other player's browser. */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const screens = {};

export function registerScreens(ids) {
  for (const name of ids) screens[name] = document.getElementById('screen-' + name);
}

export function showScreen(name) {
  Object.values(screens).forEach(s => s && s.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');
  const gate = name === 'invite';
  const bar = document.getElementById('account-bar');
  if (bar) bar.style.display = gate ? 'none' : '';
  document.body.classList.toggle('login-active', gate);
}

export function activeScreen() {
  for (const [name, el] of Object.entries(screens)) {
    if (el && el.classList.contains('active')) return name;
  }
  return null;
}

export function openModal(html) {
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('active');
}

export function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

export function alertModal(title, message) {
  openModal(`<h3>${esc(title)}</h3><p>${esc(message)}</p>
    <div class="modal-actions"><button class="primary" id="modal-ok">Close</button></div>`);
  document.getElementById('modal-ok').addEventListener('click', closeModal);
}

/* Backdrop click closes the modal. */
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target.id === 'modal-overlay') closeModal();
});
