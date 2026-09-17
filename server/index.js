import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PDFDocument } from 'pdf-lib';
import { db } from './db.js';
import { sendSignRequestEmail } from './mailer.js';
import { sendSignRequestWhatsapp } from './whatsapp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const UPLOADS_DIR = path.join(__dirname, 'uploads');
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
 * Notifica a un firmante por cada canal de contacto que tenga (email y/o
 * WhatsApp) y, si al menos uno funciona, deja constancia en el registro.
 * @param {{id:string, document_id:string}} documentRow
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

  db.prepare(
    'INSERT INTO send_log (id, document_id, signer_id, token, document_name, email, phone, sent_at, opened_at, signed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)'
  ).run(
    randomUUID(),
    documentRow.id,
    signerRow.id,
    token,
    documentRow.filename,
    signerRow.email || null,
    signerRow.phone || null,
    nowIso()
  );

  return { token, channels, errors };
}

/**
 * Recibe el documento + campos + firmantes, los guarda, y notifica al
 * primer firmante (por orden). El resto se va avisando automáticamente a
 * medida que cada uno firma (ver POST /api/sign/:token).
 * Body: { documentName, pdfBase64, signers: [{label,name,phone,email}],
 *          fields: [{ signerLabel, pageIndex, x, y, w, h, cssScale }] }
 */
app.post('/api/send-document', async (req, res) => {
  try {
    const { documentName, pdfBase64, signers, fields } = req.body;

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
    const pdfPath = path.join(UPLOADS_DIR, `${documentId}.pdf`);
    await writeFile(pdfPath, Buffer.from(pdfBase64, 'base64'));

    db.prepare(
      'INSERT INTO documents (id, filename, pdf_path, created_at) VALUES (?, ?, ?, ?)'
    ).run(documentId, documentName, pdfPath, nowIso());

    const signerIdByLabel = {};
    signers.forEach((s, i) => {
      const signerId = randomUUID();
      signerIdByLabel[s.label] = signerId;
      db.prepare(
        'INSERT INTO signers (id, document_id, label, seq, name, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(signerId, documentId, s.label, i, s.name || null, s.phone || null, s.email || null);
    });

    fields.forEach((f) => {
      const signerId = signerIdByLabel[f.signerLabel];
      if (!signerId) return;
      db.prepare(
        'INSERT INTO fields (id, document_id, signer_id, page_index, x, y, w, h, css_scale, signed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)'
      ).run(randomUUID(), documentId, signerId, f.pageIndex, f.x, f.y, f.w, f.h, f.cssScale);
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al enviar el documento.' });
  }
});

/** Datos necesarios para que el firmante externo vea y firme su campo. */
app.get('/api/sign/:token', async (req, res) => {
  const log = db.prepare('SELECT * FROM send_log WHERE token = ?').get(req.params.token);
  if (!log) return res.status(404).json({ error: 'Enlace no válido.' });

  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(log.document_id);
  const signer = db.prepare('SELECT * FROM signers WHERE id = ?').get(log.signer_id);
  const field = db
    .prepare('SELECT * FROM fields WHERE document_id = ? AND signer_id = ?')
    .get(log.document_id, log.signer_id);

  if (!doc || !signer || !field) return res.status(404).json({ error: 'Datos no encontrados.' });

  // Solo se marca la primera vez que se abre el enlace.
  if (!log.opened_at) {
    db.prepare('UPDATE send_log SET opened_at = ? WHERE id = ?').run(nowIso(), log.id);
  }

  const pdfBytes = await readFile(doc.pdf_path);

  res.json({
    documentName: doc.filename,
    signerLabel: signer.label,
    signerName: signer.name || null,
    signerEmail: signer.email || null,
    alreadySigned: Boolean(field.signed_at),
    pdfBase64: pdfBytes.toString('base64'),
    field: {
      pageIndex: field.page_index,
      x: field.x,
      y: field.y,
      w: field.w,
      h: field.h,
      cssScale: field.css_scale,
    },
  });
});

/** Guarda el nombre del firmante externo antes de dejarle firmar. */
app.post('/api/sign/:token/name', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre no puede estar vacío.' });

  const log = db.prepare('SELECT * FROM send_log WHERE token = ?').get(req.params.token);
  if (!log) return res.status(404).json({ error: 'Enlace no válido.' });

  db.prepare('UPDATE signers SET name = ? WHERE id = ?').run(name, log.signer_id);
  res.json({ ok: true });
});

/**
 * Recibe la firma dibujada, la incrusta en el PDF, marca la hora de firma
 * y, si hay un siguiente firmante en orden con un campo asignado, le avisa
 * automáticamente para que firme a continuación.
 */
app.post('/api/sign/:token', async (req, res) => {
  try {
    const { signatureDataUrl } = req.body;
    const log = db.prepare('SELECT * FROM send_log WHERE token = ?').get(req.params.token);
    if (!log) return res.status(404).json({ error: 'Enlace no válido.' });

    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(log.document_id);
    const currentSigner = db.prepare('SELECT * FROM signers WHERE id = ?').get(log.signer_id);
    const field = db
      .prepare('SELECT * FROM fields WHERE document_id = ? AND signer_id = ?')
      .get(log.document_id, log.signer_id);
    if (!doc || !field) return res.status(404).json({ error: 'Datos no encontrados.' });

    const pdfBytes = await readFile(doc.pdf_path);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const page = pdfDoc.getPages()[field.page_index];
    const png = await pdfDoc.embedPng(dataUrlToBytes(signatureDataUrl));

    const xPt = field.x / field.css_scale;
    const wPt = field.w / field.css_scale;
    const hPt = field.h / field.css_scale;
    const yPt = page.getSize().height - field.y / field.css_scale - hPt;
    page.drawImage(png, { x: xPt, y: yPt, width: wPt, height: hPt });

    await writeFile(doc.pdf_path, await pdfDoc.save());

    const signedAt = nowIso();
    db.prepare('UPDATE fields SET signed_at = ? WHERE id = ?').run(signedAt, field.id);
    db.prepare('UPDATE send_log SET signed_at = ? WHERE id = ?').run(signedAt, log.id);

    // ¿Hay un siguiente firmante (por orden) con un campo asignado en este documento?
    let nextNotified = false;
    let nextError = null;
    const nextSigner = db
      .prepare('SELECT * FROM signers WHERE document_id = ? AND seq > ? ORDER BY seq LIMIT 1')
      .get(doc.id, currentSigner.seq);
    if (nextSigner) {
      const nextField = db
        .prepare('SELECT 1 FROM fields WHERE document_id = ? AND signer_id = ?')
        .get(doc.id, nextSigner.id);
      if (nextField) {
        try {
          await notifySigner(doc, nextSigner);
          nextNotified = true;
        } catch (err) {
          nextError = err.message;
        }
      }
    }

    res.json({ ok: true, nextNotified, nextError });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al firmar el documento.' });
  }
});

/** Descarga el PDF tal y como está ahora (sin firmas, con una, o con todas). */
app.get('/api/documents/:id/download', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });

  const pdfBytes = await readFile(doc.pdf_path);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${doc.filename}"`);
  res.send(pdfBytes);
});

/**
 * Firmas pendientes/realizadas de un usuario concreto, identificado por su
 * email (el mismo que se le puso al añadirlo como firmante). Solo aparecen
 * documentos donde a ese email ya le ha tocado el turno de firmar (se le
 * ha notificado), junto con el estado de los demás firmantes para que
 * pueda ver si el anterior ya firmó.
 */
app.get('/api/pending', (req, res) => {
  const email = (req.query.email || '').trim();
  if (!email) return res.status(400).json({ error: 'Falta el email.' });

  const logs = db
    .prepare('SELECT * FROM send_log WHERE lower(email) = lower(?) ORDER BY sent_at DESC')
    .all(email);

  const result = logs.map((log) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(log.document_id);
    const signers = db.prepare('SELECT * FROM signers WHERE document_id = ? ORDER BY seq').all(log.document_id);
    const docLogs = db.prepare('SELECT * FROM send_log WHERE document_id = ?').all(log.document_id);

    const others = signers
      .filter((s) => s.id !== log.signer_id)
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
      token: log.token,
      ownLabel: signers.find((s) => s.id === log.signer_id)?.label || null,
      ownSignedAt: log.signed_at,
      others,
    };
  });

  res.json({ pending: result });
});

/** Registro de envíos/firmas, agrupado por documento, solo para admin. */
app.get('/api/registry', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const documents = db.prepare('SELECT * FROM documents ORDER BY created_at DESC').all();

  const result = documents
    .map((doc) => {
      const signers = db.prepare('SELECT * FROM signers WHERE document_id = ? ORDER BY seq').all(doc.id);
      const logs = db.prepare('SELECT * FROM send_log WHERE document_id = ?').all(doc.id);

      const signerStatuses = signers.map((s) => {
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
});

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

app.listen(PORT, () => {
  console.log(`Firma API escuchando en http://localhost:${PORT}`);
});
