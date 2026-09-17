// Credenciales fijas mientras no haya backend de usuarios.
// role 'admin': sube documentos, asigna firmantes y ve el Registro completo.
// role 'pablo': firmante interno (normalmente Firmante 2); entra directo en
// Pendientes y solo puede consultar/firmar sus propias firmas.
const USERS = [
  { username: 'admin', password: 'Admin123$', role: 'admin' },
  { username: 'Pablo', password: 'pablo234!', role: 'pablo' },
];
const SESSION_KEY = 'firma_auth';
const USER_KEY = 'firma_user';
const ROLE_KEY = 'firma_role';

/** Rol de la sesión activa ('admin' | 'pablo'), o null si no hay sesión. */
export function getSessionRole() {
  return sessionStorage.getItem(ROLE_KEY);
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
const menuRegistry = document.getElementById('menu-registry');
const toast = document.getElementById('toast');

function setUserInitial(username) {
  userInitial.textContent = (username || 'A').trim().charAt(0).toUpperCase() || 'A';
}

function applyRoleUI(role) {
  document.body.classList.toggle('role-pablo', role === 'pablo');
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

let toastTimer = null;
function showAuthToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('ok');
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 2600);
}

/** Comprueba la sesión guardada y engancha el formulario de login/logout. */
export function initAuth() {
  if (sessionStorage.getItem(SESSION_KEY) === '1') {
    const savedUser = sessionStorage.getItem(USER_KEY);
    const savedRole = sessionStorage.getItem(ROLE_KEY) || 'admin';
    setUserInitial(savedUser);
    menuRegistry.hidden = savedRole !== 'admin';
    applyRoleUI(savedRole);
    showApp();
  } else {
    showLogin();
  }

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = loginUser.value.trim();
    const match = USERS.find(
      (u) => u.username.toLowerCase() === username.toLowerCase() && u.password === loginPass.value
    );
    if (match) {
      sessionStorage.setItem(SESSION_KEY, '1');
      sessionStorage.setItem(USER_KEY, match.username);
      sessionStorage.setItem(ROLE_KEY, match.role);
      setUserInitial(match.username);
      menuRegistry.hidden = match.role !== 'admin';
      applyRoleUI(match.role);
      loginError.hidden = true;
      showApp();
      document.dispatchEvent(new CustomEvent('firma:loggedIn', { detail: { role: match.role } }));
    } else {
      loginError.hidden = false;
      loginPass.value = '';
      loginPass.focus();
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
      if (action === 'pending' || action === 'profile' || action === 'registry') {
        document.dispatchEvent(new CustomEvent(`firma:${action}`));
        return;
      }
      showAuthToast('Documentos: próximamente.');
    });
  });

  document.addEventListener('click', (e) => {
    if (!userDropdown.hidden && !e.target.closest('.user-menu')) closeDropdown();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDropdown();
  });
}
