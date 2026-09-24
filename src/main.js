import './style.css';
import { initAuth, getSessionRole, isInternalRole } from './auth.js';
import { initProfile } from './profile.js';
import { renderPdf } from './pdfViewer.js';
import { SignatureField } from './fields.js';
import { openSignerPicker } from './signerPicker.js';
import { addSigner, resetSigners, getSigners } from './signers.js';
import { getSignToken, startSignFlow } from './signFlow.js';
import { loadRegistry } from './registry.js';
import { loadMando } from './mando.js';
import { loadPending } from './pending.js';

const signToken = getSignToken();

if (signToken) {
  // Enlace de firma externa: sin login ni resto de la app, solo la
  // pantalla para firmar el campo asignado.
  document.getElementById('login-screen').hidden = true;
  startSignFlow(signToken);
} else {
  initAuth();
  initProfile();

  // Los firmantes internos entran directo en Pendientes, no en la zona
  // de subida de documentos (esa es solo para el admin).
  document.addEventListener('firma:loggedIn', (e) => {
    if (isInternalRole(e.detail.role)) document.dispatchEvent(new CustomEvent('firma:pending'));
  });
}

// --- Estado ---
let originalBytes = null;   // ArrayBuffer del PDF original
let documentName = '';      // nombre del archivo cargado
let pages = [];             // metadatos de páginas (de renderPdf)
let thumbItems = [];        // elementos de miniatura, alineados por índice con `pages`
let currentPageIndex = 0;   // página mostrada en grande
let fields = [];            // SignatureField[]
let placing = false;        // ¿estamos colocando campos nuevos?
let activeSigner = null;    // firmante al que se asignan los cuadros que se dibujan ahora
let savedMainView = 'dropzone'; // 'dropzone' | 'viewer' — adónde volver al salir de una pantalla superpuesta

// --- Elementos ---
const dropzone = document.getElementById('dropzone');
const btnSelect = document.getElementById('btn-select');
const fileInput = document.getElementById('file-input');
const viewer = document.getElementById('viewer');
const pageStage = document.getElementById('page-stage');
const thumbRail = document.getElementById('thumb-rail');
const btnBack = document.getElementById('btn-back');
const btnConfirmFields = document.getElementById('btn-confirm-fields');
const btnSend = document.getElementById('btn-send');
const toast = document.getElementById('toast');
const btnAddSigner = document.getElementById('btn-add-signer');
const placingHint = document.getElementById('placing-hint');
const placingHintSigner = document.getElementById('placing-hint-signer');
const pendingScreen = document.getElementById('pending-screen');
const btnPendingBack = document.getElementById('btn-pending-back');
const profileScreen = document.getElementById('profile-screen');
const btnProfileBack = document.getElementById('btn-profile-back');
const registryScreen = document.getElementById('registry-screen');
const btnRegistryBack = document.getElementById('btn-registry-back');
const mandoScreen = document.getElementById('mando-screen');
const btnMandoBack = document.getElementById('btn-mando-back');
const btnHome = document.getElementById('btn-home');

const overlayScreens = [pendingScreen, profileScreen, registryScreen, mandoScreen];

// ---------- Logo: volver siempre a la pantalla de inicio ----------
// Recarga completa (no solo cambio de estado en JS) para poder recuperarse
// de una pantalla en blanco si algo falló en el estado de la SPA.
btnHome.addEventListener('click', () => {
  window.location.href = '/';
});

// ---------- Firmantes del documento ----------
btnAddSigner.addEventListener('click', addSigner);

// ---------- Pantallas superpuestas: Pendientes, Perfil y Registro ----------
function enterOverlayScreen(screenEl) {
  // Solo recordamos la vista de origen si no venimos ya de otra pantalla superpuesta.
  if (overlayScreens.every((s) => s.hidden)) {
    savedMainView = dropzone.hidden ? 'viewer' : 'dropzone';
  }
  dropzone.hidden = true;
  viewer.hidden = true;
  overlayScreens.forEach((s) => (s.hidden = true));
  screenEl.hidden = false;
}

function exitOverlayScreen() {
  overlayScreens.forEach((s) => (s.hidden = true));
  if (isInternalRole(getSessionRole())) {
    pendingScreen.hidden = false;
    loadPending();
    return;
  }
  if (savedMainView === 'viewer') viewer.hidden = false;
  else dropzone.hidden = false;
}

document.addEventListener('firma:pending', () => {
  enterOverlayScreen(pendingScreen);
  loadPending();
});
document.addEventListener('firma:profile', () => enterOverlayScreen(profileScreen));
document.addEventListener('firma:registry', () => {
  enterOverlayScreen(registryScreen);
  loadRegistry();
});
document.addEventListener('firma:mando', () => {
  enterOverlayScreen(mandoScreen);
  loadMando();
});
btnPendingBack.addEventListener('click', exitOverlayScreen);
btnProfileBack.addEventListener('click', exitOverlayScreen);
btnRegistryBack.addEventListener('click', exitOverlayScreen);
btnMandoBack.addEventListener('click', exitOverlayScreen);

// ---------- Carga del archivo ----------
btnSelect.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) loadFile(file);
});

// ---------- Arrastrar y soltar en toda la ventana ----------
const dragOverlay = document.getElementById('drag-overlay');
let dragDepth = 0; // contador para ignorar dragenter/dragleave de hijos

window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (!dropzone.hidden) {
    dragDepth++;
    dragOverlay.hidden = false;
    dropzone.classList.add('dragover');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  if (dragDepth === 0) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    dragOverlay.hidden = true;
    dropzone.classList.remove('dragover');
  }
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (dropzone.hidden) return; // ya hay un documento cargado: ignorar el drop
  dragDepth = 0;
  dragOverlay.hidden = true;
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

async function loadFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx') || file.type.includes('word')) {
    showToast('Por ahora solo PDF. La conversión de DOCX llega en la siguiente fase.');
    return;
  }
  if (!name.endsWith('.pdf') && file.type !== 'application/pdf') {
    showToast('Formato no soportado. Sube un PDF.');
    return;
  }

  originalBytes = await file.arrayBuffer();
  documentName = file.name;
  fields = [];
  resetPlacingUI();

  dropzone.hidden = true;
  viewer.hidden = false;
  showToast('Analizando documento…');

  try {
    pages = await renderPdf(originalBytes, pageStage);
    pages.forEach(attachPlacement);
    buildThumbRail();
    setCurrentPage(0);
    btnBack.hidden = false;
    updateSendState();
    showToast(`Documento listo · ${pages.length} página(s)`, true);
  } catch (err) {
    console.error(err);
    showToast('No se pudo leer el PDF.');
    resetToDropzone();
  }
}

function resetToDropzone() {
  dropzone.hidden = false;
  viewer.hidden = true;
  pageStage.innerHTML = '';
  thumbRail.innerHTML = '';
  btnSend.disabled = true;
  btnBack.hidden = true;
  originalBytes = null;
  documentName = '';
  pages = [];
  thumbItems = [];
  currentPageIndex = 0;
  fields = [];
  placing = false;
  fileInput.value = '';
  resetSigners();
}

// ---------- Navegación entre páginas ----------
/** Construye la barra lateral de miniaturas a partir de `pages`. */
function buildThumbRail() {
  thumbRail.innerHTML = '';
  thumbItems = pages.map((page) => {
    const item = document.createElement('div');
    item.className = 'thumb-item';
    item.appendChild(page.thumbCanvas);

    const num = document.createElement('span');
    num.className = 'thumb-num';
    num.textContent = String(page.pageIndex + 1);
    item.appendChild(num);

    item.addEventListener('click', () => setCurrentPage(page.pageIndex));
    thumbRail.appendChild(item);
    return { el: item };
  });
}

/** Muestra en grande la página `index` y resalta su miniatura. */
function setCurrentPage(index) {
  currentPageIndex = index;
  pages.forEach((page, i) => {
    page.wrapEl.hidden = i !== index;
  });
  thumbItems.forEach((item, i) => {
    item.el.classList.toggle('active', i === index);
  });
}

/** Actualiza el check verde de una página según si tiene algún campo asignado. */
function syncThumbBadge(page) {
  const item = thumbItems[page.pageIndex];
  if (!item) return;
  const signed = fields.some((f) => f.page === page && f.assignedSigner);
  let check = item.el.querySelector('.thumb-check');
  if (signed && !check) {
    check = document.createElement('span');
    check.className = 'thumb-check';
    check.textContent = '✓';
    item.el.appendChild(check);
  } else if (!signed && check) {
    check.remove();
  }
}

btnBack.addEventListener('click', () => {
  resetToDropzone();
  showToast('Selecciona otro documento.');
});

// ---------- Colocar campos de firma (por firmante) ----------
// Al confirmar los datos de un firmante recién creado, se activa el modo de
// dibujo asignado a ese firmante hasta que se pulse "Confirmar".
document.addEventListener('firma:signerReady', (e) => {
  startPlacingFor(e.detail);
});

document.addEventListener('firma:signerRemoved', (e) => {
  if (activeSigner && activeSigner.id === e.detail.id) stopPlacing();
});

function startPlacingFor(signer) {
  activeSigner = signer;
  placing = true;
  pages.forEach((p) => p.layerEl.classList.add('placing'));
  btnConfirmFields.hidden = false;
  placingHint.hidden = false;
  placingHintSigner.textContent = signer.label;
}

function stopPlacing() {
  placing = false;
  activeSigner = null;
  pages.forEach((p) => p.layerEl.classList.remove('placing'));
  btnConfirmFields.hidden = true;
  placingHint.hidden = true;
}

btnConfirmFields.addEventListener('click', stopPlacing);

function resetPlacingUI() {
  stopPlacing();
}

/** Engancha el dibujo de rectángulos (arrastrar) sobre la capa de una página. */
function attachPlacement(page) {
  const layer = page.layerEl;
  layer.addEventListener('pointerdown', (e) => {
    if (!placing) return;
    if (e.target.closest('.sig-field')) return; // no empezar sobre un campo
    e.preventDefault();

    const rect = layer.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;

    const ghost = document.createElement('div');
    ghost.className = 'sig-field';
    ghost.style.left = `${startX}px`;
    ghost.style.top = `${startY}px`;
    ghost.style.width = '0px';
    ghost.style.height = '0px';
    layer.appendChild(ghost);
    layer.setPointerCapture(e.pointerId);

    const move = (ev) => {
      const cx = Math.max(0, Math.min(ev.clientX - rect.left, rect.width));
      const cy = Math.max(0, Math.min(ev.clientY - rect.top, rect.height));
      ghost.style.left = `${Math.min(startX, cx)}px`;
      ghost.style.top = `${Math.min(startY, cy)}px`;
      ghost.style.width = `${Math.abs(cx - startX)}px`;
      ghost.style.height = `${Math.abs(cy - startY)}px`;
    };
    const up = () => {
      layer.releasePointerCapture(e.pointerId);
      layer.removeEventListener('pointermove', move);
      layer.removeEventListener('pointerup', up);

      const x = ghost.offsetLeft;
      const y = ghost.offsetTop;
      let w = ghost.offsetWidth;
      let h = ghost.offsetHeight;
      ghost.remove();

      // Clic suelto sin arrastrar (recuadro demasiado pequeño) -> se ignora.
      if (w < 30 || h < 18) return;
      createField(page, x, y, w, h);
      // El modo "colocar campo" sigue activo: se pueden dibujar varios
      // recuadros seguidos sin volver a pulsar el botón cada vez.
    };
    layer.addEventListener('pointermove', move);
    layer.addEventListener('pointerup', up);
  });
}

function createField(page, x, y, w, h) {
  const field = new SignatureField(page, x, y, w, h, {
    onAssignRequest: requestAssignment,
    onRemove: (f) => {
      fields = fields.filter((it) => it !== f);
      syncThumbBadge(f.page);
      updateSendState();
    },
  });
  fields.push(field);
  if (activeSigner) {
    field.setAssignedSigner(activeSigner);
    syncThumbBadge(field.page);
  }
  updateSendState();
}

async function requestAssignment(field) {
  const signer = await openSignerPicker(field.el);
  if (signer) {
    field.setAssignedSigner(signer);
    syncThumbBadge(field.page);
    updateSendState();
  }
}

// ---------- Enviar a firmar ----------
function updateSendState() {
  btnSend.disabled = !fields.some((f) => f.assignedSigner);
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

btnSend.addEventListener('click', async () => {
  if (!originalBytes) return;

  const assignedFields = fields.filter((f) => f.assignedSigner);
  if (assignedFields.length === 0) return;

  const signers = getSigners();
  const payload = {
    documentName,
    pdfBase64: arrayBufferToBase64(originalBytes),
    signers: signers.map((s) => ({ label: s.label, name: s.username, email: s.email })),
    fields: assignedFields.map((f) => {
      const rect = f.getRect();
      return {
        signerLabel: f.assignedSigner.label,
        pageIndex: f.page.pageIndex,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        cssScale: f.page.cssScale,
      };
    }),
  };

  showToast('Enviando documento…');
  btnSend.disabled = true;
  try {
    const res = await fetch('/api/send-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo enviar el documento.');
    showToast(`Enlace de firma enviado a ${data.sentTo} (email)`, true);
  } catch (err) {
    console.error(err);
    showToast(err.message);
  } finally {
    updateSendState();
  }
});

// ---------- Toast ----------
let toastTimer = null;
function showToast(msg, ok = false) {
  toast.textContent = msg;
  toast.classList.toggle('ok', ok);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 2600);
}

// Si ya había sesión de Pablo abierta (recarga de página), aterriza
// directamente en Pendientes en vez de la zona de subida de documentos.
if (!signToken && isInternalRole(getSessionRole())) {
  document.dispatchEvent(new CustomEvent('firma:pending'));
}
