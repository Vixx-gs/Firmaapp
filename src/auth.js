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

// En *.gesticotrans.app solo se entra por el Portal del Empleado: no hay
// login propio. En local (desarrollo) se mantiene el login de siempre.
const SOLO_PORTAL = window.location.hostname.endsWith('.gesticotrans.app');
const PORTAL_URL = 'https://gesticotrans.app';
const REDIRECT_KEY = 'firma_portal_redirect_at';

/** { status, data } de POST /api/auth/sso (401 sin sesión del portal, 403 sin acceso). */
async function fetchSso() {
  // Con cuerpo: el cortafuegos (ModSecurity) bloquea los POST sin Content-Length.
  const res = await fetch('/api/auth/sso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/** Muestra un aviso en lugar del formulario (sin acceso, error…), con el enlace al portal. */
function showAviso(msg) {
  app.hidden = true;
  loginScreen.hidden = false;
  loginForm.querySelectorAll('label, button[type="submit"]').forEach((el) => (el.hidden = true));
  loginError.textContent = msg;
  loginError.hidden = false;
}

/** Al login del portal, que devolverá aquí. Si ya se intentó hace poco, aviso (evita bucles). */
function irAlPortal() {
  const last = Number(sessionStorage.getItem(REDIRECT_KEY) || 0);
  if (Date.now() - last < 20000) {
    showAviso('No se ha podido iniciar sesión con el Portal del Empleado. Inténtalo de nuevo desde el portal.');
    return;
  }
  sessionStorage.setItem(REDIRECT_KEY, String(Date.now()));
  window.location.href = `${PORTAL_URL}/?next=${encodeURIComponent(window.location.href)}`;
}

/** Entra con la sesión del portal. Devuelve true si ha entrado. */
async function trySso() {
  try {
    const { status, data } = await fetchSso();
    if (status === 200) {
      sessionStorage.removeItem(REDIRECT_KEY);
      startSession(data);
      return true;
    }
    if (SOLO_PORTAL) {
      if (status === 401) irAlPortal();
      else if (status === 403) showAviso(data.error || 'No tienes acceso a Firma.');
      else showAviso('No se ha podido conectar con el Portal del Empleado. Inténtalo de nuevo en unos minutos.');
    }
    return false;
  } catch {
    if (SOLO_PORTAL) showAviso('No se ha podido conectar con el Portal del Empleado. Inténtalo de nuevo en unos minutos.');
    return false;
  }
}

/** Comprueba la sesión guardada y engancha el formulario de login/logout. */
export function initAuth() {
  // Mientras se comprueba la sesión no se enseña nada.
  loginScreen.hidden = true;
  app.hidden = true;
  if (SOLO_PORTAL) {
    // La sesión del portal manda siempre: una sesión local antigua no vale.
    sessionStorage.removeItem(SESSION_KEY);
    trySso();
  } else if (sessionStorage.getItem(SESSION_KEY) === '1' && sessionStorage.getItem(TOKEN_KEY)) {
    setUserInitial(sessionStorage.getItem(USER_KEY));
    applyRoleUI(sessionStorage.getItem(ROLE_KEY) || 'admin');
    showApp();
  } else {
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

  // Cerrar sesión devuelve al Portal del Empleado.
  btnLogout.addEventListener('click', () => {
    logout();
    window.location.href = PORTAL_URL;
  });
  // Token caducado: si sigue la sesión del portal se renueva sin pedir nada.
  document.addEventListener('firma:sessionExpired', async () => {
    if (app.hidden) return;
    if (!(await trySso()) && !SOLO_PORTAL) logout();
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
