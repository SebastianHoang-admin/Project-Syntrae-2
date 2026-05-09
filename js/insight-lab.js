import { supabase } from './supabase-client.js';

const USER_PROFILE_TABLE = 'user_profiles';
const PERSONA_TABLE = 'personas';
const SYNTHETIC_USER_KEY = '__user_persona__';
const FITNESS_RESULT_STORAGE_KEY = 'insight-lab:last-fitness-test';

const selectA = document.getElementById('fitnessPersonaA');
const selectB = document.getElementById('fitnessPersonaB');
const runBtn = document.getElementById('runFitnessBtn');
const statusEl = document.getElementById('fitnessStatus');
const previewA = document.getElementById('personaPreviewA');
const previewB = document.getElementById('personaPreviewB');
const fitnessResultEl = document.getElementById('fitnessResult');
const fitnessCompatibilityValueEl = document.getElementById('fitnessCompatibilityValue');
const fitnessOverlapValueEl = document.getElementById('fitnessOverlapValue');
const fitnessMisalignmentValueEl = document.getElementById('fitnessMisalignmentValue');
const fitnessMutationValueEl = document.getElementById('fitnessMutationValue');
const fitnessResultNoteEl = document.getElementById('fitnessResultNote');

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

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function roundPercent(valueFraction) {
  return Math.round(clamp01(valueFraction) * 100);
}

function truncate(text, max = 180) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function hideFitnessResult() {
  if (!fitnessResultEl) return;
  fitnessResultEl.hidden = true;
}

function showFitnessResult(result) {
  if (!fitnessResultEl) return;
  fitnessResultEl.hidden = false;
  fitnessCompatibilityValueEl.textContent = `${result.compatibilityPercent}%`;
  fitnessOverlapValueEl.textContent = `${result.sharedTraitCount} / ${result.unionTraitCount} traits`;
  fitnessMisalignmentValueEl.textContent = `${result.qualitativeMisalignmentPercent}%`;
  fitnessMutationValueEl.textContent = `${result.mutationRatePercent}%`;
  fitnessResultNoteEl.textContent = result.note;
}

function safeParseLayer(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue) return {};
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function getProfilePayload(option) {
  if (!option) return {};
  if (option.type === 'user') {
    return option.data?.user_profile && typeof option.data.user_profile === 'object'
      ? option.data.user_profile
      : {};
  }
  const rowProfile = option.data?.profile;
  if (rowProfile && typeof rowProfile === 'object') return rowProfile;
  const state = option.data?.state && typeof option.data.state === 'object' ? option.data.state : {};
  return {
    axis_scores: {
      L1: safeParseLayer(state?.identityLayers?.L1),
      L2: safeParseLayer(state?.identityLayers?.L2),
      L3: safeParseLayer(state?.identityLayers?.L3)
    },
    adjective_signals: [],
    freeform_signals: {},
    critical_factors: {},
    extras: state?.extras && typeof state.extras === 'object' ? state.extras : {}
  };
}

function normalizeTraitVectorEntry(axisId, layerId, rawEntry) {
  if (!axisId) return null;
  if (typeof rawEntry === 'number') {
    return { axisId, layerId, value: clamp01(rawEntry, 0.5), confidence: 0.6 };
  }
  if (!rawEntry || typeof rawEntry !== 'object') return null;
  if (typeof rawEntry.value !== 'number') return null;
  return {
    axisId,
    layerId,
    value: clamp01(rawEntry.value, 0.5),
    confidence: clamp01(rawEntry.confidence, 0.6)
  };
}

function getQuantitativeTraitVector(option) {
  const profile = getProfilePayload(option);
  const directVector = profile?.quantitative_data?.trait_vector;
  const vector = {};

  if (directVector && typeof directVector === 'object') {
    Object.entries(directVector).forEach(([axisId, entry]) => {
      const normalized = normalizeTraitVectorEntry(
        axisId,
        entry?.layer_id || null,
        entry
      );
      if (!normalized) return;
      vector[axisId] = normalized;
    });
  }

  const axisScores =
    profile?.quantitative_data?.axis_scores && typeof profile.quantitative_data.axis_scores === 'object'
      ? profile.quantitative_data.axis_scores
      : profile?.axis_scores && typeof profile.axis_scores === 'object'
        ? profile.axis_scores
        : {};

  ['L1', 'L2', 'L3'].forEach((layerId) => {
    const layer = axisScores?.[layerId];
    if (!layer || typeof layer !== 'object') return;
    Object.entries(layer).forEach(([axisId, rawEntry]) => {
      const normalized = normalizeTraitVectorEntry(axisId, layerId, rawEntry);
      if (!normalized) return;
      vector[axisId] = normalized;
    });
  });

  return vector;
}

function tokenizeQualitative(raw) {
  const text = String(raw || '').toLowerCase();
  if (!text) return [];
  return text
    .replace(/[\n\r\t]/g, ' ')
    .replace(/[^\w\s,/+-]/g, ' ')
    .split(/[\s,;/|]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 32);
}

function toStringRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = {};
  Object.entries(value).forEach(([key, raw]) => {
    const text = String(raw || '').trim();
    if (!text) return;
    record[key] = text;
  });
  return record;
}

function getQualitativeTagSet(option) {
  const profile = getProfilePayload(option);
  const qualitativeData =
    profile?.qualitative_data && typeof profile.qualitative_data === 'object'
      ? profile.qualitative_data
      : {};

  const tags = new Set();
  const existingTags = Array.isArray(qualitativeData.qualitative_tags)
    ? qualitativeData.qualitative_tags
    : [];

  existingTags.forEach((tag) => {
    const normalized = String(tag || '').trim().toLowerCase();
    if (normalized) tags.add(normalized);
  });

  const adjectiveSignals = Array.isArray(qualitativeData.adjective_signals)
    ? qualitativeData.adjective_signals
    : Array.isArray(profile?.adjective_signals)
      ? profile.adjective_signals
      : [];
  adjectiveSignals.forEach((entry) => {
    const selected = Array.isArray(entry?.selected) ? entry.selected : [];
    selected.forEach((item) => {
      tokenizeQualitative(item).forEach((token) => tags.add(`adj:${token}`));
    });
  });

  const freeformSignals = {
    ...toStringRecord(profile?.freeform_signals),
    ...toStringRecord(qualitativeData.freeform_signals)
  };
  Object.values(freeformSignals).forEach((value) => {
    tokenizeQualitative(value).forEach((token) => tags.add(`free:${token}`));
  });

  const criticalFactors = {
    ...toStringRecord(profile?.critical_factors),
    ...toStringRecord(qualitativeData.critical_factors)
  };
  Object.entries(criticalFactors).forEach(([factorKey, value]) => {
    if (factorKey) tags.add(`critical:${factorKey.toLowerCase()}`);
    tokenizeQualitative(value).forEach((token) => tags.add(`critical:${token}`));
  });

  const extrasText = {
    ...toStringRecord(profile?.extras),
    ...toStringRecord(qualitativeData.extras_text)
  };
  Object.values(extrasText).forEach((value) => {
    tokenizeQualitative(value).forEach((token) => tags.add(`extra:${token}`));
  });

  ['personal_headline', 'goals', 'strengths', 'constraints', 'communication_style'].forEach((field) => {
    const value = qualitativeData?.[field];
    tokenizeQualitative(value).forEach((token) => tags.add(`profile:${token}`));
  });

  return tags;
}

function computeQuantitativeCompatibility(vectorA, vectorB) {
  const keysA = new Set(Object.keys(vectorA || {}));
  const keysB = new Set(Object.keys(vectorB || {}));
  const sharedKeys = Array.from(keysA).filter((key) => keysB.has(key));
  const unionCount = new Set([...keysA, ...keysB]).size;

  if (!sharedKeys.length) {
    return {
      isComputable: false,
      compatibilityFraction: 0,
      sharedCount: 0,
      unionCount
    };
  }

  let weightedDeviation = 0;
  let weightMass = 0;
  sharedKeys.forEach((axisId) => {
    const a = vectorA[axisId];
    const b = vectorB[axisId];
    const deviation = Math.abs(clamp01(a?.value, 0.5) - clamp01(b?.value, 0.5));
    const weight = Math.max(0.1, (clamp01(a?.confidence, 0.6) + clamp01(b?.confidence, 0.6)) / 2);
    weightedDeviation += deviation * weight;
    weightMass += weight;
  });

  const meanDeviation = weightMass ? weightedDeviation / weightMass : 1;
  return {
    isComputable: true,
    compatibilityFraction: clamp01(1 - meanDeviation),
    meanDeviation: clamp01(meanDeviation),
    sharedCount: sharedKeys.length,
    unionCount
  };
}

function computeQualitativeMisalignment(tagsA, tagsB) {
  const setA = tagsA instanceof Set ? tagsA : new Set();
  const setB = tagsB instanceof Set ? tagsB : new Set();
  const union = new Set([...setA, ...setB]);
  if (!union.size) {
    return {
      similarityFraction: 1,
      misalignmentFraction: 0,
      intersectionCount: 0,
      unionCount: 0
    };
  }
  let intersectionCount = 0;
  setA.forEach((item) => {
    if (setB.has(item)) intersectionCount += 1;
  });
  const similarityFraction = intersectionCount / union.size;
  const misalignmentFraction = clamp01(1 - similarityFraction);
  return {
    similarityFraction,
    misalignmentFraction,
    intersectionCount,
    unionCount: union.size
  };
}

function deriveMutationRate(misalignmentFraction) {
  // Relationship definition: more qualitative diversity => higher mutation rate.
  // Mutation rate stays bounded in [10%, 60%] for stability.
  const bounded = clamp01(misalignmentFraction);
  return Math.min(0.6, Math.max(0.1, 0.1 + bounded * 0.5));
}

function renderPreview(container, option) {
  if (!option) {
    container.innerHTML = `
      <h3>Unavailable</h3>
      <div class="kv">This persona could not be loaded.</div>
    `;
    return;
  }
  const profile = getProfilePayload(option);
  const vectorSize = Object.keys(getQuantitativeTraitVector(option)).length;
  const qualitativeTagCount = getQualitativeTagSet(option).size;
  const detailParts = [];
  if (option.type === 'user') {
    if (option.data?.personal_headline) detailParts.push(option.data.personal_headline);
    if (option.data?.goals) detailParts.push(`Goals: ${option.data.goals}`);
    if (option.data?.communication_style) detailParts.push(`Style: ${option.data.communication_style}`);
  } else {
    const headline = profile?.qualitative_data?.personal_headline || profile?.personal_headline || '';
    if (headline) detailParts.push(headline);
    if (option.data?.state?.usersInput) {
      detailParts.push(`Context: ${String(option.data.state.usersInput).replace(/\s+/g, ' ').trim()}`);
    }
    const layerCount = Object.keys(option.data?.state?.identityLayers || {}).length;
    if (layerCount) detailParts.push(`Identity layers saved: ${layerCount}`);
  }
  detailParts.push(`Quant traits: ${vectorSize}`);
  detailParts.push(`Qual tags: ${qualitativeTagCount}`);
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
  hideFitnessResult();
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

  const vectorA = getQuantitativeTraitVector(personaA);
  const vectorB = getQuantitativeTraitVector(personaB);
  const quantResult = computeQuantitativeCompatibility(vectorA, vectorB);
  if (!quantResult.isComputable) {
    runBtn.disabled = true;
    setStatus('Not enough quantitative data overlap yet. Complete Layer 1-3 answers for both personas.', 'error');
    return;
  }

  runBtn.disabled = false;
  setStatus(`Ready: compare "${personaA?.label || keyA}" vs "${personaB?.label || keyB}" (${quantResult.sharedCount} shared quantitative traits).`, 'success');
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
  const linkedPersonaRow = personaRows.find(
    (row) => sanitizePersonaKey(row?.persona_key) === primaryPersonaKey
  );
  const linkedPersonaProfile = linkedPersonaRow?.profile && typeof linkedPersonaRow.profile === 'object'
    ? linkedPersonaRow.profile
    : {};
  const baseDisplayName =
    profileJson.display_name ||
    fullName(userProfileRow?.first_name || userMetadata?.first_name, userProfileRow?.last_name || userMetadata?.last_name) ||
    'Your Persona';

  const accountUserProfile = {
    schema_version: '2.0.0',
    persona_key: SYNTHETIC_USER_KEY,
    persona_name: baseDisplayName,
    quantitative_data: {
      ...(linkedPersonaProfile.quantitative_data && typeof linkedPersonaProfile.quantitative_data === 'object'
        ? linkedPersonaProfile.quantitative_data
        : {}),
      ...(profileJson.quantitative_data && typeof profileJson.quantitative_data === 'object'
        ? profileJson.quantitative_data
        : {})
    },
    qualitative_data: {
      ...(linkedPersonaProfile.qualitative_data && typeof linkedPersonaProfile.qualitative_data === 'object'
        ? linkedPersonaProfile.qualitative_data
        : {}),
      ...(profileJson.qualitative_data && typeof profileJson.qualitative_data === 'object'
        ? profileJson.qualitative_data
        : {}),
      personal_headline: profileJson.personal_headline || '',
      goals: profileJson.goals || '',
      strengths: profileJson.strengths || '',
      constraints: profileJson.constraints || '',
      communication_style: profileJson.communication_style || ''
    }
  };

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
      location: userProfileRow?.location || userMetadata?.location || '',
      linked_persona_key: primaryPersonaKey || '',
      user_profile: accountUserProfile
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

  const vectorA = getQuantitativeTraitVector(optionA);
  const vectorB = getQuantitativeTraitVector(optionB);
  const quantResult = computeQuantitativeCompatibility(vectorA, vectorB);
  if (!quantResult.isComputable) {
    runBtn.disabled = true;
    setStatus('Cannot compute compatibility: missing shared quantitative traits.', 'error');
    hideFitnessResult();
    return;
  }

  const tagsA = getQualitativeTagSet(optionA);
  const tagsB = getQualitativeTagSet(optionB);
  const qualResult = computeQualitativeMisalignment(tagsA, tagsB);
  const mutationRateFraction = deriveMutationRate(qualResult.misalignmentFraction);

  const result = {
    comparedAt: new Date().toISOString(),
    personaA: { key: optionA.key, label: optionA.label },
    personaB: { key: optionB.key, label: optionB.label },
    compatibilityPercent: roundPercent(quantResult.compatibilityFraction),
    sharedTraitCount: quantResult.sharedCount,
    unionTraitCount: quantResult.unionCount,
    quantitativeDeviationPercent: roundPercent(quantResult.meanDeviation || 0),
    qualitativeMisalignmentPercent: roundPercent(qualResult.misalignmentFraction),
    qualitativeOverlapPercent: roundPercent(qualResult.similarityFraction),
    mutationRatePercent: Math.round(mutationRateFraction * 100),
    note: `Compatibility uses quantitative deviation only. Qualitative misalignment = 1 - (overlap/union). Mutation rate = 10% + 50% x misalignment (capped at 60%).`
  };

  localStorage.setItem(FITNESS_RESULT_STORAGE_KEY, JSON.stringify(result));
  showFitnessResult(result);
  setStatus(
    `Fitness Test complete: ${result.compatibilityPercent}% compatibility, ${result.mutationRatePercent}% mutation rate.`,
    'success'
  );
});

initialize();
