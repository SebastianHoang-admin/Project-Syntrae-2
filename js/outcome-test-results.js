import { supabase } from './supabase-client.js';

const USER_PROFILE_TABLE = 'user_profiles';
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

function truncateText(value, max = 140) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
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

function selectActionBySlot(actions, slot) {
  const list = Array.isArray(actions) ? actions : [];
  return (
    list.find((action) => Number(action?.gene_slot || 0) === slot) ||
    list[slot - 1] ||
    list[0] ||
    null
  );
}

function buildActionLookup(nodes) {
  const map = new Map();
  (Array.isArray(nodes) ? nodes : []).forEach((node, nodeIndex) => {
    const actions = Array.isArray(node?.actions) ? node.actions : [];
    actions.forEach((action, actionIndex) => {
      const fallbackId = `N${nodeIndex + 1}A${actionIndex + 1}`;
      const actionId = String(action?.id || fallbackId).trim() || fallbackId;
      map.set(actionId, String(action?.action || '').trim());
    });
  });
  return map;
}

function normalizeChainMatrix(matrixInput, nodes, actionsPerNode) {
  const safeNodes = Array.isArray(nodes) ? nodes : [];
  const defaultColumns = safeNodes.map((node, index) => {
    const nodeIndex = Number(node?.node_index || index + 1) || index + 1;
    return {
      node_index: nodeIndex,
      node_title: String(node?.node_title || `Node ${nodeIndex}`).trim() || `Node ${nodeIndex}`,
      column_key: `N${nodeIndex}`
    };
  });
  const matrix = matrixInput && typeof matrixInput === 'object' ? matrixInput : {};
  const inputColumns = Array.isArray(matrix?.columns) ? matrix.columns : [];
  const inputRows = Array.isArray(matrix?.rows) ? matrix.rows : [];
  const hasRows = inputColumns.length > 0 && inputRows.length > 0;

  if (!hasRows) {
    const rows = [];
    for (let slot = 1; slot <= actionsPerNode; slot += 1) {
      const actionIds = safeNodes.map((node, nodeIndex) => {
        const action = selectActionBySlot(node?.actions, slot);
        return String(action?.id || `N${nodeIndex + 1}A${slot}`).trim() || `N${nodeIndex + 1}A${slot}`;
      });
      rows.push({
        gene_slot: slot,
        action_slot: `A${slot}`,
        chain_id: `G${slot}`,
        action_ids: actionIds
      });
    }
    return {
      horizontal_axis: 'nodes',
      vertical_axis: 'actions',
      columns: defaultColumns,
      rows
    };
  }

  const columns = inputColumns.map((column, index) => {
    const nodeIndex = Number(column?.node_index || index + 1) || index + 1;
    return {
      node_index: nodeIndex,
      node_title: String(column?.node_title || `Node ${nodeIndex}`).trim() || `Node ${nodeIndex}`,
      column_key: String(column?.column_key || `N${nodeIndex}`).trim() || `N${nodeIndex}`
    };
  });
  const rows = inputRows.map((row, index) => {
    const geneSlot = Number(row?.gene_slot || index + 1) || index + 1;
    const actionIds = Array.isArray(row?.action_ids)
      ? row.action_ids.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    return {
      gene_slot: geneSlot,
      action_slot: String(row?.action_slot || `A${geneSlot}`).trim() || `A${geneSlot}`,
      chain_id: String(row?.chain_id || `G${geneSlot}`).trim() || `G${geneSlot}`,
      action_ids: actionIds
    };
  });
  return {
    horizontal_axis: 'nodes',
    vertical_axis: 'actions',
    columns,
    rows
  };
}

function renderMatrixCard(matrix, actionLookup) {
  if (!matrix || !Array.isArray(matrix.columns) || !Array.isArray(matrix.rows)) return '';
  if (!matrix.columns.length || !matrix.rows.length) return '';

  const headCells = matrix.columns
    .map((column) => `<th>${escapeHtml(String(column?.column_key || `N${column?.node_index || '?'}`))}</th>`)
    .join('');
  const bodyRows = matrix.rows
    .map((row) => {
      const actionIds = Array.isArray(row?.action_ids) ? row.action_ids : [];
      const cells = matrix.columns
        .map((_, columnIndex) => {
          const actionId = String(actionIds[columnIndex] || '').trim();
          const actionText = escapeHtml(truncateText(actionLookup.get(actionId) || '', 120));
          return `
            <td>
              <strong>${escapeHtml(actionId || '-')}</strong>
              ${actionText ? `<span>${actionText}</span>` : '<span>-</span>'}
            </td>
          `;
        })
        .join('');
      const slotLabel = escapeHtml(String(row?.action_slot || `A${row?.gene_slot || '?'}`));
      const chainLabel = escapeHtml(String(row?.chain_id || ''));
      return `<tr><th>${slotLabel}${chainLabel ? `<small>${chainLabel}</small>` : ''}</th>${cells}</tr>`;
    })
    .join('');

  return `
    <article class="scenario-card matrix-card">
      <h3>EA Chain Array (Nodes × Actions)</h3>
      <div class="matrix-meta">${escapeHtml(`Horizontal: ${matrix.horizontal_axis || 'nodes'} · Vertical: ${matrix.vertical_axis || 'actions'}`)}</div>
      <div class="matrix-wrap">
        <table class="matrix-table">
          <thead>
            <tr>
              <th>Action</th>
              ${headCells}
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </article>
  `;
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
  const nodes = Array.isArray(report?.action_space) ? report.action_space : [];
  const actionsPerNode = Number(report?.config?.actions_per_node || 5) || 5;
  const matrix = normalizeChainMatrix(report?.chain_action_matrix, nodes, actionsPerNode);
  const actionLookup = buildActionLookup(nodes);
  const matrixCard = renderMatrixCard(matrix, actionLookup);
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
  summarySubEl.textContent = sourceLine ? `${outcome} · ${sourceLine}` : outcome;
  metricGeneratedAtEl.textContent = formatDateTime(report?.generated_at || report?.generatedAt);
  metricCombinationsEl.textContent = formatCombinations(report?.total_action_combinations);
  metricIntegrityEl.textContent = integrity;
  metricTransitionsEl.textContent = transitionsTotal ? `${transitionsPassed}/${transitionsTotal}` : '-';

  scenarioGridEl.innerHTML = '';
  if (!scenarios.length) {
    scenarioGridEl.innerHTML = matrixCard;
    if (!matrixCard) {
      scenarioFallbackEl.hidden = false;
      scenarioFallbackEl.textContent = 'No scenarios available in this report.';
      return;
    }
    scenarioFallbackEl.hidden = true;
    return;
  }

  scenarioFallbackEl.hidden = true;
  const scenarioCards = scenarios
    .map((scenario, index) => renderScenarioCard(scenario, index))
    .join('');
  scenarioGridEl.innerHTML = `${matrixCard}${scenarioCards}`;
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
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.user) {
    window.location.href = 'sign-in.html';
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
