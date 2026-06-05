import { supabase } from './supabase-client.js';

const USER_PROFILE_TABLE = 'user_profiles';
const PERSONA_TABLE = 'personas';
const SYNTHETIC_USER_KEY = '__user_persona__';
const FITNESS_RESULT_STORAGE_KEY = 'insight-lab:last-fitness-test';
const FITNESS_HISTORY_STORAGE_KEY = 'insight-lab:fitness-report-history';
const INSIGHT_LAB_PROFILE_KEY = 'insight_lab';
const ACCOUNT_FITNESS_REPORTS_KEY = 'fitness_reports';
const MAX_ACCOUNT_FITNESS_REPORTS = 20;
const MAX_HISTORY_REPORTS = 10;

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

const compatibilityValueEl = document.getElementById('compatibilityValue');
const compatibilityFillEl = document.getElementById('compatibilityFill');
const compatibilityDescriptionEl = document.getElementById('compatibilityDescription');
const areasMatchListEl = document.getElementById('areasMatchList');
const areasMismatchListEl = document.getElementById('areasMismatchList');
const matchesChartRowsEl = document.getElementById('matchesChartRows');
const mismatchesChartRowsEl = document.getElementById('mismatchesChartRows');
const chartLegendEl = document.getElementById('chartLegend');
const resultsFallbackEl = document.getElementById('resultsFallback');
const historyBtnEl = document.getElementById('historyBtn');
const historyModalEl = document.getElementById('historyModal');
const historyCloseBtnEl = document.getElementById('historyCloseBtn');
const historyListEl = document.getElementById('historyList');
let currentUserId = '';
let currentUserProfileJson = {};

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function roundPercent(valueFraction) {
  return Math.round(clamp01(valueFraction) * 100);
}

function normalizeTextArray(value, limit = 5) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
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

function buildPersonaSignatureFromProfile(key, profile, updatedAt = '') {
  return {
    key: String(key || ''),
    profile_hash: hashText(stableStringify(profile || {})),
    updated_at: updatedAt || null
  };
}

function getProfilePayloadFromOption(option) {
  if (!option) return {};
  const profile = option.profile;
  if (profile && typeof profile === 'object') return profile;
  const state = option.state && typeof option.state === 'object' ? option.state : {};
  return {
    axis_scores: {
      L1: safeParseLayer(state?.identityLayers?.L1),
      L2: safeParseLayer(state?.identityLayers?.L2),
      L3: safeParseLayer(state?.identityLayers?.L3)
    },
    qualitative_data: {
      adjective_signals: [],
      freeform_signals: {},
      critical_factors: {},
      extras_text: state?.extras && typeof state.extras === 'object' ? state.extras : {},
      qualitative_tags: []
    }
  };
}

function getQuantitativeTraitVectorFromOption(option) {
  const profile = getProfilePayloadFromOption(option);
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

function getQualitativeTagSetFromOption(option) {
  const profile = getProfilePayloadFromOption(option);
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
    : [];
  adjectiveSignals.forEach((entry) => {
    const selected = Array.isArray(entry?.selected) ? entry.selected : [];
    selected.forEach((item) => {
      tokenizeQualitative(item).forEach((token) => tags.add(`adj:${token}`));
    });
  });

  const freeformSignals = toStringRecord(qualitativeData.freeform_signals);
  Object.values(freeformSignals).forEach((value) => {
    tokenizeQualitative(value).forEach((token) => tags.add(`free:${token}`));
  });

  const criticalFactors = toStringRecord(qualitativeData.critical_factors);
  Object.entries(criticalFactors).forEach(([factorKey, value]) => {
    if (factorKey) tags.add(`critical:${factorKey.toLowerCase()}`);
    tokenizeQualitative(value).forEach((token) => tags.add(`critical:${token}`));
  });

  const extrasText = toStringRecord(qualitativeData.extras_text);
  Object.values(extrasText).forEach((value) => {
    tokenizeQualitative(value).forEach((token) => tags.add(`extra:${token}`));
  });

  ['personal_headline', 'goals', 'strengths', 'constraints', 'communication_style'].forEach((field) => {
    tokenizeQualitative(qualitativeData?.[field]).forEach((token) => tags.add(`profile:${token}`));
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
      meanDeviation: 1,
      sharedCount: 0,
      unionCount,
      axisDeviations: []
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
      misalignmentFraction: 0
    };
  }
  let intersectionCount = 0;
  setA.forEach((item) => {
    if (setB.has(item)) intersectionCount += 1;
  });
  const similarityFraction = intersectionCount / union.size;
  return {
    similarityFraction,
    misalignmentFraction: clamp01(1 - similarityFraction)
  };
}

function deriveMutationRate(misalignmentFraction) {
  const bounded = clamp01(misalignmentFraction);
  return Math.min(0.6, Math.max(0.1, 0.1 + bounded * 0.5));
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
    areas_match: normalizeTextArray(matches, 4),
    areas_mismatch: normalizeTextArray(mismatches, 4)
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
      areas_match: normalizeTextArray(result.areas_match, 4),
      areas_mismatch: normalizeTextArray(result.areas_mismatch, 4),
      model: String(result.model || '').trim() || 'Deterministic heuristic'
    };
  } catch (_) {
    return null;
  }
}

function formatDateTime(iso) {
  const date = new Date(iso || '');
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function loadLatestReport() {
  try {
    const raw = localStorage.getItem(FITNESS_RESULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function saveLatestReport(report) {
  localStorage.setItem(FITNESS_RESULT_STORAGE_KEY, JSON.stringify(report));
}

function isMissingUserProfileTableError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '');
  return code === '42P01' || (message.includes('relation') && message.includes('user_profiles'));
}

function reportTimeSortValue(report) {
  const stamp = String(report?.comparedAt || report?.compared_at || report?.generatedAt || report?.generated_at || '').trim();
  if (!stamp) return 0;
  const epoch = Date.parse(stamp);
  return Number.isFinite(epoch) ? epoch : 0;
}

function reportStorageFingerprint(report) {
  if (!report || typeof report !== 'object') return '';
  const reportId = String(report?.report_id || '').trim();
  if (reportId) return `id:${reportId}`;
  const keyA = normalizePersonaKey(report?.personaA?.key || '');
  const keyB = normalizePersonaKey(report?.personaB?.key || '');
  const sigA = String(report?.personaA?.signature?.profile_hash || '').trim();
  const sigB = String(report?.personaB?.signature?.profile_hash || '').trim();
  if (keyA && keyB && sigA && sigB) return `sig:${keyA}|${sigA}|${keyB}|${sigB}`;
  const stamp = String(report?.comparedAt || report?.compared_at || '').trim();
  return stamp ? `time:${stamp}` : '';
}

function reportPersonaKeys(report) {
  const keys = [
    normalizePersonaKey(report?.personaA?.key || ''),
    normalizePersonaKey(report?.personaB?.key || '')
  ].filter(Boolean);
  return Array.from(new Set(keys));
}

function normalizeReportForAccountStorage(report) {
  if (!report || typeof report !== 'object') return null;
  return {
    ...report,
    persona_keys: reportPersonaKeys(report),
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
  const incomingFingerprint = reportStorageFingerprint(incoming);
  const filtered = existingReports.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const existingFingerprint = reportStorageFingerprint(entry);
    if (incomingFingerprint && existingFingerprint && incomingFingerprint === existingFingerprint) return false;
    return true;
  });
  filtered.unshift(incoming);
  filtered.sort((left, right) => reportTimeSortValue(right) - reportTimeSortValue(left));
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
  if (!currentUserId) {
    return currentUserProfileJson && typeof currentUserProfileJson === 'object' ? currentUserProfileJson : {};
  }
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
    console.warn('Unexpected error while persisting fitness report:', error?.message || error);
  }
}

function normalizePersonaKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.replace(/[^a-z0-9_-]/g, '');
}

function getReportComparisonFingerprint(report) {
  if (!report || typeof report !== 'object') return '';
  const sigA = report?.personaA?.signature && typeof report.personaA.signature === 'object'
    ? report.personaA.signature
    : null;
  const sigB = report?.personaB?.signature && typeof report.personaB.signature === 'object'
    ? report.personaB.signature
    : null;

  const keyA = normalizePersonaKey(sigA?.key || report?.personaA?.key || '');
  const keyB = normalizePersonaKey(sigB?.key || report?.personaB?.key || '');
  const hashA = String(sigA?.profile_hash || '').trim();
  const hashB = String(sigB?.profile_hash || '').trim();
  if (!keyA || !keyB || !hashA || !hashB) return '';
  return `${keyA}|${hashA}|${keyB}|${hashB}`;
}

function loadReportHistory() {
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

function saveReportHistory(history) {
  const trimmed = Array.isArray(history) ? history.slice(0, MAX_HISTORY_REPORTS) : [];
  localStorage.setItem(FITNESS_HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
}

function upsertReportHistory(report) {
  if (!report || typeof report !== 'object') return;
  const reportId = String(report.report_id || '').trim();
  const reportFingerprint = getReportComparisonFingerprint(report);
  const history = loadReportHistory();
  const filtered = history.filter((item) => {
    if (reportId && String(item.report_id || '') === reportId) return false;
    if (reportFingerprint && getReportComparisonFingerprint(item) === reportFingerprint) return false;
    return true;
  });
  filtered.unshift(report);
  saveReportHistory(filtered);
}

function renderHistory() {
  const history = loadReportHistory();
  historyListEl.innerHTML = '';
  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No report history yet.';
    historyListEl.appendChild(empty);
    return;
  }

  history.slice(0, MAX_HISTORY_REPORTS).forEach((entry) => {
    const item = document.createElement('article');
    item.className = 'history-item';

    const top = document.createElement('div');
    top.className = 'history-item-top';
    const pair = document.createElement('span');
    pair.className = 'history-pair';
    pair.textContent = `${entry?.personaA?.label || 'Unknown'} vs ${entry?.personaB?.label || 'Unknown'}`;
    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = formatDateTime(entry?.comparedAt);
    top.appendChild(pair);
    top.appendChild(time);

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.innerHTML = `
      <span>Compatibility: <strong>${clampPercent(entry?.compatibilityPercent)}%</strong></span>
    `;

    item.appendChild(top);
    item.appendChild(meta);
    historyListEl.appendChild(item);
  });
}

function renderList(container, items) {
  container.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = 'No signal available yet.';
    container.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    container.appendChild(li);
  });
}

function renderEvidenceChartRows(container, axes, type) {
  container.innerHTML = '';
  const list = Array.isArray(axes) ? [...axes] : [];
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No axis evidence available.';
    container.appendChild(empty);
    return;
  }

  list.sort((leftEntry, rightEntry) => {
    const leftA = clamp01(leftEntry?.persona_a_value, 0.5) * 100;
    const leftB = clamp01(leftEntry?.persona_b_value, 0.5) * 100;
    const rightA = clamp01(rightEntry?.persona_a_value, 0.5) * 100;
    const rightB = clamp01(rightEntry?.persona_b_value, 0.5) * 100;
    const leftShared = Math.min(leftA, leftB);
    const rightShared = Math.min(rightA, rightB);
    const leftGap = Math.abs(leftA - leftB);
    const rightGap = Math.abs(rightA - rightB);
    return type === 'match' ? rightShared - leftShared : rightGap - leftGap;
  });

  list.slice(0, 5).forEach((entry) => {
    const aValue = clamp01(entry?.persona_a_value, 0.5);
    const bValue = clamp01(entry?.persona_b_value, 0.5);
    const aPercent = Math.round(aValue * 100);
    const bPercent = Math.round(bValue * 100);
    const left = Math.min(aPercent, bPercent);
    const sharedPercent = left;
    const mismatchPercent = Math.abs(aPercent - bPercent);
    const metricLabel = type === 'match'
      ? `Match ${sharedPercent}%`
      : `Mismatch ${mismatchPercent}%`;
    const gapWidth = mismatchPercent > 0 ? Math.max(2, mismatchPercent) : 0;
    const row = document.createElement('div');
    row.className = 'chart-row';
    row.innerHTML = `
      <div class="axis-top">
        <span class="axis-label">${String(entry?.axis_name || entry?.axis_id || 'Axis')}</span>
        <span class="axis-score-label ${type}">${metricLabel}</span>
      </div>
      <div class="axis-overlay-track">
        <span class="axis-shared-line" style="left:0%; width:${sharedPercent}%"></span>
        <span class="axis-gap-line" style="left:${left}%; width:${gapWidth}%"></span>
        <span class="axis-marker a" style="left:${aPercent}%"></span>
        <span class="axis-marker b" style="left:${bPercent}%"></span>
      </div>
      <div class="axis-values">
        <span class="axis-pill a">A ${aPercent}</span>
        <span class="axis-pill b">B ${bPercent}</span>
      </div>
    `;
    container.appendChild(row);
  });
}

function getCompatibilityBand(percent) {
  if (percent <= 30) return 'low';
  if (percent <= 49) return 'mid';
  return 'high';
}

function getCompatibilityDescription(percent) {
  if (percent <= 30) {
    return 'Low compatibility. Major differences are likely to create friction without deliberate strategy and pacing.';
  }
  if (percent <= 49) {
    return 'Moderate compatibility. There are workable common points, but mismatch areas need careful framing.';
  }
  return 'High compatibility. Core traits are aligned enough to support smoother communication and coordination.';
}

function animateCompatibility(compatibilityPercent) {
  const target = clampPercent(compatibilityPercent);
  const band = getCompatibilityBand(target);
  let current = 0;
  const durationMs = 1200;
  const start = performance.now();

  compatibilityValueEl.classList.remove('low', 'mid', 'high');
  compatibilityFillEl.classList.remove('low', 'mid', 'high');
  compatibilityValueEl.classList.add(band);
  compatibilityFillEl.classList.add(band);

  function tick(now) {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    current = Math.round(target * eased);
    compatibilityValueEl.textContent = `${current}%`;
    compatibilityFillEl.style.width = `${current}%`;
    if (t < 1) requestAnimationFrame(tick);
  }

  compatibilityValueEl.textContent = '0%';
  compatibilityFillEl.style.width = '0%';
  requestAnimationFrame(tick);
}

function renderReport(report) {
  if (!report || typeof report !== 'object') {
    resultsFallbackEl.hidden = false;
    renderList(areasMatchListEl, []);
    renderList(areasMismatchListEl, []);
    compatibilityDescriptionEl.textContent = 'No compatibility report available yet.';
    if (chartLegendEl) chartLegendEl.textContent = 'A and B markers show each persona value per trait.';
    renderEvidenceChartRows(matchesChartRowsEl, [], 'match');
    renderEvidenceChartRows(mismatchesChartRowsEl, [], 'mismatch');
    animateCompatibility(0);
    return;
  }

  resultsFallbackEl.hidden = true;
  const compatibilityPercent = clampPercent(report.compatibilityPercent);
  compatibilityDescriptionEl.textContent = getCompatibilityDescription(compatibilityPercent);
  if (chartLegendEl) {
    const personaA = String(report?.personaA?.label || 'Persona A').trim() || 'Persona A';
    const personaB = String(report?.personaB?.label || 'Persona B').trim() || 'Persona B';
    chartLegendEl.textContent = `A = ${personaA}, B = ${personaB}.`;
  }
  renderList(areasMatchListEl, normalizeTextArray(report.areas_match, 4));
  renderList(areasMismatchListEl, normalizeTextArray(report.areas_mismatch, 4));
  renderEvidenceChartRows(matchesChartRowsEl, report.top_matches_axes, 'match');
  renderEvidenceChartRows(mismatchesChartRowsEl, report.top_mismatches_axes, 'mismatch');
  animateCompatibility(compatibilityPercent);
}

async function fetchUserProfile(userId) {
  const { data, error } = await supabase
    .from(USER_PROFILE_TABLE)
    .select('first_name,last_name,occupation,organization,location,profile')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

async function fetchPersonas(userId) {
  const { data, error } = await supabase
    .from(PERSONA_TABLE)
    .select('persona_key,name,updated_at,state,profile')
    .eq('user_id', userId);
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

function buildSyntheticUserProfile(userProfileRow, userMetadata, personaRows) {
  const profileJson = userProfileRow?.profile && typeof userProfileRow.profile === 'object'
    ? userProfileRow.profile
    : {};
  const primaryPersonaKey = String(profileJson.primary_persona_key || '').trim().toLowerCase();
  const linkedPersona = personaRows.find(
    (row) => String(row?.persona_key || '').trim().toLowerCase() === primaryPersonaKey
  );
  const linkedProfile = linkedPersona?.profile && typeof linkedPersona.profile === 'object'
    ? linkedPersona.profile
    : {};
  const displayName =
    profileJson.display_name ||
    `${String(userProfileRow?.first_name || userMetadata?.first_name || '').trim()} ${String(userProfileRow?.last_name || userMetadata?.last_name || '').trim()}`.trim() ||
    'Your Persona';
  const userProfile = {
    schema_version: '2.0.0',
    persona_key: SYNTHETIC_USER_KEY,
    persona_name: displayName,
    quantitative_data: {
      ...(linkedProfile.quantitative_data && typeof linkedProfile.quantitative_data === 'object'
        ? linkedProfile.quantitative_data
        : {}),
      ...(profileJson.quantitative_data && typeof profileJson.quantitative_data === 'object'
        ? profileJson.quantitative_data
        : {})
    },
    qualitative_data: {
      ...(linkedProfile.qualitative_data && typeof linkedProfile.qualitative_data === 'object'
        ? linkedProfile.qualitative_data
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
  return { primaryPersonaKey, userProfile, displayName };
}

function findComparisonOptionByKey(key, personaRows, syntheticUser) {
  const normalized = String(key || '').trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === SYNTHETIC_USER_KEY) {
    return {
      key: SYNTHETIC_USER_KEY,
      label: syntheticUser.displayName,
      profile: syntheticUser.userProfile,
      updated_at: new Date().toISOString()
    };
  }

  const row = personaRows.find(
    (item) => String(item?.persona_key || '').trim().toLowerCase() === normalized
  );
  if (!row) return null;

  const rowProfile = row?.profile && typeof row.profile === 'object' ? row.profile : {};
  const mergedProfile = normalized === syntheticUser.primaryPersonaKey
    ? {
        ...rowProfile,
        ...syntheticUser.userProfile,
        quantitative_data: {
          ...(rowProfile.quantitative_data && typeof rowProfile.quantitative_data === 'object'
            ? rowProfile.quantitative_data
            : {}),
          ...(syntheticUser.userProfile.quantitative_data && typeof syntheticUser.userProfile.quantitative_data === 'object'
            ? syntheticUser.userProfile.quantitative_data
            : {})
        },
        qualitative_data: {
          ...(rowProfile.qualitative_data && typeof rowProfile.qualitative_data === 'object'
            ? rowProfile.qualitative_data
            : {}),
          ...(syntheticUser.userProfile.qualitative_data && typeof syntheticUser.userProfile.qualitative_data === 'object'
            ? syntheticUser.userProfile.qualitative_data
            : {})
        }
      }
    : rowProfile;

  return {
    key: String(row?.persona_key || ''),
    label: String(row?.name || row?.persona_key || 'Persona').trim(),
    profile: mergedProfile,
    state: row?.state && typeof row.state === 'object' ? row.state : {},
    updated_at: row?.updated_at || ''
  };
}

function buildInsightsPayload(optionA, optionB, quantResult, qualResult) {
  const topMatches = [...quantResult.axisDeviations]
    .sort((a, b) => a.deviation - b.deviation)
    .slice(0, 4);
  const topMismatches = [...quantResult.axisDeviations]
    .sort((a, b) => b.deviation - a.deviation)
    .slice(0, 4);
  const fallbackAreas = buildFallbackAreas(quantResult, qualResult);

  return {
    personaA: {
      key: optionA.key,
      label: optionA.label,
      profile: getProfilePayloadFromOption(optionA),
      quantitative_trait_count: Object.keys(getQuantitativeTraitVectorFromOption(optionA)).length,
      qualitative_tag_count: getQualitativeTagSetFromOption(optionA).size
    },
    personaB: {
      key: optionB.key,
      label: optionB.label,
      profile: getProfilePayloadFromOption(optionB),
      quantitative_trait_count: Object.keys(getQuantitativeTraitVectorFromOption(optionB)).length,
      qualitative_tag_count: getQualitativeTagSetFromOption(optionB).size
    },
    metrics: {
      compatibility_percent: roundPercent(quantResult.compatibilityFraction),
      quantitative_deviation_percent: roundPercent(quantResult.meanDeviation || 0),
      qualitative_misalignment_percent: roundPercent(qualResult.misalignmentFraction),
      mutation_rate_percent: Math.round(deriveMutationRate(qualResult.misalignmentFraction) * 100),
      top_matches: topMatches,
      top_mismatches: topMismatches
    },
    fallback_areas: fallbackAreas
  };
}

function hasPersonaChanged(storedSignature, currentSignature) {
  if (!storedSignature || !currentSignature) return true;
  if (String(storedSignature.key || '') !== String(currentSignature.key || '')) return true;
  if (String(storedSignature.profile_hash || '') !== String(currentSignature.profile_hash || '')) return true;
  return false;
}

async function maybeRegenerateReport(latestReport) {
  if (!latestReport?.personaA?.key || !latestReport?.personaB?.key) return latestReport;

  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.user) return latestReport;

  const user = data.session.user;
  const [userProfileRow, personaRows] = await Promise.all([
    fetchUserProfile(user.id),
    fetchPersonas(user.id)
  ]);
  const syntheticUser = buildSyntheticUserProfile(userProfileRow, user.user_metadata || {}, personaRows);
  const optionA = findComparisonOptionByKey(latestReport.personaA.key, personaRows, syntheticUser);
  const optionB = findComparisonOptionByKey(latestReport.personaB.key, personaRows, syntheticUser);
  if (!optionA || !optionB) return latestReport;

  const currentSigA = buildPersonaSignatureFromProfile(optionA.key, getProfilePayloadFromOption(optionA), optionA.updated_at);
  const currentSigB = buildPersonaSignatureFromProfile(optionB.key, getProfilePayloadFromOption(optionB), optionB.updated_at);
  const changedA = hasPersonaChanged(latestReport?.personaA?.signature, currentSigA);
  const changedB = hasPersonaChanged(latestReport?.personaB?.signature, currentSigB);
  if (!changedA && !changedB) return latestReport;

  const vectorA = getQuantitativeTraitVectorFromOption(optionA);
  const vectorB = getQuantitativeTraitVectorFromOption(optionB);
  const quantResult = computeQuantitativeCompatibility(vectorA, vectorB);
  if (!quantResult.isComputable) return latestReport;

  const tagsA = getQualitativeTagSetFromOption(optionA);
  const tagsB = getQualitativeTagSetFromOption(optionB);
  const qualResult = computeQualitativeMisalignment(tagsA, tagsB);
  const mutationRatePercent = Math.round(deriveMutationRate(qualResult.misalignmentFraction) * 100);
  const payload = buildInsightsPayload(optionA, optionB, quantResult, qualResult);
  const modelAreas = await fetchModelAreas(payload);
  const fallbackAreas = buildFallbackAreas(quantResult, qualResult);
  const areas = modelAreas || { ...fallbackAreas, model: 'Fallback' };
  const topMatchesAxes = [...quantResult.axisDeviations].sort((a, b) => a.deviation - b.deviation).slice(0, 5);
  const topMismatchesAxes = [...quantResult.axisDeviations].sort((a, b) => b.deviation - a.deviation).slice(0, 5);

  return {
    report_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    comparedAt: new Date().toISOString(),
    personaA: {
      key: optionA.key,
      label: optionA.label,
      avatar_url: latestReport?.personaA?.avatar_url || '',
      signature: currentSigA
    },
    personaB: {
      key: optionB.key,
      label: optionB.label,
      avatar_url: latestReport?.personaB?.avatar_url || '',
      signature: currentSigB
    },
    compatibilityPercent: roundPercent(quantResult.compatibilityFraction),
    quantitativeDeviationPercent: roundPercent(quantResult.meanDeviation || 0),
    qualitativeMisalignmentPercent: roundPercent(qualResult.misalignmentFraction),
    mutationRatePercent,
    areas_match: normalizeTextArray(areas.areas_match, 4),
    areas_mismatch: normalizeTextArray(areas.areas_mismatch, 4),
    top_matches_axes: topMatchesAxes,
    top_mismatches_axes: topMismatchesAxes,
    llm_model: String(areas.model || 'Deterministic heuristic')
  };
}

function bindHistoryEvents() {
  historyBtnEl.addEventListener('click', () => {
    renderHistory();
    historyModalEl.hidden = false;
  });
  historyCloseBtnEl.addEventListener('click', () => {
    historyModalEl.hidden = true;
  });
  historyModalEl.addEventListener('click', (event) => {
    if (event.target === historyModalEl) historyModalEl.hidden = true;
  });
}

async function initialize() {
  bindHistoryEvents();

  try {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data?.session?.user?.id) {
      currentUserId = data.session.user.id;
      const profileRow = await fetchUserProfile(currentUserId);
      currentUserProfileJson = profileRow?.profile && typeof profileRow.profile === 'object'
        ? profileRow.profile
        : {};
    }
  } catch (_) {
    // Non-blocking: report view still works with local cache.
  }

  let latest = loadLatestReport();
  if (!latest) {
    renderReport(null);
    return;
  }

  upsertReportHistory(latest);
  await persistFitnessReportToAccount(latest);
  renderReport(latest);

  try {
    const refreshed = await maybeRegenerateReport(latest);
    const changed = String(refreshed?.report_id || '') !== String(latest?.report_id || '');
    if (changed) {
      saveLatestReport(refreshed);
      upsertReportHistory(refreshed);
      await persistFitnessReportToAccount(refreshed);
      renderReport(refreshed);
    }
  } catch (_) {
    // Keep latest report rendered if auto-refresh fails.
  }
}

initialize();
