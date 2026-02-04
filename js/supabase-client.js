// Keep client fresh; newer versions fully support publishable keys.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.0/+esm';

const url = window.SUPABASE_URL;
const key = window.SUPABASE_ANON_KEY;

const looksPlaceholder = !key || key === 'YOUR-ANON-KEY' || key.includes('publishable') && key.length < 60 || key.startsWith('sb_publishable') && key.length < 40;

if (!url || !key || url.includes('YOUR-PROJECT') || looksPlaceholder) {
  console.error('[Supabase] Missing or placeholder configuration: update js/supabase-config.js with your project URL and anon (or publishable) key.');
}

export const supabase = createClient(url, key);

// Helper to toggle a loading state on a button.
export function withButtonState(button, fn) {
  return async (...args) => {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Please wait…';
    try {
      return await fn(...args);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  };
}

// Helper to redirect an already authenticated user.
export async function redirectIfSignedIn(target = 'Chat.html') {
  const { data } = await supabase.auth.getSession();
  if (data?.session) {
    window.location.href = target;
  }
}
