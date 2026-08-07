import { supabase } from './supabase-client.js';

const USER_PROFILE_TABLE = 'user_profiles';
const PERSONA_TABLE = 'personas';
const SYNTHETIC_USER_KEY = '__user_persona__';
const FITNESS_RESULT_STORAGE_KEY = 'insight-lab:last-fitness-test';
const FITNESS_HISTORY_STORAGE_KEY = 'insight-lab:fitness-report-history';
const INSIGHT_LAB_PROFILE_KEY = 'insight_lab';
const ACCOUNT_FITNESS_REPORTS_KEY = 'fitness_reports';
const ACCOUNT_OUTCOME_REPORTS_KEY = 'outcome_reports';
const ACCOUNT_OUTCOME_QUEUE_KEY = 'outcome_job_queue';
const ACCOUNT_OUTCOME_FAILED_KEY = 'outcome_failed_jobs';
const ACCOUNT_OUTCOME_MODEL_SETTINGS_KEY = 'outcome_model_settings';
const MAX_ACCOUNT_FITNESS_REPORTS = 20;
const MAX_ACCOUNT_OUTCOME_REPORTS = 20;
const MAX_ACCOUNT_OUTCOME_FAILED = 30;
const MAX_OUTCOME_QUEUE_ITEMS = 10;
const MAX_OUTCOME_JOB_RETRIES = 3;
const DECISION_TREE_DEMO = 'decision-tree';

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
  L2_A5: 'Inner Confidence ↔ Social Reassurance',
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
const outcomeStopBtn = document.getElementById('stopOutcomeBtn');
const outcomeStatusEl = document.getElementById('outcomeStatus');
const outcomeReadyBadgeEl = document.getElementById('outcomeReadyBadge');
const outcomeReadyLabelEl = document.getElementById('outcomeReadyLabel');
const outcomeResultsEl = document.getElementById('outcomeResults');
const outcomeSummaryTitleEl = document.getElementById('outcomeSummaryTitle');
const outcomeSummaryTextEl = document.getElementById('outcomeSummaryText');
const outcomePathwayGridEl = document.getElementById('outcomePathwayGrid');
const outcomeHistorySectionEl = document.getElementById('outcomeHistorySection');
const outcomeHistoryMetaEl = document.getElementById('outcomeHistoryMeta');
const outcomeHistoryListEl = document.getElementById('outcomeHistoryList');
const outcomeHistoryEmptyEl = document.getElementById('outcomeHistoryEmpty');
const outcomeRunOverlayEl = document.getElementById('outcomeRunOverlay');
const outcomeRunProgressBarEl = document.getElementById('outcomeRunProgressBar');
const outcomeRunProgressTextEl = document.getElementById('outcomeRunProgressText');
const outcomeRunStageEl = document.getElementById('outcomeRunStage');

let personaOptions = [];
let optionByKey = new Map();
let currentUserId = '';
let currentUserProfileJson = {};
let isOutcomeQueueRunning = false;
let currentOutcomeRunningJobId = '';
let outcomeHistoryReportMap = new Map();
let outcomeQueueRetryTimer = null;
let outcomeQueueAbortController = null;
let outcomeStopRequested = false;

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

function isAbortError(error) {
  const name = String(error?.name || '').trim().toLowerCase();
  const message = String(error?.message || '').trim().toLowerCase();
  return name === 'aborterror' || message.includes('aborted') || message.includes('abort');
}

function createOutcomeJobId() {
  return `outcome-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadOutcomeJobQueue() {
  const insightLab = currentUserProfileJson?.[INSIGHT_LAB_PROFILE_KEY] && typeof currentUserProfileJson[INSIGHT_LAB_PROFILE_KEY] === 'object'
    ? currentUserProfileJson[INSIGHT_LAB_PROFILE_KEY]
    : {};
  const queue = Array.isArray(insightLab?.[ACCOUNT_OUTCOME_QUEUE_KEY])
    ? insightLab[ACCOUNT_OUTCOME_QUEUE_KEY]
    : [];
  return queue
    .filter((item) => item && typeof item === 'object')
    .slice(0, MAX_OUTCOME_QUEUE_ITEMS);
}

async function saveOutcomeJobQueue(queue) {
  const safeQueue = Array.isArray(queue) ? queue.slice(0, MAX_OUTCOME_QUEUE_ITEMS) : [];
  const latestProfile = await loadLatestAccountProfileJson();
  const baseProfile = latestProfile && typeof latestProfile === 'object' ? latestProfile : {};
  const insightLab = baseProfile?.[INSIGHT_LAB_PROFILE_KEY] && typeof baseProfile[INSIGHT_LAB_PROFILE_KEY] === 'object'
    ? baseProfile[INSIGHT_LAB_PROFILE_KEY]
    : {};
  const nextProfile = {
    ...baseProfile,
    [INSIGHT_LAB_PROFILE_KEY]: {
      ...insightLab,
      [ACCOUNT_OUTCOME_QUEUE_KEY]: safeQueue,
      updated_at: new Date().toISOString()
    }
  };

  if (currentUserId) {
    const { error } = await supabase
      .from(USER_PROFILE_TABLE)
      .upsert(
        {
          user_id: currentUserId,
          profile: nextProfile
        },
        { onConflict: 'user_id' }
      );
    if (error && !isMissingUserProfileTableError(error)) {
      throw new Error(`Could not persist outcome queue: ${error.message || error}`);
    }
  }
  currentUserProfileJson = nextProfile;
  renderOutcomeTestHistory();
  updateOutcomeUI();
}

function parseRateLimitRetrySecondsFromMessage(message) {
  const text = String(message || '');
  if (!text) return null;
  const match = text.match(/try again in\s+([0-9]+(?:\.[0-9]+)?)s/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds;
}

function computeOutcomeRetryPlan(error, priorRetryCount = 0) {
  const message = String(error?.message || '').trim();
  const lowerMessage = message.toLowerCase();
  const status = Number(error?.status || 0) || 0;
  const stage = String(error?.stage || '').trim().toLowerCase();
  const retryFromPayload = Number(error?.retryAfterSeconds || 0) || 0;
  const resetFromPayload = Number(error?.rateLimitResetSeconds || 0) || 0;
  const retryFromMessage = Number(parseRateLimitRetrySecondsFromMessage(message) || 0) || 0;
  const retryAfterSeconds = Math.max(retryFromPayload, resetFromPayload, retryFromMessage);
  const isAuthOrConfigError =
    status === 400 ||
    status === 401 ||
    status === 403 ||
    stage.startsWith('configuration.');
  const isRateLimited =
    status === 429 ||
    lowerMessage.includes('rate limit') ||
    retryAfterSeconds > 0;
  const isTimeoutLike =
    status === 408 ||
    status === 504 ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('abort');
  const isUpstreamTransient = status === 502 || status === 503;
  const isNetworkTransient =
    !status ||
    lowerMessage.includes('failed to fetch') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('socket') ||
    lowerMessage.includes('econn') ||
    lowerMessage.includes('enotfound');
  const isOpenAiPipelineError = stage.startsWith('openai.');

  if (isAuthOrConfigError) {
    return {
      shouldRetry: false,
      retrySeconds: 0,
      reasonLabel: 'fatal'
    };
  }

  const shouldRetry =
    isOpenAiPipelineError ||
    isRateLimited ||
    isTimeoutLike ||
    isUpstreamTransient ||
    isNetworkTransient;
  if (!shouldRetry) {
    return {
      shouldRetry: false,
      retrySeconds: 0,
      reasonLabel: 'fatal'
    };
  }

  if (retryAfterSeconds > 0) {
    return {
      shouldRetry: true,
      retrySeconds: Math.max(2, Math.ceil(retryAfterSeconds)),
      reasonLabel: isRateLimited ? 'rate_limit' : 'retry_after'
    };
  }

  const retryCount = Math.max(0, Number(priorRetryCount || 0));
  const baseSeconds = isTimeoutLike
    ? 45
    : isUpstreamTransient
      ? 35
      : isNetworkTransient
        ? 25
        : isOpenAiPipelineError
          ? 20
          : 20;
  const exponentialSeconds = Math.round(baseSeconds * Math.pow(1.75, Math.min(retryCount, 8)));

  return {
    shouldRetry: true,
    retrySeconds: Math.max(baseSeconds, Math.min(15 * 60, exponentialSeconds)),
    reasonLabel: isRateLimited
      ? 'rate_limit'
      : isTimeoutLike
        ? 'timeout'
        : isUpstreamTransient
          ? 'upstream'
          : isNetworkTransient
            ? 'network'
            : isOpenAiPipelineError
              ? 'model_response'
              : 'transient'
  };
}

function scheduleOutcomeQueueRetry(delayMs) {
  const safeDelay = Math.max(2000, Math.min(15 * 60 * 1000, Math.round(delayMs)));
  if (outcomeQueueRetryTimer) {
    clearTimeout(outcomeQueueRetryTimer);
    outcomeQueueRetryTimer = null;
  }
  outcomeQueueRetryTimer = setTimeout(() => {
    outcomeQueueRetryTimer = null;
    processOutcomeQueue().catch((error) => {
      setOutcomeStatus(`Best Way failed: ${error?.message || 'Unexpected error'}`, 'error');
    });
  }, safeDelay);
}

function hasOutcomeQueueWork() {
  return (
    isOutcomeQueueRunning ||
    Boolean(currentOutcomeRunningJobId) ||
    Boolean(outcomeQueueRetryTimer) ||
    loadOutcomeJobQueue().length > 0
  );
}

async function stopOutcomeQueueByUser() {
  outcomeStopRequested = true;
  if (outcomeQueueRetryTimer) {
    clearTimeout(outcomeQueueRetryTimer);
    outcomeQueueRetryTimer = null;
  }
  if (outcomeQueueAbortController) {
    try {
      outcomeQueueAbortController.abort();
    } catch (_) {
      // no-op
    }
  }

  const pendingJobs = loadOutcomeJobQueue();
  const removedCount = pendingJobs.length;
  if (removedCount) {
    await saveOutcomeJobQueue([]);
  } else {
    updateOutcomeUI();
  }

  const wasRunning = isOutcomeQueueRunning || Boolean(currentOutcomeRunningJobId);
  if (wasRunning || removedCount > 0) {
    setOutcomeStatus(`Best Way stopped by user. Removed ${removedCount} queued job${removedCount === 1 ? '' : 's'}.`, 'info');
  } else {
    setOutcomeStatus('No active Best Way run to stop.', 'info');
  }
}

function notifyOutcomeComplete(title, body) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, { body });
    } catch (_) {
      // no-op
    }
    return;
  }
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
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

function isFallbackGeneratedOutcomeReport(report) {
  const source = String(report?.generator_source || report?.generatorSource || '').trim().toLowerCase();
  return source.startsWith('fallback');
}

function formatHistoryDateTime(value) {
  const stamp = String(value || '').trim();
  if (!stamp) return 'Time unavailable';
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return date.toLocaleString([], {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function mergeUniqueOutcomeReports(reports) {
  const source = Array.isArray(reports) ? reports : [];
  const merged = [];
  const seen = new Set();

  source.forEach((report) => {
    if (!report || typeof report !== 'object') return;
    if (isFallbackGeneratedOutcomeReport(report)) return;
    const fingerprint = getOutcomeReportStorageFingerprint(report);
    const dedupeKey = fingerprint || `dedupe:${reportTimestampValue(report)}:${String(report?.requested_outcome || '').trim().toLowerCase()}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    merged.push(report);
  });

  merged.sort((left, right) => reportTimestampValue(right) - reportTimestampValue(left));
  return merged.slice(0, MAX_ACCOUNT_OUTCOME_REPORTS);
}

function getOutcomeReportsFromProfile(profileJson) {
  const insightLab = profileJson?.[INSIGHT_LAB_PROFILE_KEY] && typeof profileJson[INSIGHT_LAB_PROFILE_KEY] === 'object'
    ? profileJson[INSIGHT_LAB_PROFILE_KEY]
    : {};
  const accountReports = Array.isArray(insightLab?.[ACCOUNT_OUTCOME_REPORTS_KEY])
    ? insightLab[ACCOUNT_OUTCOME_REPORTS_KEY]
    : [];
  return mergeUniqueOutcomeReports(accountReports);
}

function failedOutcomeTimestampValue(entry) {
  const stamp = String(entry?.failed_at || entry?.failedAt || entry?.updated_at || entry?.queued_at || '').trim();
  if (!stamp) return 0;
  const epoch = Date.parse(stamp);
  return Number.isFinite(epoch) ? epoch : 0;
}

function normalizeOutcomeFailedJobForAccountStorage(failedJob) {
  if (!failedJob || typeof failedJob !== 'object') return null;
  const personaA = failedJob?.persona_a && typeof failedJob.persona_a === 'object'
    ? failedJob.persona_a
    : failedJob?.personaA && typeof failedJob.personaA === 'object'
      ? failedJob.personaA
      : {};
  const personaB = failedJob?.persona_b && typeof failedJob.persona_b === 'object'
    ? failedJob.persona_b
    : failedJob?.personaB && typeof failedJob.personaB === 'object'
      ? failedJob.personaB
      : {};
  const normalizedId = String(failedJob.id || '').trim() || `failed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const attempts = Math.max(1, Math.round(Number(failedJob.attempts || failedJob.retry_count || 1) || 1));
  const lastErrorStatus = Number(failedJob.last_error_status);
  return {
    id: normalizedId,
    queued_at: String(failedJob.queued_at || '').trim() || null,
    failed_at: String(failedJob.failed_at || '').trim() || new Date().toISOString(),
    requested_outcome: sanitizeText(failedJob.requested_outcome || failedJob.requestedOutcome || '', 320),
    persona_a: {
      key: sanitizePersonaKey(personaA.key || ''),
      label: sanitizeText(personaA.label || '', 120),
      signature: personaA.signature && typeof personaA.signature === 'object' ? personaA.signature : {}
    },
    persona_b: {
      key: sanitizePersonaKey(personaB.key || ''),
      label: sanitizeText(personaB.label || '', 120),
      signature: personaB.signature && typeof personaB.signature === 'object' ? personaB.signature : {}
    },
    attempts,
    last_error: sanitizeText(failedJob.last_error || failedJob.error || 'Unknown error', 1000),
    last_error_status: Number.isFinite(lastErrorStatus) ? lastErrorStatus : null,
    last_retry_reason: sanitizeText(failedJob.last_retry_reason || '', 60).toLowerCase(),
    stage: sanitizeText(failedJob.stage || '', 120).toLowerCase(),
    updated_at: new Date().toISOString()
  };
}

function mergeUniqueOutcomeFailedJobs(failedJobs) {
  const source = Array.isArray(failedJobs) ? failedJobs : [];
  const merged = [];
  const seen = new Set();
  source.forEach((entry) => {
    const normalized = normalizeOutcomeFailedJobForAccountStorage(entry);
    if (!normalized) return;
    const id = String(normalized.id || '').trim();
    const dedupeKey = id || `dedupe:${failedOutcomeTimestampValue(normalized)}:${normalized.requested_outcome}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    merged.push(normalized);
  });
  merged.sort((left, right) => failedOutcomeTimestampValue(right) - failedOutcomeTimestampValue(left));
  return merged.slice(0, MAX_ACCOUNT_OUTCOME_FAILED);
}

function getOutcomeFailedJobsFromProfile(profileJson) {
  const insightLab = profileJson?.[INSIGHT_LAB_PROFILE_KEY] && typeof profileJson[INSIGHT_LAB_PROFILE_KEY] === 'object'
    ? profileJson[INSIGHT_LAB_PROFILE_KEY]
    : {};
  const failedJobs = Array.isArray(insightLab?.[ACCOUNT_OUTCOME_FAILED_KEY])
    ? insightLab[ACCOUNT_OUTCOME_FAILED_KEY]
    : [];
  return mergeUniqueOutcomeFailedJobs(failedJobs);
}

function mergeOutcomeFailedJobIntoProfile(profileJson, failedJob) {
  const baseProfile = profileJson && typeof profileJson === 'object' ? profileJson : {};
  const insightLab = baseProfile?.[INSIGHT_LAB_PROFILE_KEY] && typeof baseProfile[INSIGHT_LAB_PROFILE_KEY] === 'object'
    ? baseProfile[INSIGHT_LAB_PROFILE_KEY]
    : {};
  const existingFailedJobs = Array.isArray(insightLab?.[ACCOUNT_OUTCOME_FAILED_KEY])
    ? insightLab[ACCOUNT_OUTCOME_FAILED_KEY]
    : [];
  const incoming = normalizeOutcomeFailedJobForAccountStorage(failedJob);
  if (!incoming) return baseProfile;

  const incomingId = String(incoming.id || '').trim();
  const filtered = existingFailedJobs.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (!incomingId) return true;
    return String(entry.id || '').trim() !== incomingId;
  });
  filtered.unshift(incoming);
  const trimmed = mergeUniqueOutcomeFailedJobs(filtered);

  return {
    ...baseProfile,
    [INSIGHT_LAB_PROFILE_KEY]: {
      ...insightLab,
      [ACCOUNT_OUTCOME_FAILED_KEY]: trimmed,
      updated_at: new Date().toISOString()
    }
  };
}

async function persistFailedOutcomeJob(failedJob) {
  if (!currentUserId || !failedJob || typeof failedJob !== 'object') return;
  try {
    const latestProfile = await loadLatestAccountProfileJson();
    const nextProfile = mergeOutcomeFailedJobIntoProfile(latestProfile, failedJob);
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
        console.warn('Could not persist failed outcome job to account storage:', error.message || error);
      }
      return;
    }
    currentUserProfileJson = nextProfile;
    renderOutcomeTestHistory();
  } catch (error) {
    console.warn('Unexpected error while saving failed outcome job to account storage:', error?.message || error);
  }
}

function renderOutcomeTestHistory() {
  if (!outcomeHistorySectionEl || !outcomeHistoryMetaEl || !outcomeHistoryListEl || !outcomeHistoryEmptyEl) return;

  const queue = loadOutcomeJobQueue();
  const reports = getOutcomeReportsFromProfile(currentUserProfileJson).slice(0, 10);
  const failedJobs = getOutcomeFailedJobsFromProfile(currentUserProfileJson).slice(0, 10);
  const historyRows = [];
  outcomeHistoryReportMap = new Map();

  queue.forEach((job, index) => {
    const isRunning = isOutcomeQueueRunning && (currentOutcomeRunningJobId ? currentOutcomeRunningJobId === job.id : index === 0);
    const pairLabel = `${String(job?.personaA?.label || 'Persona A').trim()} → ${String(job?.personaB?.label || 'Persona B').trim()}`;
    const requestedOutcome = String(job?.requestedOutcome || '').trim() || 'No requested outcome provided';
    const retryStamp = String(job?.next_retry_at || '').trim();
    const retryInfo = retryStamp
      ? ` · <strong>Next retry:</strong> ${escapeHtml(formatHistoryDateTime(retryStamp))}`
      : '';
    historyRows.push(`
      <article class="outcome-history-item">
        <div class="outcome-history-top">
          <span class="outcome-history-label">${escapeHtml(pairLabel)}</span>
          <span class="history-pill ${isRunning ? 'running' : 'queued'}">${isRunning ? 'Running' : 'Queued'}</span>
        </div>
        <div class="outcome-history-meta"><strong>Goal:</strong> ${escapeHtml(requestedOutcome)}${retryInfo}</div>
        <div class="outcome-history-time">${escapeHtml(formatHistoryDateTime(job?.queued_at))}</div>
      </article>
    `);
  });

  failedJobs.forEach((failedJob) => {
    const personaALabel = String(failedJob?.persona_a?.label || failedJob?.personaA?.label || 'Persona A').trim();
    const personaBLabel = String(failedJob?.persona_b?.label || failedJob?.personaB?.label || 'Persona B').trim();
    const requestedOutcome = String(failedJob?.requested_outcome || failedJob?.requestedOutcome || '').trim() || 'No requested outcome provided';
    const attempts = Math.max(1, Number(failedJob?.attempts || failedJob?.retry_count || 1) || 1);
    const lastError = truncate(String(failedJob?.last_error || failedJob?.error || 'Unknown error').trim(), 180);
    const statusInfo = failedJob?.last_error_status ? ` · <strong>Status:</strong> ${escapeHtml(String(failedJob.last_error_status))}` : '';
    historyRows.push(`
      <article class="outcome-history-item">
        <div class="outcome-history-top">
          <span class="outcome-history-label">${escapeHtml(`${personaALabel} → ${personaBLabel}`)}</span>
          <span class="history-pill failed">Failed</span>
        </div>
        <div class="outcome-history-meta"><strong>Goal:</strong> ${escapeHtml(requestedOutcome)} · <strong>Attempts:</strong> ${escapeHtml(String(attempts))}/${MAX_OUTCOME_JOB_RETRIES}${statusInfo}</div>
        <div class="outcome-history-meta"><strong>Last error:</strong> ${escapeHtml(lastError)}</div>
        <div class="outcome-history-time">${escapeHtml(formatHistoryDateTime(failedJob?.failed_at || failedJob?.updated_at || failedJob?.queued_at))}</div>
      </article>
    `);
  });

  reports.forEach((report) => {
    const personaALabel = String(report?.persona_a?.label || report?.personaA?.label || 'Persona A').trim();
    const personaBLabel = String(report?.persona_b?.label || report?.personaB?.label || 'Persona B').trim();
    const requestedOutcome = String(report?.requested_outcome || report?.requestedOutcome || '').trim() || 'No requested outcome provided';
    const integrity = toSafePercent(report?.best_chain?.chain_metrics?.chain_integrity_percent, 0).toFixed(2);
    const reportKeyBase = getOutcomeReportStorageFingerprint(report) || `${personaALabel}|${personaBLabel}|${requestedOutcome}|${reportTimestampValue(report)}`;
    const reportKey = encodeURIComponent(reportKeyBase);
    outcomeHistoryReportMap.set(reportKey, report);
    historyRows.push(`
      <article class="outcome-history-item outcome-history-item-clickable" data-report-key="${reportKey}" title="Open detailed result">
        <div class="outcome-history-top">
          <span class="outcome-history-label">${escapeHtml(`${personaALabel} → ${personaBLabel}`)}</span>
          <span class="history-pill done">Done</span>
        </div>
        <div class="outcome-history-meta"><strong>Goal:</strong> ${escapeHtml(requestedOutcome)} · <strong>Best integrity:</strong> ${escapeHtml(integrity)}% · <strong>Click to view details</strong></div>
        <div class="outcome-history-time">${escapeHtml(formatHistoryDateTime(report?.generated_at || report?.generatedAt))}</div>
      </article>
    `);
  });

  const queuedCount = queue.length;
  const completedCount = reports.length;
  const failedCount = failedJobs.length;
  outcomeHistoryMetaEl.textContent = `${queuedCount} queued · ${completedCount} completed · ${failedCount} failed`;
  outcomeHistoryListEl.innerHTML = historyRows.join('');
  const hasHistory = historyRows.length > 0;
  outcomeHistoryEmptyEl.hidden = hasHistory;
  if (!hasHistory) {
    outcomeHistoryMetaEl.textContent = 'No queued, completed, or failed tests yet';
  }
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
    renderOutcomeTestHistory();
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
    return { ready: false, reason: 'Choose one comparison target for the Compatibility Sheet.' };
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

  const personaAOptions = personaOptions.filter((option) => option.type === 'user' || option.isLinkedUser);
  const personaBOptions = personaOptions.filter((option) => option.type !== 'user' && !option.isLinkedUser);
  const selectableA = personaAOptions.length ? personaAOptions : personaOptions.slice(0, 1);
  const selectableB = personaBOptions.length
    ? personaBOptions
    : personaOptions.filter((option) => option.key !== selectableA[0]?.key);

  selectableA.forEach((option) => {
    const optA = document.createElement('option');
    optA.value = option.key;
    optA.textContent = option.label;
    selectA.appendChild(optA);
  });

  selectableB.forEach((option) => {
    const optB = document.createElement('option');
    optB.value = option.key;
    optB.textContent = option.label;
    selectB.appendChild(optB);
  });

  personaOptions.forEach((option) => {
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

  if (!personaOptions.length || !selectableA.length || !selectableB.length) {
    selectA.innerHTML = '<option value="">No personas available</option>';
    selectB.innerHTML = '<option value="">No comparison targets available</option>';
    if (outcomeSelectA) outcomeSelectA.innerHTML = '<option value="">No personas available</option>';
    if (outcomeSelectB) outcomeSelectB.innerHTML = '<option value="">No personas available</option>';
    runBtn.disabled = true;
    if (outcomeRunBtn) outcomeRunBtn.disabled = true;
    setReadyState(false);
    setOutcomeReadyState(false);
    setStatus('Persona A needs a user persona and Persona B needs at least one comparison target.', 'error');
    setOutcomeStatus('No personas found for this account.', 'error');
    renderPreview(previewA, null);
    renderPreview(previewB, null);
    return;
  }

  const firstKey = selectableA[0]?.key || '';
  const secondKey = selectableB[0]?.key || '';
  selectA.value = firstKey;
  selectB.value = secondKey;
  const outcomeFirstKey = personaOptions.find((item) => item.type === 'user' || item.isLinkedUser)?.key || personaOptions[0]?.key || '';
  const outcomeSecondKey = personaOptions.find((item) => item.key !== outcomeFirstKey)?.key || outcomeFirstKey;
  if (outcomeSelectA) outcomeSelectA.value = outcomeFirstKey;
  if (outcomeSelectB) {
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
          raw_db_row: row,
          raw_db_profile: rowProfile,
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
    return 'Finalizing Compatibility Sheet...';
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
  setOutcomeRunOverlayProgress(0, 'Computing Best Way scenarios...');
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

function openOutcomeReportDetails(report) {
  if (!report || typeof report !== 'object') {
    setOutcomeStatus('Unable to open report details: report payload is missing.', 'error');
    return;
  }
  try {
    const reportId = String(report?.report_id || '').trim();
    const generatedAt = String(report?.generated_at || report?.generatedAt || '').trim();
    const query = reportId
      ? `?report_id=${encodeURIComponent(reportId)}`
      : generatedAt
        ? `?generated_at=${encodeURIComponent(generatedAt)}`
        : '';
    if (isDecisionTreeDemo()) {
      const params = new URLSearchParams(query ? query.slice(1) : '');
      params.set('demo', DECISION_TREE_DEMO);
      window.location.href = `outcome-test-results.html?${params.toString()}`;
      return;
    }
    window.location.href = `outcome-test-results.html${query}`;
  } catch (error) {
    setOutcomeStatus(`Unable to open report details: ${error?.message || 'storage write failed'}`, 'error');
  }
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
    `${requestedOutcome ? `"${requestedOutcome}"` : 'Requested goal'} · Generated ${nodeCount} nodes × ${actionsPerNode} actions · Best chain integrity ${bestChainIntegrity}%`;

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

function buildDemoProfile(name, axisScores, extras, headline) {
  const traitVector = {};
  Object.entries(axisScores).forEach(([layerId, layer]) => {
    Object.entries(layer).forEach(([axisId, value]) => {
      traitVector[axisId] = {
        layer_id: layerId,
        value,
        confidence: 0.76
      };
    });
  });

  return {
    schema_version: 'demo-1.0',
    persona_name: name,
    personal_headline: headline,
    quantitative_data: {
      axis_scores: axisScores,
      trait_vector: traitVector
    },
    qualitative_data: {
      personal_headline: headline,
      extras_text: extras,
      qualitative_tags: Object.values(extras)
        .join(' ')
        .toLowerCase()
        .split(/\W+/)
        .filter((token) => token.length > 3)
        .slice(0, 80)
    },
    extras
  };
}

function buildDemoOptions() {
  const mayaAxis = {
    L1: { L1_A1: 0.68, L1_A2: 0.72, L1_A3: 0.42, L1_A4: 0.55, L1_A5: 0.58, L1_A6: 0.61 },
    L2: { L2_A1: 0.52, L2_A2: 0.48, L2_A3: 0.62, L2_A4: 0.32, L2_A5: 0.64, L2_A6: 0.76 },
    L3: { L3_A1: 0.78, L3_A2: 0.82, L3_A3: 0.7, L3_A4: 0.66, L3_A5: 0.76, L3_A6: 0.54 }
  };
  const danielAxis = {
    L1: { L1_A1: 0.62, L1_A2: 0.66, L1_A3: 0.42, L1_A4: 0.56, L1_A5: 0.48, L1_A6: 0.58 },
    L2: { L2_A1: 0.54, L2_A2: 0.46, L2_A3: 0.63, L2_A4: 0.35, L2_A5: 0.58, L2_A6: 0.72 },
    L3: { L3_A1: 0.73, L3_A2: 0.76, L3_A3: 0.66, L3_A4: 0.62, L3_A5: 0.68, L3_A6: 0.52 }
  };
  const aaronAxis = {
    L1: { L1_A1: 0.7, L1_A2: 0.82, L1_A3: 0.34, L1_A4: 0.5, L1_A5: 0.42, L1_A6: 0.46 },
    L2: { L2_A1: 0.38, L2_A2: 0.44, L2_A3: 0.58, L2_A4: 0.42, L2_A5: 0.52, L2_A6: 0.64 },
    L3: { L3_A1: 0.8, L3_A2: 0.86, L3_A3: 0.88, L3_A4: 0.58, L3_A5: 0.72, L3_A6: 0.78 }
  };
  const naomiAxis = {
    L1: { L1_A1: 0.78, L1_A2: 0.84, L1_A3: 0.58, L1_A4: 0.62, L1_A5: 0.6, L1_A6: 0.68 },
    L2: { L2_A1: 0.44, L2_A2: 0.72, L2_A3: 0.7, L2_A4: 0.58, L2_A5: 0.48, L2_A6: 0.52 },
    L3: { L3_A1: 0.82, L3_A2: 0.78, L3_A3: 0.62, L3_A4: 0.72, L3_A5: 0.84, L3_A6: 0.7 }
  };

  return [
    {
      key: SYNTHETIC_USER_KEY,
      label: 'Maya Chen (You)',
      sourceLabel: 'Demo User Persona',
      type: 'user',
      data: {
        avatar_url: 'assets/maya-chen-avatar.png',
        display_name: 'Maya Chen',
        personal_headline: '22-year-old student who wants clarity while staying kind and low pressure',
        goals: 'Invite Daniel to talk about where the relationship is going while keeping the message warm, respectful, and easy to answer honestly.',
        strengths: 'Emotionally observant, sincere, patient, and careful with tone. Maya notices when timing, wording, or pressure could change how a message lands.',
        constraints: 'Maya gets one real-world conversation to initiate and wants to avoid making Daniel feel cornered, rushed, or responsible for her anxiety.',
        communication_style: 'Warm, reflective, considerate, and direct when clarity matters. Maya prefers invitations, plain language, and room for the other person to respond.',
        user_profile: buildDemoProfile(
          'Maya Chen',
          mayaAxis,
          {
            'basic-profile': 'Maya Chen. Female. 22 yrs old. Undergraduate student in San Francisco.',
            goal: 'Invite a deeper relationship conversation with care',
            tone: 'Warm, thoughtful, low pressure',
            strengths: 'Notices emotional nuance and tries to choose words that respect both people.',
            concern: 'Does not want clarity to sound like an ultimatum.',
            decision_context: 'One real-world relationship action with Daniel Smith'
          },
          '22-year-old student who wants clarity while staying kind and low pressure'
        )
      }
    },
    {
      key: 'daniel-smith-demo',
      label: 'Daniel Smith',
      sourceLabel: 'Demo Relationship Persona',
      type: 'persona',
      data: {
        avatar_url: 'assets/daniel-smith-cartoon-avatar.png',
        name: 'Daniel Smith',
        profile: buildDemoProfile(
          'Daniel Smith',
          danielAxis,
          {
            'basic-profile': 'Daniel Smith. Male. 23 yrs old. Graduate student in product design.',
            relationship_role: 'Romantic interest and close relationship focus for Maya Chen',
            likely_response_pattern: 'Responds well to warm invitations, specific wording, and steady pacing.',
            emotional_needs: 'Needs room to think and a sense that his response is welcome either way.',
            concern: 'May become reserved if the tone feels rushed, overly heavy, or like an immediate answer is required.',
            decision_context: 'Best Way should balance clarity with emotional room.'
          },
          'Warm, sincere, and receptive when directness is paired with emotional room'
        )
      }
    },
    {
      key: 'aaron-chen-demo',
      label: 'Aaron Chen',
      sourceLabel: 'Demo Family Persona',
      type: 'persona',
      data: {
        avatar_url: 'assets/aaron-chen-cartoon-avatar.png',
        name: 'Aaron Chen',
        profile: buildDemoProfile(
          'Aaron Chen',
          aaronAxis,
          {
            'basic-profile': 'Aaron Chen. Male. 55 yrs old. Maya Chen\'s father.',
            relationship_role: 'Family persona and father figure Maya wants to approach with care',
            likely_response_pattern: 'Responds best to honest context, practical next steps, and being included respectfully.',
            emotional_needs: 'Needs to know Maya is safe, thinking clearly, and not carrying a difficult choice alone.',
            concern: 'May worry quickly if information arrives suddenly or without enough practical context.',
            decision_context: 'Best Way should help Maya share important family news with warmth and preparation.'
          },
          'Protective, practical, and warm when Maya leads with honesty and a clear plan'
        )
      }
    },
    {
      key: 'naomi-brooks-demo',
      label: 'Naomi Brooks',
      sourceLabel: 'Demo Workplace Persona',
      type: 'persona',
      data: {
        avatar_url: 'assets/naomi-brooks-cartoon-avatar.png',
        name: 'Naomi Brooks',
        profile: buildDemoProfile(
          'Naomi Brooks',
          naomiAxis,
          {
            'basic-profile': 'Naomi Brooks. Female. 39 yrs old. Maya Chen\'s manager and team lead.',
            relationship_role: 'Workplace persona and professional decision maker Maya wants to approach clearly',
            likely_response_pattern: 'Responds best to concise evidence, accountability, and requests that protect team work.',
            emotional_needs: 'Needs clarity, specificity, and evidence that Maya understands business pressure.',
            concern: 'May become more evaluative if the ask is vague, delayed, or disconnected from team impact.',
            decision_context: 'Best Way should help Maya make professional conversations specific, fair, and easy to evaluate.'
          },
          'Fair, direct, and supportive when requests are specific, accountable, and team-aware'
        )
      }
    }
  ];
}

function buildDemoOutcomeReport() {
  return {
    report_id: 'demo-maya-daniel-outcome',
    generated_at: new Date().toISOString(),
    requested_outcome: "Invite Daniel to talk about where the relationship is going without making the message feel heavy.",
    persona_a: { key: SYNTHETIC_USER_KEY, label: 'Maya Chen' },
    persona_b: { key: 'daniel-smith-demo', label: 'Daniel Smith' },
    config: { node_count: 3, actions_per_node: 3 },
    best_chain: {
      chain_metrics: {
        chain_integrity_percent: 86,
        logicality_percent: 88,
        ethics_legal_percent: 96,
        practicality_percent: 91,
        specificity_percent: 84,
        transitions_passed: 3,
        transitions_total: 3
      }
    },
    chain_candidates: [
      {
        chain_metrics: {
          chain_integrity_percent: 86,
          logicality_percent: 88,
          ethics_legal_percent: 96,
          practicality_percent: 91,
          specificity_percent: 84,
          transitions_passed: 3,
          transitions_total: 3
        },
        actions: [
          { node_index: 1, action: 'Use the light and open-ended invitation first.' },
          { node_index: 2, action: 'If Daniel responds warmly, name the topic with one clear sentence.' },
          { node_index: 3, action: 'Let the conversation breathe before asking for a firm answer.' }
        ],
        transition_checks: [
          { from_node_index: 1, to_node_index: 2, pass: true, logicality_percent: 89, practicality_percent: 92, ethics_legal_percent: 96, note: 'Warmth lowers pressure before clarity.' },
          { from_node_index: 2, to_node_index: 3, pass: true, logicality_percent: 87, practicality_percent: 91, ethics_legal_percent: 97, note: 'Space keeps the invitation mutual.' }
        ]
      }
    ],
    action_space: [
      {
        node_index: 1,
        node_title: 'Opening message',
        actions: [
          { id: 'A1', gene_slot: 1, action: 'Would you be up for a relaxed check-in this weekend?', rationale: 'Highest probability of feeling invitational rather than pressuring.' },
          { id: 'A2', gene_slot: 2, action: "I've valued our time together. Could we talk about where this is going?", rationale: 'Clearer but more serious.' },
          { id: 'A3', gene_slot: 3, action: "I've been thinking about us in a good way.", rationale: 'Sincere, but may feel heavier upfront.' }
        ]
      },
      {
        node_index: 2,
        node_title: 'Likely consequence range',
        actions: [
          { id: 'B1', gene_slot: 1, action: 'Daniel feels invited, not cornered: 52-60%', rationale: 'Best match for his warm but careful response pattern.' },
          { id: 'B2', gene_slot: 2, action: 'Topic stays too vague: 20-28%', rationale: 'May require one follow-up clarifying sentence.' },
          { id: 'B3', gene_slot: 3, action: 'Conversation opens naturally: 18-26%', rationale: 'Most likely if timing and mood are calm.' }
        ]
      },
      {
        node_index: 3,
        node_title: 'Recommended next move',
        actions: [
          { id: 'C1', gene_slot: 1, action: 'Start with Option B, then clarify gently if Daniel responds warmly.', rationale: 'Balances warmth and clarity.' },
          { id: 'C2', gene_slot: 2, action: 'Choose Option A if clarity matters more than lightness.', rationale: 'Better when avoiding ambiguity is the top priority.' },
          { id: 'C3', gene_slot: 3, action: 'Avoid compressing the invitation and the desired answer into one message.', rationale: 'Reduces emotional pressure.' }
        ]
      }
    ]
  };
}

function buildDemoFitnessReport(optionA, optionB) {
  const reportsByPersona = {
    'daniel-smith-demo': {
      report_id: 'demo-comparison-test-maya-daniel',
      compatibilityPercent: 78,
      quantitativeDeviationPercent: 22,
      qualitativeMisalignmentPercent: 18,
      mutationRatePercent: 14,
      areas_match: [
        "Maya's warm specificity pairs well with Daniel's preference for gentle, private communication",
        'Both value respect, honesty, and low-pressure follow-through',
        'Quiet, intentional settings help both personas stay present instead of performative'
      ],
      areas_mismatch: [
        'Maya may seek clarity sooner than Daniel is ready to name it',
        'Daniel can become reserved when a message feels like an immediate relationship verdict',
        'The best path needs timing that gives Daniel room and wording that gives Maya clarity'
      ],
      top_matches_axes: [
        { axis_name: 'Respect / Dignity Boundary', deviation: 0.06, persona_a_value: 0.82, persona_b_value: 0.76 },
        { axis_name: 'Depth <-> Breadth', deviation: 0.04, persona_a_value: 0.76, persona_b_value: 0.72 },
        { axis_name: 'Immediate <-> Deferred Reward', deviation: 0.01, persona_a_value: 0.62, persona_b_value: 0.63 }
      ],
      top_mismatches_axes: [
        { axis_name: 'Conflict Response', deviation: 0.1, persona_a_value: 0.58, persona_b_value: 0.48 },
        { axis_name: 'Loyalty / Commitment Boundary', deviation: 0.04, persona_a_value: 0.7, persona_b_value: 0.66 }
      ]
    },
    'aaron-chen-demo': {
      report_id: 'demo-comparison-test-maya-aaron',
      compatibilityPercent: 71,
      quantitativeDeviationPercent: 29,
      qualitativeMisalignmentPercent: 24,
      mutationRatePercent: 18,
      areas_match: [
        'Both value respect, honesty, and careful timing in emotionally important moments',
        'Maya\'s warmth pairs well with Aaron\'s protective family loyalty',
        'A prepared next step helps both people feel less reactive'
      ],
      areas_mismatch: [
        'Aaron may move into practical worry before Maya feels emotionally understood',
        'Maya may soften the message so much that Aaron misses the seriousness at first',
        'The father-daughter role raises the stakes around independence and protection'
      ],
      top_matches_axes: [
        { axis_name: 'Respect / Dignity Boundary', deviation: 0.04, persona_a_value: 0.82, persona_b_value: 0.86 },
        { axis_name: 'Honesty Boundary', deviation: 0.02, persona_a_value: 0.78, persona_b_value: 0.8 },
        { axis_name: 'Persistence', deviation: 0.1, persona_a_value: 0.72, persona_b_value: 0.82 }
      ],
      top_mismatches_axes: [
        { axis_name: 'Risk / Safety Boundary', deviation: 0.24, persona_a_value: 0.54, persona_b_value: 0.78 },
        { axis_name: 'Stability <-> Growth', deviation: 0.14, persona_a_value: 0.52, persona_b_value: 0.38 },
        { axis_name: 'Adaptation Speed', deviation: 0.15, persona_a_value: 0.61, persona_b_value: 0.46 }
      ]
    },
    'naomi-brooks-demo': {
      report_id: 'demo-comparison-test-maya-naomi',
      compatibilityPercent: 64,
      quantitativeDeviationPercent: 36,
      qualitativeMisalignmentPercent: 31,
      mutationRatePercent: 22,
      areas_match: [
        'Both respond well to clear intentions and respectful directness',
        'Accountability and preparation create a strong shared starting point',
        'Maya\'s care can become persuasive when paired with evidence and a specific ask'
      ],
      areas_mismatch: [
        'Naomi may evaluate business impact before acknowledging emotional context',
        'Maya may over-polish the request and make the practical ask less clear',
        'Workplace timing and role hierarchy create more pressure than a personal conversation'
      ],
      top_matches_axes: [
        { axis_name: 'Honesty Boundary', deviation: 0.04, persona_a_value: 0.78, persona_b_value: 0.82 },
        { axis_name: 'Fairness / Reciprocity Boundary', deviation: 0.08, persona_a_value: 0.76, persona_b_value: 0.84 },
        { axis_name: 'Adaptation Speed', deviation: 0.07, persona_a_value: 0.61, persona_b_value: 0.68 }
      ],
      top_mismatches_axes: [
        { axis_name: 'Autonomy <-> Coordination', deviation: 0.24, persona_a_value: 0.48, persona_b_value: 0.72 },
        { axis_name: 'Immediate <-> Deferred Reward', deviation: 0.08, persona_a_value: 0.62, persona_b_value: 0.7 },
        { axis_name: 'Depth <-> Breadth', deviation: 0.24, persona_a_value: 0.76, persona_b_value: 0.52 }
      ]
    }
  };

  const selectedReport = reportsByPersona[optionB?.key] || reportsByPersona['daniel-smith-demo'];
  return {
    ...selectedReport,
    comparedAt: new Date().toISOString(),
    personaA: { key: optionA.key, label: optionA.label, signature: { key: optionA.key, profile_hash: 'demo-a' } },
    personaB: { key: optionB.key, label: optionB.label, signature: { key: optionB.key, profile_hash: `demo-${optionB.key}` } },
    llm_model: 'Demo predictive model'
  };
}

async function runDemoFitnessReview() {
  const optionA = optionByKey.get(selectA.value);
  const optionB = optionByKey.get(selectB.value);
  const evaluation = evaluatePair(optionA, optionB);
  if (!evaluation.ready) {
    setStatus(evaluation.reason, 'error');
    return;
  }
  const report = await runWithProgress(async () => {
    await wait(700);
    return buildDemoFitnessReport(optionA, optionB);
  });
  localStorage.setItem(FITNESS_RESULT_STORAGE_KEY, JSON.stringify(report));
  setStatus(`Demo Compatibility Sheet ready for Maya Chen and ${optionB.label}.`, 'success');
  window.setTimeout(() => {
    window.location.href = demoUrl('demo-fitness-test-results.html');
  }, 450);
}

async function runDemoOutcomePathways() {
  const report = await runOutcomeWithProgress(async () => {
    await wait(700);
    return buildDemoOutcomeReport();
  });
  renderOutcomeResults(report);
  setOutcomeStatus('Best Way paths complete for this decision.', 'success');
}

function setupDemoInsightLab() {
  document.body.classList.add('demo-mode');
  document.title = 'Insight Lab - Maya and Daniel Smith Demo';
  document.querySelectorAll('a[href="Chat.html"]').forEach((link) => {
    link.setAttribute('href', demoUrl('DashboardDemo.html', { state: 'start' }));
  });
  document.querySelectorAll('a[href="analyze.html"]').forEach((link) => {
    link.setAttribute('href', demoUrl('analyze.html', { persona: 'daniel-smith-demo' }));
  });
  document.querySelectorAll('a[href="profile.html"]').forEach((link) => {
    link.setAttribute('href', demoUrl('profile.html'));
  });

  const hero = document.querySelector('.hero');
  if (hero && !document.querySelector('.demo-intro-grid')) {
    hero.insertAdjacentHTML('beforeend', `
      <div class="demo-intro-grid" aria-label="Insight Lab function overview">
        <article class="demo-intro-card demo-story-card">
          <h3>Compare personas before the moment matters.</h3>
          <p>Insight Lab is a virtual experimental space for placing two personas side by side, reading their likely points of fit and friction, and turning private context into calmer real-world decisions.</p>
        </article>
        <figure class="demo-abstract-card" aria-label="Abstract friendly comparison artwork">
          <span class="abstract-orb one"></span>
          <span class="abstract-orb two"></span>
          <span class="abstract-orb three"></span>
          <span class="abstract-path"></span>
          <span class="abstract-node a"></span>
          <span class="abstract-node b"></span>
          <span class="abstract-node c"></span>
          <figcaption class="abstract-cardlet">
            <strong>Patterns become easier to read.</strong>
            <span>Warm signals, practical context, and comparison paths come together before a real decision is made.</span>
          </figcaption>
        </figure>
      </div>
    `);
  }

  currentUserId = 'demo-user';
  currentUserProfileJson = {
    [INSIGHT_LAB_PROFILE_KEY]: {
      [ACCOUNT_OUTCOME_REPORTS_KEY]: [buildDemoOutcomeReport()],
      [ACCOUNT_OUTCOME_QUEUE_KEY]: []
    }
  };
  personaOptions = buildDemoOptions().filter((option) => (
    option.key === SYNTHETIC_USER_KEY || option.key === 'daniel-smith-demo'
  ));
  optionByKey = new Map(personaOptions.map((item) => [item.key, item]));
  populateSelectors();
  if (selectA) selectA.value = SYNTHETIC_USER_KEY;
  if (selectB) selectB.value = 'daniel-smith-demo';
  if (outcomeSelectA) outcomeSelectA.value = SYNTHETIC_USER_KEY;
  if (outcomeSelectB) outcomeSelectB.value = 'daniel-smith-demo';
  if (outcomeInitialConditionsEl) {
    outcomeInitialConditionsEl.value = 'Maya wants to invite Daniel into a deeper conversation this weekend while keeping the tone warm and low pressure.';
  }
  if (outcomeRequestedOutcomeEl) {
    outcomeRequestedOutcomeEl.value = "Invite Daniel to talk about where the relationship is going without making the message feel heavy.";
  }
  updateFitnessUI();
  updateOutcomeUI();
}

function evaluateOutcomeSetup(optionA, optionB, requestedOutcome) {
  if (!optionA || !optionB) {
    return { ready: false, reason: 'Select both personas to run Best Way.' };
  }
  if (optionA.key === optionB.key) {
    return { ready: false, reason: 'Choose two different personas for Best Way.' };
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
  const queuedCount = loadOutcomeJobQueue().length;
  const queueIsFull = queuedCount >= MAX_OUTCOME_QUEUE_ITEMS;
  const hasActiveWork = hasOutcomeQueueWork();
  if (outcomeStopBtn) {
    outcomeStopBtn.disabled = !hasActiveWork;
  }
  if (!evaluation.ready) {
    outcomeRunBtn.disabled = true;
    setOutcomeReadyState(false);
    if (!hasActiveWork) {
      setOutcomeStatus(evaluation.reason, 'error');
    }
    return;
  }
  if (queueIsFull) {
    outcomeRunBtn.disabled = true;
    setOutcomeReadyState(true);
    if (!hasActiveWork) {
      setOutcomeStatus(`Best Way queue is full (${MAX_OUTCOME_QUEUE_ITEMS}). Stop or wait for jobs to finish.`, 'error');
    }
    return;
  }
  outcomeRunBtn.disabled = false;
  setOutcomeReadyState(true);
  if (!hasActiveWork) {
    setOutcomeStatus('', 'info');
  }
}

function getOutcomeModelSettingsFromProfile() {
  const insightLab = currentUserProfileJson?.[INSIGHT_LAB_PROFILE_KEY] && typeof currentUserProfileJson[INSIGHT_LAB_PROFILE_KEY] === 'object'
    ? currentUserProfileJson[INSIGHT_LAB_PROFILE_KEY]
    : {};
  const settings = insightLab?.[ACCOUNT_OUTCOME_MODEL_SETTINGS_KEY];
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  try {
    return JSON.parse(JSON.stringify(settings));
  } catch (_) {
    return null;
  }
}

function sanitizeOutcomeModelSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  let cloned;
  try {
    cloned = JSON.parse(JSON.stringify(settings));
  } catch (_) {
    return null;
  }
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) return null;
  return cloned;
}

function buildOutcomePayload(optionA, optionB, signatureA, signatureB) {
  const payload = {
    initial_conditions: String(outcomeInitialConditionsEl?.value || '').trim(),
    requested_outcome: String(outcomeRequestedOutcomeEl?.value || '').trim(),
    require_prompt_template: true,
    personaA: {
      key: optionA.key,
      label: optionA.label,
      signature: signatureA,
      profile: getProfilePayload(optionA),
      db_record: optionA?.data && typeof optionA.data === 'object' ? optionA.data : {}
    },
    personaB: {
      key: optionB.key,
      label: optionB.label,
      signature: signatureB,
      profile: getProfilePayload(optionB),
      db_record: optionB?.data && typeof optionB.data === 'object' ? optionB.data : {}
    },
    action_space_only: true,
    config: {
      node_count: 10,
      actions_per_node: 5
    }
  };

  const modelSettings = sanitizeOutcomeModelSettings(getOutcomeModelSettingsFromProfile());
  if (modelSettings) {
    payload.model_settings = modelSettings;
  }

  return payload;
}

async function fetchOutcomeReport(payload, options = {}) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token || '';
  const signal = options && typeof options === 'object' ? options.signal : undefined;
  const response = await fetch('/api/outcome-test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(payload),
    ...(signal ? { signal } : {})
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const messageParts = [];
    const primary = String(json?.error || 'Best Way request failed').trim();
    if (primary) messageParts.push(primary);
    const stage = String(json?.stage || '').trim();
    if (stage) messageParts.push(`stage=${stage}`);
    const responseStatus = String(json?.response_status || '').trim();
    if (responseStatus) messageParts.push(`openai_status=${responseStatus}`);
    const incompleteReason = String(json?.response_incomplete_reason || '').trim();
    if (incompleteReason) messageParts.push(`incomplete_reason=${incompleteReason}`);
    const excerpt = String(json?.output_excerpt || '').trim();
    if (excerpt) messageParts.push(`output_excerpt=${excerpt}`);
    const message = messageParts.join(' | ') || 'Best Way request failed';
    const error = new Error(message);
    error.status = response.status;
    error.stage = String(json?.stage || '').trim();
    error.retryAfterSeconds = Number(json?.retry_after_seconds || 0) || 0;
    error.rateLimitResetSeconds = Number(json?.rate_limit_reset_seconds || 0) || 0;
    error.rateLimit = json?.rate_limit && typeof json.rate_limit === 'object'
      ? json.rate_limit
      : null;
    error.openaiRequestId = String(json?.openai_request_id || '').trim();
    throw error;
  }
  if (!json || typeof json !== 'object') {
    throw new Error('Best Way returned an invalid response');
  }
  return json;
}

async function processOutcomeQueue() {
  if (isOutcomeQueueRunning) return;
  outcomeStopRequested = false;
  isOutcomeQueueRunning = true;
  renderOutcomeTestHistory();
  updateOutcomeUI();
  try {
    while (true) {
      await loadLatestAccountProfileJson();
      const queue = loadOutcomeJobQueue();
      if (outcomeStopRequested) {
        if (queue.length) {
          await saveOutcomeJobQueue([]);
        }
        setOutcomeStatus('Best Way queue stopped by user.', 'info');
        break;
      }
      const nextJob = queue[0];
      if (!nextJob) break;

      const nextRetryAt = Date.parse(String(nextJob?.next_retry_at || '').trim());
      const now = Date.now();
      if (Number.isFinite(nextRetryAt) && nextRetryAt > now) {
        const waitMs = nextRetryAt - now;
        const waitSec = Math.max(1, Math.ceil(waitMs / 1000));
        const retryReason = String(nextJob?.last_retry_reason || '').trim();
        const reasonLabel = retryReason === 'rate_limit'
          ? 'rate limit'
          : retryReason === 'timeout'
            ? 'timeout'
            : retryReason === 'upstream'
              ? 'upstream service issue'
              : retryReason === 'network'
                ? 'network issue'
                : 'transient model issue';
        setOutcomeStatus(
          `Best Way queue is waiting for auto-retry (${reasonLabel}). Next retry for "${nextJob.requestedOutcome}" in ~${waitSec}s.`,
          'info'
        );
        scheduleOutcomeQueueRetry(waitMs + 500);
        break;
      }

      currentOutcomeRunningJobId = String(nextJob.id || '').trim();
      renderOutcomeTestHistory();

      setOutcomeStatus(
        `Best Way queued job ${nextJob.id} is running in background. You can continue using the app.`,
        'info'
      );

      try {
        const runAbortController = new AbortController();
        outcomeQueueAbortController = runAbortController;
        const response = await fetchOutcomeReport(nextJob.payload, {
          signal: runAbortController.signal
        });
        const report = {
          ...response,
          persona_a: {
            ...(response?.persona_a && typeof response.persona_a === 'object' ? response.persona_a : {}),
            key: nextJob.personaA.key,
            label: nextJob.personaA.label,
            signature: nextJob.personaA.signature
          },
          persona_b: {
            ...(response?.persona_b && typeof response.persona_b === 'object' ? response.persona_b : {}),
            key: nextJob.personaB.key,
            label: nextJob.personaB.label,
            signature: nextJob.personaB.signature
          },
          persona_keys: Array.from(
            new Set(
              [nextJob.personaA.key, nextJob.personaB.key]
                .map((key) => sanitizePersonaKey(key))
                .filter(Boolean)
            )
          ),
          requested_outcome: nextJob.requestedOutcome
        };

        await persistOutcomeReportToAccount(report);

        const refreshedQueue = loadOutcomeJobQueue();
        refreshedQueue.shift();
        await saveOutcomeJobQueue(refreshedQueue);

        setOutcomeStatus(
          `Best Way complete for "${nextJob.requestedOutcome}". Open the results page to view scenarios.`,
          'success'
        );
        notifyOutcomeComplete(
          'Syntrae: Best Way Complete',
          `Requested goal: ${nextJob.requestedOutcome}`
        );
      } catch (error) {
        if (outcomeStopRequested && isAbortError(error)) {
          const refreshedQueue = loadOutcomeJobQueue();
          const targetIndex = refreshedQueue.findIndex((item) => String(item?.id || '') === String(nextJob.id || ''));
          if (targetIndex >= 0) {
            refreshedQueue.splice(targetIndex, 1);
            await saveOutcomeJobQueue(refreshedQueue);
          }
          setOutcomeStatus('Best Way stopped by user.', 'info');
          break;
        }

        const message = String(error?.message || 'Unexpected error');
        const refreshedQueue = loadOutcomeJobQueue();
        const targetIndex = refreshedQueue.findIndex((item) => String(item?.id || '') === String(nextJob.id || ''));
        const existingRetryCount = targetIndex >= 0
          ? (Number(refreshedQueue[targetIndex]?.retry_count || 0) || 0)
          : 0;
        const nextFailureCount = existingRetryCount + 1;
        const retryPlan = computeOutcomeRetryPlan(error, existingRetryCount);

        if (retryPlan.shouldRetry && targetIndex >= 0 && nextFailureCount < MAX_OUTCOME_JOB_RETRIES) {
          const retrySeconds = Math.max(2, Math.ceil(retryPlan.retrySeconds || 45));
          const nextRetryIso = new Date(Date.now() + retrySeconds * 1000).toISOString();
          refreshedQueue[targetIndex] = {
            ...refreshedQueue[targetIndex],
            retry_count: nextFailureCount,
            next_retry_at: nextRetryIso,
            last_error: message,
            last_error_status: Number(error?.status || 0) || null,
            stage: String(error?.stage || '').trim(),
            last_retry_reason: retryPlan.reasonLabel
          };
          await saveOutcomeJobQueue(refreshedQueue);
          const reasonLabel = retryPlan.reasonLabel === 'rate_limit'
            ? 'rate limit'
            : retryPlan.reasonLabel === 'timeout'
              ? 'timeout'
              : retryPlan.reasonLabel === 'upstream'
                ? 'upstream service issue'
                : retryPlan.reasonLabel === 'network'
                  ? 'network issue'
                  : retryPlan.reasonLabel === 'model_response'
                    ? 'model response formatting issue'
                  : 'transient issue';
          const nextAttempt = nextFailureCount + 1;
          const limitTokens = Number(error?.rateLimit?.limit_tokens || 0) || 0;
          const remainingTokens = Number(error?.rateLimit?.remaining_tokens || 0) || 0;
          const rateLimitHint = limitTokens > 0
            ? ` · tokens ${remainingTokens}/${limitTokens} remaining`
            : '';
          setOutcomeStatus(
            `Best Way hit a ${reasonLabel}. Auto-retry scheduled in ~${retrySeconds}s (attempt ${nextAttempt} of ${MAX_OUTCOME_JOB_RETRIES})${rateLimitHint}.`,
            'info'
          );
          scheduleOutcomeQueueRetry((retrySeconds * 1000) + 500);
          break;
        }

        const failedQueueJob = targetIndex >= 0 ? refreshedQueue[targetIndex] : nextJob;
        if (targetIndex >= 0) {
          refreshedQueue.splice(targetIndex, 1);
          await saveOutcomeJobQueue(refreshedQueue);
        } else if (refreshedQueue.length) {
          refreshedQueue.shift();
          await saveOutcomeJobQueue(refreshedQueue);
        }
        await persistFailedOutcomeJob({
          id: String(failedQueueJob?.id || nextJob?.id || '').trim(),
          queued_at: failedQueueJob?.queued_at || nextJob?.queued_at || null,
          failed_at: new Date().toISOString(),
          requested_outcome: failedQueueJob?.requestedOutcome || failedQueueJob?.requested_outcome || nextJob?.requestedOutcome || '',
          persona_a: failedQueueJob?.personaA || failedQueueJob?.persona_a || nextJob?.personaA || {},
          persona_b: failedQueueJob?.personaB || failedQueueJob?.persona_b || nextJob?.personaB || {},
          attempts: nextFailureCount,
          last_error: message,
          last_error_status: Number(error?.status || 0) || null,
          last_retry_reason: retryPlan.shouldRetry ? 'max_retries_exceeded' : 'fatal',
          stage: String(error?.stage || '').trim()
        });
        if (retryPlan.shouldRetry && nextFailureCount >= MAX_OUTCOME_JOB_RETRIES) {
          setOutcomeStatus(`Best Way failed after ${MAX_OUTCOME_JOB_RETRIES} attempts: ${message}`, 'error');
        } else {
          setOutcomeStatus(`Best Way failed: ${message}`, 'error');
        }
      } finally {
        outcomeQueueAbortController = null;
      }
      currentOutcomeRunningJobId = '';
      renderOutcomeTestHistory();
      updateOutcomeUI();
    }
  } finally {
    isOutcomeQueueRunning = false;
    currentOutcomeRunningJobId = '';
    outcomeStopRequested = false;
    outcomeQueueAbortController = null;
    renderOutcomeTestHistory();
    updateOutcomeUI();
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
  if (isDecisionTreeDemo()) {
    setupDemoInsightLab();
    return;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.user) {
    window.location.href = 'sign-in.html?auth=required';
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
  renderOutcomeTestHistory();
  const queuedJobs = loadOutcomeJobQueue();
  if (queuedJobs.length) {
    setOutcomeStatus(
      `${queuedJobs.length} queued outcome test${queuedJobs.length > 1 ? 's are' : ' is'} pending. Running in background…`,
      'info'
    );
    processOutcomeQueue().catch((error) => {
      setOutcomeStatus(`Best Way failed: ${error?.message || 'Unexpected error'}`, 'error');
    });
  }
}

selectA.addEventListener('change', updateFitnessUI);
selectB.addEventListener('change', updateFitnessUI);
if (outcomeSelectA) outcomeSelectA.addEventListener('change', updateOutcomeUI);
if (outcomeSelectB) outcomeSelectB.addEventListener('change', updateOutcomeUI);
if (outcomeRequestedOutcomeEl) outcomeRequestedOutcomeEl.addEventListener('input', updateOutcomeUI);
if (outcomeHistoryListEl) {
  outcomeHistoryListEl.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-report-key]') : null;
    if (!target) return;
    const reportKey = String(target.getAttribute('data-report-key') || '').trim();
    if (!reportKey) return;
    const report = outcomeHistoryReportMap.get(reportKey);
    if (!report) {
      setOutcomeStatus('Unable to open this result detail. The report is no longer available in cache.', 'error');
      return;
    }
    openOutcomeReportDetails(report);
  });
}

runBtn.addEventListener('click', async () => {
  if (isDecisionTreeDemo()) {
    await runDemoFitnessReview();
    return;
  }

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
    setStatus(`Compatibility Sheet failed: ${error?.message || 'Unexpected error'}`, 'error');
  }
});

if (outcomeRunBtn) {
  outcomeRunBtn.addEventListener('click', async () => {
    if (isDecisionTreeDemo()) {
      await runDemoOutcomePathways();
      return;
    }

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
      const queue = loadOutcomeJobQueue();
      if (queue.length >= MAX_OUTCOME_QUEUE_ITEMS) {
        setOutcomeStatus(`Best Way queue is full (${MAX_OUTCOME_QUEUE_ITEMS}). Stop or wait for jobs to finish.`, 'error');
        updateOutcomeUI();
        return;
      }
      const job = {
        id: createOutcomeJobId(),
        queued_at: new Date().toISOString(),
        requestedOutcome,
        personaA: {
          key: optionA.key,
          label: optionA.label,
          signature: signatureA
        },
        personaB: {
          key: optionB.key,
          label: optionB.label,
          signature: signatureB
        },
        payload
      };
      queue.push(job);
      await saveOutcomeJobQueue(queue);
      updateOutcomeUI();
      setOutcomeStatus(
        `Best Way queued (${queue.length} in queue). You can continue using the app; you’ll be notified when this run completes.`,
        'info'
      );
      processOutcomeQueue().catch((error) => {
        setOutcomeStatus(`Best Way failed: ${error?.message || 'Unexpected error'}`, 'error');
      });
    } catch (error) {
      setOutcomeReadyState(false);
      setOutcomeStatus(`Best Way failed: ${error?.message || 'Unexpected error'}`, 'error');
    }
  });
}

if (outcomeStopBtn) {
  outcomeStopBtn.addEventListener('click', async () => {
    try {
      await stopOutcomeQueueByUser();
    } catch (error) {
      setOutcomeStatus(`Could not stop Best Way: ${error?.message || 'Unexpected error'}`, 'error');
    }
  });
}

initialize();
