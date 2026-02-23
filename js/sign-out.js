import { supabase } from './supabase-client.js';

const titleEl = document.getElementById('status-title');
const messageEl = document.getElementById('status-message');
const PROJECT_REF = (() => {
  try {
    const host = new URL(window.SUPABASE_URL || '').hostname;
    return host.split('.')[0] || '';
  } catch (_) {
    return '';
  }
})();

function isMissingSessionError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('session missing') || msg.includes('session_not_found');
}

function clearAuthStorage() {
  const shouldRemove = (key) => {
    if (!key) return false;
    if (key === 'supabase.auth.token') return true;
    const lowerKey = key.toLowerCase();
    if (!lowerKey.startsWith('sb-')) return false;
    if (!lowerKey.includes('auth-token')) return false;
    return !PROJECT_REF || lowerKey.includes(PROJECT_REF.toLowerCase());
  };
  const shouldRemovePersona = (key) => {
    if (!key) return false;
    return key === 'persona-name'
      || key === 'active-persona-key'
      || key === 'persona-portrait'
      || key === 'persona-avatar-present'
      || key === 'persona-answers'
      || key === 'persona-visible-session'
      || key === 'users-input'
      || key.startsWith('identity-layer-')
      || key.startsWith('extra-');
  };

  for (const key of Object.keys(localStorage)) {
    if (shouldRemove(key) || shouldRemovePersona(key)) localStorage.removeItem(key);
  }
  for (const key of Object.keys(sessionStorage)) {
    if (shouldRemove(key) || shouldRemovePersona(key)) sessionStorage.removeItem(key);
  }
}

async function signOut() {
  try {
    titleEl.textContent = 'Signing you out…';
    messageEl.textContent = 'Clearing your session.';

    const { error: globalError } = await supabase.auth.signOut({ scope: 'global' });
    if (globalError && !isMissingSessionError(globalError)) {
      throw globalError;
    }

    // Always force local sign-out as a fallback for stale browser storage.
    const { error: localError } = await supabase.auth.signOut({ scope: 'local' });
    if (localError && !isMissingSessionError(localError)) {
      throw localError;
    }

    clearAuthStorage();

    titleEl.textContent = 'You are now signed out';
    messageEl.textContent = 'You can close this tab or sign in with another account.';

    // Small delay so storage/session cleanup finishes before navigation.
    setTimeout(() => {
      window.location.href = 'sign-in.html?signed_out=true';
    }, 600);
  } catch (err) {
    // If remote sign-out fails, still clear local session and continue.
    clearAuthStorage();
    titleEl.textContent = 'Signed out on this browser';
    messageEl.textContent = 'Your local session was cleared. Redirecting to sign in...';
    setTimeout(() => {
      window.location.href = 'sign-in.html?signed_out=true';
    }, 800);
    console.error('Sign-out warning:', err);
  }
}

signOut();
