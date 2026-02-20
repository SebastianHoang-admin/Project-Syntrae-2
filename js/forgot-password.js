import { withButtonState } from './supabase-client.js';

const form = document.getElementById('forgot-password-form');
const messageEl = document.getElementById('auth-message');
const submitButton = form.querySelector('button[type="submit"]');
let captchaWidgetId = null;

function showMessage(text, type = 'info') {
  messageEl.textContent = text;
  messageEl.dataset.type = type;
  messageEl.hidden = false;
}

function clearMessage() {
  messageEl.hidden = true;
  messageEl.textContent = '';
  messageEl.removeAttribute('data-type');
}

function ensureCaptchaRendered() {
  if (!window.TURNSTILE_SITE_KEY || window.TURNSTILE_SITE_KEY === 'YOUR_TURNSTILE_SITE_KEY') {
    showMessage('CAPTCHA is not configured yet. Set TURNSTILE_SITE_KEY in js/supabase-config.js.', 'error');
    return false;
  }
  if (!window.turnstile || typeof window.turnstile.render !== 'function') {
    showMessage('CAPTCHA is still loading. Please wait a second and try again.', 'error');
    return false;
  }
  if (captchaWidgetId === null) {
    captchaWidgetId = window.turnstile.render('#turnstile-widget', {
      sitekey: window.TURNSTILE_SITE_KEY
    });
  }
  return true;
}

async function handleSubmit(event) {
  event.preventDefault();
  clearMessage();
  if (!ensureCaptchaRendered()) return;

  const formData = new FormData(form);
  const email = (formData.get('email') || '').trim().toLowerCase();
  const captchaToken = window.turnstile.getResponse(captchaWidgetId);
  if (!captchaToken) {
    showMessage('Please complete the CAPTCHA before requesting reset.', 'error');
    return;
  }

  const response = await withButtonState(submitButton, () => {
    return fetch('/api/password-recovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        captchaToken,
        origin: window.location.origin
      })
    });
  })();

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    showMessage(payload.error || 'Could not request password reset right now.', 'error');
    if (captchaWidgetId !== null && window.turnstile) {
      window.turnstile.reset(captchaWidgetId);
    }
    return;
  }

  // Keep response neutral to avoid account enumeration.
  showMessage('If an account exists for this email, reset instructions have been sent.', 'success');
  if (captchaWidgetId !== null && window.turnstile) {
    window.turnstile.reset(captchaWidgetId);
  }
}

window.addEventListener('load', () => {
  ensureCaptchaRendered();
});

form.addEventListener('submit', handleSubmit);
