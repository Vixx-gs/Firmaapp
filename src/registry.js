// "Registro": documentos que el usuario logueado ha firmado él mismo.
import { getProfile } from './profile.js';

const tableEl = document.getElementById('registry-table');
const bodyEl = document.getElementById('registry-body');
const emptyEl = document.getElementById('registry-empty');

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

async function downloadDocument(documentId, documentName, email) {
  try {
    const res = await fetch(`/api/documents/${documentId}/download?email=${encodeURIComponent(email)}`);
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

/** Carga y pinta los documentos que el usuario logueado ha firmado. */
export async function loadRegistry() {
  bodyEl.innerHTML = '';
  const email = getProfile().email?.trim();

  if (!email) {
    tableEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.querySelector('span').textContent = 'Configura tu email en "Perfil" para ver tu registro.';
    return;
  }

  try {
    const res = await fetch(`/api/my-registry?email=${encodeURIComponent(email)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar el registro.');

    if (data.documents.length === 0) {
      tableEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.querySelector('span').textContent = 'No hay documentos firmados todavía.';
      return;
    }

    tableEl.hidden = false;
    emptyEl.hidden = true;
    data.documents.forEach((doc) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="registry-doc" title="${doc.documentName}">${doc.documentName}</span></td>
        <td><span class="registry-signer-contact">${doc.ownLabel || '—'}</span></td>
        <td><span class="registry-date">${formatDate(doc.ownSignedAt)}</span></td>
        <td>
          <button type="button" class="registry-download-btn">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3v12" />
              <path d="M7 10l5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
            Descargar
          </button>
        </td>
      `;
      tr.querySelector('.registry-download-btn').addEventListener('click', () =>
        downloadDocument(doc.documentId, doc.documentName, email)
      );
      bodyEl.appendChild(tr);
    });
  } catch (err) {
    tableEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.querySelector('span').textContent = err.message;
  }
}
