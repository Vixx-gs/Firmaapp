// "Mando": vista de administrador con todos los documentos enviados a
// firmar en la app, a quién y cuándo se enviaron/firmaron.
const tableEl = document.getElementById('mando-table');
const bodyEl = document.getElementById('mando-body');
const emptyEl = document.getElementById('mando-empty');

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

function statusBadge(signer) {
  if (signer.signedAt) {
    return `<span class="registry-status signed" title="Firmado: ${formatDate(signer.signedAt)}">Firmado</span>`;
  }
  if (signer.openedAt) {
    return `<span class="registry-status opened" title="Abierto: ${formatDate(signer.openedAt)}">Abierto</span>`;
  }
  if (signer.sentAt) {
    return `<span class="registry-status pending" title="Enviado: ${formatDate(signer.sentAt)}">Pendiente</span>`;
  }
  return '<span class="registry-status pending">Sin enviar</span>';
}

function signerLine(signer) {
  const contact = signer.email || signer.phone || '—';
  return `
    <div class="registry-signer-line">
      <span class="registry-signer-name">${signer.label}</span>
      ${statusBadge(signer)}
      <span class="registry-signer-contact">${contact}</span>
    </div>
  `;
}

async function downloadDocument(documentId, documentName) {
  try {
    const res = await fetch(`/api/documents/${documentId}/download`, {
      headers: { 'x-firma-role': 'admin' },
    });
    if (!res.ok) throw new Error('No se pudo descargar el documento.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = documentName;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
  }
}

async function uploadToDrive(documentId, btn) {
  btn.disabled = true;
  btn.textContent = 'Subiendo…';
  try {
    const res = await fetch(`/api/documents/${documentId}/drive`, {
      method: 'POST',
      headers: { 'x-firma-role': 'admin' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo subir a Drive.');
    loadMando();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Reintentar subida a Drive';
    btn.title = err.message;
  }
}

/** Carga y pinta la lista completa de documentos de la app (solo admin). */
export async function loadMando() {
  bodyEl.innerHTML = '';
  try {
    const res = await fetch('/api/registry', { headers: { 'x-firma-role': 'admin' } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar el listado.');

    if (data.documents.length === 0) {
      tableEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.querySelector('span').textContent = 'No hay envíos registrados todavía.';
      return;
    }

    tableEl.hidden = false;
    emptyEl.hidden = true;
    data.documents.forEach((doc) => {
      const firstSentAt = doc.signers.find((s) => s.sentAt)?.sentAt;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="registry-doc" title="${doc.documentName}">${doc.documentName}</span></td>
        <td><div class="registry-signers">${doc.signers.map(signerLine).join('')}</div></td>
        <td><span class="registry-date">${formatDate(firstSentAt)}</span></td>
        <td>
          <div class="registry-actions">
            <button type="button" class="registry-download-btn" data-role="download">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 3v12" />
                <path d="M7 10l5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
              Descargar
            </button>
          </div>
        </td>
      `;
      tr.querySelector('[data-role="download"]').addEventListener('click', () =>
        downloadDocument(doc.documentId, doc.documentName)
      );
      const actions = tr.querySelector('.registry-actions');
      if (doc.driveUrl) {
        const link = document.createElement('a');
        link.className = 'registry-download-btn';
        link.href = doc.driveUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Ver en Drive';
        actions.appendChild(link);
      } else if (doc.completed && data.driveConfigured) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'registry-download-btn';
        btn.textContent = 'Subir a Drive';
        btn.addEventListener('click', () => uploadToDrive(doc.documentId, btn));
        actions.appendChild(btn);
      }
      bodyEl.appendChild(tr);
    });
  } catch (err) {
    tableEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.querySelector('span').textContent = err.message;
  }
}
