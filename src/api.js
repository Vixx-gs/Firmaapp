// fetch() para las rutas internas de la API: añade el token de sesión y, si el
// servidor responde 401 (token caducado o inválido), avisa para volver al login.
export const TOKEN_KEY = 'firma_token';

export async function apiFetch(url, options = {}) {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const headers = { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) document.dispatchEvent(new CustomEvent('firma:sessionExpired'));
  return res;
}
