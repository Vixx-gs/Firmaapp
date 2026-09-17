import twilio from 'twilio';

// Leídas de forma diferida (no al cargar el módulo), ver mailer.js.
let client = null;
function getClient() {
  const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM; // p.ej. "whatsapp:+14155238886"
  if (!ACCOUNT_SID || !AUTH_TOKEN || !WHATSAPP_FROM) return null;
  if (!client) client = twilio(ACCOUNT_SID, AUTH_TOKEN);
  return client;
}

function toWhatsappAddress(phone) {
  const trimmed = phone.trim();
  return trimmed.startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`;
}

/**
 * Envía el aviso de "firma pendiente" por WhatsApp vía Twilio.
 * @param {{ to: string, signLink: string, documentName: string }} params
 */
export async function sendSignRequestWhatsapp({ to, signLink, documentName }) {
  const client = getClient();
  if (!client) {
    throw new Error(
      'Envío de WhatsApp no configurado: faltan TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM en el .env del servidor.'
    );
  }

  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: toWhatsappAddress(to),
    body: `Tienes una firma pendiente en el documento "${documentName}". Fírmalo aquí: ${signLink}`,
  });
}
