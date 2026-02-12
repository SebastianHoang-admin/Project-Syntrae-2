import { supabase } from './supabase-client.js';

const form = document.getElementById('profile-form');
const statusEl = document.getElementById('status');

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
  const meta = data.user.user_metadata || {};
  if (meta.first_name) form.first_name.value = meta.first_name;
  if (meta.last_name) form.last_name.value = meta.last_name;
  if (meta.occupation) form.occupation.value = meta.occupation;
  if (meta.organization) form.organization.value = meta.organization;
  if (meta.location) form.location.value = meta.location;
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
