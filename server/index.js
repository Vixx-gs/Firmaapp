import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PDFDocument } from 'pdf-lib';
import { all, one, run, withTransaction, initSchema } from './db.js';
import { sendSignRequestEmail, sendCompletedDocumentEmail, sendOtpEmail } from './mailer.js';
import { sendSignRequestWhatsapp } from './whatsapp.js';
import { generateAuditCert } from './audit-cert.js';
import { startReminders } from './reminders.js';
import { isS3Enabled, uploadPdf, downloadPdf, pdfKey, pdfExists, deletePdf } from './storage.js';
import { createSessionToken, requireAuth } from './session.js';

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

/** Casilla de firma tal como la recibe la pantalla de firma. */
function casilla(f) {
  return { id: f.id, pageIndex: f.page_index, x: f.x, y: f.y, w: f.w, h: f.h, cssScale: f.css_scale, signed: Boolean(f.signed_at) };
}

const MIN_PIXELES_FIRMA = 150; // un punto suelto o un garabato mínimo no cuentan como firma

/**
 * Cuenta los píxeles con tinta de la firma (PNG RGBA de 8 bits, como el que
 * genera el lienzo de firma). Devuelve 0 si la imagen no se puede leer.
 */
function pixelesConTinta(png) {
  try {
    if (png.readUInt32BE(12) !== 0x49484452) return 0;               // IHDR
    const ancho = png.readUInt32BE(16), alto = png.readUInt32BE(20);
    if (png[24] !== 8 || png[25] !== 6) return 0;                        // 8 bits, RGBA
    const idat = [];
    for (let i = 8; i < png.length;) {
      const len = png.readUInt32BE(i), tipo = png.toString('ascii', i + 4, i + 8);
      if (tipo === 'IDAT') idat.push(png.subarray(i + 8, i + 8 + len));
      i += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const fila = ancho * 4;
    let prev = Buffer.alloc(fila), tinta = 0;
    for (let y = 0; y < alto; y++) {
      const filtro = raw[y * (fila + 1)];
      const datos = raw.subarray(y * (fila + 1) + 1, (y + 1) * (fila + 1));
      const cur = Buffer.alloc(fila);
      for (let x = 0; x < fila; x++) {
        const a = x >= 4 ? cur[x - 4] : 0, b = prev[x], c = x >= 4 ? prev[x - 4] : 0;
        let p = 0;
        if (filtro === 1) p = a;
        else if (filtro === 2) p = b;
        else if (filtro === 3) p = (a + b) >> 1;
        else if (filtro === 4) {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        cur[x] = (datos[x] + p) & 255;
        if (x % 4 === 3 && cur[x] > 0) tinta++;
      }
      prev = cur;
    }
    return tinta;
  } catch {
    return 0;
  }
}

// Roles que solo firman: no pueden enviar documentos (igual que en src/auth.js).
const SIGNER_ONLY_ROLES = ['pablo', 'user'];

/** Comprueba el rol del token verificado por requireAuth (nunca una cabecera del cliente). */
function requireAdmin(req, res) {
  if (req.user?.role !== 'admin') {
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
  requireAuth,
  route(async (req, res) => {
    if (SIGNER_ONLY_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Tu usuario no puede enviar documentos.' });
    }
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
      const createdBy = req.user.username;
      await client.query(
        'INSERT INTO documents (id, filename, pdf, pdf_key, created_at, original_hash, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [documentId, documentName, storedPdfKey ? null : pdfBuffer, storedPdfKey, nowIso(), originalHash, createdBy]
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

    const doc = await one('SELECT id, filename, pdf, pdf_key FROM documents WHERE id = $1', [log.document_id]);
    const signer = await one('SELECT * FROM signers WHERE id = $1', [log.signer_id]);
    // Todas las casillas del firmante (puede tener una en cada página).
    const fields = await all(
      'SELECT * FROM fields WHERE document_id = $1 AND signer_id = $2 ORDER BY page_index, y, x',
      [log.document_id, log.signer_id]
    );
    const field = fields.find((f) => !f.signed_at) || fields[0];

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
      alreadySigned: fields.every((f) => f.signed_at),
      pdfBase64: pdfBuf.toString('base64'),
      field: casilla(field),
      fields: fields.map(casilla),
    });
  })
);

// Código de verificación (OTP) del enlace de firma.
const OTP_VALIDEZ_MIN = 10; // vale 10 minutos
const OTP_REUSO_MIN = 3;    // durante los 3 primeros, "Reenviar" manda el mismo
const OTP_MAX_INTENTOS = 5; // fallos permitidos por código; luego hay que pedir otro
const OTP_MAX_ENVIOS = 5;   // correos por código (evita usar el enlace para spam)

/** POST /api/sign/:token/request-otp  — genera y envía un OTP al email del firmante. */
app.post(
  '/api/sign/:token/request-otp',
  route(async (req, res) => {
    const log = await one('SELECT * FROM send_log WHERE token = $1', [req.params.token]);
    if (!log) return res.status(404).json({ error: 'Enlace no válido.' });
    if (!log.email) return res.status(400).json({ error: 'El firmante no tiene email registrado.' });

    // Si se pidió un código hace menos de OTP_REUSO_MIN minutos, se reenvía el
    // mismo: así no cambia mientras el firmante espera el correo o pulsa
    // "Reenviar". Pasado ese tiempo se genera otro y el anterior deja de valer.
    // (Cada código vale OTP_VALIDEZ_MIN minutos desde que se generó.)
    const reciente = await one(
      `SELECT id, code, sends FROM otp_codes
        WHERE send_log_id = $1 AND used_at IS NULL
          AND expires_at > now() + make_interval(mins => $2)
        ORDER BY expires_at DESC LIMIT 1`,
      [log.id, OTP_VALIDEZ_MIN - OTP_REUSO_MIN]
    );
    let otp = reciente?.code;
    if (reciente) {
      if (reciente.sends >= OTP_MAX_ENVIOS) {
        return res.status(429).json({ error: `Ya te hemos enviado el código varias veces. Revisa tu correo (también la carpeta de spam) o inténtalo de nuevo en ${OTP_REUSO_MIN} minutos.` });
      }
      await run('UPDATE otp_codes SET sends = sends + 1 WHERE id = $1', [reciente.id]);
    } else {
      await run("UPDATE otp_codes SET used_at = now() WHERE send_log_id = $1 AND used_at IS NULL", [log.id]);
      otp = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + OTP_VALIDEZ_MIN * 60 * 1000).toISOString();
      await run(
        'INSERT INTO otp_codes (id, send_log_id, code, expires_at) VALUES ($1, $2, $3, $4)',
        [randomUUID(), log.id, otp, expiresAt]
      );
    }

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

    // Código vigente de este enlace (solo hay uno a la vez).
    const otpRow = await one(
      `SELECT * FROM otp_codes WHERE send_log_id = $1 AND used_at IS NULL AND expires_at > now()
       ORDER BY expires_at DESC LIMIT 1`,
      [log.id]
    );
    if (!otpRow) return res.status(401).json({ error: 'Código caducado. Pide uno nuevo.' });
    if (otpRow.code !== String(code).trim()) {
      const { attempts } = await one('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts', [otpRow.id]);
      if (attempts >= OTP_MAX_INTENTOS) {
        await run('UPDATE otp_codes SET used_at = now() WHERE id = $1', [otpRow.id]);
        return res.status(429).json({ error: 'Demasiados intentos fallidos. Pide un código nuevo.' });
      }
      return res.status(401).json({ error: `Código incorrecto. Te quedan ${OTP_MAX_INTENTOS - attempts} intentos.` });
    }

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
    // Una firma por casilla: [{ fieldId, signatureDataUrl }]. Las pantallas antiguas mandan solo
    // signatureDataUrl, que vale únicamente si al firmante le queda una sola casilla.
    const firmas = Array.isArray(req.body.signatures) ? req.body.signatures : null;
    if (!firmas && (typeof signatureDataUrl !== 'string' || !signatureDataUrl.includes(','))) {
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
      const pendientes = (
        await client.query('SELECT * FROM fields WHERE document_id = $1 AND signer_id = $2 AND signed_at IS NULL', [
          log.document_id,
          log.signer_id,
        ])
      ).rows;
      if (!doc) return { status: 404, error: 'Datos no encontrados.' };
      if (!pendientes.length) return { status: 409, error: 'Este documento ya está firmado por ti.' };

      // Tienen que venir firmadas TODAS las casillas pendientes, cada una con un trazo de verdad.
      let porCasilla;
      if (firmas) {
        porCasilla = new Map(firmas.filter((f) => f && typeof f.signatureDataUrl === 'string').map((f) => [f.fieldId, f.signatureDataUrl]));
      } else if (pendientes.length === 1) {
        porCasilla = new Map([[pendientes[0].id, signatureDataUrl]]);
      } else {
        return { status: 400, error: 'Este documento tiene varias casillas para firmar. Recarga la página y fírmalas todas.' };
      }
      const faltan = pendientes.filter((f) => !porCasilla.has(f.id));
      if (faltan.length) {
        return { status: 400, error: `Faltan ${faltan.length} casilla${faltan.length > 1 ? 's' : ''} por firmar.` };
      }
      for (const f of pendientes) {
        const png = dataUrlToBytes(porCasilla.get(f.id));
        if (pixelesConTinta(png) < MIN_PIXELES_FIRMA) {
          return { status: 400, error: 'Alguna casilla está vacía o con una firma demasiado pequeña. Firma de nuevo.' };
        }
      }

      const currentPdfBuffer = await getPdfBuffer(doc);
      const pdfDoc = await PDFDocument.load(currentPdfBuffer);
      for (const field of pendientes) {
        const page = pdfDoc.getPages()[field.page_index];
        const png = await pdfDoc.embedPng(dataUrlToBytes(porCasilla.get(field.id)));
        const xPt = field.x / field.css_scale;
        const wPt = field.w / field.css_scale;
        const hPt = field.h / field.css_scale;
        const yPt = page.getSize().height - field.y / field.css_scale - hPt;
        page.drawImage(png, { x: xPt, y: yPt, width: wPt, height: hPt });
      }

      const signedPdf = Buffer.from(await pdfDoc.save());
      const signedAt = nowIso();
      if (doc.pdf_key) {
        // Sobreescribe el PDF en S3 con la versión firmada (fuera de la TX para no bloquear)
        await uploadPdf(doc.pdf_key, signedPdf);
        await client.query('UPDATE documents SET pdf = NULL WHERE id = $1', [doc.id]);
      } else {
        await client.query('UPDATE documents SET pdf = $1 WHERE id = $2', [signedPdf, doc.id]);
      }
      await client.query('UPDATE fields SET signed_at = $1 WHERE id = ANY($2)', [signedAt, pendientes.map((f) => f.id)]);
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
 * todas). Cualquier usuario con sesión puede descargarlo (el Mando es
 * visible para todos).
 */
app.get(
  '/api/documents/:id/download',
  requireAuth,
  route(async (req, res) => {
    const doc = await one('SELECT id, filename, pdf, pdf_key FROM documents WHERE id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });

    const pdfBuf = await getPdfBuffer(doc);
    res.attachment(doc.filename);
    res.type('application/pdf');
    res.send(pdfBuf);
  })
);

/**
 * DELETE /api/documents/:id — elimina un documento y todo lo asociado (firmantes,
 * enlaces de firma, registro) y su PDF en S3. Solo admin (botón "Borrar" de Mando).
 */
app.delete(
  '/api/documents/:id',
  requireAuth,
  route(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const doc = await one('SELECT id, filename, pdf_key FROM documents WHERE id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });
    await run('DELETE FROM documents WHERE id = $1', [req.params.id]);
    console.log(`Documento borrado por ${req.user.username}: ${doc.filename} (${doc.id})`);
    try {
      await deletePdf(doc.pdf_key);
    } catch (err) {
      console.error(`No se pudo borrar el PDF de ${doc.id} en S3:`, err.message);
    }
    res.json({ ok: true });
  })
);

/**
 * Documentos que un usuario concreto (por email) ha firmado, para su
 * "Registro" personal.
 */
app.get(
  '/api/my-registry',
  requireAuth,
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
 * Documentos cuyo PDF ya no existe en S3 (p. ej. se borró desde el panel de
 * OVH): se borran también de la base de datos, para que desaparezcan de Mando,
 * de Pendientes y de los avisos del portal a la vez. Solo cuenta un "no existe"
 * claro de S3 (404); un error de conexión no borra nada.
 */
async function purgarSinPdf(ids = null) {
  if (!isS3Enabled()) return 0;
  const docs = ids
    ? await all('SELECT id, filename, pdf_key FROM documents WHERE pdf_key IS NOT NULL AND id = ANY($1)', [ids])
    : await all('SELECT id, filename, pdf_key FROM documents WHERE pdf_key IS NOT NULL');
  let borrados = 0;
  for (const d of docs) {
    let existe = true;
    try { existe = await pdfExists(d.pdf_key); } catch { /* sin conexión con S3: no se toca */ }
    if (!existe) {
      await run('DELETE FROM documents WHERE id = $1', [d.id]);
      console.log(`Documento sin PDF en S3, borrado: ${d.filename} (${d.id})`);
      borrados++;
    }
  }
  return borrados;
}

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
  requireAuth,
  route(async (req, res) => {
    const email = (req.query.email || '').trim();
    if (!email) return res.status(400).json({ error: 'Falta el email.' });

    await purgarSinPdf((await all('SELECT DISTINCT document_id FROM signers WHERE lower(email) = lower($1)', [email])).map((r) => r.document_id));
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
  requireAuth,
  route(async (req, res) => {
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
      `SELECT d.id, d.filename, d.created_at, d.pdf_key, d.created_by FROM documents d WHERE ${where}
       ORDER BY d.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    // Documentos cuyo PDF ya no existe en S3: se borran del todo (ver purgarSinPdf).
    await purgarSinPdf(documents.filter((d) => d.pdf_key).map((d) => d.id));
    const quedan = new Set((await all('SELECT id FROM documents WHERE id = ANY($1)', [documents.map((d) => d.id)])).map((r) => r.id));
    const visibleDocs = documents.filter((d) => quedan.has(d.id));

    const documentIds = visibleDocs.map((d) => d.id);
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

    const result = visibleDocs.map((doc) => {
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
        createdBy: doc.created_by || null,
        signers: signerStatuses,
      };
    });

    res.json({ documents: result, total, limit, offset, hasMore: offset + result.length < total });
  })
);

// En producción, este mismo proceso sirve también el frontend ya compilado
// (carpeta dist/ generada con `npm run build`), para no necesitar un
// ── Gestión de usuarios (solo admin) ─────────────────────────────────────────

// ── Inicio de sesión con el Portal del Empleado (SSO) ────────────────────────
// El navegador envía la cookie de sesión del portal a todo *.gesticotrans.app.
// Se la reenviamos al portal, que dice quién es y qué rol tiene en Firma.
const PORTAL_URL = process.env.PORTAL_URL || 'https://gesticotrans.app';
const PORTAL_COOKIE = '__Secure-gt_session';

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/**
 * POST /api/auth/sso { launch } → { username, nombre, role, token }.
 * Solo con el pase que da el portal al pulsar la tarjeta de Firma: el portal
 * comprueba que el pase es para Firma y de la persona con la sesión abierta.
 */
app.post(
  '/api/auth/sso',
  route(async (req, res) => {
    const cookie = readCookie(req, PORTAL_COOKIE);
    const launch = req.body?.launch;
    if (!cookie || !launch) return res.status(401).json({ error: 'Entra desde el Portal del Empleado.' });
    const r = await fetch(`${PORTAL_URL}/api/sso/verify`, {
      method: 'POST',
      headers: { cookie: `${PORTAL_COOKIE}=${cookie}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ launch, app: 'firma' }),
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 401 || r.status === 403) {
      return res.status(401).json({ error: 'Entra desde el Portal del Empleado.' });
    }
    if (!r.ok) throw new Error('El portal no responde.');
    const me = await r.json();
    const role = me.access?.firma;
    if (!role) return res.status(403).json({ error: 'No tienes acceso a Firma. Pídelo a un administrador del portal.' });
    res.json({ username: me.username, nombre: me.nombre, role, token: createSessionToken({ username: me.username, role }) });
  })
);

/**
 * GET /api/portal/resumen → { avisos: [{ n, texto }] } para la tarjeta de Firma
 * en el portal: documentos enviados por la persona que aún esperan alguna firma.
 * Lo llama el servidor del portal reenviando la cookie de su sesión.
 */
app.get(
  '/api/portal/resumen',
  route(async (req, res) => {
    const cookie = readCookie(req, PORTAL_COOKIE);
    if (!cookie) return res.status(401).json({ error: 'Sin sesión del portal.' });
    const r = await fetch(`${PORTAL_URL}/api/me`, { headers: { cookie: `${PORTAL_COOKIE}=${cookie}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return res.status(401).json({ error: 'Sin sesión del portal.' });
    const me = await r.json();
    if (!me.access?.firma) return res.status(403).json({ error: 'Sin acceso a Firma.' });
    await purgarSinPdf((await all('SELECT id FROM documents WHERE created_by = $1', [me.username])).map((r) => r.id));
    const { n } = await one(
      `SELECT count(DISTINCT d.id)::int AS n
         FROM documents d JOIN send_log l ON l.document_id = d.id
        WHERE d.created_by = $1 AND l.signed_at IS NULL AND l.expired_at IS NULL`,
      [me.username]
    );
    res.json({ avisos: n ? [{ n, texto: n === 1 ? '1 documento esperando firma' : `${n} documentos esperando firma` }] : [] });
  })
);

// ── Borradores: documentos que otra app (Contratos) deja preparados ─────────
// Contratos genera el PDF y lo deja aquí con los datos del firmante; después
// abre Firma con ?borrador=<id> y Firma lo carga para colocar las firmas.
// Solo lo puede leer la misma persona que lo creó, y se borran a las 24 h.
const BORRADOR_MAX_BYTES = 20 * 1024 * 1024;

/** POST /api/borradores { nombreArchivo, pdfBase64, firmante, origen } → { id }. Autenticado con la cookie del portal. */
app.post(
  '/api/borradores',
  route(async (req, res) => {
    const cookie = readCookie(req, PORTAL_COOKIE);
    if (!cookie) return res.status(401).json({ error: 'Sin sesión del portal.' });
    const r = await fetch(`${PORTAL_URL}/api/me`, { headers: { cookie: `${PORTAL_COOKIE}=${cookie}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return res.status(401).json({ error: 'Sin sesión del portal.' });
    const me = await r.json();
    if (!me.access?.firma) return res.status(403).json({ error: 'No tienes acceso a Firma.' });

    const { nombreArchivo, pdfBase64, firmante, origen } = req.body || {};
    const pdf = Buffer.from(String(pdfBase64 || ''), 'base64');
    if (!pdf.length || pdf.subarray(0, 4).toString() !== '%PDF') return res.status(400).json({ error: 'El documento no es un PDF.' });
    if (pdf.length > BORRADOR_MAX_BYTES) return res.status(413).json({ error: 'El documento es demasiado grande.' });
    const limpio = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const datosFirmante = firmante && typeof firmante === 'object'
      ? { nombre: limpio(firmante.nombre, 120), email: limpio(firmante.email, 160), telefono: limpio(firmante.telefono, 30) }
      : null;
    const id = randomUUID();
    const nombre = (limpio(nombreArchivo, 200) || 'documento.pdf').replace(/[\\/]/g, '-');
    await run(
      'INSERT INTO borradores (id, filename, pdf, firmante, created_by, origen) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, nombre.toLowerCase().endsWith('.pdf') ? nombre : `${nombre}.pdf`, pdf, datosFirmante ? JSON.stringify(datosFirmante) : null, me.username, limpio(origen, 40) || null]
    );
    res.status(201).json({ id });
  })
);

/** GET /api/borradores/:id → { nombreArchivo, pdfBase64, firmante } (solo quien lo creó). */
app.get(
  '/api/borradores/:id',
  requireAuth,
  route(async (req, res) => {
    const b = await one("SELECT * FROM borradores WHERE id = $1 AND created_at > now() - interval '24 hours'", [req.params.id]);
    if (!b || b.created_by !== req.user.username) return res.status(404).json({ error: 'El documento ya no está disponible. Vuelve a enviarlo desde Contratos.' });
    res.json({ nombreArchivo: b.filename, pdfBase64: Buffer.from(b.pdf).toString('base64'), firmante: b.firmante, origen: b.origen });
  })
);

/** POST /api/auth/login: retirado (403). Se mantiene para que el frontend antiguo reciba un mensaje claro. */
app.post(
  '/api/auth/login',
  route(async (req, res) => {
    // Las cuentas propias de Firma se retiraron: solo se entra por el Portal del Empleado.
    res.status(403).json({ error: 'Entra desde el Portal del Empleado: https://gesticotrans.app' });
  })
);

/**
 * GET /api/users → { users: [{ username, nombre }] }: las personas con acceso a
 * Firma en el Portal del Empleado (las sugerencias del selector de firmantes).
 * Los usuarios se gestionan solo en el portal.
 */
app.get(
  '/api/users',
  requireAuth,
  route(async (req, res) => {
    const cookie = readCookie(req, PORTAL_COOKIE);
    if (!cookie) return res.json({ users: [] });
    const r = await fetch(`${PORTAL_URL}/api/apps/firma/people`, {
      headers: { cookie: `${PORTAL_COOKIE}=${cookie}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return res.json({ users: [] });
    const { people = [] } = await r.json();
    res.json({ users: people });
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
  purgarSinPdf().catch((err) => console.error('Limpieza de documentos sin PDF:', err.message));
  const limpiarBorradores = () => run("DELETE FROM borradores WHERE created_at < now() - interval '24 hours'").catch(() => {});
  limpiarBorradores();
  setInterval(limpiarBorradores, 60 * 60 * 1000).unref();
  setInterval(() => purgarSinPdf().catch(() => {}), 15 * 60 * 1000).unref();
  startReminders();
  app.listen(PORT, () => {
    console.log(`Firma API escuchando en http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('No se pudo arrancar el servidor:', err.message);
  process.exit(1);
});
