import { withButtonState, redirectIfSignedIn } from './supabase-client.js';

const form = document.getElementById('signup-form');
const messageEl = document.getElementById('auth-message');
const submitButton = form.querySelector('button[type="submit"]');

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

async function handleSignUp(event) {
  event.preventDefault();
  clearMessage();
  const formData = new FormData(form);
  const payload = {
    fullName: (formData.get('name') || '').trim(),
    email: (formData.get('email') || '').trim().toLowerCase(),
    password: formData.get('password'),
    website: (formData.get('website') || '').trim()
  };

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
    return;
  }

  showMessage('Almost there! Check your email for a verification link. Open it, verify, then return here to sign in.', 'success');
}

redirectIfSignedIn();
form.addEventListener('submit', handleSignUp);
