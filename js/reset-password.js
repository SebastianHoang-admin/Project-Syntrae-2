import { supabase, withButtonState } from './supabase-client.js';

const form = document.getElementById('reset-password-form');
const messageEl = document.getElementById('auth-message');
const submitButton = form.querySelector('button[type="submit"]');
let recoverySessionReady = false;

function showMessage(text, type = 'info') {
  messageEl.textContent = text;
  messageEl.dataset.type = type;
  messageEl.hidden = false;
}

function disableForm(disabled) {
  submitButton.disabled = disabled;
  for (const el of form.querySelectorAll('input')) {
    el.disabled = disabled;
  }
}

function getHashParams() {
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  return new URLSearchParams(raw);
}

async function initializeRecoveryFlow() {
  const queryParams = new URLSearchParams(window.location.search);
  const hashParams = getHashParams();

  const errorMessage = queryParams.get('error_description') || hashParams.get('error_description');
  if (errorMessage) {
    showMessage(errorMessage, 'error');
    disableForm(true);
    return;
  }

  const code = queryParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      showMessage(error.message || 'This reset link is invalid or expired.', 'error');
      disableForm(true);
      return;
    }
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session) {
    showMessage('This reset link is invalid or expired. Request a new password reset email.', 'error');
    disableForm(true);
    return;
  }

  recoverySessionReady = true;
  showMessage('Reset link verified. Enter your new password.', 'info');

  // Remove auth params from URL after session is established.
  window.history.replaceState({}, document.title, window.location.pathname);
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!recoverySessionReady) {
    showMessage('Reset session not ready. Please use the link in your email again.', 'error');
    return;
  }

  const formData = new FormData(form);
  const newPassword = String(formData.get('newPassword') || '');
  const confirmPassword = String(formData.get('confirmPassword') || '');

  if (newPassword.length < 8) {
    showMessage('Password must be at least 8 characters.', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    showMessage('Passwords do not match.', 'error');
    return;
  }

  const result = await withButtonState(submitButton, () => {
    return supabase.auth.updateUser({ password: newPassword });
  })();

  if (result.error) {
    showMessage(result.error.message || 'Could not update password right now.', 'error');
    return;
  }

  showMessage('Password updated. Redirecting to sign in...', 'success');
  await supabase.auth.signOut();
  setTimeout(() => {
    window.location.href = 'sign-in.html?reset=success';
  }, 1000);
}

disableForm(false);
form.addEventListener('submit', handleSubmit);
initializeRecoveryFlow();
