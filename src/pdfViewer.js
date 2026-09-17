import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const THUMB_WIDTH = 96;

/**
 * Renderiza todas las páginas del PDF dentro de `stageEl`, una a una.
 * Además genera una miniatura por página (copia escalada del canvas
 * principal, sin volver a pedirle el render a pdf.js).
 * Devuelve un array con metadatos de cada página, incluyendo la escala
 * (px CSS por punto PDF) necesaria para convertir coordenadas al exportar.
 *
 * @param {ArrayBuffer} data  Bytes del PDF.
 * @param {HTMLElement} stageEl  Contenedor donde pintar las páginas grandes.
 * @returns {Promise<Array<{pageIndex:number, wrapEl:HTMLElement, layerEl:HTMLElement, thumbCanvas:HTMLCanvasElement, cssScale:number, widthPt:number, heightPt:number}>>}
 */
export async function renderPdf(data, stageEl) {
  stageEl.innerHTML = '';

  // pdf.js consume (detacha) el ArrayBuffer; le pasamos una copia para
  // conservar el original intacto de cara a pdf-lib al exportar.
  const doc = await pdfjsLib.getDocument({ data: data.slice(0) }).promise;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pages = [];

  // Ancho objetivo del área de páginas (con un máximo legible).
  const targetWidth = Math.min(stageEl.clientWidth || 800, 900);

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);

    // Escala para ajustar la página al ancho disponible.
    const unscaled = page.getViewport({ scale: 1 });
    const cssScale = targetWidth / unscaled.width;
    const viewport = page.getViewport({ scale: cssScale });

    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.style.width = `${viewport.width}px`;
    wrap.style.height = `${viewport.height}px`;

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const ctx = canvas.getContext('2d');
    await page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    }).promise;

    const layer = document.createElement('div');
    layer.className = 'field-layer';
    layer.dataset.pageIndex = String(i - 1);

    wrap.appendChild(canvas);
    wrap.appendChild(layer);
    stageEl.appendChild(wrap);

    // Miniatura: copia escalada del canvas ya renderizado (rápido, sin
    // volver a pedirle el render a pdf.js).
    const thumbHeight = Math.round(THUMB_WIDTH * (viewport.height / viewport.width));
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = THUMB_WIDTH;
    thumbCanvas.height = thumbHeight;
    thumbCanvas
      .getContext('2d')
      .drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, THUMB_WIDTH, thumbHeight);

    pages.push({
      pageIndex: i - 1,
      wrapEl: wrap,
      layerEl: layer,
      thumbCanvas,
      cssScale,
      widthPt: unscaled.width,
      heightPt: unscaled.height,
    });
  }

  return pages;
}
