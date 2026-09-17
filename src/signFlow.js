import { renderPdf } from './pdfViewer.js';
import { openSignaturePad } from './signaturePad.js';

const toast = document.getElementById('toast');
let toastTimer = null;
function showToast(msg, ok = false) {
  toast.textContent = msg;
  toast.classList.toggle('ok', ok);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 2600);
}

function base64ToArrayBuffer(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** @returns {string|null} el token `?sign=...` de la URL, si lo hay. */
export function getSignToken() {
  return new URLSearchParams(window.location.search).get('sign');
}

/**
 * Sustituye por completo el arranque normal de la app: sin login, sin
 * subida de documentos. Solo muestra el campo asignado al firmante del
 * enlace para que lo firme.
 */
export async function startSignFlow(token) {
  const signView = document.getElementById('sign-view');
  const statusText = document.getElementById('sign-status-text');
  const signNameView = document.getElementById('sign-name-view');
  const signNameForm = document.getElementById('sign-name-form');
  const signNameInput = document.getElementById('sign-name-input');
  const signNameEmail = document.getElementById('sign-name-email');
  const signNameError = document.getElementById('sign-name-error');
  const signActive = document.getElementById('sign-active');
  const signStage = document.getElementById('sign-stage');
  const docNameEl = document.getElementById('sign-doc-name');
  const signerLabelEl = document.getElementById('sign-signer-label');
  const btnConfirm = document.getElementById('btn-sign-confirm');

  signView.hidden = false;

  let data;
  try {
    const res = await fetch(`/api/sign/${token}`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Enlace no válido.');
  } catch (err) {
    statusText.textContent = err.message;
    return;
  }

  if (data.alreadySigned) {
    statusText.textContent = 'Ya has firmado este documento. ¡Gracias!';
    return;
  }

  // Si aún no sabemos el nombre del firmante, se lo pedimos antes de nada
  // (el email ya se conoce, lo puso el admin al añadirlo como firmante).
  if (!data.signerName) {
    signView.hidden = true;
    signNameView.hidden = false;
    signNameEmail.value = data.signerEmail || '';

    await new Promise((resolve) => {
      signNameForm.addEventListener('submit', async function onSubmit(e) {
        e.preventDefault();
        const name = signNameInput.value.trim();
        if (!name) {
          signNameError.hidden = false;
          return;
        }
        signNameError.hidden = true;
        const submitBtn = signNameForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        try {
          const res = await fetch(`/api/sign/${token}/name`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          });
          const result = await res.json();
          if (!res.ok) throw new Error(result.error || 'No se pudo guardar el nombre.');
          signNameForm.removeEventListener('submit', onSubmit);
          signNameView.hidden = true;
          resolve();
        } catch (err) {
          submitBtn.disabled = false;
          showToast(err.message);
        }
      });
    });
  }

  signView.hidden = true;
  signActive.hidden = false;
  docNameEl.textContent = data.documentName;
  signerLabelEl.textContent = `Casilla asignada a ${data.signerLabel}`;

  const pages = await renderPdf(base64ToArrayBuffer(data.pdfBase64), signStage);
  const targetPage = pages[data.field.pageIndex];
  pages.forEach((p, i) => {
    p.wrapEl.hidden = i !== data.field.pageIndex;
  });

  // Convierte la geometría guardada (capturada con la escala del admin) a
  // la escala con la que se ha renderizado la página en este dispositivo.
  const scaleRatio = targetPage.cssScale / data.field.cssScale;
  const box = document.createElement('div');
  box.className = 'sig-field sign-target';
  box.style.left = `${data.field.x * scaleRatio}px`;
  box.style.top = `${data.field.y * scaleRatio}px`;
  box.style.width = `${data.field.w * scaleRatio}px`;
  box.style.height = `${data.field.h * scaleRatio}px`;
  box.innerHTML = '<span class="label">Pulsa aquí para firmar</span>';
  targetPage.layerEl.appendChild(box);

  let signatureDataUrl = null;

  box.addEventListener('click', async () => {
    const dataUrl = await openSignaturePad({ simple: true });
    if (!dataUrl) return;
    signatureDataUrl = dataUrl;
    box.classList.add('signed');
    const label = box.querySelector('.label');
    if (label) label.remove();
    let img = box.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      box.appendChild(img);
    }
    img.src = dataUrl;
    btnConfirm.disabled = false;
  });

  btnConfirm.addEventListener('click', async () => {
    if (!signatureDataUrl) return;
    btnConfirm.disabled = true;
    btnConfirm.textContent = 'Enviando…';
    try {
      const res = await fetch(`/api/sign/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureDataUrl }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Error al firmar.');

      signActive.hidden = true;
      signView.hidden = false;
      statusText.textContent = 'Firma enviada correctamente. Ya puedes cerrar esta ventana.';
    } catch (err) {
      btnConfirm.disabled = false;
      btnConfirm.textContent = 'Firmar';
      showToast(err.message);
    }
  });
}
