import nodemailer from 'nodemailer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '..', 'public', 'logo.png');
const LOGO_CID = 'firma-logo';

// Leídas de forma diferida (no al cargar el módulo) para que dotenv.config()
// pueda ejecutarse primero en index.js con un `import` normal, sin depender
// de top-level await (incompatible con cómo Phusion Passenger carga la app).
let transporter = null;
function getTransporter() {
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

/**
 * Plantilla HTML de marca común a todos los correos: banner con el
 * degradado y logo de la app, cuerpo con el mensaje, y un botón opcional.
 * @param {{ title: string, bodyHtml: string, ctaLabel?: string, ctaUrl?: string }} params
 */
function brandedHtml({ title, bodyHtml, ctaLabel, ctaUrl }) {
  const cta = ctaUrl
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 28px auto 4px;">
        <tr>
          <td style="border-radius: 10px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 45%, #ec4899 100%);">
            <a href="${ctaUrl}" target="_blank" rel="noopener"
               style="display: inline-block; padding: 13px 28px; font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 10px;">
              ${ctaLabel}
            </a>
          </td>
        </tr>
      </table>
    `
    : '';

  return `
<!DOCTYPE html>
<html lang="es">
  <body style="margin: 0; padding: 0; background: #f5f6fc; font-family: Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f5f6fc; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width: 480px; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(99,102,241,0.08);">
            <tr>
              <td style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 45%, #ec4899 100%); padding: 28px 24px; text-align: center;">
                <img src="cid:${LOGO_CID}" width="48" height="48" alt="Firma" style="display: inline-block; border-radius: 12px; vertical-align: middle;" />
                <div style="display: inline-block; vertical-align: middle; margin-left: 12px; text-align: left;">
                  <div style="color: #ffffff; font-size: 20px; font-weight: 800; line-height: 1.2;">Firma</div>
                  <div style="color: rgba(255,255,255,0.85); font-size: 12px; font-weight: 500;">Firma electrónica</div>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding: 32px 28px;">
                <h1 style="margin: 0 0 16px; font-size: 19px; color: #1f2130;">${title}</h1>
                <div style="font-size: 14.5px; line-height: 1.6; color: #3d3f52;">${bodyHtml}</div>
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding: 18px 28px; background: #f5f6fc; text-align: center;">
                <span style="font-size: 12px; color: #8a8ca0;">Firma electrónica simple, rápida y segura</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `;
}

function logoAttachment() {
  return { filename: 'logo.png', path: LOGO_PATH, cid: LOGO_CID };
}

/**
 * Envía el correo de "firma pendiente" con el enlace de firma.
 * @param {{ to: string, signLink: string, documentName: string }} params
 */
export async function sendSignRequestEmail({ to, signLink, documentName }) {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error(
      'Envío de email no configurado: faltan GMAIL_USER / GMAIL_APP_PASSWORD en el .env del servidor.'
    );
  }

  const bodyHtml = `
    <p>Hola,</p>
    <p>Tienes una firma pendiente en el documento <strong>${documentName}</strong>.</p>
    <p>Pulsa el botón de abajo para revisarlo y firmarlo. Solo te llevará un momento.</p>
    <p style="margin-top: 20px; color: #8a8ca0; font-size: 13px;">Si no esperabas este correo, puedes ignorarlo con tranquilidad.</p>
  `;
  const text = `Hola,\n\nTienes una firma pendiente en el documento "${documentName}".\nFírmalo aquí: ${signLink}\n\nSi no esperabas este correo, puedes ignorarlo.`;

  await transporter.sendMail({
    from: `"Firma Electrónica" <${process.env.GMAIL_USER}>`,
    replyTo: process.env.GMAIL_USER,
    to,
    subject: `Firma pendiente: ${documentName}`,
    text,
    html: brandedHtml({
      title: 'Tienes una firma pendiente',
      bodyHtml,
      ctaLabel: 'Revisar y firmar',
      ctaUrl: signLink,
    }),
    attachments: [logoAttachment()],
  });
}

/**
 * Envía el documento ya firmado por todas las partes como copia final a un
 * firmante, con el PDF adjunto.
 * @param {{ to: string, documentName: string, pdfBuffer: Buffer }} params
 */
export async function sendCompletedDocumentEmail({ to, documentName, pdfBuffer }) {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error(
      'Envío de email no configurado: faltan GMAIL_USER / GMAIL_APP_PASSWORD en el .env del servidor.'
    );
  }

  const bodyHtml = `
    <p>Hola,</p>
    <p>El documento <strong>${documentName}</strong> ya ha sido firmado por todas las partes.</p>
    <p>Te adjuntamos una copia final para que la guardes.</p>
  `;
  const text = `Hola,\n\nEl documento "${documentName}" ya ha sido firmado por todas las partes.\nTe adjuntamos una copia final en PDF.`;

  await transporter.sendMail({
    from: `"Firma Electrónica" <${process.env.GMAIL_USER}>`,
    replyTo: process.env.GMAIL_USER,
    to,
    subject: `Documento firmado: ${documentName}`,
    text,
    html: brandedHtml({
      title: 'Documento firmado por todas las partes',
      bodyHtml,
    }),
    attachments: [
      logoAttachment(),
      { filename: documentName.endsWith('.pdf') ? documentName : `${documentName}.pdf`, content: pdfBuffer },
    ],
  });
}
