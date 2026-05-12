import { supabase } from './supabase-client.js';

const USER_PROFILE_TABLE = 'user_profiles';
const OUTCOME_RESULT_STORAGE_KEY = 'insight-lab:last-outcome-test';
const INSIGHT_LAB_PROFILE_KEY = 'insight_lab';
const ACCOUNT_OUTCOME_REPORTS_KEY = 'outcome_reports';
const MAX_HISTORY_REPORTS = 10;

const summaryTitleEl = document.getElementById('summaryTitle');
const summarySubEl = document.getElementById('summarySub');
const metricGeneratedAtEl = document.getElementById('metricGeneratedAt');
const metricCombinationsEl = document.getElementById('metricCombinations');
const metricIntegrityEl = document.getElementById('metricIntegrity');
const metricTransitionsEl = document.getElementById('metricTransitions');
const scenarioGridEl = document.getElementById('scenarioGrid');
const scenarioFallbackEl = document.getElementById('scenarioFallback');
const historyBtnEl = document.getElementById('historyBtn');
const historyModalEl = document.getElementById('historyModal');
const historyCloseBtnEl = document.getElementById('historyCloseBtn');
const historyListEl = document.getElementById('historyList');

let currentUserId = '';
let cachedHistory = [];

function safeText(value, fallback = '-') {
  const text = String(value || '').trim();
  return text || fallback;
}

function toPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
}

function formatPercent(value) {
  return `${toPercent(value).toFixed(2)}%`;
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

function normalizePersonaKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.replace(/[^a-z0-9_-]/g, '');
}

function formatCombinations(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return numeric.toLocaleString();
}

function getReportTimestampValue(report) {
  const stamp = String(
    report?.generated_at ||
      report?.generatedAt ||
      report?.updated_at ||
      report?.created_at ||
      ''
  ).trim();
  if (!stamp) return 0;
  const epoch = Date.parse(stamp);
  return Number.isFinite(epoch) ? epoch : 0;
}

function getReportFingerprint(report) {
  if (!report || typeof report !== 'object') return '';
  const reportId = String(report?.report_id || '').trim();
  if (reportId) return `id:${reportId}`;

  const keyA = normalizePersonaKey(report?.persona_a?.key || report?.personaA?.key || '');
  const keyB = normalizePersonaKey(report?.persona_b?.key || report?.personaB?.key || '');
  const outcome = String(report?.requested_outcome || report?.requestedOutcome || '').trim().toLowerCase();
  const generated = String(report?.generated_at || report?.generatedAt || '').trim();
  return `${keyA}|${keyB}|${outcome}|${generated}`;
}

function dedupeReports(reports) {
  const seen = new Set();
  const output = [];
  reports.forEach((report) => {
    if (!report || typeof report !== 'object') return;
    const fingerprint = getReportFingerprint(report);
    if (fingerprint && seen.has(fingerprint)) return;
    if (fingerprint) seen.add(fingerprint);
    output.push(report);
  });
  return output;
}

function sortReportsNewestFirst(reports) {
  return [...reports].sort((left, right) => getReportTimestampValue(right) - getReportTimestampValue(left));
}

function loadLatestLocalOutcomeReport() {
  try {
    const raw = localStorage.getItem(OUTCOME_RESULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function saveLatestLocalOutcomeReport(report) {
  if (!report || typeof report !== 'object') return;
  localStorage.setItem(OUTCOME_RESULT_STORAGE_KEY, JSON.stringify(report));
}

function normalizeScenarioList(report) {
  const fromChain = Array.isArray(report?.chain_candidates) ? report.chain_candidates : [];
  if (fromChain.length) return fromChain.slice(0, 5);
  const legacy = Array.isArray(report?.top_pathways) ? report.top_pathways : [];
  return legacy.slice(0, 5);
}

function renderScenarioCard(scenario, index) {
  const integrity = formatPercent(scenario?.chain_metrics?.chain_integrity_percent ?? scenario?.empirical_success_percent);
  const logicality = formatPercent(scenario?.chain_metrics?.logicality_percent);
  const ethicsLegal = formatPercent(scenario?.chain_metrics?.ethics_legal_percent ?? scenario?.average_ethics_percent);
  const transitionsPassed = Number(scenario?.chain_metrics?.transitions_passed || 0) || 0;
  const transitionsTotal = Number(scenario?.chain_metrics?.transitions_total || 0) || 0;
  const actions = Array.isArray(scenario?.actions) ? scenario.actions : [];

  const actionRows = actions
    .slice(0, 10)
    .map((step) => {
      const nodeIndex = Number(step?.node_index || 0) || 0;
      const actionText = safeText(step?.action, '');
      if (!actionText) return '';
      return `<div><strong>N${nodeIndex}</strong>: ${escapeHtml(actionText)}</div>`;
    })
    .filter(Boolean)
    .join('');

  return `
    <article class="scenario-card">
      <h3>Scenario ${index + 1}</h3>
      <div class="scenario-metrics">
        <span>Integrity ${integrity}</span>
        <span>Logicality ${logicality}</span>
        <span>Ethics/Legal ${ethicsLegal}</span>
        <span>Transitions ${transitionsPassed}/${transitionsTotal}</span>
      </div>
      <div class="scenario-actions">${actionRows || '<div>No action steps available.</div>'}</div>
    </article>
  `;
}

function renderReport(report) {
  if (!report || typeof report !== 'object') {
    summaryTitleEl.textContent = 'No outcome report loaded.';
    summarySubEl.textContent = 'Run an Outcomes Test in Insight Lab to generate scenario guidance.';
    metricGeneratedAtEl.textContent = '-';
    metricCombinationsEl.textContent = '-';
    metricIntegrityEl.textContent = '-';
    metricTransitionsEl.textContent = '-';
    scenarioGridEl.innerHTML = '';
    scenarioFallbackEl.hidden = false;
    scenarioFallbackEl.textContent = 'No scenarios available yet.';
    return;
  }

  const personaA = safeText(report?.persona_a?.label || report?.personaA?.label || 'Persona A');
  const personaB = safeText(report?.persona_b?.label || report?.personaB?.label || 'Persona B');
  const outcome = safeText(report?.requested_outcome || report?.requestedOutcome || 'Requested outcome');
  const scenarios = normalizeScenarioList(report);
  const bestScenario = report?.best_chain && typeof report.best_chain === 'object'
    ? report.best_chain
    : scenarios[0] || null;
  const transitionsPassed = Number(bestScenario?.chain_metrics?.transitions_passed || 0) || 0;
  const transitionsTotal = Number(bestScenario?.chain_metrics?.transitions_total || 0) || 0;
  const integrity = bestScenario
    ? formatPercent(bestScenario?.chain_metrics?.chain_integrity_percent ?? bestScenario?.empirical_success_percent)
    : '-';

  summaryTitleEl.textContent = `${personaA} → ${personaB}`;
  summarySubEl.textContent = outcome;
  metricGeneratedAtEl.textContent = formatDateTime(report?.generated_at || report?.generatedAt);
  metricCombinationsEl.textContent = formatCombinations(report?.total_action_combinations);
  metricIntegrityEl.textContent = integrity;
  metricTransitionsEl.textContent = transitionsTotal ? `${transitionsPassed}/${transitionsTotal}` : '-';

  scenarioGridEl.innerHTML = '';
  if (!scenarios.length) {
    scenarioFallbackEl.hidden = false;
    scenarioFallbackEl.textContent = 'No scenarios available in this report.';
    return;
  }

  scenarioFallbackEl.hidden = true;
  scenarioGridEl.innerHTML = scenarios
    .map((scenario, index) => renderScenarioCard(scenario, index))
    .join('');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderHistory(history) {
  historyListEl.innerHTML = '';
  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No outcome report history yet.';
    historyListEl.appendChild(empty);
    return;
  }

  history.slice(0, MAX_HISTORY_REPORTS).forEach((entry) => {
    const item = document.createElement('article');
    item.className = 'history-item';
    const personaA = safeText(entry?.persona_a?.label || entry?.personaA?.label || 'Persona A');
    const personaB = safeText(entry?.persona_b?.label || entry?.personaB?.label || 'Persona B');
    const outcome = safeText(entry?.requested_outcome || entry?.requestedOutcome || 'Requested outcome');
    const generatedAt = formatDateTime(entry?.generated_at || entry?.generatedAt);

    const scenarioList = normalizeScenarioList(entry);
    const bestScenario = entry?.best_chain && typeof entry.best_chain === 'object'
      ? entry.best_chain
      : scenarioList[0] || null;
    const integrity = bestScenario
      ? formatPercent(bestScenario?.chain_metrics?.chain_integrity_percent ?? bestScenario?.empirical_success_percent)
      : '-';

    item.innerHTML = `
      <div class="history-item-top">
        <span class="history-pair">${escapeHtml(`${personaA} vs ${personaB}`)}</span>
        <span class="history-time">${escapeHtml(generatedAt)}</span>
      </div>
      <div class="history-meta">
        <span>Integrity: <strong>${escapeHtml(integrity)}</strong></span>
        <span>Outcome: ${escapeHtml(outcome)}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      saveLatestLocalOutcomeReport(entry);
      renderReport(entry);
      historyModalEl.hidden = true;
    });

    historyListEl.appendChild(item);
  });
}

async function loadOutcomeHistoryFromAccount(userId) {
  const { data, error } = await supabase
    .from(USER_PROFILE_TABLE)
    .select('profile')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    return [];
  }
  const profile = data?.profile && typeof data.profile === 'object' ? data.profile : {};
  const insightLab = profile?.[INSIGHT_LAB_PROFILE_KEY] && typeof profile[INSIGHT_LAB_PROFILE_KEY] === 'object'
    ? profile[INSIGHT_LAB_PROFILE_KEY]
    : {};
  const reports = Array.isArray(insightLab?.[ACCOUNT_OUTCOME_REPORTS_KEY])
    ? insightLab[ACCOUNT_OUTCOME_REPORTS_KEY]
    : [];
  return reports.filter((item) => item && typeof item === 'object');
}

async function initialize() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.user) {
    window.location.href = 'sign-in.html';
    return;
  }

  currentUserId = data.session.user.id;
  const accountHistory = await loadOutcomeHistoryFromAccount(currentUserId);
  const localLatest = loadLatestLocalOutcomeReport();

  const merged = dedupeReports(
    sortReportsNewestFirst([...(localLatest ? [localLatest] : []), ...accountHistory])
  );
  cachedHistory = merged.slice(0, MAX_HISTORY_REPORTS);

  const latest = cachedHistory[0] || localLatest || null;
  if (latest) saveLatestLocalOutcomeReport(latest);
  renderReport(latest);
  renderHistory(cachedHistory);
}

historyBtnEl.addEventListener('click', () => {
  renderHistory(cachedHistory);
  historyModalEl.hidden = false;
});

historyCloseBtnEl.addEventListener('click', () => {
  historyModalEl.hidden = true;
});

historyModalEl.addEventListener('click', (event) => {
  if (event.target === historyModalEl) historyModalEl.hidden = true;
});

initialize();
