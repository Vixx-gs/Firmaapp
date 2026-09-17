// Datos de perfil del usuario de la app, guardados localmente
// (no hay backend de usuarios todavía).
const PROFILE_KEY = 'firma_profile';

const form = document.getElementById('profile-form');
const nameInput = document.getElementById('profile-name');
const phoneInput = document.getElementById('profile-phone');
const emailInput = document.getElementById('profile-email');
const userInitial = document.getElementById('user-initial');
const toast = document.getElementById('toast');

/** Datos de perfil guardados, accesibles desde otros módulos (p. ej. firmantes). */
export function getProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {};
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

export function initProfile() {
  const profile = getProfile();
  applyAvatarInitial(profile);
  fillForm();

  // Repoblar el formulario cada vez que se entra a la pantalla de perfil.
  document.addEventListener('firma:profile', fillForm);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const updated = {
      name: nameInput.value.trim(),
      phone: phoneInput.value.trim(),
      email: emailInput.value.trim(),
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
    applyAvatarInitial(updated);
    showProfileToast('Perfil actualizado.');
  });
}
