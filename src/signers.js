// Lista de usuarios ya usados alguna vez (nombre + teléfono/email), para
// autocompletar el campo "Usuario" como un buscador de contactos (estilo
// "Para:" de email) y para poder reutilizar sus datos de contacto.
import { getProfile } from './profile.js';

const KNOWN_USERS_KEY = 'firma_known_users';

// Usuarios internos de la app (ver auth.js): siempre disponibles como
// sugerencia al asignar firmante, aunque nunca se hayan usado antes en este
// navegador. Su email se completa cuando ellos mismos lo rellenan en Perfil.
const BUILTIN_USERS = [
  { name: 'Pablo', email: '' },
  { name: 'Comercial', email: '' },
];

const signersList = document.getElementById('signers-list');
const modal = document.getElementById('signer-modal');
const form = document.getElementById('signer-form');
const titleEl = document.getElementById('signer-modal-title');
const emailInput = document.getElementById('signer-email');
const userInput = document.getElementById('signer-username');
const suggestionsEl = document.getElementById('signer-suggestions');
const errorEl = document.getElementById('signer-error');
const btnCancel = document.getElementById('signer-cancel');

let signers = []; // { id, label, email, username }
let signerSeq = 0;
let editingId = null;
let editingIsNew = false; // true si el modal se abrió justo tras crear el firmante (addSigner)

function getKnownUsers() {
  let stored = [];
  try {
    const raw = JSON.parse(localStorage.getItem(KNOWN_USERS_KEY)) || [];
    // Compatibilidad con el formato antiguo (solo nombres, sin contacto).
    stored = raw.map((u) => (typeof u === 'string' ? { name: u, email: '' } : u));
  } catch {
    stored = [];
  }
  const extra = BUILTIN_USERS.filter(
    (b) => !stored.some((u) => u.name.toLowerCase() === b.name.toLowerCase())
  );
  return [...stored, ...extra];
}

/** Guarda o actualiza el email asociado a un nombre de usuario. */
function rememberUser(name, email) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const list = getKnownUsers();
  const existing = list.find((u) => u.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    existing.email = email || existing.email;
  } else {
    list.push({ name: trimmed, email: email || '' });
  }
  localStorage.setItem(KNOWN_USERS_KEY, JSON.stringify(list));
}

/**
 * Busca un usuario por nombre exacto (sin distinguir mayúsculas). Si el
 * nombre coincide con el del propio perfil, usa los datos del perfil
 * (siempre actualizados) en vez de la copia guardada.
 */
function findKnownUser(name) {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return null;

  const profile = getProfile();
  if (profile.name && profile.name.trim().toLowerCase() === trimmed) {
    return { name: profile.name, email: profile.email || '' };
  }
  return getKnownUsers().find((u) => u.name.toLowerCase() === trimmed) || null;
}

/** Solo sugiere nombres ya usados antes (o el propio perfil); uno nuevo no aparece hasta escribirlo entero. */
function renderSuggestions(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    suggestionsEl.hidden = true;
    return;
  }

  const names = getKnownUsers().map((u) => u.name);
  const profile = getProfile();
  if (profile.name && !names.some((n) => n.toLowerCase() === profile.name.trim().toLowerCase())) {
    names.push(profile.name);
  }

  const matches = names.filter((n) => n.toLowerCase().includes(q)).slice(0, 6);

  if (matches.length === 0) {
    suggestionsEl.hidden = true;
    return;
  }
  suggestionsEl.innerHTML = '';
  matches.forEach((name) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'signer-suggestion-item';
    item.textContent = name;
    item.addEventListener('click', () => {
      userInput.value = name;
      suggestionsEl.hidden = true;
    });
    suggestionsEl.appendChild(item);
  });
  suggestionsEl.hidden = false;
}

userInput.addEventListener('input', () => renderSuggestions(userInput.value));
userInput.addEventListener('blur', () => {
  // Pequeño retraso para no cerrar antes de procesar el clic en una sugerencia.
  setTimeout(() => {
    suggestionsEl.hidden = true;
  }, 150);
});

function openModal(signer, { isNew = false } = {}) {
  editingId = signer.id;
  editingIsNew = isNew;
  titleEl.textContent = `Datos de ${signer.label}`;
  emailInput.value = signer.email || '';
  userInput.value = signer.username || '';
  errorEl.hidden = true;
  suggestionsEl.hidden = true;
  modal.hidden = false;
  emailInput.focus();
}

function closeModal() {
  modal.hidden = true;
  suggestionsEl.hidden = true;
  editingId = null;
  editingIsNew = false;
}

btnCancel.addEventListener('click', closeModal);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  const username = userInput.value.trim();

  let finalEmail = email;

  if (!email && username) {
    // Solo se ha rellenado "Usuario": reutilizamos su email si ya tiene uno
    // guardado (incluido el caso de que sea el propio perfil).
    const known = findKnownUser(username);
    if (known && known.email) {
      finalEmail = known.email;
    } else {
      errorEl.textContent = 'Primero completa tu perfil o introduce el email manualmente.';
      errorEl.hidden = false;
      return;
    }
  } else if (!email) {
    errorEl.textContent = 'Rellena el email.';
    errorEl.hidden = false;
    return;
  }

  const signer = signers.find((s) => s.id === editingId);
  if (!signer) return;
  signer.email = finalEmail;
  signer.username = username;
  if (username) rememberUser(username, finalEmail);

  renderChip(signer);
  const wasNew = editingIsNew;
  closeModal();

  if (wasNew) {
    document.dispatchEvent(new CustomEvent('firma:signerReady', { detail: { ...signer } }));
  }
});

function renderChip(signer) {
  let chip = signersList.querySelector(`[data-id="${signer.id}"]`);
  if (!chip) {
    chip = document.createElement('div');
    chip.dataset.id = String(signer.id);
    signersList.appendChild(chip);
  }
  const filled = Boolean(signer.email);
  chip.className = `signer-chip${filled ? ' filled' : ''}`;
  chip.innerHTML = `
    <button type="button" class="signer-chip-label">
      ${signer.label}${filled ? ' <span class="chip-check">✓</span>' : ''}
    </button>
    <button type="button" class="remove-signer" aria-label="Quitar firmante">×</button>
  `;
  chip.querySelector('.signer-chip-label').addEventListener('click', () => openModal(signer, { isNew: false }));
  chip.querySelector('.remove-signer').addEventListener('click', (e) => {
    e.stopPropagation();
    signers = signers.filter((s) => s.id !== signer.id);
    chip.remove();
    document.dispatchEvent(new CustomEvent('firma:signerRemoved', { detail: { id: signer.id } }));
    relabelSigners();
  });
}

/** Renumera los firmantes restantes (Firmante 1, 2, ...) tras quitar uno. */
function relabelSigners() {
  signers.forEach((s, i) => {
    s.label = `Firmante ${i + 1}`;
    renderChip(s);
  });
}

/** Crea un nuevo firmante, lo añade como chip y abre su card de datos. */
export function addSigner() {
  signerSeq++;
  const signer = { id: signerSeq, label: `Firmante ${signers.length + 1}`, email: '', username: '' };
  signers.push(signer);
  renderChip(signer);
  openModal(signer, { isNew: true });
}

/** Lista actual de firmantes confirmados, para asignarlos a campos de firma. */
export function getSigners() {
  return signers.map((s) => ({ ...s }));
}

/** Limpia los firmantes del documento actual (al cambiar de documento). */
export function resetSigners() {
  signers = [];
  signerSeq = 0;
  signersList.innerHTML = '';
  closeModal();
}
