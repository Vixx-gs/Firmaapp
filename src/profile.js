// Datos de perfil del usuario de la app, guardados localmente
// (no hay backend de usuarios todavía). Se guardan por usuario de login para
// que compartir navegador entre admin y firmantes internos (Pablo, Comercial)
// no mezcle sus datos.
import { getSessionUser } from './auth.js';

const PROFILE_KEY_PREFIX = 'firma_profile_';
const LEGACY_PROFILE_KEY = 'firma_profile'; // formato antiguo, sin usuario

function profileKey() {
  return `${PROFILE_KEY_PREFIX}${(getSessionUser() || 'admin').toLowerCase()}`;
}

const form = document.getElementById('profile-form');
const nameInput = document.getElementById('profile-name');
const phoneInput = document.getElementById('profile-phone');
const emailInput = document.getElementById('profile-email');
const userInitial = document.getElementById('user-initial');
const toast = document.getElementById('toast');

/** Datos de perfil guardados, accesibles desde otros módulos (p. ej. firmantes). */
export function getProfile() {
  try {
    return JSON.parse(localStorage.getItem(profileKey())) || {};
  } catch {
    return {};
  }
}

/** El nombre del perfil, si existe, manda sobre el usuario de login para la inicial del avatar. */
function applyAvatarInitial(profile) {
  const name = profile.name?.trim();
  if (name) userInitial.textContent = name.charAt(0).toUpperCase();
}

function fillForm() {
  const profile = getProfile();
  nameInput.value = profile.name || '';
  phoneInput.value = profile.phone || '';
  emailInput.value = profile.email || '';
}

let toastTimer = null;
function showProfileToast(msg) {
  toast.textContent = msg;
  toast.classList.add('ok');
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 2600);
}

/** Migra el perfil del formato antiguo (compartido) al del admin, una sola vez. */
function migrateLegacyProfile() {
  const legacy = localStorage.getItem(LEGACY_PROFILE_KEY);
  if (legacy === null) return;
  if (localStorage.getItem(`${PROFILE_KEY_PREFIX}admin`) === null) {
    localStorage.setItem(`${PROFILE_KEY_PREFIX}admin`, legacy);
  }
  localStorage.removeItem(LEGACY_PROFILE_KEY);
}

export function initProfile() {
  migrateLegacyProfile();
  const profile = getProfile();
  applyAvatarInitial(profile);
  fillForm();

  // Repoblar el formulario (y la inicial del avatar) cada vez que se entra a
  // la pantalla de perfil o que cambia el usuario logueado.
  document.addEventListener('firma:profile', fillForm);
  document.addEventListener('firma:loggedIn', () => {
    applyAvatarInitial(getProfile());
    fillForm();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const updated = {
      name: nameInput.value.trim(),
      phone: phoneInput.value.trim(),
      email: emailInput.value.trim(),
    };
    localStorage.setItem(profileKey(), JSON.stringify(updated));
    applyAvatarInitial(updated);
    showProfileToast('Perfil actualizado.');
  });
}
