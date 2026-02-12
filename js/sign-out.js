import { supabase } from './supabase-client.js';

const titleEl = document.getElementById('status-title');
const messageEl = document.getElementById('status-message');

async function signOut() {
  try {
    titleEl.textContent = 'Signing you out…';
    messageEl.textContent = 'Clearing your session.';

    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    titleEl.textContent = 'You are now signed out';
    messageEl.textContent = 'You can close this tab or sign in with another account.';

    // Small delay so local storage/session finishes clearing before navigation.
    setTimeout(() => {
      window.location.href = 'sign-in.html';
    }, 600);
  } catch (err) {
    titleEl.textContent = 'Sign-out had an issue';
    messageEl.textContent = err.message || 'Please retry.';
  }
}

signOut();
