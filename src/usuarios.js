// Pantalla "Usuarios": el admin puede añadir y eliminar usuarios (nunca admin).
const listEl = document.getElementById('usuarios-list');
const emptyEl = document.getElementById('usuarios-empty');
const form = document.getElementById('usuarios-form');
const inputUser = document.getElementById('usuarios-username');
const inputPass = document.getElementById('usuarios-password');
const selectRole = document.getElementById('usuarios-role');
const errorEl = document.getElementById('usuarios-error');
const btnAdd = document.getElementById('usuarios-add-btn');

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderRow(user) {
  const tr = document.createElement('tr');
  tr.dataset.id = user.id;
  tr.innerHTML = `
    <td>${user.username}</td>
    <td><span class="registry-status pending">${user.role}</span></td>
    <td>${formatDate(user.createdAt)}</td>
    <td>
      <button type="button" class="usuarios-delete-btn" data-id="${user.id}" aria-label="Eliminar usuario">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4h6v2" />
        </svg>
        Eliminar
      </button>
    </td>
  `;
  tr.querySelector('.usuarios-delete-btn').addEventListener('click', () => deleteUser(user.id, tr));
  return tr;
}

async function deleteUser(id, tr) {
  if (!confirm('¿Eliminar este usuario? Esta acción no se puede deshacer.')) return;
  try {
    const res = await fetch(`/api/users/${id}`, {
      method: 'DELETE',
      headers: { 'x-firma-role': 'admin' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo eliminar.');
    tr.remove();
    if (!listEl.querySelector('tr')) {
      listEl.closest('table').hidden = true;
      emptyEl.hidden = false;
    }
  } catch (err) {
    alert(err.message);
  }
}

async function loadUsers() {
  listEl.innerHTML = '';
  emptyEl.hidden = true;
  try {
    const res = await fetch('/api/users', { headers: { 'x-firma-role': 'admin' } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar.');
    if (data.users.length === 0) {
      listEl.closest('table').hidden = true;
      emptyEl.hidden = false;
    } else {
      listEl.closest('table').hidden = false;
      emptyEl.hidden = true;
      data.users.forEach((u) => listEl.appendChild(renderRow(u)));
    }
  } catch (err) {
    emptyEl.textContent = err.message;
    emptyEl.hidden = false;
  }
}

form && form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  const username = inputUser.value.trim();
  const password = inputPass.value;
  const role = selectRole.value;
  if (!username || !password) {
    errorEl.textContent = 'Rellena usuario y contraseña.';
    errorEl.hidden = false;
    return;
  }
  btnAdd.disabled = true;
  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-firma-role': 'admin' },
      body: JSON.stringify({ username, password, role }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo crear.');
    form.reset();
    const table = listEl.closest('table');
    table.hidden = false;
    emptyEl.hidden = true;
    listEl.prepend(renderRow(data));
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    btnAdd.disabled = false;
  }
});

/** Carga la pantalla de usuarios (llamado desde main.js). */
export function loadUsuarios() {
  loadUsers();
}
