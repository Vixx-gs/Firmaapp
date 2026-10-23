// Envía un correo de prueba con la configuración del .env (SMTP propio o Gmail).
// Uso, en el servidor:  node server/probar-correo.mjs destinatario@ejemplo.com
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { sendOtpEmail } from './mailer.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });   // el mismo .env que index.js

const to = process.argv[2];
if (!to) {
  console.error('Uso: node server/probar-correo.mjs destinatario@ejemplo.com');
  process.exit(1);
}
console.log(`Enviando desde ${process.env.SMTP_HOST ? `${process.env.SMTP_USER} (${process.env.SMTP_HOST})` : `${process.env.GMAIL_USER} (Gmail)`} a ${to}…`);
await sendOtpEmail({ to, otp: '123456', documentName: 'Prueba de envío' });
console.log('Enviado.');
