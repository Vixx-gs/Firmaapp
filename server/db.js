import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const db = new DatabaseSync(path.join(__dirname, 'firma.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    pdf_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS signers (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    label TEXT NOT NULL,
    seq INTEGER NOT NULL,
    name TEXT,
    phone TEXT,
    email TEXT,
    FOREIGN KEY (document_id) REFERENCES documents(id)
  );

  CREATE TABLE IF NOT EXISTS fields (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    signer_id TEXT NOT NULL,
    page_index INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    w REAL NOT NULL,
    h REAL NOT NULL,
    css_scale REAL NOT NULL,
    signed_at TEXT,
    FOREIGN KEY (document_id) REFERENCES documents(id),
    FOREIGN KEY (signer_id) REFERENCES signers(id)
  );

  CREATE TABLE IF NOT EXISTS send_log (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    signer_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    document_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    sent_at TEXT NOT NULL,
    opened_at TEXT,
    signed_at TEXT,
    FOREIGN KEY (document_id) REFERENCES documents(id),
    FOREIGN KEY (signer_id) REFERENCES signers(id)
  );
`);

// Migración ligera para bases de datos creadas antes de añadir opened_at.
const sendLogColumns = db.prepare("PRAGMA table_info(send_log)").all();
if (!sendLogColumns.some((c) => c.name === 'opened_at')) {
  db.exec('ALTER TABLE send_log ADD COLUMN opened_at TEXT');
}
