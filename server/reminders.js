// Cron diario de recordatorios y expiración de firmas pendientes.
// Se ejecuta cada hora; las acciones son idempotentes (columnas *_sent_at).
//
// Calendario por firmante a partir de `sent_at`:
//   +1 día  → recordatorio 1
//   +7 días → recordatorio 2
//  +14 días → aviso de expiración (queda 1 día)
//  +15 días → marcar como "No firmada" (expired_at)

import { all, run } from './db.js';
import { sendReminderEmail } from './mailer.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function processReminders() {
  const now = new Date();
  let rows;
  try {
    rows = await all(`
      SELECT sl.id, sl.token, sl.email, sl.document_name,
             sl.sent_at, sl.reminder_1_sent_at, sl.reminder_7_sent_at,
             sl.reminder_14_sent_at, sl.expired_at
      FROM send_log sl
      WHERE sl.signed_at IS NULL
        AND sl.expired_at IS NULL
        AND sl.email IS NOT NULL
        AND sl.sent_at IS NOT NULL
    `);
  } catch (err) {
    console.error('[reminders] Error al leer send_log:', err.message);
    return;
  }

  const PUBLIC_URL = process.env.PUBLIC_URL || 'https://firma.gesticotrans.app';

  for (const row of rows) {
    const sentAt = new Date(row.sent_at);
    const days = (now - sentAt) / MS_PER_DAY;
    const signLink = `${PUBLIC_URL}/?sign=${row.token}`;
    const documentName = row.document_name;

    try {
      if (days >= 15) {
        await run('UPDATE send_log SET expired_at = $1 WHERE id = $2', [now.toISOString(), row.id]);
        console.log(`[reminders] Expirado: ${row.id} (${documentName})`);
      } else if (days >= 14 && !row.reminder_14_sent_at) {
        await sendReminderEmail({ to: row.email, signLink, documentName, type: 14 });
        await run('UPDATE send_log SET reminder_14_sent_at = $1 WHERE id = $2', [now.toISOString(), row.id]);
        console.log(`[reminders] Recordatorio 14d enviado: ${row.email} — ${documentName}`);
      } else if (days >= 7 && !row.reminder_7_sent_at) {
        await sendReminderEmail({ to: row.email, signLink, documentName, type: 7 });
        await run('UPDATE send_log SET reminder_7_sent_at = $1 WHERE id = $2', [now.toISOString(), row.id]);
        console.log(`[reminders] Recordatorio 7d enviado: ${row.email} — ${documentName}`);
      } else if (days >= 1 && !row.reminder_1_sent_at) {
        await sendReminderEmail({ to: row.email, signLink, documentName, type: 1 });
        await run('UPDATE send_log SET reminder_1_sent_at = $1 WHERE id = $2', [now.toISOString(), row.id]);
        console.log(`[reminders] Recordatorio 1d enviado: ${row.email} — ${documentName}`);
      }
    } catch (err) {
      console.error(`[reminders] Error procesando ${row.id}:`, err.message);
    }
  }
}

/** Inicia el cron de recordatorios: comprueba al arrancar y luego cada hora. */
export function startReminders() {
  // Primera ejecución al arrancar (cubre reinicios del servidor)
  processReminders().catch((err) => console.error('[reminders] Error inicial:', err.message));
  // Cada hora
  setInterval(() => {
    processReminders().catch((err) => console.error('[reminders] Error periódico:', err.message));
  }, 60 * 60 * 1000);
}
