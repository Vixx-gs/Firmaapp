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
 * Muestra el paso de verificación OTP antes de permitir la firma.
 * Devuelve el otpSessionToken si se verifica correctamente, o null si el
 * firmante cancela o hay error irrecuperable.
 */
async function runOtpStep(token, email, signView, statusText) {
  return new Promise((resolve) => {
    signView.hidden = false;

    // Construir UI del OTP dentro de .login-card
    const card = signView.querySelector('.login-card');
    card.innerHTML = `
      <img src="/logo.png" alt="Firma" class="logo login-logo" />
      <h1>Verifica tu identidad</h1>
      <p class="login-sub">Para garantizar la validez legal de tu firma, necesitamos verificar que eres tú.</p>
      <div id="otp-step-send">
        <p class="login-sub" style="margin-top:0">Te enviaremos un código de 6 dígitos a:<br><strong>${email}</strong></p>
        <button id="otp-btn-send" class="select-btn login-submit" type="button">Enviar código</button>
        <p id="otp-send-error" class="login-error" hidden></p>
      </div>
      <div id="otp-step-verify" hidden>
        <p class="login-sub" style="margin-top:0">Introduce el código que has recibido en <strong>${email}</strong></p>
        <div class="otp-inputs" id="otp-inputs">
          <input class="otp-digit" maxlength="1" inputmode="numeric" pattern="[0-9]" autocomplete="one-time-code" />
          <input class="otp-digit" maxlength="1" inputmode="numeric" pattern="[0-9]" />
          <input class="otp-digit" maxlength="1" inputmode="numeric" pattern="[0-9]" />
          <input class="otp-digit" maxlength="1" inputmode="numeric" pattern="[0-9]" />
          <input class="otp-digit" maxlength="1" inputmode="numeric" pattern="[0-9]" />
          <input class="otp-digit" maxlength="1" inputmode="numeric" pattern="[0-9]" />
        </div>
        <p id="otp-verify-error" class="login-error" hidden></p>
        <button id="otp-btn-verify" class="select-btn login-submit" type="button" disabled>Verificar</button>
        <button id="otp-btn-resend" class="btn btn-light" type="button" style="width:100%;margin-top:10px">Reenviar código</button>
      </div>
    `;

    const stepSend = card.querySelector('#otp-step-send');
    const stepVerify = card.querySelector('#otp-step-verify');
    const btnSend = card.querySelector('#otp-btn-send');
    const sendError = card.querySelector('#otp-send-error');
    const digits = card.querySelectorAll('.otp-digit');
    const btnVerify = card.querySelector('#otp-btn-verify');
    const verifyError = card.querySelector('#otp-verify-error');
    const btnResend = card.querySelector('#otp-btn-resend');

    // Navegación entre dígitos OTP
    digits.forEach((input, i) => {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(-1);
        if (input.value && i < digits.length - 1) digits[i + 1].focus();
        const code = Array.from(digits).map((d) => d.value).join('');
        btnVerify.disabled = code.length < 6;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && i > 0) digits[i - 1].focus();
      });
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
        [...pasted].forEach((ch, j) => { if (digits[j]) digits[j].value = ch; });
        const filled = Math.min(pasted.length, digits.length) - 1;
        if (digits[filled]) digits[filled].focus();
        btnVerify.disabled = pasted.length < 6;
      });
    });

    async function sendOtp() {
      btnSend.disabled = true;
      btnSend.textContent = 'Enviando…';
      sendError.hidden = true;
      try {
        const res = await fetch(`/api/sign/${token}/request-otp`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo enviar el código.');
        stepSend.hidden = true;
        stepVerify.hidden = false;
        digits[0].focus();
      } catch (err) {
        sendError.textContent = err.message;
        sendError.hidden = false;
        btnSend.disabled = false;
        btnSend.textContent = 'Enviar código';
      }
    }

    async function verifyOtp() {
      const code = Array.from(digits).map((d) => d.value).join('');
      if (code.length < 6) return;
      btnVerify.disabled = true;
      btnVerify.textContent = 'Verificando…';
      verifyError.hidden = true;
      try {
        const res = await fetch(`/api/sign/${token}/verify-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Código incorrecto.');
        resolve(data.otpSessionToken);
      } catch (err) {
        verifyError.textContent = err.message;
        verifyError.hidden = false;
        digits.forEach((d) => (d.value = ''));
        digits[0].focus();
        btnVerify.disabled = true;
        btnVerify.textContent = 'Verificar';
      }
    }

    btnSend.addEventListener('click', sendOtp);
    btnVerify.addEventListener('click', verifyOtp);
    btnResend.addEventListener('click', () => {
      stepVerify.hidden = true;
      stepSend.hidden = false;
      btnSend.disabled = false;
      btnSend.textContent = 'Reenviar código';
      sendOtp();
    });
  });
}

/**
 * Sustituye por completo el arranque normal de la app: sin login, sin
 * subida de documentos. Solo muestra el campo asignado al firmante del
 * enlace para que lo firme.
 */
export async function startSignFlow(token) {
  const signView = document.getElementById('sign-view');
  const statusText = document.getElementById('sign-status-text');
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

  // ── Paso 1: verificación OTP ────────────────────────────────────────────
  let otpSessionToken = null;
  if (data.signerEmail) {
    otpSessionToken = await runOtpStep(token, data.signerEmail, signView, statusText);
  }

  // ── Paso 2: mostrar documento y campo de firma ──────────────────────────
  const card = signView.querySelector('.login-card');
  // Restaurar contenido original del sign-view (por si runOtpStep lo modificó)
  card.innerHTML = `
    <img src="/logo.png" alt="Firma" class="logo login-logo" />
    <h1>Firma electrónica</h1>
    <p id="sign-status-text" class="login-sub">Cargando documento…</p>
  `;

  signView.hidden = true;
  signActive.hidden = false;
  docNameEl.textContent = data.documentName;
  signerLabelEl.textContent = `Casilla asignada a ${data.signerLabel}`;

  const pages = await renderPdf(base64ToArrayBuffer(data.pdfBase64), signStage);
  const targetPage = pages[data.field.pageIndex];

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
        body: JSON.stringify({ signatureDataUrl, otpSessionToken }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Error al firmar.');

      signActive.hidden = true;
      signView.hidden = false;

      if (sessionStorage.getItem('firma_auth') === '1') {
        card.querySelector('#sign-status-text') && (card.querySelector('#sign-status-text').textContent = 'Firma enviada correctamente. Volviendo a Pendientes…');
        setTimeout(() => { window.location.href = '/'; }, 1200);
      } else {
        const st = document.getElementById('sign-status-text');
        if (st) st.textContent = 'Firma enviada correctamente. Ya puedes cerrar esta ventana.';
      }
    } catch (err) {
      btnConfirm.disabled = false;
      btnConfirm.textContent = 'Firmar';
      showToast(err.message);
    }
  });
}
