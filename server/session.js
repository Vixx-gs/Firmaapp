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

/** Middleware: exige `Authorization: Bearer <token>` válido y deja el usuario en req.user. */
export function requireAuth(req, res, next) {
  const header = req.header('authorization') || '';
  const user = verifySessionToken(header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!user) return res.status(401).json({ error: 'Sesión no válida o caducada. Vuelve a iniciar sesión.' });
  req.user = user;
  next();
}
