import { supabase, withButtonState, redirectIfSignedIn } from './supabase-client.js';

const form = document.getElementById('signup-form');
const messageEl = document.getElementById('auth-message');
const submitButton = form.querySelector('button[type="submit"]');
const nameInput = document.getElementById('name');
const emailInput = document.getElementById('email');
const params = new URLSearchParams(window.location.search);
const isVerifiedWaitlistSignup = params.get('waitlist') === 'verified';
const redirectTarget = params.get('next') || (isVerifiedWaitlistSignup ? 'founding-welcome.html?verified=true' : 'Chat.html');
let captchaWidgetId = null;

function showMessage(text, type = 'info', asHtml = false) {
  if (asHtml) {
    messageEl.innerHTML = text;
  } else {
    messageEl.textContent = text;
  }
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

async function handleSignUp(event) {
  event.preventDefault();
  clearMessage();
  const formData = new FormData(form);
  const payload = {
    fullName: (formData.get('name') || '').trim(),
    email: (formData.get('email') || '').trim().toLowerCase(),
    password: formData.get('password'),
    website: (formData.get('website') || '').trim(),
    waitlistVerified: isVerifiedWaitlistSignup,
    captchaToken: ''
  };

  if (!ensureCaptchaRendered()) return;
  payload.captchaToken = window.turnstile.getResponse(captchaWidgetId);
  if (!payload.captchaToken) {
    showMessage('Please complete the CAPTCHA before signing up.', 'error');
    return;
  }

  const response = await withButtonState(submitButton, async () => {
    return fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  })();

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 409 || body.code === 'email_exists') {
      const html = 'There is an account associated with this email already, please <a href="sign-in.html" style="color:inherit;text-decoration:underline;">sign in</a>.';
      showMessage(html, 'error', true);
      return;
    }
    if (body.error === 'Server auth configuration missing' && Array.isArray(body.missing) && body.missing.length > 0) {
      showMessage(`${body.error}: ${body.missing.join(', ')}`, 'error');
      return;
    }
    showMessage(body.error || 'Sign-up failed. Please try again.', 'error');
    if (captchaWidgetId !== null && window.turnstile) {
      window.turnstile.reset(captchaWidgetId);
    }
    return;
  }

  if (body.autoSignIn) {
    const result = await supabase.auth.signInWithPassword({
      email: payload.email,
      password: payload.password,
      options: { captchaToken: payload.captchaToken }
    });

    if (result.error) {
      const html = 'Your account was created. Please <a href="sign-in.html" style="color:inherit;text-decoration:underline;">sign in</a> to continue.';
      showMessage(html, 'success', true);
      if (captchaWidgetId !== null && window.turnstile) {
        window.turnstile.reset(captchaWidgetId);
      }
      return;
    }

    showMessage('Account ready. Redirecting...', 'success');
    window.location.href = body.redirectTo || redirectTarget;
    return;
  }

  if (body.requiresEmailConfirmation) {
    showMessage('Almost there! Check your email for a verification link. Open it, verify, then return here to sign in.', 'success');
    return;
  }

  showMessage('Account ready. Redirecting...', 'success');
  window.location.href = body.redirectTo || redirectTarget;
}

window.addEventListener('load', () => {
  ensureCaptchaRendered();
});

if (isVerifiedWaitlistSignup) {
  const verifiedEmail = String(params.get('email') || '').trim().toLowerCase();
  const verifiedName = String(params.get('name') || '').trim();
  if (verifiedEmail && emailInput) {
    emailInput.value = verifiedEmail;
    emailInput.readOnly = true;
  }
  if (verifiedName && nameInput && !nameInput.value) {
    nameInput.value = verifiedName;
  }
  showMessage('Email confirmed. Create your Syntrae account to finish joining the founding circle.', 'success');
}

if (!isVerifiedWaitlistSignup) {
  redirectIfSignedIn(redirectTarget);
}
form.addEventListener('submit', handleSignUp);
