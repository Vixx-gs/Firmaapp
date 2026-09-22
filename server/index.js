import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PDFDocument } from 'pdf-lib';
import { all, one, run, withTransaction, initSchema } from './db.js';
import { sendSignRequestEmail, sendCompletedDocumentEmail } from './mailer.js';
import { sendSignRequestWhatsapp } from './whatsapp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const DIST_DIR = path.join(__dirname, '..', 'dist');

const PORT = process.env.PORT || 4000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:5173`;

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

function nowIso() {
  return new Date().toISOString();
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  return Buffer.from(base64, 'base64');
}

function requireAdmin(req, res) {
  if (req.header('x-firma-role') !== 'admin') {
    res.status(403).json({ error: 'No autorizado.' });
    return false;
  }
  return true;
}

/**
 * Envuelve un handler async para que un fallo (p. ej. la base de datos no
 * responde) devuelva un 500 en JSON en vez de un rechazo sin capturar, que
 * en Node tumbaría el proceso.
 */
const route = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};

/** Agrupa filas por una clave: { clave: [filas] }. */
function groupBy(rows, key) {
  const groups = {};
  for (const row of rows) (groups[row[key]] ||= []).push(row);
  return groups;
}

/**
 * Notifica a un firmante por cada canal de contacto que tenga (email y/o
 * WhatsApp) y, si al menos uno funciona, deja constancia en el registro.
 * @param {{id:string, filename:string}} documentRow
 * @param {{id:string, label:string, email:string|null, phone:string|null}} signerRow
 * @returns {Promise<{token:string, channels:string[]}>}
 */
async function notifySigner(documentRow, signerRow) {
  const token = randomUUID();
  const signLink = `${PUBLIC_URL}/?sign=${token}`;
  const channels = [];
  const errors = [];

  if (signerRow.email) {
    try {
      await sendSignRequestEmail({ to: signerRow.email, signLink, documentName: documentRow.filename });
      channels.push('email');
    } catch (err) {
      errors.push(`Email: ${err.message}`);
    }
  }
  if (signerRow.phone) {
    try {
      await sendSignRequestWhatsapp({ to: signerRow.phone, signLink, documentName: documentRow.filename });
      channels.push('whatsapp');
    } catch (err) {
      errors.push(`WhatsApp: ${err.message}`);
    }
  }

  if (channels.length === 0) {
    throw new Error(errors.join(' · ') || `No se pudo notificar a ${signerRow.label}.`);
  }

  await run(
    `INSERT INTO send_log (id, document_id, signer_id, token, document_name, email, phone, sent_at, opened_at, signed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL)`,
    [
      randomUUID(),
      documentRow.id,
      signerRow.id,
      token,
      documentRow.filename,
      signerRow.email || null,
      signerRow.phone || null,
      nowIso(),
    ]
  );

  return { token, channels, errors };
}

/** Comprobación rápida de que el servidor y la base de datos responden. */
app.get(
  '/api/health',
  route(async (req, res) => {
    await one('SELECT 1 AS ok');
    res.json({ ok: true });
  })
);

/**
 * Recibe el documento + campos + firmantes, los guarda, y notifica al
 * primer firmante (por orden). El resto se va avisando automáticamente a
 * medida que cada uno firma (ver POST /api/sign/:token).
 * Body: { documentName, pdfBase64, signers: [{label,name,phone,email}],
 *          fields: [{ signerLabel, pageIndex, x, y, w, h, cssScale }] }
 */
app.post(
  '/api/send-document',
  route(async (req, res) => {
    const { documentName, pdfBase64, signers, fields } = req.body;

    if (typeof pdfBase64 !== 'string' || !pdfBase64 || !documentName) {
      return res.status(400).json({ error: 'Falta el documento.' });
    }
    if (!Array.isArray(signers) || signers.length === 0) {
      return res.status(400).json({ error: 'No hay firmantes.' });
    }
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: 'No hay campos de firma asignados.' });
    }

    const firstSigner = signers[0];
    if (!firstSigner.email) {
      return res
        .status(400)
        .json({ error: `${firstSigner.label} necesita un email para poder enviarle el documento.` });
    }

    const documentId = randomUUID();
    const signerIdByLabel = {};

    // Todo o nada: un fallo a mitad no deja un documento a medias guardado.
    await withTransaction(async (client) => {
      await client.query('INSERT INTO documents (id, filename, pdf, created_at) VALUES ($1, $2, $3, $4)', [
        documentId,
        documentName,
        Buffer.from(pdfBase64, 'base64'),
        nowIso(),
      ]);

      for (const [i, s] of signers.entries()) {
        const signerId = randomUUID();
        signerIdByLabel[s.label] = signerId;
        await client.query(
          'INSERT INTO signers (id, document_id, label, seq, name, phone, email) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [signerId, documentId, s.label, i, s.name || null, s.phone || null, s.email || null]
        );
      }

      for (const f of fields) {
        const signerId = signerIdByLabel[f.signerLabel];
        if (!signerId) continue;
        await client.query(
          `INSERT INTO fields (id, document_id, signer_id, page_index, x, y, w, h, css_scale, signed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
          [randomUUID(), documentId, signerId, f.pageIndex, f.x, f.y, f.w, f.h, f.cssScale]
        );
      }
    });

    const documentRow = { id: documentId, filename: documentName };
    const firstSignerRow = {
      id: signerIdByLabel[firstSigner.label],
      label: firstSigner.label,
      email: firstSigner.email || null,
      phone: null,
    };
    const { channels } = await notifySigner(documentRow, firstSignerRow);

    res.json({ ok: true, sentTo: firstSigner.email, channels });
  })
);

/** Datos necesarios para que el firmante externo vea y firme su campo. */
app.get(
  '/api/sign/:token',
  route(async (req, res) => {
    const log = await one('SELECT * FROM send_log WHERE token = $1', [req.params.token]);
    if (!log) return res.status(404).json({ error: 'Enlace no válido.' });

    const doc = await one('SELECT id, filename, pdf FROM documents WHERE id = $1', [log.document_id]);
    const signer = await one('SELECT * FROM signers WHERE id = $1', [log.signer_id]);
    const field = await one('SELECT * FROM fields WHERE document_id = $1 AND signer_id = $2', [
      log.document_id,
      log.signer_id,
    ]);

    if (!doc || !signer || !field) return res.status(404).json({ error: 'Datos no encontrados.' });

    // Solo se marca la primera vez que se abre el enlace.
    if (!log.opened_at) {
      await run('UPDATE send_log SET opened_at = $1 WHERE id = $2 AND opened_at IS NULL', [nowIso(), log.id]);
    }

    res.json({
      documentName: doc.filename,
      signerLabel: signer.label,
      alreadySigned: Boolean(field.signed_at),
      pdfBase64: doc.pdf.toString('base64'),
      field: {
        pageIndex: field.page_index,
        x: field.x,
        y: field.y,
        w: field.w,
        h: field.h,
        cssScale: field.css_scale,
      },
    });
  })
);

/**
 * Recibe la firma dibujada, la incrusta en el PDF, marca la hora de firma
 * y, si hay un siguiente firmante en orden con un campo asignado, le avisa
 * automáticamente para que firme a continuación.
 */
app.post(
  '/api/sign/:token',
  route(async (req, res) => {
    const { signatureDataUrl } = req.body;
    if (typeof signatureDataUrl !== 'string' || !signatureDataUrl.includes(',')) {
      return res.status(400).json({ error: 'Falta la firma.' });
    }

    // Se bloquea la fila del documento mientras se incrusta la firma: dos
    // firmas simultáneas se aplican una detrás de otra sin pisarse el PDF.
    const outcome = await withTransaction(async (client) => {
      const log = (await client.query('SELECT * FROM send_log WHERE token = $1', [req.params.token])).rows[0];
      if (!log) return { status: 404, error: 'Enlace no válido.' };

      const doc = (
        await client.query('SELECT id, filename, pdf FROM documents WHERE id = $1 FOR UPDATE', [log.document_id])
      ).rows[0];
      const currentSigner = (await client.query('SELECT * FROM signers WHERE id = $1', [log.signer_id])).rows[0];
      const field = (
        await client.query('SELECT * FROM fields WHERE document_id = $1 AND signer_id = $2', [
          log.document_id,
          log.signer_id,
        ])
      ).rows[0];
      if (!doc || !field) return { status: 404, error: 'Datos no encontrados.' };
      if (field.signed_at) return { status: 409, error: 'Este documento ya está firmado por ti.' };

      const pdfDoc = await PDFDocument.load(doc.pdf);
      const page = pdfDoc.getPages()[field.page_index];
      const png = await pdfDoc.embedPng(dataUrlToBytes(signatureDataUrl));

      const xPt = field.x / field.css_scale;
      const wPt = field.w / field.css_scale;
      const hPt = field.h / field.css_scale;
      const yPt = page.getSize().height - field.y / field.css_scale - hPt;
      page.drawImage(png, { x: xPt, y: yPt, width: wPt, height: hPt });

      const signedPdf = Buffer.from(await pdfDoc.save());
      const signedAt = nowIso();
      await client.query('UPDATE documents SET pdf = $1 WHERE id = $2', [signedPdf, doc.id]);
      await client.query('UPDATE fields SET signed_at = $1 WHERE id = $2', [signedAt, field.id]);
      await client.query('UPDATE send_log SET signed_at = $1 WHERE id = $2', [signedAt, log.id]);

      // ¿Hay un siguiente firmante (por orden) con un campo asignado en este documento?
      const nextSigner =
        (
          await client.query('SELECT * FROM signers WHERE document_id = $1 AND seq > $2 ORDER BY seq LIMIT 1', [
            doc.id,
            currentSigner.seq,
          ])
        ).rows[0] || null;
      const nextHasField = nextSigner
        ? Boolean(
            (await client.query('SELECT 1 FROM fields WHERE document_id = $1 AND signer_id = $2', [doc.id, nextSigner.id]))
              .rows[0]
          )
        : false;

      // ¿Quedan campos sin firmar? Si no, el documento está completo.
      const stillPending = (
        await client.query('SELECT 1 FROM fields WHERE document_id = $1 AND signed_at IS NULL', [doc.id])
      ).rows[0];
      const allSigners = stillPending
        ? []
        : (await client.query('SELECT * FROM signers WHERE document_id = $1', [doc.id])).rows;

      return {
        ok: true,
        doc: { id: doc.id, filename: doc.filename },
        nextSigner,
        nextHasField,
        completed: !stillPending,
        finalPdf: signedPdf,
        allSigners,
      };
    });

    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });

    // Los avisos (email/WhatsApp) van fuera de la transacción: no bloquean la base de datos.
    let nextNotified = false;
    let nextError = null;
    if (outcome.nextSigner && outcome.nextHasField) {
      try {
        await notifySigner(outcome.doc, outcome.nextSigner);
        nextNotified = true;
      } catch (err) {
        nextError = err.message;
      }
    }

    // Documento completo: copia final por email a todos los firmantes con email.
    if (outcome.completed) {
      await Promise.all(
        outcome.allSigners
          .filter((s) => s.email)
          .map((s) =>
            sendCompletedDocumentEmail({
              to: s.email,
              documentName: outcome.doc.filename,
              pdfBuffer: outcome.finalPdf,
            }).catch((err) => console.error(`No se pudo enviar copia final a ${s.email}:`, err.message))
          )
      );
    }

    res.json({ ok: true, nextNotified, nextError, completed: outcome.completed });
  })
);

/**
 * Descarga el PDF tal y como está ahora (sin firmas, con una, o con
 * todas). El admin puede descargar cualquier documento; un firmante solo
 * puede descargar uno que él mismo haya firmado (identificado por email).
 */
app.get(
  '/api/documents/:id/download',
  route(async (req, res) => {
    const doc = await one('SELECT id, filename, pdf FROM documents WHERE id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });

    if (req.header('x-firma-role') !== 'admin') {
      const email = (req.query.email || '').trim();
      const signed = email
        ? await one(
            `SELECT 1 FROM signers s
             JOIN send_log l ON l.signer_id = s.id
             WHERE s.document_id = $1 AND lower(s.email) = lower($2) AND l.signed_at IS NOT NULL`,
            [doc.id, email]
          )
        : null;
      if (!signed) return res.status(403).json({ error: 'No autorizado.' });
    }

    res.attachment(doc.filename);
    res.type('application/pdf');
    res.send(doc.pdf);
  })
);

/**
 * Documentos que un usuario concreto (por email) ha firmado, para su
 * "Registro" personal.
 */
app.get(
  '/api/my-registry',
  route(async (req, res) => {
    const email = (req.query.email || '').trim();
    if (!email) return res.status(400).json({ error: 'Falta el email.' });

    const rows = await all(
      `SELECT s.document_id AS "documentId", s.label AS "ownLabel", l.signed_at AS "ownSignedAt",
              d.filename AS "documentName"
       FROM signers s
       JOIN send_log l ON l.signer_id = s.id
       JOIN documents d ON d.id = s.document_id
       WHERE lower(s.email) = lower($1) AND l.signed_at IS NOT NULL
       ORDER BY l.signed_at DESC`,
      [email]
    );

    res.json({ documents: rows });
  })
);

/**
 * Firmas pendientes/realizadas de un usuario concreto, identificado por su
 * email (el mismo que se le puso al añadirlo como firmante). Se listan
 * todos los documentos donde ese email es firmante, desde el momento en
 * que el documento se envía (aunque todavía no le haya tocado el turno a
 * él), junto con el estado de los demás firmantes. `token` solo viene
 * relleno cuando ya se le ha notificado a él (es decir, ya puede firmar).
 */
app.get(
  '/api/pending',
  route(async (req, res) => {
    const email = (req.query.email || '').trim();
    if (!email) return res.status(400).json({ error: 'Falta el email.' });

    const ownSigners = await all('SELECT * FROM signers WHERE lower(email) = lower($1)', [email]);
    if (ownSigners.length === 0) return res.json({ pending: [] });

    const documentIds = [...new Set(ownSigners.map((s) => s.document_id))];
    const docs = await all('SELECT id, filename FROM documents WHERE id = ANY($1)', [documentIds]);
    const docById = Object.fromEntries(docs.map((d) => [d.id, d]));
    const signersByDoc = groupBy(
      await all('SELECT * FROM signers WHERE document_id = ANY($1) ORDER BY seq', [documentIds]),
      'document_id'
    );
    const logsByDoc = groupBy(
      await all('SELECT * FROM send_log WHERE document_id = ANY($1)', [documentIds]),
      'document_id'
    );

    const result = ownSigners
      .map((ownSigner) => {
        const doc = docById[ownSigner.document_id];
        if (!doc) return null;

        const docLogs = logsByDoc[ownSigner.document_id] || [];
        // Sin enlace enviado a nadie todavía para este documento -> no mostrar.
        if (docLogs.length === 0) return null;

        const ownLog = docLogs.find((l) => l.signer_id === ownSigner.id) || null;
        const others = (signersByDoc[ownSigner.document_id] || [])
          .filter((s) => s.id !== ownSigner.id)
          .map((s) => {
            const l = docLogs.find((x) => x.signer_id === s.id);
            return {
              label: s.label,
              sentAt: l?.sent_at || null,
              openedAt: l?.opened_at || null,
              signedAt: l?.signed_at || null,
            };
          });

        return {
          documentId: doc.id,
          documentName: doc.filename,
          token: ownLog?.token || null,
          ownLabel: ownSigner.label,
          ownSignedAt: ownLog?.signed_at || null,
          others,
        };
      })
      .filter(Boolean);

    res.json({ pending: result });
  })
);

/** Registro de envíos/firmas, agrupado por documento, solo para admin. */
app.get(
  '/api/registry',
  route(async (req, res) => {
    if (!requireAdmin(req, res)) return;

    // Sin la columna `pdf`: el listado no debe cargar todos los archivos en memoria.
    const documents = await all('SELECT id, filename, created_at FROM documents ORDER BY created_at DESC');
    const signersByDoc = groupBy(await all('SELECT * FROM signers ORDER BY seq'), 'document_id');
    const logsByDoc = groupBy(await all('SELECT * FROM send_log'), 'document_id');

    const result = documents
      .map((doc) => {
        const logs = logsByDoc[doc.id] || [];
        const signerStatuses = (signersByDoc[doc.id] || []).map((s) => {
          const log = logs.find((l) => l.signer_id === s.id);
          return {
            label: s.label,
            email: s.email,
            phone: s.phone,
            sentAt: log?.sent_at || null,
            openedAt: log?.opened_at || null,
            signedAt: log?.signed_at || null,
          };
        });

        return {
          documentId: doc.id,
          documentName: doc.filename,
          signers: signerStatuses,
        };
      })
      // Solo documentos que ya se han enviado a alguien.
      .filter((d) => d.signers.some((s) => s.sentAt));

    res.json({ documents: result });
  })
);

// En producción, este mismo proceso sirve también el frontend ya compilado
// (carpeta dist/ generada con `npm run build`), para no necesitar un
// servidor estático ni un proxy nginx aparte en el hosting.
app.use(express.static(DIST_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(DIST_DIR, 'index.html'), (err) => {
    if (err) next(err);
  });
});

// Sin top-level await (Phusion Passenger carga este archivo con require()).
async function main() {
  await initSchema();
  app.listen(PORT, () => {
    console.log(`Firma API escuchando en http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('No se pudo arrancar el servidor:', err.message);
  process.exit(1);
});
