import { supabase } from './supabase-client.js';

const form = document.getElementById('profile-form');
const statusEl = document.getElementById('status');
const USER_PROFILE_TABLE = 'user_profiles';

function isMissingTableError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '');
  return code === '42P01' || message.includes('relation') && message.includes('user_profiles');
}

function showStatus(text, type = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.type = type;
  statusEl.hidden = false;
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.textContent = '';
  statusEl.removeAttribute('data-type');
}

async function loadExisting() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    window.location.href = 'sign-in.html';
    return;
  }

  let source = null;
  const { data: profileRow, error: profileError } = await supabase
    .from(USER_PROFILE_TABLE)
    .select('first_name,last_name,occupation,organization,location')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (profileError && !isMissingTableError(profileError)) {
    showStatus(`Could not load saved profile: ${profileError.message || profileError}`, 'error');
  }
  if (!profileError && profileRow) {
    source = profileRow;
  } else {
    source = data.user.user_metadata || {};
  }

  if (source.first_name) form.first_name.value = source.first_name;
  if (source.last_name) form.last_name.value = source.last_name;
  if (source.occupation) form.occupation.value = source.occupation;
  if (source.organization) form.organization.value = source.organization;
  if (source.location) form.location.value = source.location;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearStatus();
  const formData = new FormData(form);
  const payload = {
    first_name: formData.get('first_name')?.trim(),
    last_name: formData.get('last_name')?.trim(),
    occupation: formData.get('occupation')?.trim(),
    organization: formData.get('organization')?.trim(),
    location: formData.get('location')?.trim(),
    profile_completed: true,
  };

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user?.id) {
    showStatus('Session expired. Please sign in again.', 'error');
    return;
  }

  const profilePayload = {
    user_id: userData.user.id,
    first_name: payload.first_name || null,
    last_name: payload.last_name || null,
    occupation: payload.occupation || null,
    organization: payload.organization || null,
    location: payload.location || null,
  };

  const { error: profileError } = await supabase
    .from(USER_PROFILE_TABLE)
    .upsert(profilePayload, { onConflict: 'user_id' });

  if (profileError && !isMissingTableError(profileError)) {
    showStatus(`Could not save profile table: ${profileError.message || profileError}`, 'error');
    return;
  }

  const { error } = await supabase.auth.updateUser({ data: payload });
  if (error) {
    showStatus(error.message, 'error');
    return;
  }
  showStatus('Profile saved! Redirecting…', 'success');
  setTimeout(() => window.location.href = 'Chat.html', 500);
});

document.getElementById('skipBtn').addEventListener('click', async () => {
  clearStatus();
  try {
    await supabase.auth.updateUser({ data: { profile_completed: true } });
  } catch (err) {
    // non-blocking
  }
  window.location.href = 'Chat.html';
});

loadExisting();
