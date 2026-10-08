import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PDFDocument } from 'pdf-lib';
import { all, one, run, withTransaction, initSchema } from './db.js';
import { sendSignRequestEmail, sendCompletedDocumentEmail, sendOtpEmail } from './mailer.js';
import { sendSignRequestWhatsapp } from './whatsapp.js';
import { generateAuditCert } from './audit-cert.js';
import { startReminders } from './reminders.js';
import { isS3Enabled, uploadPdf, downloadPdf, pdfKey } from './storage.js';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function seedUsers() {
  const SEEDS = [
    { username: 'admin', password: process.env.ADMIN_PASSWORD || 'Admin123$', role: 'admin' },
    { username: 'Pablo', password: process.env.PABLO_PASSWORD || 'Pablo345!', role: 'pablo' },
    { username: 'Comercial', password: process.env.COMERCIAL_PASSWORD || 'Com852!', role: 'comercial' },
  ];
  for (const u of SEEDS) {
    const existing = await one('SELECT id FROM users WHERE lower(username) = lower($1)', [u.username]);
    if (!existing) {
      await run(
        'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
        [randomUUID(), u.username, hashPassword(u.password), u.role]
      );
      console.log(`Usuario ${u.username} creado.`);
    }
  }
}

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

/** Devuelve el Buffer del PDF de un documento (S3 o columna pdf en BD). */
async function getPdfBuffer(doc) {
  if (doc.pdf_key) return downloadPdf(doc.pdf_key);
  return doc.pdf; // BYTEA legacy
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

async function addAuditEvent(documentId, { signerId = null, action, ip = null, userAgent = null, email = null, metadata = null } = {}) {
  await run(
    `INSERT INTO audit_log (id, document_id, signer_id, action, ip, user_agent, email, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [randomUUID(), documentId, signerId || null, action, ip, userAgent, email, metadata ? JSON.stringify(metadata) : null, nowIso()]
  );
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
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const originalHash = sha256(pdfBuffer);

    // Si S3 está configurado, sube el PDF allí y guarda solo la clave en BD.
    let storedPdfKey = null;
    if (isS3Enabled()) {
      storedPdfKey = pdfKey(documentId);
      await uploadPdf(storedPdfKey, pdfBuffer);
    }

    // Todo o nada: un fallo a mitad no deja un documento a medias guardado.
    await withTransaction(async (client) => {
      await client.query(
        'INSERT INTO documents (id, filename, pdf, pdf_key, created_at, original_hash) VALUES ($1, $2, $3, $4, $5, $6)',
        [documentId, documentName, storedPdfKey ? null : pdfBuffer, storedPdfKey, nowIso(), originalHash]
      );

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

    await addAuditEvent(documentId, {
      action: 'document_created',
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'],
      metadata: { documentName, signerCount: signers.length, originalHash },
    });

    const documentRow = { id: documentId, filename: documentName };
    const firstSignerRow = {
      id: signerIdByLabel[firstSigner.label],
      label: firstSigner.label,
      email: firstSigner.email || null,
      phone: null,
    };
    const { token, channels } = await notifySigner(documentRow, firstSignerRow);

    res.json({ ok: true, sentTo: firstSigner.email, channels, signLink: `${PUBLIC_URL}/?sign=${token}` });
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
      const openedAt = nowIso();
      await run('UPDATE send_log SET opened_at = $1 WHERE id = $2 AND opened_at IS NULL', [openedAt, log.id]);
      await addAuditEvent(log.document_id, {
        signerId: log.signer_id,
        action: 'sign_page_opened',
        ip: getClientIp(req),
        userAgent: req.headers['user-agent'],
        email: log.email,
        metadata: { signerLabel: signer.label },
      });
    }

    const pdfBuf = await getPdfBuffer(doc);
    res.json({
      documentName: doc.filename,
      signerLabel: signer.label,
      signerEmail: signer.email || null,
      alreadySigned: Boolean(field.signed_at),
      pdfBase64: pdfBuf.toString('base64'),
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

/** POST /api/sign/:token/request-otp  — genera y envía un OTP al email del firmante. */
app.post(
  '/api/sign/:token/request-otp',
  route(async (req, res) => {
    const log = await one('SELECT * FROM send_log WHERE token = $1', [req.params.token]);
    if (!log) return res.status(404).json({ error: 'Enlace no válido.' });
    if (!log.email) return res.status(400).json({ error: 'El firmante no tiene email registrado.' });

    // Invalida OTPs anteriores no usados para este send_log
    await run("UPDATE otp_codes SET used_at = now() WHERE send_log_id = $1 AND used_at IS NULL", [log.id]);

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await run(
      'INSERT INTO otp_codes (id, send_log_id, code, expires_at) VALUES ($1, $2, $3, $4)',
      [randomUUID(), log.id, otp, expiresAt]
    );

    const doc = await one('SELECT filename FROM documents WHERE id = $1', [log.document_id]);
    await sendOtpEmail({ to: log.email, otp, documentName: doc?.filename || log.document_name });

    await addAuditEvent(log.document_id, {
      signerId: log.signer_id,
      action: 'otp_requested',
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'],
      email: log.email,
    });

    res.json({ ok: true, sentTo: log.email });
  })
);

/** POST /api/sign/:token/verify-otp  { code }  — verifica el OTP y devuelve otpToken. */
app.post(
  '/api/sign/:token/verify-otp',
  route(async (req, res) => {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Falta el código.' });

    const log = await one('SELECT * FROM send_log WHERE token = $1', [req.params.token]);
    if (!log) return res.status(404).json({ error: 'Enlace no válido.' });

    const otpRow = await one(
      `SELECT * FROM otp_codes WHERE send_log_id = $1 AND code = $2 AND used_at IS NULL AND expires_at > now()
       ORDER BY expires_at DESC LIMIT 1`,
      [log.id, code.trim()]
    );
    if (!otpRow) return res.status(401).json({ error: 'Código incorrecto o caducado.' });

    await run('UPDATE otp_codes SET used_at = now() WHERE id = $1', [otpRow.id]);
    const verifiedAt = nowIso();
    await run('UPDATE send_log SET otp_verified_at = $1 WHERE id = $2', [verifiedAt, log.id]);

    await addAuditEvent(log.document_id, {
      signerId: log.signer_id,
      action: 'otp_verified',
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'],
      email: log.email,
    });

    // Token de sesión de firma: hash del token de enlace + timestamp, para
    // que el cliente lo incluya en el POST de firma como prueba de verificación.
    const otpSessionToken = sha256(`${req.params.token}:${verifiedAt}`);
    res.json({ ok: true, otpSessionToken, verifiedAt });
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
    const { signatureDataUrl, otpSessionToken } = req.body;
    if (typeof signatureDataUrl !== 'string' || !signatureDataUrl.includes(',')) {
      return res.status(400).json({ error: 'Falta la firma.' });
    }

    const signIp = getClientIp(req);
    const signUa = req.headers['user-agent'] || null;

    // Se bloquea la fila del documento mientras se incrusta la firma: dos
    // firmas simultáneas se aplican una detrás de otra sin pisarse el PDF.
    const outcome = await withTransaction(async (client) => {
      const log = (await client.query('SELECT * FROM send_log WHERE token = $1', [req.params.token])).rows[0];
      if (!log) return { status: 404, error: 'Enlace no válido.' };

      // Verificar que el OTP fue validado (o que el token de sesión es correcto).
      if (!log.otp_verified_at) return { status: 403, error: 'Debes verificar tu identidad con el código OTP antes de firmar.' };
      if (otpSessionToken) {
        const expected = sha256(`${req.params.token}:${new Date(log.otp_verified_at).toISOString()}`);
        if (otpSessionToken !== expected) return { status: 403, error: 'Token de verificación inválido.' };
      }

      const doc = (
        await client.query('SELECT id, filename, pdf, pdf_key FROM documents WHERE id = $1 FOR UPDATE', [log.document_id])
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

      const currentPdfBuffer = await getPdfBuffer(doc);
      const pdfDoc = await PDFDocument.load(currentPdfBuffer);
      const page = pdfDoc.getPages()[field.page_index];
      const png = await pdfDoc.embedPng(dataUrlToBytes(signatureDataUrl));

      const xPt = field.x / field.css_scale;
      const wPt = field.w / field.css_scale;
      const hPt = field.h / field.css_scale;
      const yPt = page.getSize().height - field.y / field.css_scale - hPt;
      page.drawImage(png, { x: xPt, y: yPt, width: wPt, height: hPt });

      const signedPdf = Buffer.from(await pdfDoc.save());
      const signedAt = nowIso();
      if (doc.pdf_key) {
        // Sobreescribe el PDF en S3 con la versión firmada (fuera de la TX para no bloquear)
        await uploadPdf(doc.pdf_key, signedPdf);
        await client.query('UPDATE documents SET pdf = NULL WHERE id = $1', [doc.id]);
      } else {
        await client.query('UPDATE documents SET pdf = $1 WHERE id = $2', [signedPdf, doc.id]);
      }
      await client.query('UPDATE fields SET signed_at = $1 WHERE id = $2', [signedAt, field.id]);
      await client.query(
        'UPDATE send_log SET signed_at = $1, sign_ip = $2, sign_ua = $3 WHERE id = $4',
        [signedAt, signIp, signUa, log.id]
      );

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

      // Si el documento está completo, guardar el hash del PDF firmado final.
      let signedHash = null;
      if (!stillPending) {
        signedHash = sha256(signedPdf);
        await client.query('UPDATE documents SET signed_hash = $1 WHERE id = $2', [signedHash, doc.id]);
      }

      return {
        ok: true,
        doc: { id: doc.id, filename: doc.filename },
        nextSigner,
        nextHasField,
        completed: !stillPending,
        finalPdf: signedPdf,
        allSigners,
        signedHash,
      };
    });

    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });

    // Audit event de firma aplicada.
    const logRow = await one('SELECT * FROM send_log WHERE token = $1', [req.params.token]);
    if (logRow) {
      await addAuditEvent(logRow.document_id, {
        signerId: logRow.signer_id,
        action: 'signed',
        ip: signIp,
        userAgent: signUa,
        email: logRow.email,
        metadata: { signedAt: logRow.signed_at },
      });
    }

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

    // Documento completo: generar certificado de evidencia y enviar a todos.
    if (outcome.completed) {
      await addAuditEvent(outcome.doc.id, { action: 'completed', metadata: { signedHash: outcome.signedHash } });

      // Recopilar datos para el certificado.
      let auditBuffer = null;
      try {
        const docRow = await one('SELECT * FROM documents WHERE id = $1', [outcome.doc.id]);
        const signersRows = await all('SELECT * FROM signers WHERE document_id = $1 ORDER BY seq', [outcome.doc.id]);
        const logsRows = await all('SELECT * FROM send_log WHERE document_id = $1', [outcome.doc.id]);
        const auditEvents = await all('SELECT * FROM audit_log WHERE document_id = $1 ORDER BY created_at', [outcome.doc.id]);

        const signersForCert = signersRows.map((s) => {
          const l = logsRows.find((x) => x.signer_id === s.id);
          return {
            label: s.label,
            name: s.name,
            email: s.email,
            phone: s.phone,
            sentAt: l?.sent_at || null,
            openedAt: l?.opened_at || null,
            signedAt: l?.signed_at || null,
            otpVerifiedAt: l?.otp_verified_at || null,
            signIp: l?.sign_ip || null,
            signUa: l?.sign_ua || null,
          };
        });

        auditBuffer = await generateAuditCert({
          documentName: outcome.doc.filename,
          originalHash: docRow?.original_hash || null,
          signedHash: outcome.signedHash,
          createdAt: docRow?.created_at || null,
          signers: signersForCert,
          auditEvents,
        });
      } catch (err) {
        console.error('No se pudo generar el certificado de evidencia:', err.message);
      }

      await Promise.all(
        outcome.allSigners
          .filter((s) => s.email)
          .map((s) =>
            sendCompletedDocumentEmail({
              to: s.email,
              documentName: outcome.doc.filename,
              pdfBuffer: outcome.finalPdf,
              auditBuffer,
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
    const doc = await one('SELECT id, filename, pdf, pdf_key FROM documents WHERE id = $1', [req.params.id]);
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

    const pdfBuf = await getPdfBuffer(doc);
    res.attachment(doc.filename);
    res.type('application/pdf');
    res.send(pdfBuf);
  })
);

/** DELETE /api/documents/:id  — elimina un documento y todo lo asociado (solo admin). */
app.delete(
  '/api/documents/:id',
  route(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const doc = await one('SELECT id FROM documents WHERE id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });
    await run('DELETE FROM documents WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
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

/**
 * Registro de envíos/firmas, agrupado por documento, solo para admin.
 * Paginado (20 por página con `offset`) y filtrable por nombre (`q`) y
 * rango de fechas de envío (`from`/`to`, formato AAAA-MM-DD).
 */
app.get(
  '/api/registry',
  route(async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const q = (req.query.q || '').trim();
    const from = (req.query.from || '').trim();
    const to = (req.query.to || '').trim();

    // Solo documentos que ya se han enviado a alguien (tienen algún send_log).
    const conditions = ['EXISTS (SELECT 1 FROM send_log l WHERE l.document_id = d.id)'];
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`d.filename ILIKE $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`d.created_at >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      conditions.push(`d.created_at < ($${params.length}::date + interval '1 day')`);
    }
    const where = conditions.join(' AND ');

    const total = (await one(`SELECT count(*)::int AS n FROM documents d WHERE ${where}`, params)).n;
    const documents = await all(
      `SELECT d.id, d.filename, d.created_at FROM documents d WHERE ${where}
       ORDER BY d.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const documentIds = documents.map((d) => d.id);
    const signersByDoc = groupBy(
      documentIds.length
        ? await all('SELECT * FROM signers WHERE document_id = ANY($1) ORDER BY seq', [documentIds])
        : [],
      'document_id'
    );
    const logsByDoc = groupBy(
      documentIds.length ? await all('SELECT * FROM send_log WHERE document_id = ANY($1)', [documentIds]) : [],
      'document_id'
    );

    const result = documents.map((doc) => {
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
          expiredAt: log?.expired_at || null,
        };
      });

      return {
        documentId: doc.id,
        documentName: doc.filename,
        signers: signerStatuses,
      };
    });

    res.json({ documents: result, total, limit, offset, hasMore: offset + result.length < total });
  })
);

// En producción, este mismo proceso sirve también el frontend ya compilado
// (carpeta dist/ generada con `npm run build`), para no necesitar un
// ── Gestión de usuarios (solo admin) ─────────────────────────────────────────

/** POST /api/auth/login  { username, password } → { role, username } */
app.post(
  '/api/auth/login',
  route(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Faltan credenciales.' });
    const user = await one(
      'SELECT username, role FROM users WHERE lower(username)=lower($1) AND password_hash=$2',
      [username.trim(), hashPassword(password)]
    );
    if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    res.json({ username: user.username, role: user.role });
  })
);

/** GET /api/users → [{ id, username, role, createdAt }]  (solo admin) */
app.get(
  '/api/users',
  route(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const rows = await all(
      "SELECT id, username, role, created_at AS \"createdAt\" FROM users WHERE role <> 'admin' ORDER BY created_at DESC"
    );
    res.json({ users: rows });
  })
);

/** POST /api/users  { username, password, role }  (solo admin, nunca role=admin) */
app.post(
  '/api/users',
  route(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { username, password, role } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Faltan username y password.' });
    if (!role || role === 'admin') return res.status(400).json({ error: 'Rol no válido.' });
    const trimmed = username.trim();
    if (trimmed.toLowerCase() === 'admin') return res.status(400).json({ error: 'Nombre reservado.' });
    const exists = await one('SELECT id FROM users WHERE lower(username)=$1', [trimmed.toLowerCase()]);
    if (exists) return res.status(409).json({ error: 'El usuario ya existe.' });
    const id = randomUUID();
    await run(
      'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
      [id, trimmed, hashPassword(password), role]
    );
    res.status(201).json({ id, username: trimmed, role });
  })
);

/** DELETE /api/users/:id  (solo admin, nunca el propio admin) */
app.delete(
  '/api/users/:id',
  route(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const user = await one("SELECT role FROM users WHERE id=$1", [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (user.role === 'admin') return res.status(403).json({ error: 'No se puede eliminar al admin.' });
    await run('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  })
);

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
  await seedUsers();
  startReminders();
  app.listen(PORT, () => {
    console.log(`Firma API escuchando en http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('No se pudo arrancar el servidor:', err.message);
  process.exit(1);
});
