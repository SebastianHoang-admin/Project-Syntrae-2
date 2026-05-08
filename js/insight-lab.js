import { supabase } from './supabase-client.js';

const USER_PROFILE_TABLE = 'user_profiles';
const PERSONA_TABLE = 'personas';
const SYNTHETIC_USER_KEY = '__user_persona__';

const selectA = document.getElementById('fitnessPersonaA');
const selectB = document.getElementById('fitnessPersonaB');
const runBtn = document.getElementById('runFitnessBtn');
const statusEl = document.getElementById('fitnessStatus');
const previewA = document.getElementById('personaPreviewA');
const previewB = document.getElementById('personaPreviewB');

let personaOptions = [];
let optionByKey = new Map();
let currentUser = null;

function sanitizePersonaKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  const cleaned = normalized.replace(/[^a-z0-9_-]/g, '');
  return cleaned || '';
}

function setStatus(text, type = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.type = type;
}

function fullName(first, last) {
  return `${String(first || '').trim()} ${String(last || '').trim()}`.trim();
}

function truncate(text, max = 180) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function renderPreview(container, option) {
  if (!option) {
    container.innerHTML = `
      <h3>Unavailable</h3>
      <div class="kv">This persona could not be loaded.</div>
    `;
    return;
  }
  const detailParts = [];
  if (option.type === 'user') {
    if (option.data?.personal_headline) detailParts.push(option.data.personal_headline);
    if (option.data?.goals) detailParts.push(`Goals: ${option.data.goals}`);
    if (option.data?.communication_style) detailParts.push(`Style: ${option.data.communication_style}`);
  } else {
    if (option.data?.profile?.personal_headline) detailParts.push(option.data.profile.personal_headline);
    if (option.data?.state?.usersInput) {
      detailParts.push(`Context: ${String(option.data.state.usersInput).replace(/\s+/g, ' ').trim()}`);
    }
    const layerCount = Object.keys(option.data?.state?.identityLayers || {}).length;
    if (layerCount) detailParts.push(`Identity layers saved: ${layerCount}`);
  }
  const detailText = truncate(detailParts.join(' | ') || 'No additional notes yet.');

  container.innerHTML = `
    <h3>${option.label}</h3>
    <div class="kv"><strong>Source:</strong> ${option.sourceLabel}</div>
    <div class="kv"><strong>Key:</strong> ${option.key}</div>
    <div class="kv">${detailText}</div>
  `;
}

function updateFitnessUI() {
  const keyA = selectA.value;
  const keyB = selectB.value;
  const personaA = optionByKey.get(keyA);
  const personaB = optionByKey.get(keyB);
  renderPreview(previewA, personaA);
  renderPreview(previewB, personaB);

  if (!keyA || !keyB) {
    runBtn.disabled = true;
    setStatus('Select both personas to continue.', 'info');
    return;
  }
  if (keyA === keyB) {
    runBtn.disabled = true;
    setStatus('Choose two different personas for Fitness Test.', 'error');
    return;
  }
  runBtn.disabled = false;
  setStatus(`Ready: compare "${personaA?.label || keyA}" vs "${personaB?.label || keyB}".`, 'success');
}

function populateSelectors() {
  selectA.innerHTML = '';
  selectB.innerHTML = '';
  personaOptions.forEach((option) => {
    const optA = document.createElement('option');
    optA.value = option.key;
    optA.textContent = option.label;
    selectA.appendChild(optA);

    const optB = document.createElement('option');
    optB.value = option.key;
    optB.textContent = option.label;
    selectB.appendChild(optB);
  });

  if (!personaOptions.length) {
    selectA.innerHTML = '<option value="">No personas available</option>';
    selectB.innerHTML = '<option value="">No personas available</option>';
    runBtn.disabled = true;
    setStatus('No personas found for this account.', 'error');
    renderPreview(previewA, null);
    renderPreview(previewB, null);
    return;
  }

  const firstKey = personaOptions[0]?.key || '';
  const secondKey = personaOptions[1]?.key || firstKey;
  const userOption = personaOptions.find((o) => o.type === 'user');
  selectA.value = userOption?.key || firstKey;
  selectB.value = secondKey === selectA.value ? firstKey : secondKey;
  updateFitnessUI();
}

async function fetchUserProfile(userId) {
  const { data, error } = await supabase
    .from(USER_PROFILE_TABLE)
    .select('first_name,last_name,occupation,organization,location,profile')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('Could not load user profile for Insight Lab:', error.message || error);
    return null;
  }
  return data || null;
}

async function fetchPersonas(userId) {
  const { data, error } = await supabase
    .from(PERSONA_TABLE)
    .select('id,persona_key,name,state,profile,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('Could not load personas for Insight Lab:', error.message || error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

function buildOptions(userProfileRow, personaRows, userMetadata) {
  const profileJson = userProfileRow?.profile && typeof userProfileRow.profile === 'object'
    ? userProfileRow.profile
    : {};
  const primaryPersonaKey = sanitizePersonaKey(profileJson.primary_persona_key || '');
  const baseDisplayName =
    profileJson.display_name ||
    fullName(userProfileRow?.first_name || userMetadata?.first_name, userProfileRow?.last_name || userMetadata?.last_name) ||
    'Your Persona';

  const userOption = {
    key: SYNTHETIC_USER_KEY,
    label: `${baseDisplayName} (You)`,
    sourceLabel: 'User Persona',
    type: 'user',
    data: {
      display_name: baseDisplayName,
      personal_headline: profileJson.personal_headline || '',
      goals: profileJson.goals || '',
      strengths: profileJson.strengths || '',
      constraints: profileJson.constraints || '',
      communication_style: profileJson.communication_style || '',
      occupation: userProfileRow?.occupation || userMetadata?.occupation || '',
      organization: userProfileRow?.organization || userMetadata?.organization || '',
      location: userProfileRow?.location || userMetadata?.location || ''
    }
  };

  const personaOptionsFromRows = personaRows
    .map((row) => {
      const key = sanitizePersonaKey(row?.persona_key);
      if (!key) return null;
      const isPrimaryLinked = key && key === primaryPersonaKey;
      return {
        key,
        label: row?.name ? `${row.name}` : key,
        sourceLabel: isPrimaryLinked ? 'Saved Persona · Linked as user persona' : 'Saved Persona',
        type: 'persona',
        data: row
      };
    })
    .filter(Boolean);

  return [userOption, ...personaOptionsFromRows];
}

async function initialize() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.user) {
    window.location.href = 'sign-in.html';
    return;
  }

  currentUser = data.session.user;
  const userId = currentUser.id;
  const userMetadata = currentUser.user_metadata || {};

  const [userProfileRow, personaRows] = await Promise.all([
    fetchUserProfile(userId),
    fetchPersonas(userId)
  ]);

  personaOptions = buildOptions(userProfileRow, personaRows, userMetadata);
  optionByKey = new Map(personaOptions.map((o) => [o.key, o]));
  populateSelectors();
}

selectA.addEventListener('change', updateFitnessUI);
selectB.addEventListener('change', updateFitnessUI);

runBtn.addEventListener('click', () => {
  const optionA = optionByKey.get(selectA.value);
  const optionB = optionByKey.get(selectB.value);
  if (!optionA || !optionB || optionA.key === optionB.key) {
    updateFitnessUI();
    return;
  }
  setStatus(
    `Fitness Test setup locked: ${optionA.label} vs ${optionB.label}. Algorithm execution will be connected next.`,
    'success'
  );
});

initialize();
