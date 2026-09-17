import { getSigners } from './signers.js';

const picker = document.getElementById('signer-picker');

let resolver = null;
let outsideHandler = null;
let keyHandler = null;

function cleanupListeners() {
  if (outsideHandler) document.removeEventListener('pointerdown', outsideHandler, true);
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  outsideHandler = null;
  keyHandler = null;
}

function close(result) {
  picker.hidden = true;
  cleanupListeners();
  const r = resolver;
  resolver = null;
  r?.(result);
}

/**
 * Abre un selector con los firmantes confirmados (con email guardado)
 * anclado junto al campo `anchorEl`. Resuelve con el firmante elegido, o
 * `null` si se cierra sin elegir.
 * @param {HTMLElement} anchorEl
 * @returns {Promise<{id:number, label:string}|null>}
 */
export function openSignerPicker(anchorEl) {
  const confirmedSigners = getSigners().filter((s) => s.email);
  picker.innerHTML = '';

  if (confirmedSigners.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'signer-picker-empty';
    empty.textContent = 'Añade y confirma firmantes arriba antes de asignar este campo.';
    picker.appendChild(empty);
  } else {
    confirmedSigners.forEach((signer) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'signer-picker-item';
      item.textContent = signer.label;
      item.addEventListener('click', () => close(signer));
      picker.appendChild(item);
    });
  }

  const rect = anchorEl.getBoundingClientRect();
  const top = Math.min(rect.bottom + 8, window.innerHeight - 16);
  const left = Math.min(rect.left, window.innerWidth - 240);
  picker.style.top = `${Math.max(8, top)}px`;
  picker.style.left = `${Math.max(8, left)}px`;
  picker.hidden = false;

  outsideHandler = (e) => {
    if (!picker.contains(e.target) && !anchorEl.contains(e.target)) close(null);
  };
  keyHandler = (e) => {
    if (e.key === 'Escape') close(null);
  };
  // Se enganchan en el siguiente tick para no cerrar con el mismo clic que abrió el selector.
  setTimeout(() => {
    document.addEventListener('pointerdown', outsideHandler, true);
    document.addEventListener('keydown', keyHandler);
  }, 0);

  return new Promise((resolve) => {
    resolver = resolve;
  });
}
