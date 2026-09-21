// Script de un solo uso: autoriza la cuenta de Google Drive donde se guardan
// los documentos firmados y muestra el GOOGLE_REFRESH_TOKEN que hay que poner
// en las variables de entorno del servidor.
//
// Uso (en tu PC, con GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en server/.env):
//   node server/drive-auth.js
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en server/.env');
  process.exit(1);
}

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const ACCOUNT = process.env.GOOGLE_DRIVE_ACCOUNT || 'ivantrafico1@gmail.com';
const state = randomUUID();

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',
    prompt: 'consent',
    login_hint: ACCOUNT,
    state,
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }

  const finish = (status, message, exitCode) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<p style="font-family:sans-serif">${message}</p>`);
    server.close();
    setTimeout(() => process.exit(exitCode), 200);
  };

  if (url.searchParams.get('state') !== state) return finish(400, 'Petición no válida.', 1);
  if (url.searchParams.get('error')) {
    console.error('Google devolvió un error:', url.searchParams.get('error'));
    return finish(400, 'No se autorizó el acceso. Puedes cerrar esta ventana.', 1);
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code'),
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.refresh_token) {
    console.error('No se obtuvo refresh token:', tokens.error_description || tokens.error || tokens);
    return finish(500, 'No se pudo completar la autorización. Mira la terminal.', 1);
  }

  console.log('\nAutorización correcta. Añade esto a las variables de entorno del servidor:\n');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  finish(200, 'Listo. Ya puedes cerrar esta ventana y volver a la terminal.', 0);
});

server.listen(PORT, () => {
  console.log(`Abre este enlace e inicia sesión como ${ACCOUNT}:\n\n${authUrl}\n`);
});
