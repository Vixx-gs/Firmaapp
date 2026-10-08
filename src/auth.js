// Autenticación contra el backend (POST /api/auth/login).
// role 'admin': sube documentos, asigna firmantes y ve el Registro completo.
// Cualquier otro role es un firmante interno; entra directo en su panel.
// Roles que SOLO pueden firmar (no envían documentos): entran directo en Pendientes.
const SIGNER_ONLY_ROLES = ['pablo', 'user'];
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

/** Comprueba la sesión guardada y engancha el formulario de login/logout. */
export function initAuth() {
  if (sessionStorage.getItem(SESSION_KEY) === '1') {
    const savedUser = sessionStorage.getItem(USER_KEY);
    const savedRole = sessionStorage.getItem(ROLE_KEY) || 'admin';
    setUserInitial(savedUser);
    applyRoleUI(savedRole);
    showApp();
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
      sessionStorage.setItem(SESSION_KEY, '1');
      sessionStorage.setItem(USER_KEY, data.username);
      sessionStorage.setItem(ROLE_KEY, data.role);
      setUserInitial(data.username);
      applyRoleUI(data.role);
      loginError.hidden = true;
      showApp();
      document.dispatchEvent(new CustomEvent('firma:loggedIn', { detail: { role: data.role } }));
    } catch {
      loginError.textContent = 'No se pudo conectar con el servidor.';
      loginError.hidden = false;
    }
  });

  btnLogout.addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(ROLE_KEY);
    applyRoleUI(null);
    showLogin();
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
