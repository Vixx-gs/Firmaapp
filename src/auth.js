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
const menuUsuarios = document.getElementById('menu-usuarios');

function setUserInitial(username) {
  userInitial.textContent = (username || 'A').trim().charAt(0).toUpperCase() || 'A';
}

function applyRoleUI(role) {
  document.body.classList.toggle('role-pablo', isInternalRole(role));
  if (menuMando) menuMando.hidden = role === null;
  if (menuUsuarios) menuUsuarios.hidden = role !== 'admin';
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

/**
 * Entra con la sesión del Portal del Empleado si la hay. Devuelve true si
 * ha entrado; si no (sin sesión del portal o sin acceso a Firma), false.
 */
async function trySso() {
  try {
    // Con cuerpo: el cortafuegos (ModSecurity) bloquea los POST sin Content-Length.
    const res = await fetch('/api/auth/sso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) return false;
    startSession(await res.json());
    return true;
  } catch {
    return false;
  }
}

/** Comprueba la sesión guardada y engancha el formulario de login/logout. */
export function initAuth() {
  // Las sesiones de antes de los tokens no tienen firma_token: vuelven al login.
  if (sessionStorage.getItem(SESSION_KEY) === '1' && sessionStorage.getItem(TOKEN_KEY)) {
    const savedUser = sessionStorage.getItem(USER_KEY);
    const savedRole = sessionStorage.getItem(ROLE_KEY) || 'admin';
    setUserInitial(savedUser);
    applyRoleUI(savedRole);
    showApp();
  } else {
    // Mientras se comprueba la sesión del portal no se enseña nada.
    loginScreen.hidden = true;
    app.hidden = true;
    trySso().then((ok) => ok || showLogin());
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

  btnLogout.addEventListener('click', logout);
  // Token caducado: si sigue la sesión del portal se renueva sin pedir nada.
  document.addEventListener('firma:sessionExpired', async () => {
    if (app.hidden) return;
    if (!(await trySso())) logout();
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
