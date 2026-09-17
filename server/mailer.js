import nodemailer from 'nodemailer';

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

let transporter = null;
if (GMAIL_USER && GMAIL_APP_PASSWORD) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

/**
 * Envía el correo de "firma pendiente" con el enlace de firma.
 * @param {{ to: string, signLink: string, documentName: string }} params
 */
export async function sendSignRequestEmail({ to, signLink, documentName }) {
  if (!transporter) {
    throw new Error(
      'Envío de email no configurado: faltan GMAIL_USER / GMAIL_APP_PASSWORD en el .env del servidor.'
    );
  }

  await transporter.sendMail({
    from: `"Firma Electrónica" <${GMAIL_USER}>`,
    to,
    subject: 'Tienes una firma pendiente',
    html: `
      <p>Hola,</p>
      <p>Tienes una firma pendiente en el documento <strong>${documentName}</strong>.</p>
      <p><a href="${signLink}" target="_blank" rel="noopener">Pulsa aquí para firmarlo</a></p>
      <p>Si no esperabas este correo, puedes ignorarlo.</p>
    `,
  });
}
