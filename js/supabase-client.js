import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.1/+esm';

const url = window.SUPABASE_URL;
const key = window.SUPABASE_ANON_KEY;

if (!url || !key || url.includes('YOUR-PROJECT') || key === 'YOUR-ANON-KEY') {
  console.error('[Supabase] Missing configuration: update js/supabase-config.js with your project URL and anon key.');
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
