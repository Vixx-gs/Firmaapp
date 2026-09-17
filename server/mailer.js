import nodemailer from 'nodemailer';

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

  await transporter.sendMail({
    from: `"Firma Electrónica" <${process.env.GMAIL_USER}>`,
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
