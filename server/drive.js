// Copia de los documentos totalmente firmados en una carpeta de Google Drive.
// Usa OAuth con refresh token de la cuenta destino y el permiso mínimo
// (drive.file: la app solo ve lo que ella misma crea, incluida la carpeta).
import { randomUUID } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DEFAULT_FOLDER_NAME = 'FirmaDigital- Documentos Firmados';

// Variables leídas de forma diferida (ver mailer.js).
export function isDriveConfigured() {
  const e = process.env;
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.GOOGLE_REFRESH_TOKEN);
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

let cachedToken = null;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw httpError(
      `Google rechazó la autorización (${res.status}): ${data.error_description || data.error || 'sin detalle'}`,
      res.status
    );
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) - 60) * 1000 };
  return cachedToken.value;
}

async function driveFetch(url, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401) cachedToken = null;
    const body = await res.text().catch(() => '');
    throw httpError(`Drive ${res.status}: ${body.slice(0, 300)}`, res.status);
  }
  return res;
}

async function findOrCreateFolder() {
  const name = process.env.GOOGLE_DRIVE_FOLDER_NAME || DEFAULT_FOLDER_NAME;
  const q = `mimeType='${FOLDER_MIME}' and name='${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and trashed=false`;
  const list = await (
    await driveFetch(`${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`)
  ).json();
  if (list.files?.length) return list.files[0].id;

  const created = await (
    await driveFetch(`${FILES_URL}?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
    })
  ).json();
  return created.id;
}

// Una sola búsqueda/creación a la vez, para no duplicar la carpeta si se
// firman dos documentos a la vez justo tras arrancar.
let folderPromise = null;
function ensureFolder() {
  if (!folderPromise) {
    folderPromise = findOrCreateFolder().catch((err) => {
      folderPromise = null;
      throw err;
    });
  }
  return folderPromise;
}

async function uploadOnce(name, pdfBuffer) {
  const folderId = await ensureFolder();
  const boundary = `firma-${randomUUID()}`;
  const metadata = JSON.stringify({ name, parents: [folderId], mimeType: 'application/pdf' });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`
    ),
    pdfBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await driveFetch(`${UPLOAD_URL}?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return res.json();
}

/**
 * Sube un PDF a la carpeta de Drive (creándola si no existe).
 * @param {{ name: string, pdfBuffer: Buffer }} params
 * @returns {Promise<{ id: string, webViewLink: string }>}
 */
export async function uploadSignedPdf({ name, pdfBuffer }) {
  try {
    return await uploadOnce(name, pdfBuffer);
  } catch (err) {
    // Si borraron la carpeta mientras el servidor seguía en marcha, se recrea.
    if (err.status !== 404) throw err;
    folderPromise = null;
    return uploadOnce(name, pdfBuffer);
  }
}
