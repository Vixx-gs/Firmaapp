// Autenticación contra el backend (POST /api/auth/login).
// role 'admin': sube documentos, asigna firmantes y ve el Registro completo.
// Cualquier otro role es un firmante interno; entra directo en su panel.
// Roles que SOLO pueden firmar (no envían documentos): entran directo en Pendientes.
const SIGNER_ONLY_ROLES = ['pablo', 'user'];
import { TOKEN_KEY } from './api.js';

const SESSION_KEY = 'firma_auth';
const USER_KEY = 'firma_user';
const ROLE_KEY = 'firma_role';

/** Rol de la sesión activa ('admin' | 'comercial' | …), o null si no hay sesión. */
export function getSessionRole() {
  return sessionStorage.getItem(ROLE_KEY);
}

/** Usuario de login de la sesión activa, o null si no hay sesión. */
export function getSessionUser() {
  return sessionStorage.getItem(USER_KEY);
}

/** true si el rol es un firmante interno puro (no puede enviar documentos). */
export function isInternalRole(role) {
  return role !== null && SIGNER_ONLY_ROLES.includes(role);
}

const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const loginUser = document.getElementById('login-user');
const loginPass = document.getElementById('login-pass');
const loginError = document.getElementById('login-error');
const app = document.getElementById('app');
const btnLogout = document.getElementById('btn-logout');

const userInitial = document.getElementById('user-initial');
const btnUser = document.getElementById('btn-user');
const userDropdown = document.getElementById('user-dropdown');
const menuMando = document.getElementById('menu-mando');

function setUserInitial(username) {
  userInitial.textContent = (username || 'A').trim().charAt(0).toUpperCase() || 'A';
}

function applyRoleUI(role) {
  document.body.classList.toggle('role-pablo', isInternalRole(role));
  if (menuMando) menuMando.hidden = role === null;
}

function showApp() {
  loginScreen.hidden = true;
  app.hidden = false;
}

function showLogin() {
  app.hidden = true;
  loginScreen.hidden = false;
  loginForm.reset();
  loginError.hidden = true;
  closeDropdown();
  loginUser.focus();
}

function openDropdown() {
  userDropdown.hidden = false;
  btnUser.setAttribute('aria-expanded', 'true');
}
function closeDropdown() {
  userDropdown.hidden = true;
  btnUser.setAttribute('aria-expanded', 'false');
}

/** Guarda la sesión (de login o del portal) y entra en la app. */
function startSession(data) {
  sessionStorage.setItem(SESSION_KEY, '1');
  sessionStorage.setItem(USER_KEY, data.username);
  sessionStorage.setItem(ROLE_KEY, data.role);
  sessionStorage.setItem(TOKEN_KEY, data.token);
  setUserInitial(data.nombre || data.username);
  applyRoleUI(data.role);
  loginError.hidden = true;
  showApp();
  document.dispatchEvent(new CustomEvent('firma:loggedIn', { detail: { role: data.role } }));
}

// En *.gesticotrans.app solo se entra pulsando la tarjeta de Firma en el
// Portal del Empleado: el portal añade un pase (?portal_launch=) que abre la
// sesión en esta pestaña. Escribir la URL o un marcador lleva al portal.
// En local (desarrollo) se mantiene el login de siempre.
const SOLO_PORTAL = window.location.hostname.endsWith('.gesticotrans.app');
const PORTAL_URL = 'https://gesticotrans.app';
// En *.gesticotrans.app no hay login propio: en lugar de "Salir" hay un botón
// para volver al portal (que también cierra la sesión de Firma en esta pestaña).
if (SOLO_PORTAL) {
  document.getElementById('btn-portal')?.removeAttribute('hidden');
  document.getElementById('btn-logout')?.setAttribute('hidden', '');
}

// El pase se lee al cargar y se quita de la barra de direcciones.
const LAUNCH = new URLSearchParams(window.location.search).get('portal_launch');
if (LAUNCH) {
  const url = new URL(window.location.href);
  url.searchParams.delete('portal_launch');
  window.history.replaceState(null, '', url);
}

/** Muestra un aviso en lugar del formulario (sin acceso, error…), con el enlace al portal. */
function showAviso(msg) {
  app.hidden = true;
  loginScreen.hidden = false;
  loginForm.querySelectorAll('label, button[type="submit"]').forEach((el) => (el.hidden = true));
  loginError.textContent = msg;
  loginError.hidden = false;
}

function irAlPortal() {
  window.location.href = PORTAL_URL;
}

/** Abre la sesión de Firma con el pase del portal. Devuelve true si ha entrado. */
async function entrarConPase(launch) {
  try {
    // Con cuerpo siempre: el cortafuegos (ModSecurity) bloquea los POST sin Content-Length.
    const res = await fetch('/api/auth/sso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ launch }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      startSession(data);
      return true;
    }
    if (res.status === 403) showAviso(data.error || 'No tienes acceso a Firma.');
    else irAlPortal();
    return false;
  } catch {
    showAviso('No se ha podido conectar con el Portal del Empleado. Inténtalo de nuevo en unos minutos.');
    return false;
  }
}

/** Comprueba la sesión y engancha el formulario de login/logout. */
export function initAuth() {
  // Mientras se comprueba la sesión no se enseña nada.
  loginScreen.hidden = true;
  app.hidden = true;
  const sesionEnEstaPestana = sessionStorage.getItem(SESSION_KEY) === '1' && sessionStorage.getItem(TOKEN_KEY);
  if (SOLO_PORTAL && LAUNCH) {
    // Un pase nuevo manda sobre lo que hubiera en esta pestaña.
    sessionStorage.removeItem(SESSION_KEY);
    entrarConPase(LAUNCH);
  } else if (sesionEnEstaPestana) {
    setUserInitial(sessionStorage.getItem(USER_KEY));
    applyRoleUI(sessionStorage.getItem(ROLE_KEY) || 'admin');
    showApp();
  } else if (SOLO_PORTAL) {
    irAlPortal();
  } else {
    showLogin();
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = loginUser.value.trim();
    const password = loginPass.value;
    loginError.hidden = true;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        loginError.textContent = data.error || 'Usuario o contraseña incorrectos.';
        loginError.hidden = false;
        loginPass.value = '';
        loginPass.focus();
        return;
      }
      startSession(data);
    } catch {
      loginError.textContent = 'No se pudo conectar con el servidor.';
      loginError.hidden = false;
    }
  });

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(ROLE_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    applyRoleUI(null);
    showLogin();
  }

  // Cerrar sesión devuelve al Portal del Empleado.
  btnLogout.addEventListener('click', () => {
    logout();
    window.location.href = PORTAL_URL;
  });
  document.getElementById('btn-portal')?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
    window.location.href = PORTAL_URL;
  });
  // Token caducado: si sigue la sesión del portal se renueva sin pedir nada.
  // Token caducado: en .app se vuelve al portal (hay que entrar por la tarjeta).
  document.addEventListener('firma:sessionExpired', () => {
    if (app.hidden) return;
    logout();
    if (SOLO_PORTAL) irAlPortal();
  });

  // ---------- Menú de usuario ----------
  btnUser.addEventListener('click', (e) => {
    e.stopPropagation();
    if (userDropdown.hidden) openDropdown();
    else closeDropdown();
  });

  userDropdown.querySelectorAll('.user-dropdown-item').forEach((item) => {
    item.addEventListener('click', () => {
      closeDropdown();
      const action = item.dataset.action;
      document.dispatchEvent(new CustomEvent(`firma:${action}`));
    });
  });

  document.addEventListener('click', (e) => {
    if (!userDropdown.hidden && !e.target.closest('.user-menu')) closeDropdown();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDropdown();
  });
}
