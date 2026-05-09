import { supabase } from './supabase-client.js';

const USER_PROFILE_TABLE = 'user_profiles';
const PERSONA_TABLE = 'personas';
const SYNTHETIC_USER_KEY = '__user_persona__';
const FITNESS_RESULT_STORAGE_KEY = 'insight-lab:last-fitness-test';
const FITNESS_HISTORY_STORAGE_KEY = 'insight-lab:fitness-report-history';

const AXIS_LABELS = Object.freeze({
  L1_A1: 'Initiative',
  L1_A2: 'Persistence',
  L1_A3: 'Risk Engagement',
  L1_A4: 'Social Energy Direction',
  L1_A5: 'Conflict Response',
  L1_A6: 'Adaptation Speed',
  L2_A1: 'Stability ↔ Growth',
  L2_A2: 'Autonomy ↔ Coordination',
  L2_A3: 'Immediate ↔ Deferred Reward',
  L2_A4: 'Status ↔ Belonging',
  L2_A5: 'Internal ↔ External Validation',
  L2_A6: 'Depth ↔ Breadth',
  L3_A1: 'Honesty Boundary',
  L3_A2: 'Respect / Dignity Boundary',
  L3_A3: 'Loyalty / Commitment Boundary',
  L3_A4: 'Autonomy Intrusion Boundary',
  L3_A5: 'Fairness / Reciprocity Boundary',
  L3_A6: 'Risk / Safety Boundary'
});

const selectA = document.getElementById('fitnessPersonaA');
const selectB = document.getElementById('fitnessPersonaB');
const runBtn = document.getElementById('runFitnessBtn');
const statusEl = document.getElementById('fitnessStatus');
const previewA = document.getElementById('personaPreviewA');
const previewB = document.getElementById('personaPreviewB');
const readyBadgeEl = document.getElementById('fitnessReadyBadge');
const readyLabelEl = document.getElementById('fitnessReadyLabel');
const runOverlayEl = document.getElementById('fitnessRunOverlay');
const runProgressBarEl = document.getElementById('fitnessRunProgressBar');
const runProgressTextEl = document.getElementById('fitnessRunProgressText');
const runStageEl = document.getElementById('fitnessRunStage');

let personaOptions = [];
let optionByKey = new Map();

function sanitizePersonaKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  const cleaned = normalized.replace(/[^a-z0-9_-]/g, '');
  return cleaned || '';
}

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function roundPercent(valueFraction) {
  return Math.round(clamp01(valueFraction) * 100);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fullName(first, last) {
  return `${String(first || '').trim()} ${String(last || '').trim()}`.trim();
}

function truncate(text, max = 180) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getInitials(value) {
  const text = String(value || '').trim();
  if (!text) return '??';
  const pieces = text.split(/\s+/).filter(Boolean).slice(0, 2);
  if (!pieces.length) return text.slice(0, 2).toUpperCase();
  return pieces.map((item) => item[0].toUpperCase()).join('');
}

function setStatus(text = '', type = 'info') {
  const message = String(text || '').trim();
  if (!message) {
    statusEl.hidden = true;
    statusEl.textContent = '';
    statusEl.dataset.type = 'info';
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.dataset.type = type;
}

function setReadyState(isReady) {
  readyBadgeEl.classList.remove('ready', 'not-ready');
  if (isReady) {
    readyBadgeEl.classList.add('ready');
    readyLabelEl.textContent = 'Ready';
    return;
  }
  readyBadgeEl.classList.add('not-ready');
  readyLabelEl.textContent = 'Not ready';
}

function getPortraitUrl(option) {
  if (!option) return '';
  if (option.type === 'user') return String(option.data?.avatar_url || '').trim();
  return String(option.data?.avatar_url || '').trim();
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
      const normalized = normalizeTraitVectorEntry(axisId, entry?.layer_id || null, entry);
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
  const axisDeviations = [];

  sharedKeys.forEach((axisId) => {
    const a = vectorA[axisId];
    const b = vectorB[axisId];
    const deviation = Math.abs(clamp01(a?.value, 0.5) - clamp01(b?.value, 0.5));
    const weight = Math.max(0.1, (clamp01(a?.confidence, 0.6) + clamp01(b?.confidence, 0.6)) / 2);
    weightedDeviation += deviation * weight;
    weightMass += weight;
    axisDeviations.push({
      axis_id: axisId,
      axis_name: AXIS_LABELS[axisId] || axisId,
      deviation: clamp01(deviation),
      persona_a_value: clamp01(a?.value, 0.5),
      persona_b_value: clamp01(b?.value, 0.5)
    });
  });

  const meanDeviation = weightMass ? weightedDeviation / weightMass : 1;
  return {
    isComputable: true,
    compatibilityFraction: clamp01(1 - meanDeviation),
    meanDeviation: clamp01(meanDeviation),
    sharedCount: sharedKeys.length,
    unionCount,
    axisDeviations
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
  const bounded = clamp01(misalignmentFraction);
  return Math.min(0.6, Math.max(0.1, 0.1 + bounded * 0.5));
}

function normalizeTextArray(value, limit = 4) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  const keys = Object.keys(value).sort();
  const body = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',');
  return `{${body}}`;
}

function hashText(input) {
  const text = String(input || '');
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function buildPersonaSignature(option) {
  const profile = getProfilePayload(option);
  const serialized = stableStringify(profile);
  const profileHash = hashText(serialized);
  const updatedAt = option?.data?.updated_at || option?.data?.saved_at || '';
  return {
    key: option?.key || '',
    profile_hash: profileHash,
    updated_at: updatedAt || null
  };
}

function loadStoredReportObject(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function loadStoredReportHistory() {
  try {
    const raw = localStorage.getItem(FITNESS_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === 'object');
  } catch (_) {
    return [];
  }
}

function normalizeKey(value) {
  return sanitizePersonaKey(value || '');
}

function isSameSignature(left, right) {
  if (!left || !right) return false;
  const leftKey = normalizeKey(left.key);
  const rightKey = normalizeKey(right.key);
  if (leftKey !== rightKey) return false;
  return String(left.profile_hash || '') === String(right.profile_hash || '');
}

function isReusableReport(report, optionA, optionB, signatureA, signatureB) {
  if (!report || typeof report !== 'object') return false;
  const reportKeyA = normalizeKey(report?.personaA?.key);
  const reportKeyB = normalizeKey(report?.personaB?.key);
  if (reportKeyA !== normalizeKey(optionA?.key) || reportKeyB !== normalizeKey(optionB?.key)) {
    return false;
  }
  return (
    isSameSignature(report?.personaA?.signature, signatureA) &&
    isSameSignature(report?.personaB?.signature, signatureB)
  );
}

function findReusableFitnessReport(optionA, optionB, signatureA, signatureB) {
  const latestReport = loadStoredReportObject(FITNESS_RESULT_STORAGE_KEY);
  if (isReusableReport(latestReport, optionA, optionB, signatureA, signatureB)) {
    return latestReport;
  }

  const history = loadStoredReportHistory();
  return (
    history.find((entry) => isReusableReport(entry, optionA, optionB, signatureA, signatureB)) ||
    null
  );
}

function buildFallbackAreas(quantResult, qualResult) {
  const sorted = [...(quantResult.axisDeviations || [])].sort((a, b) => a.deviation - b.deviation);
  const matches = sorted.slice(0, 3).map((item) => `${item.axis_name} alignment is strong`);
  const mismatches = [...sorted]
    .reverse()
    .slice(0, 3)
    .map((item) => `${item.axis_name} shows clear mismatch`);

  if (qualResult.misalignmentFraction > 0.65) {
    mismatches.push('Lifestyle and preference signals are highly diverse');
  } else if (qualResult.similarityFraction > 0.45) {
    matches.push('Preference language overlaps on several themes');
  }

  return {
    areas_match: normalizeTextArray(matches),
    areas_mismatch: normalizeTextArray(mismatches)
  };
}

async function fetchModelAreas(payload) {
  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data?.session?.access_token || '';
    const response = await fetch('/api/fitness-insights', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) return null;
    const result = await response.json().catch(() => null);
    if (!result || typeof result !== 'object') return null;
    return {
      areas_match: normalizeTextArray(result.areas_match),
      areas_mismatch: normalizeTextArray(result.areas_mismatch),
      model: String(result.model || '').trim() || 'LLM'
    };
  } catch (_) {
    return null;
  }
}

function evaluatePair(optionA, optionB) {
  if (!optionA || !optionB) {
    return { ready: false, reason: 'Select both personas to continue.' };
  }
  if (optionA.key === optionB.key) {
    return { ready: false, reason: 'Choose two different personas for Fitness Test.' };
  }

  const vectorA = getQuantitativeTraitVector(optionA);
  const vectorB = getQuantitativeTraitVector(optionB);
  const quantResult = computeQuantitativeCompatibility(vectorA, vectorB);
  if (!quantResult.isComputable) {
    return { ready: false, reason: 'Not enough quantitative data overlap yet. Complete Layer 1-3 answers for both personas.' };
  }

  const tagsA = getQualitativeTagSet(optionA);
  const tagsB = getQualitativeTagSet(optionB);
  const qualResult = computeQualitativeMisalignment(tagsA, tagsB);
  const mutationRateFraction = deriveMutationRate(qualResult.misalignmentFraction);

  return {
    ready: true,
    quantResult,
    qualResult,
    mutationRateFraction,
    vectorA,
    vectorB,
    tagsA,
    tagsB
  };
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
  const avatarUrl = getPortraitUrl(option);
  const initials = getInitials(option.label);
  const detailParts = [];
  if (option.type === 'user') {
    if (option.data?.personal_headline) detailParts.push(option.data.personal_headline);
    if (option.data?.goals) detailParts.push(`Goals: ${option.data.goals}`);
    if (option.data?.communication_style) detailParts.push(`Style: ${option.data.communication_style}`);
  } else {
    const headline = profile?.qualitative_data?.personal_headline || profile?.personal_headline || '';
    if (headline) detailParts.push(headline);
  }
  const detailText = truncate(detailParts.join(' | '));
  const detailLine = detailText ? `<div class="kv">${escapeHtml(detailText)}</div>` : '';

  container.innerHTML = `
    <div class="persona-head">
      <div class="persona-avatar">
        ${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(option.label)} avatar">` : escapeHtml(initials)}
      </div>
      <div class="persona-name-wrap">
        <h3>${escapeHtml(option.label)}</h3>
        <div class="kv"><strong>Source:</strong> ${escapeHtml(option.sourceLabel)}</div>
      </div>
    </div>
    ${detailLine}
  `;
}

function updateFitnessUI() {
  const keyA = selectA.value;
  const keyB = selectB.value;
  const personaA = optionByKey.get(keyA);
  const personaB = optionByKey.get(keyB);
  renderPreview(previewA, personaA);
  renderPreview(previewB, personaB);

  const evaluation = evaluatePair(personaA, personaB);
  if (!evaluation.ready) {
    runBtn.disabled = true;
    setReadyState(false);
    setStatus(evaluation.reason, 'error');
    return;
  }

  runBtn.disabled = false;
  setReadyState(true);
  setStatus('', 'info');
}

function getPersonaRowAvatarUrl(row) {
  const fromTop = String(row?.portrait_data_url || '').trim();
  if (fromTop) return fromTop;
  const fromState = String(row?.state?.personaPortrait || '').trim();
  return fromState || '';
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
    setReadyState(false);
    setStatus('No personas found for this account.', 'error');
    renderPreview(previewA, null);
    renderPreview(previewB, null);
    return;
  }

  const firstKey = personaOptions[0]?.key || '';
  const secondKey = personaOptions[1]?.key || firstKey;
  const userOption = personaOptions.find((item) => item.type === 'user' || item.isLinkedUser);
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
    .select('id,persona_key,name,state,profile,updated_at,portrait_data_url,portrait_storage_path')
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
      avatar_url: getPersonaRowAvatarUrl(linkedPersonaRow),
      user_profile: accountUserProfile
    }
  };

  const personaOptionsFromRows = personaRows
    .map((row) => {
      const key = sanitizePersonaKey(row?.persona_key);
      if (!key) return null;
      const isPrimaryLinked = key && key === primaryPersonaKey;
      const rowProfile = row?.profile && typeof row.profile === 'object' ? row.profile : {};
      const mergedRowProfile = isPrimaryLinked
        ? {
            ...rowProfile,
            ...accountUserProfile,
            quantitative_data: {
              ...(rowProfile.quantitative_data && typeof rowProfile.quantitative_data === 'object'
                ? rowProfile.quantitative_data
                : {}),
              ...(accountUserProfile.quantitative_data && typeof accountUserProfile.quantitative_data === 'object'
                ? accountUserProfile.quantitative_data
                : {})
            },
            qualitative_data: {
              ...(rowProfile.qualitative_data && typeof rowProfile.qualitative_data === 'object'
                ? rowProfile.qualitative_data
                : {}),
              ...(accountUserProfile.qualitative_data && typeof accountUserProfile.qualitative_data === 'object'
                ? accountUserProfile.qualitative_data
                : {})
            }
          }
        : rowProfile;
      return {
        key,
        label: row?.name ? `${row.name}` : key,
        sourceLabel: isPrimaryLinked ? 'Saved Persona · Linked as user persona' : 'Saved Persona',
        type: 'persona',
        isLinkedUser: Boolean(isPrimaryLinked),
        data: {
          ...row,
          profile: mergedRowProfile,
          avatar_url: getPersonaRowAvatarUrl(row)
        }
      };
    })
    .filter(Boolean);

  if (linkedPersonaRow) {
    return personaOptionsFromRows;
  }

  return [userOption, ...personaOptionsFromRows];
}

function setRunOverlayProgress(progressPercent, stageText) {
  const bounded = Math.max(0, Math.min(100, Math.round(progressPercent)));
  runProgressBarEl.style.width = `${bounded}%`;
  runProgressTextEl.textContent = `${bounded}%`;
  if (stageText) runStageEl.textContent = stageText;
}

function openRunOverlay() {
  runOverlayEl.hidden = false;
  setRunOverlayProgress(0, 'Initializing profile comparison…');
}

function closeRunOverlay() {
  runOverlayEl.hidden = true;
}

async function runWithProgress(taskFn) {
  openRunOverlay();
  let progress = 0;
  const stageFromProgress = (value) => {
    if (value < 20) return 'Reading profile vectors…';
    if (value < 45) return 'Computing quantitative compatibility…';
    if (value < 70) return 'Evaluating qualitative diversity…';
    if (value < 90) return 'Generating match and mismatch insights…';
    return 'Finalizing Fitness report…';
  };

  const timer = setInterval(() => {
    progress = Math.min(92, progress + (Math.random() * 4.5 + 2.2));
    setRunOverlayProgress(progress, stageFromProgress(progress));
  }, 170);

  try {
    const taskPromise = taskFn();
    const minDelay = wait(1800);
    const [result] = await Promise.all([taskPromise, minDelay]);
    clearInterval(timer);

    for (let value = progress; value <= 100; value += 4) {
      setRunOverlayProgress(value, stageFromProgress(value));
      await wait(24);
    }
    await wait(120);
    closeRunOverlay();
    return result;
  } catch (error) {
    clearInterval(timer);
    closeRunOverlay();
    throw error;
  }
}

function buildInsightsPayload(optionA, optionB, evaluation) {
  const fallbackAreas = buildFallbackAreas(evaluation.quantResult, evaluation.qualResult);
  const topMatches = [...evaluation.quantResult.axisDeviations]
    .sort((a, b) => a.deviation - b.deviation)
    .slice(0, 4);
  const topMismatches = [...evaluation.quantResult.axisDeviations]
    .sort((a, b) => b.deviation - a.deviation)
    .slice(0, 4);

  return {
    personaA: {
      key: optionA.key,
      label: optionA.label,
      profile: getProfilePayload(optionA),
      quantitative_trait_count: Object.keys(evaluation.vectorA || {}).length,
      qualitative_tag_count: evaluation.tagsA?.size || 0
    },
    personaB: {
      key: optionB.key,
      label: optionB.label,
      profile: getProfilePayload(optionB),
      quantitative_trait_count: Object.keys(evaluation.vectorB || {}).length,
      qualitative_tag_count: evaluation.tagsB?.size || 0
    },
    metrics: {
      compatibility_percent: roundPercent(evaluation.quantResult.compatibilityFraction),
      quantitative_deviation_percent: roundPercent(evaluation.quantResult.meanDeviation || 0),
      qualitative_misalignment_percent: roundPercent(evaluation.qualResult.misalignmentFraction),
      mutation_rate_percent: Math.round(evaluation.mutationRateFraction * 100),
      top_matches: topMatches,
      top_mismatches: topMismatches
    },
    fallback_areas: fallbackAreas
  };
}

async function initialize() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.user) {
    window.location.href = 'sign-in.html';
    return;
  }

  const userId = data.session.user.id;
  const userMetadata = data.session.user.user_metadata || {};
  const [userProfileRow, personaRows] = await Promise.all([
    fetchUserProfile(userId),
    fetchPersonas(userId)
  ]);

  personaOptions = buildOptions(userProfileRow, personaRows, userMetadata);
  optionByKey = new Map(personaOptions.map((item) => [item.key, item]));
  populateSelectors();
}

selectA.addEventListener('change', updateFitnessUI);
selectB.addEventListener('change', updateFitnessUI);

runBtn.addEventListener('click', async () => {
  const optionA = optionByKey.get(selectA.value);
  const optionB = optionByKey.get(selectB.value);
  const evaluation = evaluatePair(optionA, optionB);
  if (!evaluation.ready) {
    runBtn.disabled = true;
    setReadyState(false);
    setStatus(evaluation.reason, 'error');
    return;
  }

  try {
    const signatureA = buildPersonaSignature(optionA);
    const signatureB = buildPersonaSignature(optionB);
    const reusableReport = findReusableFitnessReport(optionA, optionB, signatureA, signatureB);
    if (reusableReport) {
      localStorage.setItem(FITNESS_RESULT_STORAGE_KEY, JSON.stringify(reusableReport));
      window.location.href = 'fitness-test-results.html';
      return;
    }

    const payload = buildInsightsPayload(optionA, optionB, evaluation);
    const finalData = await runWithProgress(async () => {
      const modelAreas = await fetchModelAreas(payload);
      const fallbackAreas = buildFallbackAreas(evaluation.quantResult, evaluation.qualResult);
      const areas = modelAreas || { ...fallbackAreas, model: 'Fallback' };
      const topMatchesAxes = [...evaluation.quantResult.axisDeviations]
        .sort((a, b) => a.deviation - b.deviation)
        .slice(0, 5);
      const topMismatchesAxes = [...evaluation.quantResult.axisDeviations]
        .sort((a, b) => b.deviation - a.deviation)
        .slice(0, 5);
      return {
        report_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        comparedAt: new Date().toISOString(),
        personaA: {
          key: optionA.key,
          label: optionA.label,
          avatar_url: getPortraitUrl(optionA),
          signature: signatureA
        },
        personaB: {
          key: optionB.key,
          label: optionB.label,
          avatar_url: getPortraitUrl(optionB),
          signature: signatureB
        },
        compatibilityPercent: roundPercent(evaluation.quantResult.compatibilityFraction),
        quantitativeDeviationPercent: roundPercent(evaluation.quantResult.meanDeviation || 0),
        qualitativeMisalignmentPercent: roundPercent(evaluation.qualResult.misalignmentFraction),
        mutationRatePercent: Math.round(evaluation.mutationRateFraction * 100),
        areas_match: normalizeTextArray(areas.areas_match),
        areas_mismatch: normalizeTextArray(areas.areas_mismatch),
        top_matches_axes: topMatchesAxes,
        top_mismatches_axes: topMismatchesAxes,
        llm_model: String(areas.model || 'LLM'),
        powered_by: 'LLM model'
      };
    });

    localStorage.setItem(FITNESS_RESULT_STORAGE_KEY, JSON.stringify(finalData));
    window.location.href = 'fitness-test-results.html';
  } catch (error) {
    setReadyState(false);
    setStatus(`Fitness Test failed: ${error?.message || 'Unexpected error'}`, 'error');
  }
});

initialize();
