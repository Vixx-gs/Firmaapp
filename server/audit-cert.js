/**
 * Genera el certificado de evidencia de firma electrónica avanzada.
 * Contiene: datos del documento, hash original y firmado, y por cada
 * firmante: nombre, email, teléfono, IP, user-agent, OTP y timestamps.
 */
import { PDFDocument, StandardFonts, rgb, PageSizes } from 'pdf-lib';

function formatDate(iso) {
  if (!iso) return 'N/D';
  const d = new Date(iso);
  return d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', hour12: false });
}

/** Recorta un texto largo añadiendo "…" si supera maxLen caracteres. */
function trunc(str, maxLen = 70) {
  if (!str) return 'N/D';
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

/**
 * @param {{
 *   documentName: string,
 *   originalHash: string,
 *   signedHash: string,
 *   createdAt: string,
 *   signers: Array<{
 *     label: string, name: string|null, email: string|null, phone: string|null,
 *     sentAt: string|null, openedAt: string|null, signedAt: string|null,
 *     otpVerifiedAt: string|null, signIp: string|null, signUa: string|null
 *   }>,
 *   auditEvents: Array<{ action: string, ip: string|null, email: string|null, created_at: string, metadata: any }>
 * }} data
 * @returns {Promise<Buffer>}
 */
export async function generateAuditCert(data) {
  const pdf = await PDFDocument.create();
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await pdf.embedFont(StandardFonts.Helvetica);

  const PAGE_W = PageSizes.A4[0];
  const PAGE_H = PageSizes.A4[1];
  const MARGIN = 50;
  const COL = PAGE_W - MARGIN * 2;
  const PURPLE = rgb(0.39, 0.36, 0.96);
  const DARK = rgb(0.12, 0.13, 0.19);
  const GRAY = rgb(0.54, 0.55, 0.63);
  const GREEN = rgb(0.13, 0.63, 0.38);
  const LINE_H = 16;

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function newPage() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }

  function ensureSpace(needed) {
    if (y - needed < MARGIN) newPage();
  }

  function drawText(text, { x = MARGIN, size = 10, font = fontReg, color = DARK, maxWidth } = {}) {
    // Wrap simple por caracteres si hay maxWidth
    const words = String(text).split(' ');
    let line = '';
    const lines = [];
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (maxWidth && font.widthOfTextAtSize(test, size) > maxWidth) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    for (const l of lines) {
      ensureSpace(LINE_H + 4);
      page.drawText(l, { x, y, size, font, color });
      y -= LINE_H;
    }
  }

  function drawLabelValue(label, value, { labelColor = GRAY } = {}) {
    ensureSpace(LINE_H * 2 + 4);
    page.drawText(label, { x: MARGIN, y, size: 9, font: fontBold, color: labelColor });
    y -= LINE_H - 2;
    drawText(trunc(value, 90), { x: MARGIN + 10, size: 9, color: DARK });
    y -= 2;
  }

  function drawHLine(color = rgb(0.88, 0.88, 0.93)) {
    ensureSpace(12);
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color });
    y -= 10;
  }

  function drawSectionTitle(title) {
    ensureSpace(30);
    y -= 6;
    page.drawRectangle({ x: MARGIN, y: y - 4, width: COL, height: 20, color: rgb(0.94, 0.93, 1) });
    page.drawText(title.toUpperCase(), { x: MARGIN + 8, y: y + 2, size: 9, font: fontBold, color: PURPLE });
    y -= 18;
  }

  // ── Cabecera ──────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: PAGE_H - 70, width: PAGE_W, height: 70, color: PURPLE });
  page.drawText('CERTIFICADO DE EVIDENCIA', { x: MARGIN, y: PAGE_H - 35, size: 16, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('Firma Electrónica Avanzada', { x: MARGIN, y: PAGE_H - 55, size: 10, font: fontReg, color: rgb(0.85, 0.85, 1) });
  page.drawText(`Emitido: ${formatDate(new Date().toISOString())}`, {
    x: PAGE_W - MARGIN - 180, y: PAGE_H - 45, size: 9, font: fontReg, color: rgb(0.85, 0.85, 1),
  });
  y = PAGE_H - 85;

  // ── Documento ─────────────────────────────────────────────────────────────
  drawSectionTitle('Datos del documento');
  drawLabelValue('Nombre del documento', data.documentName);
  drawLabelValue('Fecha de creación', formatDate(data.createdAt));
  drawLabelValue('Hash SHA-256 del original', data.originalHash || 'No disponible');
  drawLabelValue('Hash SHA-256 del documento firmado', data.signedHash || 'Pendiente de firma');

  y -= 4;
  drawHLine();

  // ── Firmantes ─────────────────────────────────────────────────────────────
  drawSectionTitle('Registro de firmantes');

  for (const [i, s] of data.signers.entries()) {
    ensureSpace(120);
    y -= 4;
    page.drawText(`${s.label}${s.name ? ` — ${s.name}` : ''}`, { x: MARGIN, y, size: 11, font: fontBold, color: DARK });
    y -= LINE_H + 2;

    drawLabelValue('Email', s.email);
    if (s.phone) drawLabelValue('Teléfono', s.phone);
    drawLabelValue('Notificado', formatDate(s.sentAt));
    drawLabelValue('Enlace abierto', formatDate(s.openedAt));
    drawLabelValue('OTP verificado', s.otpVerifiedAt ? formatDate(s.otpVerifiedAt) : 'No verificado');
    drawLabelValue('Firmado', s.signedAt ? formatDate(s.signedAt) : 'Pendiente', {
      labelColor: s.signedAt ? GREEN : GRAY,
    });
    drawLabelValue('IP de firma', s.signIp);
    drawLabelValue('Dispositivo / navegador', s.signUa);

    if (i < data.signers.length - 1) { y -= 6; drawHLine(rgb(0.9, 0.9, 0.96)); }
  }

  y -= 4;
  drawHLine();

  // ── Log de auditoría ──────────────────────────────────────────────────────
  drawSectionTitle('Registro de auditoría cronológico');

  const ACTION_LABELS = {
    document_created: 'Documento creado',
    otp_requested: 'OTP solicitado',
    otp_verified: 'OTP verificado',
    sign_page_opened: 'Página de firma abierta',
    signed: 'Firma aplicada',
    completed: 'Documento completado',
  };

  for (const ev of data.auditEvents) {
    ensureSpace(40);
    const label = ACTION_LABELS[ev.action] || ev.action;
    page.drawText(`● ${label}`, { x: MARGIN, y, size: 9, font: fontBold, color: DARK });
    page.drawText(formatDate(ev.created_at), { x: PAGE_W - MARGIN - 140, y, size: 9, font: fontReg, color: GRAY });
    y -= LINE_H - 2;
    if (ev.email) drawText(`  Email: ${ev.email}`, { x: MARGIN, size: 8, color: GRAY });
    if (ev.ip) drawText(`  IP: ${ev.ip}`, { x: MARGIN, size: 8, color: GRAY });
    if (ev.metadata?.signerLabel) drawText(`  Firmante: ${ev.metadata.signerLabel}`, { x: MARGIN, size: 8, color: GRAY });
    y -= 4;
  }

  y -= 4;
  drawHLine();

  // ── Pie legal ─────────────────────────────────────────────────────────────
  ensureSpace(60);
  y -= 6;
  const legal = [
    'Este certificado acredita la realización de una firma electrónica avanzada conforme al Reglamento (UE) 910/2014 (eIDAS), art. 26.',
    'Los datos registrados (timestamps, IPs, verificación OTP y hashes SHA-256) constituyen evidencia de la identidad del firmante',
    'y de la integridad del documento. El hash SHA-256 permite detectar cualquier alteración posterior al proceso de firma.',
  ];
  for (const line of legal) {
    drawText(line, { size: 8, color: GRAY, maxWidth: COL });
  }

  return Buffer.from(await pdf.save());
}
