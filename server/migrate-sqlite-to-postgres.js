// Migración de un solo uso: copia los documentos, firmantes, campos y registro
// de envíos de la antigua base SQLite (firma.db + PDFs en server/uploads) a
// PostgreSQL. No borra ni modifica nada del origen y se puede repetir sin
// duplicar datos (lo que ya existe en PostgreSQL se salta).
//
// Uso (con DATABASE_URL en server/.env o en el entorno):
//   node server/migrate-sqlite-to-postgres.js [ruta/a/firma.db]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import dotenv from 'dotenv';
import { getPool, initSchema, withTransaction } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const sqlitePath = path.resolve(process.argv[2] || path.join(__dirname, 'firma.db'));
if (!fs.existsSync(sqlitePath)) {
  console.error(`No existe la base SQLite: ${sqlitePath}`);
  process.exit(1);
}

/** El PDF puede estar en la ruta guardada o, si el proyecto se movió, en uploads/<id>.pdf. */
function findPdf(doc) {
  const candidates = [doc.pdf_path, path.join(__dirname, 'uploads', `${doc.id}.pdf`)];
  const found = candidates.find((p) => p && fs.existsSync(p));
  return found ? fs.readFileSync(found) : null;
}

async function main() {
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  await initSchema();

  const docs = sqlite.prepare('SELECT * FROM documents').all();
  const stats = { documents: 0, signers: 0, fields: 0, send_log: 0, alreadyThere: 0 };
  const missing = [];

  await withTransaction(async (client) => {
    for (const doc of docs) {
      const pdf = findPdf(doc);
      if (!pdf) {
        missing.push(`${doc.filename} (${doc.id})`);
        continue;
      }

      const inserted = await client.query(
        'INSERT INTO documents (id, filename, pdf, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
        [doc.id, doc.filename, pdf, doc.created_at]
      );
      if (inserted.rowCount === 0) stats.alreadyThere++;
      else stats.documents++;

      for (const s of sqlite.prepare('SELECT * FROM signers WHERE document_id = ?').all(doc.id)) {
        const r = await client.query(
          `INSERT INTO signers (id, document_id, label, seq, name, phone, email)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
          [s.id, s.document_id, s.label, s.seq, s.name ?? null, s.phone ?? null, s.email ?? null]
        );
        stats.signers += r.rowCount;
      }

      for (const f of sqlite.prepare('SELECT * FROM fields WHERE document_id = ?').all(doc.id)) {
        const r = await client.query(
          `INSERT INTO fields (id, document_id, signer_id, page_index, x, y, w, h, css_scale, signed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
          [f.id, f.document_id, f.signer_id, f.page_index, f.x, f.y, f.w, f.h, f.css_scale, f.signed_at ?? null]
        );
        stats.fields += r.rowCount;
      }

      for (const l of sqlite.prepare('SELECT * FROM send_log WHERE document_id = ?').all(doc.id)) {
        const r = await client.query(
          `INSERT INTO send_log (id, document_id, signer_id, token, document_name, email, phone, sent_at, opened_at, signed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
          [
            l.id,
            l.document_id,
            l.signer_id,
            l.token,
            l.document_name,
            l.email ?? null,
            l.phone ?? null,
            l.sent_at,
            l.opened_at ?? null,
            l.signed_at ?? null,
          ]
        );
        stats.send_log += r.rowCount;
      }
    }
  });

  console.log(`Origen: ${sqlitePath} (${docs.length} documentos)`);
  console.log(
    `Copiados: ${stats.documents} documentos, ${stats.signers} firmantes, ${stats.fields} campos, ${stats.send_log} envíos.`
  );
  if (stats.alreadyThere) console.log(`Ya estaban en PostgreSQL y se han saltado: ${stats.alreadyThere} documentos.`);
  if (missing.length) {
    console.log(`\nATENCIÓN: no se encontró el PDF de ${missing.length} documento(s) y no se han copiado:`);
    missing.forEach((m) => console.log(`  - ${m}`));
  }
  await getPool().end();
  process.exit(missing.length ? 2 : 0);
}

main().catch((err) => {
  console.error('La migración ha fallado (no se ha copiado nada):', err.message);
  process.exit(1);
});
