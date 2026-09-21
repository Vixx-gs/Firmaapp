// Importar un PDF desde Google Drive (Google Picker) o Dropbox (Chooser).
// Las claves son públicas por diseño (van en el navegador) y se leen en el
// build desde variables VITE_* del .env de la raíz; ver .env.example.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const GOOGLE_APP_ID = import.meta.env.VITE_GOOGLE_APP_ID;
const DROPBOX_APP_KEY = import.meta.env.VITE_DROPBOX_APP_KEY;

const MAX_BYTES = 50 * 1024 * 1024;

const scripts = new Map();
function loadScript(src, attrs = {}) {
  if (scripts.has(src)) return scripts.get(src);
  const promise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    el.onload = resolve;
    el.onerror = () => {
      scripts.delete(src);
      reject(new Error('No se pudo cargar el servicio externo. Revisa tu conexión.'));
    };
    document.head.appendChild(el);
  });
  scripts.set(src, promise);
  return promise;
}

function googleConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_API_KEY && GOOGLE_APP_ID);
}

function loadGoogleScripts() {
  return Promise.all([
    loadScript('https://accounts.google.com/gsi/client'),
    loadScript('https://apis.google.com/js/api.js'),
  ]);
}

function loadDropboxScript() {
  return loadScript('https://www.dropbox.com/static/api/2/dropins.js', {
    id: 'dropboxjs',
    'data-app-key': DROPBOX_APP_KEY,
  });
}

/** Precarga los scripts para que el popup se abra dentro del gesto del clic (Safari es estricto). */
export function warmUpCloudImport() {
  if (googleConfigured()) loadGoogleScripts().catch(() => {});
  if (DROPBOX_APP_KEY) loadDropboxScript().catch(() => {});
}

let googleToken = null;
let googleTokenExpiresAt = 0;

function getGoogleToken() {
  if (googleToken && Date.now() < googleTokenExpiresAt) return Promise.resolve(googleToken);
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (resp) => {
        if (resp.error) return reject(new Error('No se pudo conectar con Google Drive.'));
        googleToken = resp.access_token;
        googleTokenExpiresAt = Date.now() + (Number(resp.expires_in) - 60) * 1000;
        resolve(googleToken);
      },
      error_callback: () => reject(new Error('Se canceló el acceso a Google Drive.')),
    });
    client.requestAccessToken({ prompt: googleToken ? '' : 'select_account' });
  });
}

function rejectIfTooBig(bytes) {
  if (bytes && bytes > MAX_BYTES) throw new Error('El archivo supera el máximo de 50 MB.');
}

/** @returns {Promise<File|null>} el PDF elegido, o null si se cancela. */
export async function pickFromDrive() {
  if (!googleConfigured()) throw new Error('Google Drive todavía no está configurado.');
  await loadGoogleScripts();
  await new Promise((resolve) => window.gapi.load('picker', { callback: resolve }));

  const token = await getGoogleToken();
  const doc = await new Promise((resolve) => {
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setMimeTypes('application/pdf')
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);
    new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setAppId(GOOGLE_APP_ID)
      .setLocale('es')
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.PICKED) resolve(data.docs[0]);
        else if (data.action === window.google.picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
  if (!doc) return null;
  rejectIfTooBig(doc.sizeBytes);

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error('No se pudo descargar el archivo de Google Drive.');
  const blob = await res.blob();
  rejectIfTooBig(blob.size);
  return new File([blob], doc.name || 'documento.pdf', { type: 'application/pdf' });
}

/** @returns {Promise<File|null>} el PDF elegido, o null si se cancela. */
export async function pickFromDropbox() {
  if (!DROPBOX_APP_KEY) throw new Error('Dropbox todavía no está configurado.');
  await loadDropboxScript();
  if (!window.Dropbox?.isBrowserSupported()) throw new Error('Tu navegador no admite Dropbox.');

  const file = await new Promise((resolve) => {
    window.Dropbox.choose({
      linkType: 'direct',
      multiselect: false,
      extensions: ['.pdf'],
      sizeLimit: MAX_BYTES,
      success: (files) => resolve(files[0]),
      cancel: () => resolve(null),
    });
  });
  if (!file) return null;

  const res = await fetch(file.link);
  if (!res.ok) throw new Error('No se pudo descargar el archivo de Dropbox.');
  const blob = await res.blob();
  return new File([blob], file.name || 'documento.pdf', { type: 'application/pdf' });
}
