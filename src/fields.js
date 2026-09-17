let idCounter = 0;

/**
 * Un campo de firma colocado sobre una página: rectángulo ajustable que se
 * asigna a uno de los firmantes del documento. La geometría vive en el
 * propio DOM (left/top/width/height en px CSS relativos a la capa de la
 * página).
 */
export class SignatureField {
  /**
   * @param {object} page  Metadatos de la página (de renderPdf).
   * @param {number} x  Posición X en px CSS dentro de la capa.
   * @param {number} y  Posición Y en px CSS dentro de la capa.
   * @param {number} w  Ancho en px CSS.
   * @param {number} h  Alto en px CSS.
   * @param {object} handlers  { onAssignRequest(field), onRemove(field) }
   */
  constructor(page, x, y, w, h, handlers) {
    this.id = ++idCounter;
    this.page = page;
    this.handlers = handlers;
    this.assignedSigner = null;

    const el = document.createElement('div');
    el.className = 'sig-field';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.innerHTML = `
      <span class="label">Sin asignar · clic para asignar firmante</span>
      <button class="remove" title="Eliminar">×</button>
      <div class="handle"></div>
    `;
    this.el = el;
    page.layerEl.appendChild(el);

    this._wireInteractions();
  }

  _wireInteractions() {
    const el = this.el;
    const handle = el.querySelector('.handle');
    const removeBtn = el.querySelector('.remove');

    removeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.remove();
      this.handlers.onRemove?.(this);
    });

    // Pedir firma al hacer clic en el cuerpo (no al arrastrar).
    let dragged = false;

    // --- Mover ---
    el.addEventListener('pointerdown', (e) => {
      if (e.target === handle || e.target === removeBtn) return;
      e.preventDefault();
      dragged = false;
      el.setPointerCapture(e.pointerId);
      const layerRect = this.page.layerEl.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const origLeft = el.offsetLeft;
      const origTop = el.offsetTop;

      const move = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragged = true;
        let nl = origLeft + dx;
        let nt = origTop + dy;
        nl = Math.max(0, Math.min(nl, layerRect.width - el.offsetWidth));
        nt = Math.max(0, Math.min(nt, layerRect.height - el.offsetHeight));
        el.style.left = `${nl}px`;
        el.style.top = `${nt}px`;
      };
      const up = (ev) => {
        el.releasePointerCapture(e.pointerId);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        if (!dragged) this.handlers.onAssignRequest?.(this);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });

    // --- Redimensionar ---
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const layerRect = this.page.layerEl.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const origW = el.offsetWidth;
      const origH = el.offsetHeight;

      const move = (ev) => {
        let nw = origW + (ev.clientX - startX);
        let nh = origH + (ev.clientY - startY);
        nw = Math.max(40, Math.min(nw, layerRect.width - el.offsetLeft));
        nh = Math.max(24, Math.min(nh, layerRect.height - el.offsetTop));
        el.style.width = `${nw}px`;
        el.style.height = `${nh}px`;
      };
      const up = () => {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  /** Asigna el campo a un firmante (no dibuja nada todavía: eso llega después). */
  setAssignedSigner(signer) {
    this.assignedSigner = signer;
    this.el.classList.add('assigned');
    const label = this.el.querySelector('.label');
    if (label) label.remove();

    let badge = this.el.querySelector('.assigned-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'assigned-badge';
      this.el.insertBefore(badge, this.el.querySelector('.handle'));
    }
    badge.innerHTML = `
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
      <span>${signer.label}</span>
    `;
  }

  /** Geometría actual en px CSS relativa a la capa de la página. */
  getRect() {
    return {
      x: this.el.offsetLeft,
      y: this.el.offsetTop,
      w: this.el.offsetWidth,
      h: this.el.offsetHeight,
    };
  }

  remove() {
    this.el.remove();
  }
}
