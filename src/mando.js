// "Mando": vista de administrador con todos los documentos enviados a
// firmar en la app, a quién y cuándo se enviaron/firmaron. Paginado (20 en
// 20, con "Mostrar más") y filtrable por nombre y rango de fechas.
const PAGE_SIZE = 20;

const tableEl = document.getElementById('mando-table');
const bodyEl = document.getElementById('mando-body');
const emptyEl = document.getElementById('mando-empty');
const loadMoreWrap = document.getElementById('mando-load-more-wrap');
const btnLoadMore = document.getElementById('mando-load-more');
const inputQ = document.getElementById('mando-filter-q');
const inputFrom = document.getElementById('mando-filter-from');
const inputTo = document.getElementById('mando-filter-to');
const btnClear = document.getElementById('mando-filter-clear');

let offset = 0;
let loading = false;

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

function appendRow(doc) {
  const firstSentAt = doc.signers.find((s) => s.sentAt)?.sentAt;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><span class="registry-doc" title="${doc.documentName}">${doc.documentName}</span></td>
    <td><div class="registry-signers">${doc.signers.map(signerLine).join('')}</div></td>
    <td><span class="registry-date">${formatDate(firstSentAt)}</span></td>
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
    downloadDocument(doc.documentId, doc.documentName)
  );
  bodyEl.appendChild(tr);
}

function currentFilters() {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (inputQ.value.trim()) params.set('q', inputQ.value.trim());
  if (inputFrom.value) params.set('from', inputFrom.value);
  if (inputTo.value) params.set('to', inputTo.value);
  return params;
}

async function loadPage() {
  if (loading) return;
  loading = true;
  btnLoadMore.disabled = true;
  btnLoadMore.textContent = 'Cargando…';
  try {
    const res = await fetch(`/api/registry?${currentFilters()}`, { headers: { 'x-firma-role': 'admin' } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar el listado.');

    if (offset === 0 && data.documents.length === 0) {
      tableEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.querySelector('span').textContent = 'No hay envíos registrados todavía.';
      loadMoreWrap.hidden = true;
      return;
    }

    tableEl.hidden = false;
    emptyEl.hidden = true;
    data.documents.forEach(appendRow);
    offset += data.documents.length;
    loadMoreWrap.hidden = !data.hasMore;
  } catch (err) {
    tableEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.querySelector('span').textContent = err.message;
    loadMoreWrap.hidden = true;
  } finally {
    loading = false;
    btnLoadMore.disabled = false;
    btnLoadMore.textContent = 'Mostrar más';
  }
}

function reload() {
  offset = 0;
  bodyEl.innerHTML = '';
  loadMoreWrap.hidden = true;
  loadPage();
}

let debounceTimer = null;
function debouncedReload() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(reload, 300);
}

btnLoadMore.addEventListener('click', loadPage);
inputQ.addEventListener('input', debouncedReload);
inputFrom.addEventListener('change', reload);
inputTo.addEventListener('change', reload);
btnClear.addEventListener('click', () => {
  inputQ.value = '';
  inputFrom.value = '';
  inputTo.value = '';
  reload();
});

/** Carga (desde cero) la lista de documentos de la app (solo admin). */
export function loadMando() {
  reload();
}
