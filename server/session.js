import crypto from 'node:crypto';

// Tokens de sesión firmados con HMAC: `<payload base64url>.<firma base64url>`.
// El servidor no guarda estado; basta con SESSION_SECRET en server/.env.

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Se lee de forma diferida porque index.js carga dotenv después de importar
// este módulo.
let secret = null;
function getSecret() {
  if (!secret) {
    secret = process.env.SESSION_SECRET;
    if (!secret) {
      // Sin secreto fijo las sesiones se pierden en cada reinicio del proceso.
      console.warn('Falta SESSION_SECRET en server/.env: se usa uno aleatorio temporal.');
      secret = crypto.randomBytes(32).toString('hex');
    }
  }
  return secret;
}

function sign(data) {
  return crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
}

/** Crea un token para el usuario que acaba de hacer login. */
export function createSessionToken({ username, role }) {
  const payload = Buffer.from(
    JSON.stringify({ u: username, r: role, exp: Date.now() + SESSION_TTL_MS })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Devuelve { username, role } si el token es válido y no ha caducado; si no, null. */
export function verifySessionToken(token) {
  if (typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;

  try {
    const { u, r, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!u || !r || typeof exp !== 'number' || exp < Date.now()) return null;
    return { username: u, role: r };
  } catch {
    return null;
  }
}

// ── La sesión de Firma depende de la del portal ─────────────────────────────
// En *.gesticotrans.app el navegador envía también la cookie del portal. Si esa
// sesión se ha cerrado (Cerrar sesión, o un administrador la ha anulado) o es
// de otra persona, la sesión de Firma deja de valer. Se pregunta al portal como
// mucho una vez por minuto; si el portal no responde, no se bloquea a nadie.
const PORTAL_URL = process.env.PORTAL_URL || 'https://gesticotrans.app';
const PORTAL_COOKIE = '__Secure-gt_session';
const COMPROBAR_CADA_MS = 60 * 1000;
const comprobadas = new Map(); // huella(cookie)|usuario → { ok, hasta }

function cookiePortal(req) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === PORTAL_COOKIE) return v.join('=');
  }
  return null;
}

async function sesionPortalValida(req, username) {
  if (!req.hostname.endsWith('.gesticotrans.app')) return true;
  const cookie = cookiePortal(req);
  if (!cookie) return false;
  const clave = `${crypto.createHash('sha256').update(cookie).digest('hex')}|${username}`;
  const guardada = comprobadas.get(clave);
  if (guardada && guardada.hasta > Date.now()) return guardada.ok;
  let ok = true;
  try {
    const r = await fetch(`${PORTAL_URL}/api/me`, { headers: { cookie: `${PORTAL_COOKIE}=${cookie}` }, signal: AbortSignal.timeout(5000) });
    if (r.status === 401 || r.status === 403) ok = false;
    else if (r.ok) ok = (await r.json()).username === username;
  } catch { /* portal sin respuesta: no se bloquea */ }
  if (comprobadas.size > 5000) comprobadas.clear();
  comprobadas.set(clave, { ok, hasta: Date.now() + COMPROBAR_CADA_MS });
  return ok;
}

/** Middleware: exige `Authorization: Bearer <token>` válido y deja el usuario en req.user. */
export async function requireAuth(req, res, next) {
  const header = req.header('authorization') || '';
  const user = verifySessionToken(header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!user) return res.status(401).json({ error: 'Sesión no válida o caducada. Vuelve a iniciar sesión.' });
  if (!(await sesionPortalValida(req, user.username))) {
    return res.status(401).json({ error: 'Tu sesión del Portal del Empleado ha terminado. Vuelve a entrar desde el portal.' });
  }
  req.user = user;
  next();
}
