import { supabase } from './supabase-client.js';

const USER_PROFILE_TABLE = 'user_profiles';
const INSIGHT_LAB_PROFILE_KEY = 'insight_lab';
const ACCOUNT_OUTCOME_REPORTS_KEY = 'outcome_reports';
const MAX_HISTORY_REPORTS = 10;
const DECISION_TREE_DEMO = 'decision-tree';

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

function buildDemoOutcomeReport() {
  return {
    report_id: 'demo-maya-daniel-outcome',
    generated_at: new Date().toISOString(),
    requested_outcome: "Invite Daniel to talk about where the relationship is going without making the message feel heavy.",
    persona_a: { key: '__user_persona__', label: 'Maya Chen' },
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

function isFallbackGeneratedOutcomeReport(report) {
  const source = String(report?.generator_source || report?.generatorSource || '').trim().toLowerCase();
  return source.startsWith('fallback');
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
    if (isFallbackGeneratedOutcomeReport(report)) return;
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

function getReportSelectorFromUrl() {
  const params = new URLSearchParams(window.location.search || '');
  const reportId = String(params.get('report_id') || '').trim();
  const generatedAt = String(params.get('generated_at') || '').trim();
  return {
    report_id: reportId || '',
    generated_at: generatedAt || ''
  };
}

function selectReportFromHistory(history, selector) {
  if (!Array.isArray(history) || !history.length) return null;
  const safeSelector = selector && typeof selector === 'object' ? selector : {};
  const targetId = String(safeSelector.report_id || '').trim();
  if (targetId) {
    const byId = history.find((entry) => String(entry?.report_id || '').trim() === targetId);
    if (byId) return byId;
  }
  const targetGeneratedAt = String(safeSelector.generated_at || '').trim();
  if (targetGeneratedAt) {
    const byGenerated = history.find((entry) => {
      const stamp = String(entry?.generated_at || entry?.generatedAt || '').trim();
      return stamp && stamp === targetGeneratedAt;
    });
    if (byGenerated) return byGenerated;
  }
  return history[0];
}

function updateUrlForReport(report) {
  if (!report || typeof report !== 'object') return;
  const reportId = String(report?.report_id || '').trim();
  const generatedAt = String(report?.generated_at || report?.generatedAt || '').trim();
  const params = new URLSearchParams();
  if (isDecisionTreeDemo()) params.set('demo', DECISION_TREE_DEMO);
  if (reportId) {
    params.set('report_id', reportId);
  } else if (generatedAt) {
    params.set('generated_at', generatedAt);
  }
  const query = params.toString();
  const target = `outcome-test-results.html${query ? `?${query}` : ''}`;
  window.history.replaceState({}, '', target);
}

function normalizeScenarioList(report) {
  const fromChain = Array.isArray(report?.chain_candidates) ? report.chain_candidates : [];
  if (fromChain.length) return fromChain.slice(0, 5);
  const legacy = Array.isArray(report?.top_pathways) ? report.top_pathways : [];
  return legacy.slice(0, 5);
}

function describeGenerationSource(report) {
  const source = String(report?.generator_source || '').trim();
  if (source === 'llm_prompt_template') {
    const id = safeText(report?.prompt_template_id_used, '');
    const version = safeText(report?.prompt_template_version_used, '');
    if (id && version) return `Source: prompt template ${id} (v${version})`;
    if (id) return `Source: prompt template ${id}`;
    return 'Source: prompt template';
  }
  if (source === 'llm_inline_prompt') return 'Source: inline model prompt';
  if (source) return `Source: ${source}`;
  return '';
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
    summarySubEl.textContent = 'Run Best Way in Decision Studio to generate scenario guidance.';
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
  const outcome = safeText(report?.requested_outcome || report?.requestedOutcome || 'Requested goal');
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
  const sourceLine = describeGenerationSource(report);
  const probabilityLine = isDecisionTreeDemo() ? 'Best Way probability ranges' : '';
  summarySubEl.textContent = [outcome, sourceLine, probabilityLine].filter(Boolean).join(' · ');
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
    const outcome = safeText(entry?.requested_outcome || entry?.requestedOutcome || 'Requested goal');
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
        <span>Goal: ${escapeHtml(outcome)}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      renderReport(entry);
      updateUrlForReport(entry);
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
  return reports.filter((item) => item && typeof item === 'object' && !isFallbackGeneratedOutcomeReport(item));
}

async function initialize() {
  if (isDecisionTreeDemo()) {
    document.body.classList.add('demo-mode');
    document.querySelectorAll('a[href="insight-lab.html"]').forEach((link) => {
      link.setAttribute('href', demoUrl('insight-lab.html'));
    });
    cachedHistory = [buildDemoOutcomeReport()];
    renderReport(cachedHistory[0]);
    updateUrlForReport(cachedHistory[0]);
    renderHistory(cachedHistory);
    return;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.user) {
    window.location.href = 'sign-in.html?auth=required';
    return;
  }

  currentUserId = data.session.user.id;
  const accountHistory = await loadOutcomeHistoryFromAccount(currentUserId);
  const merged = dedupeReports(sortReportsNewestFirst(accountHistory));
  cachedHistory = merged.slice(0, MAX_HISTORY_REPORTS);
  const selected = selectReportFromHistory(cachedHistory, getReportSelectorFromUrl());
  renderReport(selected);
  if (selected) updateUrlForReport(selected);
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
