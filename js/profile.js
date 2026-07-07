import { supabase } from './supabase-client.js';

const form = document.getElementById('profile-form');
const statusEl = document.getElementById('status');
const primaryPersonaSelect = document.getElementById('primary_persona_key');
const USER_PROFILE_TABLE = 'user_profiles';
const PERSONA_TABLE = 'personas';
const DECISION_TREE_DEMO = 'decision-tree';

let currentUserId = '';
let personaRows = [];

const PERSONA_FIELDS = Object.freeze([
  'display_name',
  'personal_headline',
  'goals',
  'strengths',
  'constraints',
  'communication_style',
  'primary_persona_key'
]);

function isMissingTableError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '');
  return code === '42P01' || message.includes('relation') && message.includes('user_profiles');
}

function sanitizePersonaKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  const cleaned = normalized.replace(/[^a-z0-9_-]/g, '');
  return cleaned || '';
}

function showStatus(text, type = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.type = type;
  statusEl.hidden = false;
}

function isDecisionTreeDemo() {
  const params = new URLSearchParams(window.location.search || '');
  return params.get('demo') === DECISION_TREE_DEMO;
}

function demoUrl(path, params = {}) {
  const url = new URL(path, window.location.href);
  url.searchParams.set('demo', DECISION_TREE_DEMO);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return `${url.pathname.split('/').pop()}?${url.searchParams.toString()}`;
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.textContent = '';
  statusEl.removeAttribute('data-type');
}

function fullName(first, last) {
  return `${String(first || '').trim()} ${String(last || '').trim()}`.trim();
}

function setInputValue(name, value) {
  if (!form[name]) return;
  form[name].value = String(value || '');
}

function getInputValue(name) {
  return String(form[name]?.value || '').trim();
}

function hydratePersonaFields(profileJson = {}) {
  PERSONA_FIELDS.forEach((field) => {
    if (!form[field]) return;
    setInputValue(field, profileJson?.[field] || '');
  });
}

function buildUserPersonaProfile(payload) {
  const qualitativeData = {
    personal_headline: payload.personal_headline || '',
    goals: payload.goals || '',
    strengths: payload.strengths || '',
    constraints: payload.constraints || '',
    communication_style: payload.communication_style || ''
  };

  return {
    version: '2.0.0',
    display_name: payload.display_name || fullName(payload.first_name, payload.last_name),
    personal_headline: qualitativeData.personal_headline,
    goals: qualitativeData.goals,
    strengths: qualitativeData.strengths,
    constraints: qualitativeData.constraints,
    communication_style: qualitativeData.communication_style,
    primary_persona_key: sanitizePersonaKey(payload.primary_persona_key),
    quantitative_data: {
      trait_vector: {}
    },
    qualitative_data: qualitativeData,
    data_split: {
      quantitative_fields: ['trait_vector'],
      qualitative_fields: ['personal_headline', 'goals', 'strengths', 'constraints', 'communication_style']
    },
    core_profile: {
      first_name: payload.first_name || '',
      last_name: payload.last_name || '',
      occupation: payload.occupation || '',
      organization: payload.organization || '',
      location: payload.location || ''
    },
    updated_at: new Date().toISOString()
  };
}

function renderPrimaryPersonaOptions(selectedKey = '') {
  if (!primaryPersonaSelect) return;
  const normalizedSelected = sanitizePersonaKey(selectedKey);
  primaryPersonaSelect.innerHTML = '';

  const baseOption = document.createElement('option');
  baseOption.value = '';
  baseOption.textContent = 'No linked persona';
  primaryPersonaSelect.appendChild(baseOption);

  personaRows.forEach((row) => {
    const key = sanitizePersonaKey(row?.persona_key || '');
    if (!key) return;
    const option = document.createElement('option');
    option.value = key;
    option.textContent = row?.name ? `${row.name} (${key})` : key;
    primaryPersonaSelect.appendChild(option);
  });

  if (normalizedSelected && !personaRows.some((row) => sanitizePersonaKey(row?.persona_key) === normalizedSelected)) {
    const missing = document.createElement('option');
    missing.value = normalizedSelected;
    missing.textContent = `${normalizedSelected} (not found)`;
    primaryPersonaSelect.appendChild(missing);
  }

  primaryPersonaSelect.value = normalizedSelected || '';
}

async function loadPersonas(userId) {
  const { data, error } = await supabase
    .from(PERSONA_TABLE)
    .select('persona_key,name,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('Could not load personas for user persona page:', error.message || error);
    personaRows = [];
    renderPrimaryPersonaOptions('');
    return;
  }
  personaRows = Array.isArray(data) ? data : [];
}

async function loadExisting() {
  if (isDecisionTreeDemo()) {
    loadDemoProfile();
    return;
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    window.location.href = 'sign-in.html?auth=required';
    return;
  }
  currentUserId = data.user.id;
  await loadPersonas(currentUserId);

  let source = null;
  let profileJson = {};
  const { data: profileRow, error: profileError } = await supabase
    .from(USER_PROFILE_TABLE)
    .select('first_name,last_name,occupation,organization,location,profile')
    .eq('user_id', currentUserId)
    .maybeSingle();

  if (profileError && !isMissingTableError(profileError)) {
    showStatus(`Could not load saved profile: ${profileError.message || profileError}`, 'error');
  }

  if (!profileError && profileRow) {
    source = profileRow;
    profileJson = profileRow.profile && typeof profileRow.profile === 'object' ? profileRow.profile : {};
  } else {
    source = data.user.user_metadata || {};
    profileJson = source.user_persona && typeof source.user_persona === 'object' ? source.user_persona : {};
  }

  setInputValue('first_name', source.first_name);
  setInputValue('last_name', source.last_name);
  setInputValue('occupation', source.occupation);
  setInputValue('organization', source.organization);
  setInputValue('location', source.location);
  hydratePersonaFields(profileJson);
  renderPrimaryPersonaOptions(profileJson.primary_persona_key || '');
}

function loadDemoProfile() {
  document.body.classList.add('demo-mode');
  document.title = 'Maya Chen Persona - Syntrae Demo';
  personaRows = [{ persona_key: 'daniel-smith-demo', name: 'Daniel Smith' }];

  setInputValue('first_name', 'Maya');
  setInputValue('last_name', 'Chen');
  setInputValue('occupation', 'Student');
  setInputValue('organization', 'San Francisco State University');
  setInputValue('location', 'San Francisco, CA');
  setInputValue('display_name', 'Maya Chen');
  setInputValue('personal_headline', '22-year-old student who wants clarity while staying kind and low pressure');
  setInputValue('goals', 'Invite Daniel into a deeper conversation about where the relationship is going while keeping the message warm, respectful, and easy to answer honestly.');
  setInputValue('strengths', 'Maya notices tone, timing, and emotional detail. She is patient, sincere, and willing to communicate clearly when the moment matters.');
  setInputValue('constraints', 'She has one real-world conversation to initiate and wants to avoid making Daniel feel cornered, rushed, or responsible for her anxiety.');
  setInputValue('communication_style', 'Warm, reflective, considerate, and direct when clarity is important. Maya prefers invitations, plain language, and room for the other person to respond.');
  renderPrimaryPersonaOptions('daniel-smith-demo');

  const titleRow = document.querySelector('.title-row');
  if (titleRow && !document.querySelector('.demo-video-strip')) {
    titleRow.insertAdjacentHTML('afterend', `
      <section class="demo-video-strip" aria-label="Demo profile context">
        <div class="demo-profile-intro">
          <img class="demo-profile-avatar" src="assets/maya-chen-avatar.png" alt="Maya Chen avatar">
          <div>
            <h3>Maya Chen profile</h3>
            <p>This page shows Maya's private context for choosing a considerate next step with Daniel.</p>
          </div>
        </div>
        <div class="demo-chip-row">
          <span class="demo-chip">Student</span>
          <span class="demo-chip">Female</span>
          <span class="demo-chip">22 yrs old</span>
        </div>
      </section>
    `);
  }

  const brand = document.querySelector('.brand');
  if (brand) brand.setAttribute('href', demoUrl('Chat.html', { state: 'start' }));
  const skipBtn = document.getElementById('skipBtn');
  if (skipBtn) skipBtn.textContent = 'Back to demo chat';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearStatus();

  if (isDecisionTreeDemo()) {
    showStatus('Demo profile ready. Returning to the Best Way scene...', 'success');
    setTimeout(() => window.location.href = demoUrl('Chat.html', { state: 'start' }), 550);
    return;
  }

  const payload = {
    first_name: getInputValue('first_name'),
    last_name: getInputValue('last_name'),
    occupation: getInputValue('occupation'),
    organization: getInputValue('organization'),
    location: getInputValue('location'),
    display_name: getInputValue('display_name'),
    personal_headline: getInputValue('personal_headline'),
    goals: getInputValue('goals'),
    strengths: getInputValue('strengths'),
    constraints: getInputValue('constraints'),
    communication_style: getInputValue('communication_style'),
    primary_persona_key: sanitizePersonaKey(getInputValue('primary_persona_key')),
    profile_completed: true
  };

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user?.id) {
    showStatus('Session expired. Please sign in again.', 'error');
    return;
  }

  const profileJson = buildUserPersonaProfile(payload);
  const profilePayload = {
    user_id: userData.user.id,
    first_name: payload.first_name || null,
    last_name: payload.last_name || null,
    occupation: payload.occupation || null,
    organization: payload.organization || null,
    location: payload.location || null,
    profile: profileJson
  };

  const { error: profileError } = await supabase
    .from(USER_PROFILE_TABLE)
    .upsert(profilePayload, { onConflict: 'user_id' });

  if (profileError && !isMissingTableError(profileError)) {
    showStatus(`Could not save user persona: ${profileError.message || profileError}`, 'error');
    return;
  }

  const authMetadata = {
    first_name: payload.first_name || '',
    last_name: payload.last_name || '',
    occupation: payload.occupation || '',
    organization: payload.organization || '',
    location: payload.location || '',
    profile_completed: true,
    user_persona: profileJson
  };

  const { error } = await supabase.auth.updateUser({ data: authMetadata });
  if (error) {
    showStatus(error.message, 'error');
    return;
  }

  showStatus('User persona saved. Redirecting…', 'success');
  setTimeout(() => window.location.href = 'Chat.html', 550);
});

document.getElementById('skipBtn').addEventListener('click', async () => {
  clearStatus();
  if (isDecisionTreeDemo()) {
    window.location.href = demoUrl('Chat.html', { state: 'start' });
    return;
  }
  try {
    await supabase.auth.updateUser({ data: { profile_completed: true } });
  } catch (_) {
    // non-blocking
  }
  window.location.href = 'Chat.html';
});

loadExisting();
