import { supabase, withButtonState, redirectIfSignedIn } from './supabase-client.js';

const form = document.getElementById('email-signin-form');
const messageEl = document.getElementById('auth-message');
const submitButton = form.querySelector('button[type="submit"]');

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

async function handleSignIn(event) {
  event.preventDefault();
  clearMessage();
  const formData = new FormData(form);
  const email = formData.get('email');
  const password = formData.get('password');

  const result = await withButtonState(submitButton, () => supabase.auth.signInWithPassword({ email, password }))();

  if (result.error) {
    showMessage(result.error.message, 'error');
    return;
  }

  showMessage('Signed in! Redirecting…', 'success');
  setTimeout(() => { window.location.href = 'Chat.html'; }, 600);
}

redirectIfSignedIn();
form.addEventListener('submit', handleSignIn);
