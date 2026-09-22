import pg from 'pg';

// El pool se crea de forma diferida (no al importar el módulo) para que
// dotenv.config() en index.js haya cargado ya DATABASE_URL.
let pool = null;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('Falta DATABASE_URL (conexión a PostgreSQL) en las variables de entorno del servidor.');
    }
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    // Un fallo en una conexión inactiva no debe tumbar todo el proceso.
    pool.on('error', (err) => console.error('Error en una conexión inactiva de PostgreSQL:', err.message));
  }
  return pool;
}

/** Ejecuta una consulta y devuelve las filas. Parámetros como $1, $2… */
export async function all(text, params = []) {
  return (await getPool().query(text, params)).rows;
}

/** Ejecuta una sentencia sin devolver filas (INSERT/UPDATE/DELETE). */
export async function run(text, params = []) {
  await getPool().query(text, params);
}

/** Como `all`, pero devuelve solo la primera fila (o null). */
export async function one(text, params = []) {
  return (await all(text, params))[0] || null;
}

/** Ejecuta `fn(client)` dentro de una transacción; deshace todo si lanza. */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    pdf BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS signers (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    seq INTEGER NOT NULL,
    name TEXT,
    phone TEXT,
    email TEXT
  );

  CREATE TABLE IF NOT EXISTS fields (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    signer_id TEXT NOT NULL REFERENCES signers(id) ON DELETE CASCADE,
    page_index INTEGER NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    w DOUBLE PRECISION NOT NULL,
    h DOUBLE PRECISION NOT NULL,
    css_scale DOUBLE PRECISION NOT NULL,
    signed_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS send_log (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    signer_id TEXT NOT NULL REFERENCES signers(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    document_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    sent_at TIMESTAMPTZ NOT NULL,
    opened_at TIMESTAMPTZ,
    signed_at TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS idx_signers_document ON signers(document_id);
  CREATE INDEX IF NOT EXISTS idx_signers_email ON signers(lower(email));
  CREATE INDEX IF NOT EXISTS idx_fields_document ON fields(document_id);
  CREATE INDEX IF NOT EXISTS idx_send_log_document ON send_log(document_id);
`;

/** Crea las tablas si no existen. Se llama una vez al arrancar el servidor. */
export async function initSchema() {
  await getPool().query(SCHEMA);
}
