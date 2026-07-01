import { supabase, withButtonState, redirectIfSignedIn } from './supabase-client.js';

const form = document.getElementById('email-signin-form');
const messageEl = document.getElementById('auth-message');
const submitButton = form.querySelector('button[type="submit"]');
const magicLinkButton = document.getElementById('magic-link-btn');
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

async function handleSignIn(event) {
  event.preventDefault();
  clearMessage();
  const formData = new FormData(form);
  const email = formData.get('email');
  const password = formData.get('password');
  if (!ensureCaptchaRendered()) return;
  const captchaToken = window.turnstile.getResponse(captchaWidgetId);
  if (!captchaToken) {
    showMessage('Please complete the CAPTCHA before signing in.', 'error');
    return;
  }

  const result = await withButtonState(submitButton, () => supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken }
  }))();

  if (result.error) {
    showMessage(result.error.message, 'error');
    if (captchaWidgetId !== null && window.turnstile) {
      window.turnstile.reset(captchaWidgetId);
    }
    return;
  }

  showMessage('Signed in! Redirecting…', 'success');
  setTimeout(() => { window.location.href = 'Chat.html'; }, 600);
}

async function handleMagicLinkSignIn() {
  clearMessage();
  if (!ensureCaptchaRendered()) return;

  const formData = new FormData(form);
  const email = String(formData.get('email') || '').trim().toLowerCase();
  if (!email) {
    showMessage('Please enter your email before requesting a magic link.', 'error');
    return;
  }

  const captchaToken = window.turnstile.getResponse(captchaWidgetId);
  if (!captchaToken) {
    showMessage('Please complete the CAPTCHA before requesting a magic link.', 'error');
    return;
  }

  const emailRedirectTo = `${window.location.origin}/sign-in.html?magic=verified`;
  const result = await withButtonState(magicLinkButton, () => supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo,
      shouldCreateUser: false,
      captchaToken
    }
  }))();

  if (result.error) {
    showMessage(result.error.message, 'error');
    if (captchaWidgetId !== null && window.turnstile) {
      window.turnstile.reset(captchaWidgetId);
    }
    return;
  }

  showMessage('Magic link sent. Check your email and open the link to sign in.', 'success');
  if (captchaWidgetId !== null && window.turnstile) {
    window.turnstile.reset(captchaWidgetId);
  }
}

redirectIfSignedIn();
form.addEventListener('submit', handleSignIn);
if (magicLinkButton) {
  magicLinkButton.addEventListener('click', handleMagicLinkSignIn);
}
window.addEventListener('load', () => {
  ensureCaptchaRendered();
});

// If the verification link redirected here, show a friendly note.
const params = new URLSearchParams(window.location.search);
if (params.get('verified') === 'true') {
  showMessage('Email verified! You can now sign in with your credentials.', 'success');
} else if (params.get('reset') === 'success') {
  showMessage('Password updated. Sign in with your new password.', 'success');
} else if (params.get('signed_out') === 'true') {
  showMessage('You have signed out successfully.', 'success');
} else if (params.get('magic') === 'verified') {
  showMessage('Magic link verified. Redirecting to your account...', 'success');
} else if (params.get('auth') === 'required') {
  showMessage('Sign in to continue to your private decision studio.', 'info');
}
