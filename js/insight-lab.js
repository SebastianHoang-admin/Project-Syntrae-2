import { supabase } from './supabase-client.js';

const USER_PROFILE_TABLE = 'user_profiles';
const PERSONA_TABLE = 'personas';
const SYNTHETIC_USER_KEY = '__user_persona__';
const FITNESS_RESULT_STORAGE_KEY = 'insight-lab:last-fitness-test';
const FITNESS_HISTORY_STORAGE_KEY = 'insight-lab:fitness-report-history';
const OUTCOME_RESULT_STORAGE_KEY = 'insight-lab:last-outcome-test';
const INSIGHT_LAB_PROFILE_KEY = 'insight_lab';
const ACCOUNT_FITNESS_REPORTS_KEY = 'fitness_reports';
const ACCOUNT_OUTCOME_REPORTS_KEY = 'outcome_reports';
const MAX_ACCOUNT_FITNESS_REPORTS = 20;
const MAX_ACCOUNT_OUTCOME_REPORTS = 20;

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
const outcomeSelectA = document.getElementById('outcomePersonaA');
const outcomeSelectB = document.getElementById('outcomePersonaB');
const outcomeInitialConditionsEl = document.getElementById('outcomeInitialConditions');
const outcomeRequestedOutcomeEl = document.getElementById('outcomeRequestedOutcome');
const outcomeRunBtn = document.getElementById('runOutcomeBtn');
const outcomeStatusEl = document.getElementById('outcomeStatus');
const outcomeReadyBadgeEl = document.getElementById('outcomeReadyBadge');
const outcomeReadyLabelEl = document.getElementById('outcomeReadyLabel');
const outcomeResultsEl = document.getElementById('outcomeResults');
const outcomeSummaryTitleEl = document.getElementById('outcomeSummaryTitle');
const outcomeSummaryTextEl = document.getElementById('outcomeSummaryText');
const outcomePathwayGridEl = document.getElementById('outcomePathwayGrid');
const outcomeRunOverlayEl = document.getElementById('outcomeRunOverlay');
const outcomeRunProgressBarEl = document.getElementById('outcomeRunProgressBar');
const outcomeRunProgressTextEl = document.getElementById('outcomeRunProgressText');
const outcomeRunStageEl = document.getElementById('outcomeRunStage');

let personaOptions = [];
let optionByKey = new Map();
let currentUserId = '';
let currentUserProfileJson = {};

function sanitizePersonaKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  const cleaned = normalized.replace(/[^a-z0-9_-]/g, '');
  return cleaned || '';
}

function isMissingUserProfileTableError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '');
  return code === '42P01' || (message.includes('relation') && message.includes('user_profiles'));
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

function setOutcomeStatus(text = '', type = 'info') {
  if (!outcomeStatusEl) return;
  const message = String(text || '').trim();
  if (!message) {
    outcomeStatusEl.hidden = true;
    outcomeStatusEl.textContent = '';
    outcomeStatusEl.dataset.type = 'info';
    return;
  }
  outcomeStatusEl.hidden = false;
  outcomeStatusEl.textContent = message;
  outcomeStatusEl.dataset.type = type;
}

function setOutcomeReadyState(isReady) {
  if (!outcomeReadyBadgeEl || !outcomeReadyLabelEl) return;
  outcomeReadyBadgeEl.classList.remove('ready', 'not-ready');
  if (isReady) {
    outcomeReadyBadgeEl.classList.add('ready');
    outcomeReadyLabelEl.textContent = 'Ready';
    return;
  }
  outcomeReadyBadgeEl.classList.add('not-ready');
  outcomeReadyLabelEl.textContent = 'Not ready';
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

function reportTimestampValue(report) {
  const stamp = String(report?.comparedAt || report?.compared_at || report?.generatedAt || report?.generated_at || '').trim();
  if (!stamp) return 0;
  const epoch = Date.parse(stamp);
  return Number.isFinite(epoch) ? epoch : 0;
}

function getReportStorageFingerprint(report) {
  if (!report || typeof report !== 'object') return '';
  const reportId = String(report.report_id || '').trim();
  if (reportId) return `id:${reportId}`;
  const keyA = sanitizePersonaKey(report?.personaA?.key || '');
  const keyB = sanitizePersonaKey(report?.personaB?.key || '');
  const sigA = String(report?.personaA?.signature?.profile_hash || '').trim();
  const sigB = String(report?.personaB?.signature?.profile_hash || '').trim();
  if (keyA && keyB && sigA && sigB) return `sig:${keyA}|${sigA}|${keyB}|${sigB}`;
  const stamp = String(report?.comparedAt || report?.compared_at || '').trim();
  return stamp ? `time:${stamp}` : '';
}

function buildReportPersonaKeys(report) {
  const keys = [
    sanitizePersonaKey(report?.personaA?.key || ''),
    sanitizePersonaKey(report?.personaB?.key || '')
  ].filter(Boolean);
  return Array.from(new Set(keys));
}

function normalizeReportForAccountStorage(report) {
  if (!report || typeof report !== 'object') return null;
  return {
    ...report,
    persona_keys: buildReportPersonaKeys(report),
    updated_at: new Date().toISOString()
  };
}

function mergeFitnessReportIntoProfile(profileJson, report) {
  const baseProfile = profileJson && typeof profileJson === 'object' ? profileJson : {};
  const insightLab = baseProfile?.[INSIGHT_LAB_PROFILE_KEY] && typeof baseProfile[INSIGHT_LAB_PROFILE_KEY] === 'object'
    ? baseProfile[INSIGHT_LAB_PROFILE_KEY]
    : {};
  const existingReports = Array.isArray(insightLab?.[ACCOUNT_FITNESS_REPORTS_KEY])
    ? insightLab[ACCOUNT_FITNESS_REPORTS_KEY]
    : [];
  const incoming = normalizeReportForAccountStorage(report);
  if (!incoming) return baseProfile;

  const incomingFingerprint = getReportStorageFingerprint(incoming);
  const filtered = existingReports.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const existingFingerprint = getReportStorageFingerprint(entry);
    if (incomingFingerprint && existingFingerprint && incomingFingerprint === existingFingerprint) return false;
    return true;
  });
  filtered.unshift(incoming);
  filtered.sort((left, right) => reportTimestampValue(right) - reportTimestampValue(left));
  const trimmed = filtered.slice(0, MAX_ACCOUNT_FITNESS_REPORTS);

  return {
    ...baseProfile,
    [INSIGHT_LAB_PROFILE_KEY]: {
      ...insightLab,
      [ACCOUNT_FITNESS_REPORTS_KEY]: trimmed,
      updated_at: new Date().toISOString()
    }
  };
}

async function loadLatestAccountProfileJson() {
  if (!currentUserId) return currentUserProfileJson && typeof currentUserProfileJson === 'object' ? currentUserProfileJson : {};
  const { data, error } = await supabase
    .from(USER_PROFILE_TABLE)
    .select('profile')
    .eq('user_id', currentUserId)
    .maybeSingle();
  if (error) {
    if (!isMissingUserProfileTableError(error)) {
      console.warn('Could not refresh account profile before saving fitness report:', error.message || error);
    }
    return currentUserProfileJson && typeof currentUserProfileJson === 'object' ? currentUserProfileJson : {};
  }
  const profile = data?.profile && typeof data.profile === 'object' ? data.profile : {};
  currentUserProfileJson = profile;
  return profile;
}

async function persistFitnessReportToAccount(report) {
  if (!currentUserId || !report || typeof report !== 'object') return;
  try {
    const latestProfile = await loadLatestAccountProfileJson();
    const nextProfile = mergeFitnessReportIntoProfile(latestProfile, report);
    const { error } = await supabase
      .from(USER_PROFILE_TABLE)
      .upsert(
        {
          user_id: currentUserId,
          profile: nextProfile
        },
        { onConflict: 'user_id' }
      );
    if (error) {
      if (!isMissingUserProfileTableError(error)) {
        console.warn('Could not persist fitness report to account storage:', error.message || error);
      }
      return;
    }
    currentUserProfileJson = nextProfile;
  } catch (error) {
    console.warn('Unexpected error while saving fitness report to account storage:', error?.message || error);
  }
}

function getOutcomeReportStorageFingerprint(report) {
  if (!report || typeof report !== 'object') return '';
  const reportId = String(report.report_id || '').trim();
  if (reportId) return `id:${reportId}`;

  const personaAKey = sanitizePersonaKey(report?.persona_a?.key || report?.personaA?.key || '');
  const personaBKey = sanitizePersonaKey(report?.persona_b?.key || report?.personaB?.key || '');
  const outcome = String(report?.requested_outcome || report?.requestedOutcome || '').trim().toLowerCase();
  const sigA = String(report?.persona_a?.signature?.profile_hash || report?.personaA?.signature?.profile_hash || '').trim();
  const sigB = String(report?.persona_b?.signature?.profile_hash || report?.personaB?.signature?.profile_hash || '').trim();
  if (personaAKey && personaBKey && outcome && sigA && sigB) {
    return `sig:${personaAKey}|${sigA}|${personaBKey}|${sigB}|${outcome}`;
  }
  const stamp = String(report?.generated_at || report?.generatedAt || '').trim();
  return stamp ? `time:${stamp}|${personaAKey}|${personaBKey}|${outcome}` : '';
}

function normalizeOutcomeReportForAccountStorage(report) {
  if (!report || typeof report !== 'object') return null;
  const personaKeys = Array.isArray(report.persona_keys)
    ? report.persona_keys.map((value) => sanitizePersonaKey(value)).filter(Boolean)
    : [
        sanitizePersonaKey(report?.persona_a?.key || ''),
        sanitizePersonaKey(report?.persona_b?.key || '')
      ].filter(Boolean);
  return {
    ...report,
    persona_keys: Array.from(new Set(personaKeys)),
    updated_at: new Date().toISOString()
  };
}

function mergeOutcomeReportIntoProfile(profileJson, report) {
  const baseProfile = profileJson && typeof profileJson === 'object' ? profileJson : {};
  const insightLab = baseProfile?.[INSIGHT_LAB_PROFILE_KEY] && typeof baseProfile[INSIGHT_LAB_PROFILE_KEY] === 'object'
    ? baseProfile[INSIGHT_LAB_PROFILE_KEY]
    : {};
  const existingReports = Array.isArray(insightLab?.[ACCOUNT_OUTCOME_REPORTS_KEY])
    ? insightLab[ACCOUNT_OUTCOME_REPORTS_KEY]
    : [];
  const incoming = normalizeOutcomeReportForAccountStorage(report);
  if (!incoming) return baseProfile;

  const incomingFingerprint = getOutcomeReportStorageFingerprint(incoming);
  const filtered = existingReports.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const existingFingerprint = getOutcomeReportStorageFingerprint(entry);
    if (incomingFingerprint && existingFingerprint && incomingFingerprint === existingFingerprint) return false;
    return true;
  });
  filtered.unshift(incoming);
  filtered.sort((left, right) => reportTimestampValue(right) - reportTimestampValue(left));
  const trimmed = filtered.slice(0, MAX_ACCOUNT_OUTCOME_REPORTS);

  return {
    ...baseProfile,
    [INSIGHT_LAB_PROFILE_KEY]: {
      ...insightLab,
      [ACCOUNT_OUTCOME_REPORTS_KEY]: trimmed,
      updated_at: new Date().toISOString()
    }
  };
}

async function persistOutcomeReportToAccount(report) {
  if (!currentUserId || !report || typeof report !== 'object') return;
  try {
    const latestProfile = await loadLatestAccountProfileJson();
    const nextProfile = mergeOutcomeReportIntoProfile(latestProfile, report);
    const { error } = await supabase
      .from(USER_PROFILE_TABLE)
      .upsert(
        {
          user_id: currentUserId,
          profile: nextProfile
        },
        { onConflict: 'user_id' }
      );
    if (error) {
      if (!isMissingUserProfileTableError(error)) {
        console.warn('Could not persist outcome report to account storage:', error.message || error);
      }
      return;
    }
    currentUserProfileJson = nextProfile;
  } catch (error) {
    console.warn('Unexpected error while saving outcome report to account storage:', error?.message || error);
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
  if (outcomeSelectA) outcomeSelectA.innerHTML = '';
  if (outcomeSelectB) outcomeSelectB.innerHTML = '';
  personaOptions.forEach((option) => {
    const optA = document.createElement('option');
    optA.value = option.key;
    optA.textContent = option.label;
    selectA.appendChild(optA);

    const optB = document.createElement('option');
    optB.value = option.key;
    optB.textContent = option.label;
    selectB.appendChild(optB);

    if (outcomeSelectA) {
      const outcomeOptA = document.createElement('option');
      outcomeOptA.value = option.key;
      outcomeOptA.textContent = option.label;
      outcomeSelectA.appendChild(outcomeOptA);
    }
    if (outcomeSelectB) {
      const outcomeOptB = document.createElement('option');
      outcomeOptB.value = option.key;
      outcomeOptB.textContent = option.label;
      outcomeSelectB.appendChild(outcomeOptB);
    }
  });

  if (!personaOptions.length) {
    selectA.innerHTML = '<option value="">No personas available</option>';
    selectB.innerHTML = '<option value="">No personas available</option>';
    if (outcomeSelectA) outcomeSelectA.innerHTML = '<option value="">No personas available</option>';
    if (outcomeSelectB) outcomeSelectB.innerHTML = '<option value="">No personas available</option>';
    runBtn.disabled = true;
    if (outcomeRunBtn) outcomeRunBtn.disabled = true;
    setReadyState(false);
    setOutcomeReadyState(false);
    setStatus('No personas found for this account.', 'error');
    setOutcomeStatus('No personas found for this account.', 'error');
    renderPreview(previewA, null);
    renderPreview(previewB, null);
    return;
  }

  const firstKey = personaOptions[0]?.key || '';
  const secondKey = personaOptions[1]?.key || firstKey;
  const userOption = personaOptions.find((item) => item.type === 'user' || item.isLinkedUser);
  selectA.value = userOption?.key || firstKey;
  selectB.value = secondKey === selectA.value ? firstKey : secondKey;
  if (outcomeSelectA) outcomeSelectA.value = userOption?.key || firstKey;
  if (outcomeSelectB) {
    const outcomeSecondKey = secondKey === (outcomeSelectA?.value || '') ? firstKey : secondKey;
    outcomeSelectB.value = outcomeSecondKey;
  }
  updateFitnessUI();
  updateOutcomeUI();
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

function setOutcomeRunOverlayProgress(progressPercent, stageText) {
  if (!outcomeRunProgressBarEl || !outcomeRunProgressTextEl || !outcomeRunStageEl) return;
  const bounded = Math.max(0, Math.min(100, Math.round(progressPercent)));
  outcomeRunProgressBarEl.style.width = `${bounded}%`;
  outcomeRunProgressTextEl.textContent = `${bounded}%`;
  if (stageText) outcomeRunStageEl.textContent = stageText;
}

function openOutcomeRunOverlay() {
  if (!outcomeRunOverlayEl) return;
  outcomeRunOverlayEl.hidden = false;
  setOutcomeRunOverlayProgress(0, 'Computing optimal pathway scenarios…');
}

function closeOutcomeRunOverlay() {
  if (!outcomeRunOverlayEl) return;
  outcomeRunOverlayEl.hidden = true;
}

async function runOutcomeWithProgress(taskFn) {
  openOutcomeRunOverlay();
  let progress = 0;
  const stageFromProgress = (value) => {
    if (value < 24) return 'Analyzing contextual and persona inputs…';
    if (value < 56) return 'Computing optimal pathway scenarios…';
    if (value < 86) return 'Evaluating scenario transitions and compliance…';
    return 'Finalizing outcome strategy report…';
  };

  const timer = setInterval(() => {
    progress = Math.min(93, progress + (Math.random() * 4 + 2.4));
    setOutcomeRunOverlayProgress(progress, stageFromProgress(progress));
  }, 170);

  try {
    const taskPromise = taskFn();
    const minDelay = wait(1800);
    const [result] = await Promise.all([taskPromise, minDelay]);
    clearInterval(timer);

    for (let value = progress; value <= 100; value += 4) {
      setOutcomeRunOverlayProgress(value, stageFromProgress(value));
      await wait(24);
    }
    await wait(120);
    closeOutcomeRunOverlay();
    return result;
  } catch (error) {
    clearInterval(timer);
    closeOutcomeRunOverlay();
    throw error;
  }
}

function normalizeOutcomeNodeList(value, limit = 10) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .slice(0, limit);
}

function normalizeOutcomeChainList(value, limit = 5) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .slice(0, limit);
}

function toSafePercent(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, numeric));
}

function renderOutcomeResults(report) {
  if (!outcomeResultsEl || !outcomeSummaryTitleEl || !outcomeSummaryTextEl || !outcomePathwayGridEl) return;
  if (!report || typeof report !== 'object') {
    outcomeResultsEl.hidden = true;
    outcomePathwayGridEl.innerHTML = '';
    return;
  }

  const personaALabel = String(report?.persona_a?.label || 'Persona A').trim();
  const personaBLabel = String(report?.persona_b?.label || 'Persona B').trim();
  const requestedOutcome = String(report?.requested_outcome || '').trim();
  const nodeCount = Number(report?.config?.node_count || 10) || 10;
  const actionsPerNode = Number(report?.config?.actions_per_node || 5) || 5;
  const chains = normalizeOutcomeChainList(report?.chain_candidates, 5);
  const bestChain = report?.best_chain && typeof report.best_chain === 'object'
    ? report.best_chain
    : chains[0] || null;
  const bestChainIntegrity = toSafePercent(bestChain?.chain_metrics?.chain_integrity_percent, 0).toFixed(2);

  outcomeSummaryTitleEl.textContent = `${personaALabel} → ${personaBLabel}`;
  outcomeSummaryTextEl.textContent =
    `${requestedOutcome ? `"${requestedOutcome}"` : 'Requested outcome'} · Generated ${nodeCount} nodes × ${actionsPerNode} actions · Best chain integrity ${bestChainIntegrity}%`;

  const nodes = normalizeOutcomeNodeList(report?.action_space, 10);
  const chainCards = chains
    .map((chain, index) => {
      const integrity = toSafePercent(chain?.chain_metrics?.chain_integrity_percent, 0).toFixed(2);
      const logic = toSafePercent(chain?.chain_metrics?.logicality_percent, 0).toFixed(2);
      const ethics = toSafePercent(chain?.chain_metrics?.ethics_legal_percent, 0).toFixed(2);
      const practicality = toSafePercent(chain?.chain_metrics?.practicality_percent, 0).toFixed(2);
      const specificity = toSafePercent(chain?.chain_metrics?.specificity_percent, 0).toFixed(2);
      const transitionsPassed = Number(chain?.chain_metrics?.transitions_passed || 0) || 0;
      const transitionsTotal = Number(chain?.chain_metrics?.transitions_total || 0) || 0;
      const transitionChecks = Array.isArray(chain?.transition_checks) ? chain.transition_checks : [];
      const transitionRows = transitionChecks
        .slice(0, 9)
        .map((check) => {
          const fromNode = Number(check?.from_node_index || 0) || 0;
          const toNode = Number(check?.to_node_index || 0) || 0;
          const pass = Boolean(check?.pass);
          const note = escapeHtml(check?.note || '');
          return `<div><strong>N${fromNode}→N${toNode}</strong> ${pass ? 'PASS' : 'FAIL'} · L ${toSafePercent(check?.logicality_percent, 0).toFixed(1)}% · P ${toSafePercent(check?.practicality_percent, 0).toFixed(1)}% · E/L ${toSafePercent(check?.ethics_legal_percent, 0).toFixed(1)}%${note ? `<br><span class="kv">${note}</span>` : ''}</div>`;
        })
        .join('');
      const actions = Array.isArray(chain?.actions) ? chain.actions : [];
      const chainRows = actions
        .slice(0, 10)
        .map((item) => {
          const nodeIndex = Number(item?.node_index || 0) || 0;
          const actionText = escapeHtml(item?.action || '');
          return `<div><strong>N${nodeIndex}</strong>: ${actionText}</div>`;
        })
        .join('');

      return `
        <article class="pathway-card">
          <h4>Scenario ${index + 1}</h4>
          <div class="pathway-meta">
            <span>Integrity ${integrity}%</span>
            <span>Logicality ${logic}%</span>
            <span>Practicality ${practicality}%</span>
            <span>Ethics/Legal ${ethics}%</span>
            <span>Specificity ${specificity}%</span>
            <span>Transitions ${transitionsPassed}/${transitionsTotal}</span>
          </div>
          <div class="pathway-actions">${chainRows}</div>
          ${transitionRows ? `<div class="pathway-actions">${transitionRows}</div>` : ''}
        </article>
      `;
    })
    .join('');

  const nodeCards = nodes
    .map((node) => {
      const nodeIndex = Number(node?.node_index || 0) || 0;
      const nodeTitle = escapeHtml(node?.node_title || `Node ${nodeIndex || '?'}`);
      const actions = Array.isArray(node?.actions) ? node.actions : [];
      const actionRows = actions
        .slice(0, 5)
        .map((action) => {
          const actionText = escapeHtml(action?.action || '');
          const rationaleText = escapeHtml(action?.rationale || '');
          const geneSlot = Number(action?.gene_slot || 0) || 0;
          return `<div><strong>${escapeHtml(action?.id || '')}${geneSlot ? ` · G${geneSlot}` : ''}</strong>: ${actionText}${rationaleText ? `<br><span class="kv">${rationaleText}</span>` : ''}</div>`;
        })
        .join('');

      return `
        <article class="pathway-card">
          <h4>N${nodeIndex} · ${nodeTitle}</h4>
          <div class="pathway-meta">
            <span>${actions.length} actions</span>
          </div>
          <div class="pathway-actions">${actionRows}</div>
        </article>
      `;
    })
    .join('');

  outcomePathwayGridEl.innerHTML = `${chainCards}${nodeCards}`;

  outcomeResultsEl.hidden = false;
}

function evaluateOutcomeSetup(optionA, optionB, requestedOutcome) {
  if (!optionA || !optionB) {
    return { ready: false, reason: 'Select both personas to run Outcomes Test.' };
  }
  if (optionA.key === optionB.key) {
    return { ready: false, reason: 'Choose two different personas for Outcomes Test.' };
  }
  if (!String(requestedOutcome || '').trim()) {
    return { ready: false, reason: 'Enter a requested outcome first.' };
  }
  return { ready: true, reason: '' };
}

function updateOutcomeUI() {
  if (!outcomeSelectA || !outcomeSelectB || !outcomeRunBtn) return;
  const optionA = optionByKey.get(outcomeSelectA.value);
  const optionB = optionByKey.get(outcomeSelectB.value);
  const requestedOutcome = outcomeRequestedOutcomeEl ? outcomeRequestedOutcomeEl.value : '';
  const evaluation = evaluateOutcomeSetup(optionA, optionB, requestedOutcome);
  if (!evaluation.ready) {
    outcomeRunBtn.disabled = true;
    setOutcomeReadyState(false);
    setOutcomeStatus(evaluation.reason, 'error');
    return;
  }
  outcomeRunBtn.disabled = false;
  setOutcomeReadyState(true);
  setOutcomeStatus('', 'info');
}

function buildOutcomePayload(optionA, optionB, signatureA, signatureB) {
  return {
    initial_conditions: String(outcomeInitialConditionsEl?.value || '').trim(),
    requested_outcome: String(outcomeRequestedOutcomeEl?.value || '').trim(),
    personaA: {
      key: optionA.key,
      label: optionA.label,
      signature: signatureA,
      profile: getProfilePayload(optionA)
    },
    personaB: {
      key: optionB.key,
      label: optionB.label,
      signature: signatureB,
      profile: getProfilePayload(optionB)
    },
    action_space_only: true,
    config: {
      node_count: 10,
      actions_per_node: 5
    }
  };
}

async function fetchOutcomeReport(payload) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token || '';
  const response = await fetch('/api/outcome-test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(payload)
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = String(json?.error || 'Outcome test request failed');
    throw new Error(message);
  }
  if (!json || typeof json !== 'object') {
    throw new Error('Outcome test returned an invalid response');
  }
  return json;
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
  currentUserId = userId;
  const userMetadata = data.session.user.user_metadata || {};
  const [userProfileRow, personaRows] = await Promise.all([
    fetchUserProfile(userId),
    fetchPersonas(userId)
  ]);
  currentUserProfileJson = userProfileRow?.profile && typeof userProfileRow.profile === 'object'
    ? userProfileRow.profile
    : {};

  personaOptions = buildOptions(userProfileRow, personaRows, userMetadata);
  optionByKey = new Map(personaOptions.map((item) => [item.key, item]));
  populateSelectors();
}

selectA.addEventListener('change', updateFitnessUI);
selectB.addEventListener('change', updateFitnessUI);
if (outcomeSelectA) outcomeSelectA.addEventListener('change', updateOutcomeUI);
if (outcomeSelectB) outcomeSelectB.addEventListener('change', updateOutcomeUI);
if (outcomeRequestedOutcomeEl) outcomeRequestedOutcomeEl.addEventListener('input', updateOutcomeUI);

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
      void persistFitnessReportToAccount(reusableReport);
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
    await persistFitnessReportToAccount(finalData);
    window.location.href = 'fitness-test-results.html';
  } catch (error) {
    setReadyState(false);
    setStatus(`Fitness Test failed: ${error?.message || 'Unexpected error'}`, 'error');
  }
});

if (outcomeRunBtn) {
  outcomeRunBtn.addEventListener('click', async () => {
    const optionA = optionByKey.get(outcomeSelectA?.value || '');
    const optionB = optionByKey.get(outcomeSelectB?.value || '');
    const requestedOutcome = String(outcomeRequestedOutcomeEl?.value || '').trim();
    const evaluation = evaluateOutcomeSetup(optionA, optionB, requestedOutcome);
    if (!evaluation.ready) {
      outcomeRunBtn.disabled = true;
      setOutcomeReadyState(false);
      setOutcomeStatus(evaluation.reason, 'error');
      return;
    }

    try {
      const signatureA = buildPersonaSignature(optionA);
      const signatureB = buildPersonaSignature(optionB);
      const payload = buildOutcomePayload(optionA, optionB, signatureA, signatureB);
      const report = await runOutcomeWithProgress(async () => {
        const response = await fetchOutcomeReport(payload);
        return {
          ...response,
          persona_a: {
            ...(response?.persona_a && typeof response.persona_a === 'object' ? response.persona_a : {}),
            key: optionA.key,
            label: optionA.label,
            signature: signatureA
          },
          persona_b: {
            ...(response?.persona_b && typeof response.persona_b === 'object' ? response.persona_b : {}),
            key: optionB.key,
            label: optionB.label,
            signature: signatureB
          },
          persona_keys: Array.from(new Set([optionA.key, optionB.key].map((key) => sanitizePersonaKey(key)).filter(Boolean))),
          requested_outcome: requestedOutcome,
          initial_conditions: String(outcomeInitialConditionsEl?.value || '').trim()
        };
      });

      localStorage.setItem(OUTCOME_RESULT_STORAGE_KEY, JSON.stringify(report));
      await persistOutcomeReportToAccount(report);
      window.location.href = 'outcome-test-results.html';
    } catch (error) {
      setOutcomeReadyState(false);
      setOutcomeStatus(`Outcomes Test failed: ${error?.message || 'Unexpected error'}`, 'error');
    }
  });
}

initialize();
