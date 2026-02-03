import { supabase, withButtonState, redirectIfSignedIn } from './supabase-client.js';

const form = document.getElementById('signup-form');
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

async function handleSignUp(event) {
  event.preventDefault();
  clearMessage();
  const formData = new FormData(form);
  const fullName = formData.get('name');
  const email = formData.get('email');
  const password = formData.get('password');

  const options = {
    data: { full_name: fullName },
    emailRedirectTo: `${window.location.origin}/sign-in.html`
  };

  const result = await withButtonState(submitButton, () => supabase.auth.signUp({ email, password, options }))();

  if (result.error) {
    showMessage(result.error.message, 'error');
    return;
  }

  // If email confirmation is on, session is null; otherwise user is signed in.
  if (!result.data.session) {
    showMessage('Check your email to confirm your account. Once confirmed, you can sign in.', 'success');
  } else {
    showMessage('Account created! Redirecting…', 'success');
    setTimeout(() => { window.location.href = 'Chat.html'; }, 800);
  }
}

redirectIfSignedIn();
form.addEventListener('submit', handleSignUp);
