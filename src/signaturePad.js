import SignaturePad from 'signature_pad';

const modal = document.getElementById('sign-modal');
const canvas = document.getElementById('sign-pad');
const btnClear = document.getElementById('btn-clear');
const btnCancel = document.getElementById('btn-cancel');
const btnConfirm = document.getElementById('btn-confirm');

const colorSwatches = document.querySelectorAll('.color-swatch');
const colorCustom = document.getElementById('color-custom');
const styleButtons = document.querySelectorAll('.style-btn');
const sizeRange = document.getElementById('size-range');

let pad = null;
let resolver = null;

// Preferencias del trazo, persisten entre firmas dentro de la sesión.
let currentColor = '#0a1a3a';
let currentStyle = 'pen'; // 'pen' | 'marker' | 'pencil'
let currentSize = Number(sizeRange.value); // 1..5

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Aplica color/estilo/tamaño actuales al SignaturePad ya creado. */
function applyPenSettings() {
  if (!pad) return;
  let minWidth;
  let maxWidth;
  let penColor = currentColor;

  if (currentStyle === 'marker') {
    // Trazo grueso y constante, sin variación por velocidad.
    minWidth = maxWidth = 1 + currentSize * 1.1;
  } else if (currentStyle === 'pencil') {
    // Trazo fino con textura semitransparente.
    minWidth = 0.3 + currentSize * 0.2;
    maxWidth = 0.7 + currentSize * 0.45;
    penColor = hexToRgba(currentColor, 0.72);
  } else {
    // Pluma: trazo variable según la velocidad, look natural.
    minWidth = 0.5 + currentSize * 0.3;
    maxWidth = 1.1 + currentSize * 0.85;
  }

  pad.minWidth = minWidth;
  pad.maxWidth = maxWidth;
  pad.dotSize = minWidth;
  pad.penColor = penColor;
}

function setColor(hex) {
  currentColor = hex;
  colorCustom.value = hex;
  colorSwatches.forEach((sw) => sw.classList.toggle('active', sw.dataset.color === hex));
  applyPenSettings();
}

function setStyle(style) {
  currentStyle = style;
  styleButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.style === style));
  applyPenSettings();
}

colorSwatches.forEach((sw) => sw.addEventListener('click', () => setColor(sw.dataset.color)));
colorCustom.addEventListener('input', () => {
  colorSwatches.forEach((sw) => sw.classList.remove('active'));
  currentColor = colorCustom.value;
  applyPenSettings();
});
styleButtons.forEach((btn) => btn.addEventListener('click', () => setStyle(btn.dataset.style)));
sizeRange.addEventListener('input', () => {
  currentSize = Number(sizeRange.value);
  applyPenSettings();
});

function resizeCanvas() {
  // Ajusta el lienzo a su tamaño real en pantalla manteniendo nitidez.
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  canvas.getContext('2d').scale(ratio, ratio);
  pad?.clear();
}

const padTools = document.querySelector('.pad-tools');

/**
 * Abre el modal de firma. Resuelve con un dataURL PNG (fondo transparente)
 * o con `null` si el usuario cancela.
 * @param {{simple?: boolean}} [opts]  En modo simple se oculta la barra de
 *   herramientas y se fuerza siempre negro, pluma y tamaño medio (se usa en
 *   el enlace de firma externo, donde no se permite elegir nada).
 * @returns {Promise<string|null>}
 */
export function openSignaturePad(opts = {}) {
  modal.hidden = false;
  padTools.hidden = Boolean(opts.simple);

  if (!pad) {
    pad = new SignaturePad(canvas, { backgroundColor: 'rgba(0,0,0,0)' });

    btnClear.addEventListener('click', () => pad.clear());
    btnCancel.addEventListener('click', () => close(null));
    btnConfirm.addEventListener('click', () => {
      if (pad.isEmpty()) {
        canvas.animate(
          [{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
          { duration: 150, iterations: 2 }
        );
        return;
      }
      close(pad.toDataURL('image/png'));
    });
  }

  if (opts.simple) {
    currentColor = '#000000';
    currentStyle = 'pen';
    currentSize = 2;
  }
  applyPenSettings();

  // El canvas debe ser visible para medirlo correctamente.
  requestAnimationFrame(() => {
    resizeCanvas();
    pad.clear();
  });

  return new Promise((resolve) => {
    resolver = resolve;
  });
}

function close(result) {
  modal.hidden = true;
  const r = resolver;
  resolver = null;
  r?.(result);
}

window.addEventListener('resize', () => {
  if (!modal.hidden) resizeCanvas();
});
