// Pantalla "Pendientes": documentos donde al usuario logueado (identificado
// por su email de perfil) le toca o le ha tocado firmar. Muestra también el
// estado de los demás firmantes (p. ej. si el cliente ya firmó) para que un
// firmante interno (como Pablo, firmante 2) sepa cuándo le toca.
import { getProfile } from './profile.js';

const listEl = document.getElementById('pending-list');
const emptyEl = document.getElementById('pending-empty');
const emptyTextEl = document.getElementById('pending-empty-text');

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusBadge({ signedAt, openedAt, sentAt }) {
  if (signedAt) return `<span class="registry-status signed" title="Firmado: ${formatDate(signedAt)}">Firmado</span>`;
  if (openedAt) return `<span class="registry-status opened" title="Abierto: ${formatDate(openedAt)}">Abierto</span>`;
  if (sentAt) return `<span class="registry-status pending" title="Enviado: ${formatDate(sentAt)}">Pendiente</span>`;
  return '<span class="registry-status pending">Sin enviar</span>';
}

function renderItem(item) {
  const card = document.createElement('div');
  card.className = 'pending-card';

  const others = item.others
    .map((o) => `
      <div class="pending-other-line">
        <span>${o.label}</span>
        ${statusBadge(o)}
      </div>
    `)
    .join('');

  const alreadySigned = Boolean(item.ownSignedAt);
  const canSign = Boolean(item.token); // ya se le ha notificado, le toca a él
  card.innerHTML = `
    <div class="pending-card-head">
      <strong class="pending-doc-name" title="${item.documentName}">${item.documentName}</strong>
      <span class="pending-own-label">Tu casilla: ${item.ownLabel || '—'}</span>
    </div>
    <div class="pending-others">${others}</div>
  `;

  if (alreadySigned) {
    const done = document.createElement('span');
    done.className = 'registry-status signed';
    done.textContent = 'Ya has firmado';
    card.appendChild(done);
  } else if (canSign) {
    const link = document.createElement('a');
    link.className = 'btn btn-primary pending-sign-btn';
    link.href = `/?sign=${item.token}`;
    link.textContent = 'Firmar ahora';
    card.appendChild(link);
  } else {
    const waiting = document.createElement('span');
    waiting.className = 'registry-status pending';
    waiting.textContent = 'Aún no te toca firmar';
    card.appendChild(waiting);
  }

  return card;
}

/** Carga y pinta las firmas pendientes/hechas del usuario logueado. */
export async function loadPending() {
  listEl.innerHTML = '';
  const email = getProfile().email?.trim();

  if (!email) {
    listEl.hidden = true;
    emptyEl.hidden = false;
    emptyTextEl.textContent = 'Configura tu email en "Perfil" para ver tus firmas pendientes.';
    return;
  }

  try {
    const res = await fetch(`/api/pending?email=${encodeURIComponent(email)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar tus pendientes.');

    if (data.pending.length === 0) {
      listEl.hidden = true;
      emptyEl.hidden = false;
      emptyTextEl.textContent = 'No tienes firmas pendientes.';
      return;
    }

    emptyEl.hidden = true;
    listEl.hidden = false;
    data.pending.forEach((item) => listEl.appendChild(renderItem(item)));
  } catch (err) {
    listEl.hidden = true;
    emptyEl.hidden = false;
    emptyTextEl.textContent = err.message;
  }
}
