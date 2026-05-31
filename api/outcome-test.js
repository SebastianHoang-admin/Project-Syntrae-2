const { resolveEnv } = require('./env-utils');
const {
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  DEFAULT_DIGEST_TOKEN_LIMIT,
  buildDeterministicPersonaDigest,
  buildPackedOutcomeContext,
  buildPersonaSourceHash,
  shouldFallbackDigestToLlm,
  validateDigestShape
} = require('./outcome-context-utils');

const DEFAULT_NODE_COUNT = 10;
const DEFAULT_ACTIONS_PER_NODE = 5;
const DEFAULT_POPULATION_SIZE = 140;
const DEFAULT_GENERATIONS = 90;
const DEFAULT_MUTATION_RATE = 0.14;
const DEFAULT_ELITE_COUNT = 8;
const DEFAULT_TOP_PATHWAYS = 5;
const DEFAULT_MONTE_CARLO_REPS = 1000;
const DEFAULT_OUTCOME_PROMPT_ID = 'pmpt_69fa2fb3eefc8196b8ca8889f95f756903f3f05aace493de';
const DEFAULT_OUTCOME_MAX_OUTPUT_TOKENS = 100000;
const MAX_OUTCOME_MAX_OUTPUT_TOKENS = 100000;
const DEFAULT_OUTCOME_MODEL_TIMEOUT_MS = 285000;
const DEFAULT_OUTCOME_MIN_ADAPTIVE_OUTPUT_CAP = 6000;
const DEFAULT_OUTCOME_GLOBAL_TPM_LIMIT = 30000;
const DEFAULT_OUTCOME_TPM_WINDOW_SECONDS = 60;
const DEFAULT_OUTCOME_TPM_WAIT_TIMEOUT_MS = 240000;
const DEFAULT_OUTCOME_CONTEXT_BUDGET_TOKENS = DEFAULT_CONTEXT_BUDGET_TOKENS;
const DEFAULT_OUTCOME_MAX_DIGEST_AGE_SECONDS = 86400;

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function clampInt(value, min, max) {
  return Math.round(clamp(value, min, max));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (!text) return fallback;
    if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  }
  return fallback;
}

function pickFirstPresent(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return undefined;
}

function mergePlainObjects(...values) {
  const merged = {};
  values.forEach((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    Object.assign(merged, value);
  });
  return merged;
}

function sanitizeText(value, maxLength = 280) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function sanitizePersonaKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

function toJsonSafeValue(value, seen = new WeakSet(), depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 20) return '[Depth limit reached]';

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return value;
  if (valueType === 'bigint') return value.toString();
  if (valueType === 'function' || valueType === 'symbol') return undefined;

  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafeValue(item, seen, depth + 1));
  }

  if (valueType === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out = {};
    Object.entries(value).forEach(([key, nested]) => {
      const safeNested = toJsonSafeValue(nested, seen, depth + 1);
      if (safeNested !== undefined) out[key] = safeNested;
    });
    seen.delete(value);
    return out;
  }

  return String(value);
}

function safeJson(value) {
  try {
    return JSON.stringify(toJsonSafeValue(value || {}));
  } catch (_) {
    return '{}';
  }
}

function parseRetryAfterSecondsFromText(value) {
  const text = String(value || '');
  if (!text) return null;
  const match = text.match(/try again in\s+([0-9]+(?:\.[0-9]+)?)s/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds;
}

function parseRetryAfterSecondsFromHeader(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const epoch = Date.parse(raw);
  if (!Number.isFinite(epoch)) return null;
  const deltaSeconds = (epoch - Date.now()) / 1000;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return null;
  return deltaSeconds;
}

function parseRateLimitResetSeconds(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const pattern = /([0-9]+(?:\.[0-9]+)?)(ms|s|m|h|d)/gi;
  let matched = false;
  let seconds = 0;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    matched = true;
    const amount = Number(match[1]);
    const unit = String(match[2] || '').toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (unit === 'ms') seconds += amount / 1000;
    if (unit === 's') seconds += amount;
    if (unit === 'm') seconds += amount * 60;
    if (unit === 'h') seconds += amount * 60 * 60;
    if (unit === 'd') seconds += amount * 60 * 60 * 24;
  }
  if (!matched || seconds <= 0) return null;
  return seconds;
}

function buildOpenAiRateLimitInfo(headers) {
  if (!headers || typeof headers.get !== 'function') return {};
  const limitRequests = Number(headers.get('x-ratelimit-limit-requests'));
  const limitTokens = Number(headers.get('x-ratelimit-limit-tokens'));
  const remainingRequests = Number(headers.get('x-ratelimit-remaining-requests'));
  const remainingTokens = Number(headers.get('x-ratelimit-remaining-tokens'));
  const resetRequestsRaw = headers.get('x-ratelimit-reset-requests');
  const resetTokensRaw = headers.get('x-ratelimit-reset-tokens');
  const retryAfterRaw = headers.get('retry-after');

  const resetRequestsSeconds = parseRateLimitResetSeconds(resetRequestsRaw);
  const resetTokensSeconds = parseRateLimitResetSeconds(resetTokensRaw);
  const retryAfterSeconds = parseRetryAfterSecondsFromHeader(retryAfterRaw);

  return {
    limit_requests: Number.isFinite(limitRequests) ? limitRequests : null,
    limit_tokens: Number.isFinite(limitTokens) ? limitTokens : null,
    remaining_requests: Number.isFinite(remainingRequests) ? remainingRequests : null,
    remaining_tokens: Number.isFinite(remainingTokens) ? remainingTokens : null,
    reset_requests: sanitizeText(resetRequestsRaw || '', 40) || null,
    reset_tokens: sanitizeText(resetTokensRaw || '', 40) || null,
    retry_after: sanitizeText(retryAfterRaw || '', 80) || null,
    reset_requests_seconds: Number.isFinite(resetRequestsSeconds) ? Math.max(0, Math.ceil(resetRequestsSeconds)) : null,
    reset_tokens_seconds: Number.isFinite(resetTokensSeconds) ? Math.max(0, Math.ceil(resetTokensSeconds)) : null,
    retry_after_seconds: Number.isFinite(retryAfterSeconds) ? Math.max(0, Math.ceil(retryAfterSeconds)) : null
  };
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { method: 'GET', headers });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

async function fetchSupabaseUser(supabaseUrl, anonKey, accessToken) {
  return fetchJson(`${supabaseUrl}/auth/v1/user`, {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function estimateTokenCountFromText(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function estimateTokenCountFromJson(value) {
  return estimateTokenCountFromText(safeJson(value));
}

function estimateAdaptiveOutputTokenCap(nodeCount, actionsPerNode) {
  const safeNodeCount = clampInt(nodeCount, 1, 24);
  const safeActionsPerNode = clampInt(actionsPerNode, 1, 12);
  const actionCount = safeNodeCount * safeActionsPerNode;
  const perActionBudget = 64;
  const perNodeOverhead = 26;
  const globalOverhead = 360;
  const estimated = globalOverhead + (actionCount * perActionBudget) + (safeNodeCount * perNodeOverhead);
  const headroom = Math.ceil(estimated * 1.25);
  return clampInt(headroom, 1400, MAX_OUTCOME_MAX_OUTPUT_TOKENS);
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric;
}

function extractUsageFromResponsesPayload(raw) {
  const usage = raw?.usage && typeof raw.usage === 'object' ? raw.usage : {};
  const inputTokens = Math.max(0, Math.round(toFiniteNumber(
    usage.input_tokens ??
      usage.prompt_tokens ??
      usage.inputTokens ??
      0,
    0
  )));
  const outputTokens = Math.max(0, Math.round(toFiniteNumber(
    usage.output_tokens ??
      usage.completion_tokens ??
      usage.outputTokens ??
      0,
    0
  )));
  const totalTokensRaw = Math.max(0, Math.round(toFiniteNumber(
    usage.total_tokens ??
      usage.totalTokens ??
      (inputTokens + outputTokens),
    inputTokens + outputTokens
  )));
  const totalTokens = Math.max(totalTokensRaw, inputTokens + outputTokens);
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens
  };
}

const MODEL_CONTEXT_DROP_KEY_PATTERN = /(^|_)(portrait|avatar|image|photo|thumbnail|base64|data_url|token|secret|password|session|jwt|cookie|binary|blob|html|markdown)(_|$)/i;

function shouldDropModelContextKey(key) {
  const normalized = String(key || '').trim();
  if (!normalized) return true;
  return MODEL_CONTEXT_DROP_KEY_PATTERN.test(normalized);
}

function compactModelContextValue(value, depth = 0) {
  if (value === null || value === undefined) return undefined;
  if (depth > 4) return undefined;
  if (typeof value === 'string') return sanitizeText(value, 220);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    const out = value
      .slice(0, 10)
      .map((item) => compactModelContextValue(item, depth + 1))
      .filter((item) => item !== undefined);
    return out.length ? out : undefined;
  }
  if (typeof value !== 'object') return undefined;

  const out = {};
  const entries = Object.entries(value).slice(0, 24);
  entries.forEach(([key, nested]) => {
    const safeKey = sanitizeText(key, 64);
    if (!safeKey || shouldDropModelContextKey(safeKey)) return;
    const compacted = compactModelContextValue(nested, depth + 1);
    if (compacted === undefined) return;
    out[safeKey] = compacted;
  });
  return Object.keys(out).length ? out : undefined;
}

function normalizeSupabaseRpcResult(body) {
  if (Array.isArray(body)) return body[0] && typeof body[0] === 'object' ? body[0] : {};
  if (!body || typeof body !== 'object') return {};
  return body;
}

async function callSupabaseRpc(supabaseUrl, serviceRoleKey, fnName, payload) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(payload || {})
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = sanitizeText(
      body?.message || body?.hint || body?.error || `Supabase RPC ${fnName} failed`,
      260
    ) || `Supabase RPC ${fnName} failed`;
    const error = new Error(message);
    error.status = response.status;
    error.code = sanitizeText(body?.code || '', 32);
    throw error;
  }

  return normalizeSupabaseRpcResult(body);
}

function isMissingTokenLimiterSchemaError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  return (
    code === '42p01' ||
    code === '42883' ||
    message.includes('outcome_token_budget_acquire') ||
    message.includes('outcome_token_budget_release') ||
    (message.includes('relation') && message.includes('outcome_token_budget'))
  );
}

async function acquireOutcomeTokenReservation({
  supabaseUrl,
  serviceRoleKey,
  estimatedTokens,
  tpmLimit,
  windowSeconds,
  waitTimeoutMs,
  requestId,
  userId
}) {
  const startedAt = Date.now();
  const safeTokens = clampInt(estimatedTokens, 1, 2_000_000);
  const safeLimit = clampInt(tpmLimit, 1000, 20_000_000);
  const safeWindowSeconds = clampInt(windowSeconds, 20, 300);
  const safeWaitTimeoutMs = clampInt(waitTimeoutMs, 5000, 900000);

  while (true) {
    let result;
    try {
      result = await callSupabaseRpc(supabaseUrl, serviceRoleKey, 'outcome_token_budget_acquire', {
        p_tokens: safeTokens,
        p_tpm_limit: safeLimit,
        p_window_seconds: safeWindowSeconds,
        p_request_id: requestId || null,
        p_user_id: userId || null
      });
    } catch (error) {
      if (isMissingTokenLimiterSchemaError(error)) {
        const schemaError = new Error(
          'Supabase token limiter schema is missing. Run supabase/persona_tables.sql to install outcome token budget functions.'
        );
        schemaError.status = 500;
        schemaError.stage = 'configuration.supabase_token_limiter';
        throw schemaError;
      }
      throw error;
    }

    const granted = parseBoolean(result?.granted, false);
    const reason = sanitizeText(result?.reason || '', 80);
    const retryAfterSeconds = clampInt(
      pickFirstPresent(result?.retry_after_seconds, result?.retryAfterSeconds, 2),
      1,
      900
    );

    if (granted) {
      return {
        reservation_id: sanitizeText(result?.reservation_id || '', 120),
        limit_tokens: toFiniteNumber(result?.limit_tokens, safeLimit),
        remaining_tokens: Math.max(0, Math.round(toFiniteNumber(result?.remaining_tokens, 0))),
        retry_after_seconds: retryAfterSeconds,
        wait_ms: Date.now() - startedAt
      };
    }

    if (reason === 'request_exceeds_limit') {
      const tooLargeError = new Error(
        `Estimated request token budget (${safeTokens}) exceeds global TPM limit (${safeLimit}).`
      );
      tooLargeError.status = 400;
      tooLargeError.stage = 'configuration.request_token_budget';
      tooLargeError.retryAfterSeconds = retryAfterSeconds;
      throw tooLargeError;
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed + (retryAfterSeconds * 1000) > safeWaitTimeoutMs) {
      const timeoutError = new Error(
        `Outcome request is waiting for global token capacity. Retry in ~${retryAfterSeconds}s.`
      );
      timeoutError.status = 429;
      timeoutError.stage = 'openai.global_tpm_wait_timeout';
      timeoutError.retryAfterSeconds = retryAfterSeconds;
      timeoutError.rateLimitResetTokensSeconds = retryAfterSeconds;
      timeoutError.rateLimit = {
        limit_tokens: safeLimit,
        remaining_tokens: Math.max(0, Math.round(toFiniteNumber(result?.remaining_tokens, 0))),
        retry_after_seconds: retryAfterSeconds
      };
      throw timeoutError;
    }

    await sleep(retryAfterSeconds * 1000);
  }
}

async function releaseOutcomeTokenReservation({
  supabaseUrl,
  serviceRoleKey,
  reservationId,
  actualTokens,
  success,
  requestId,
  userId,
  model,
  promptId,
  promptVersion,
  errorStage
}) {
  if (!reservationId) return;
  try {
    await callSupabaseRpc(supabaseUrl, serviceRoleKey, 'outcome_token_budget_release', {
      p_reservation_id: reservationId,
      p_actual_tokens: Math.max(0, Math.round(toFiniteNumber(actualTokens, 0))),
      p_success: Boolean(success),
      p_request_id: requestId || null,
      p_user_id: userId || null,
      p_model: sanitizeText(model || '', 80) || null,
      p_prompt_id: sanitizeText(promptId || '', 140) || null,
      p_prompt_version: sanitizeText(promptVersion || '', 40) || null,
      p_error_stage: sanitizeText(errorStage || '', 120) || null
    });
  } catch (error) {
    console.warn('Could not release outcome token reservation:', error?.message || error);
  }
}

function buildServiceRoleHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function callSupabaseRest({
  supabaseUrl,
  serviceRoleKey,
  method,
  path,
  body,
  prefer
}) {
  const headers = buildServiceRoleHeaders(
    serviceRoleKey,
    prefer ? { Prefer: prefer } : {}
  );
  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = sanitizeText(
      data?.message || data?.hint || data?.error || `Supabase ${method} ${path} failed`,
      260
    ) || `Supabase ${method} ${path} failed`;
    const error = new Error(message);
    error.status = response.status;
    error.code = sanitizeText(data?.code || '', 32);
    throw error;
  }
  return data;
}

async function fetchOutcomePromptVariables({
  supabaseUrl,
  serviceRoleKey,
  userId
}) {
  if (!supabaseUrl || !serviceRoleKey || !userId) return null;
  const query = [
    'select=user_id,node_count,actions_per_node,context_budget_tokens,max_digest_age_seconds,compaction_policy,updated_at',
    `user_id=eq.${encodeURIComponent(userId)}`,
    'limit=1'
  ].join('&');
  const rows = await callSupabaseRest({
    supabaseUrl,
    serviceRoleKey,
    method: 'GET',
    path: `/rest/v1/outcome_prompt_variables?${query}`
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchPersonaDigestRow({
  supabaseUrl,
  serviceRoleKey,
  userId,
  personaId
}) {
  if (!supabaseUrl || !serviceRoleKey || !userId || !personaId) return null;
  const query = [
    'select=id,user_id,persona_id,persona_key,digest_json,digest_version,source_hash,token_estimate,status,last_error,created_at,updated_at',
    `user_id=eq.${encodeURIComponent(userId)}`,
    `persona_id=eq.${encodeURIComponent(personaId)}`,
    'limit=1'
  ].join('&');
  const rows = await callSupabaseRest({
    supabaseUrl,
    serviceRoleKey,
    method: 'GET',
    path: `/rest/v1/persona_context_digests?${query}`
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchPersonaRowForDigest({
  supabaseUrl,
  serviceRoleKey,
  userId,
  personaId
}) {
  if (!supabaseUrl || !serviceRoleKey || !userId || !personaId) return null;
  const query = [
    'select=id,user_id,persona_key,name,profile,state,traits,updated_at',
    `user_id=eq.${encodeURIComponent(userId)}`,
    `id=eq.${encodeURIComponent(personaId)}`,
    'limit=1'
  ].join('&');
  const rows = await callSupabaseRest({
    supabaseUrl,
    serviceRoleKey,
    method: 'GET',
    path: `/rest/v1/personas?${query}`
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function upsertPersonaDigestRow({
  supabaseUrl,
  serviceRoleKey,
  row
}) {
  if (!supabaseUrl || !serviceRoleKey || !row?.persona_id) return;
  await callSupabaseRest({
    supabaseUrl,
    serviceRoleKey,
    method: 'POST',
    path: '/rest/v1/persona_context_digests?on_conflict=persona_id',
    body: [row],
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

async function enqueuePersonaDigestJob({
  supabaseUrl,
  serviceRoleKey,
  userId,
  personaId,
  reason
}) {
  if (!supabaseUrl || !serviceRoleKey || !userId || !personaId) return;
  try {
    await callSupabaseRest({
      supabaseUrl,
      serviceRoleKey,
      method: 'POST',
      path: '/rest/v1/rpc/enqueue_persona_digest_job',
      body: {
        p_user_id: userId,
        p_persona_id: personaId,
        p_reason: sanitizeText(reason || 'outcome_request', 120)
      },
      prefer: 'return=minimal'
    });
  } catch (error) {
    console.warn('Could not enqueue persona digest job:', error?.message || error);
  }
}

function parseIsoAgeSeconds(rawTimestamp) {
  const ms = Date.parse(String(rawTimestamp || ''));
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - ms) / 1000);
}

function extractPersonaDbRecord(persona) {
  const raw = persona && typeof persona === 'object' ? persona : {};
  const db = raw?.db_record && typeof raw.db_record === 'object' ? raw.db_record : {};
  return db;
}

function buildPersonaSourceForDigest(persona) {
  const raw = persona && typeof persona === 'object' ? persona : {};
  const db = extractPersonaDbRecord(raw);
  const profile = raw?.profile && typeof raw.profile === 'object'
    ? raw.profile
    : db?.profile && typeof db.profile === 'object'
      ? db.profile
      : {};
  return {
    id: sanitizeText(db?.id || raw?.id || '', 120),
    user_id: sanitizeText(db?.user_id || raw?.user_id || '', 120),
    persona_key: sanitizeText(db?.persona_key || raw?.key || '', 120),
    name: sanitizeText(db?.name || raw?.label || raw?.key || 'Persona', 120),
    profile,
    state: db?.state && typeof db.state === 'object' ? db.state : {},
    traits: db?.traits && typeof db.traits === 'object' ? db.traits : {}
  };
}

function getDigestForPrompt(digestRow, personaFallback) {
  const digestJson = digestRow?.digest_json && typeof digestRow.digest_json === 'object'
    ? digestRow.digest_json
    : {};
  const identity = digestJson?.identity && typeof digestJson.identity === 'object'
    ? digestJson.identity
    : {};
  return {
    identity: {
      persona_key: sanitizeText(identity.persona_key || personaFallback?.persona_key || '', 80),
      label: sanitizeText(identity.label || personaFallback?.name || personaFallback?.persona_key || 'Persona', 120),
      personal_headline: sanitizeText(identity.personal_headline || '', 220),
      communication_style: sanitizeText(identity.communication_style || '', 160)
    },
    goals_top3: Array.isArray(digestJson?.goals_top3) ? digestJson.goals_top3.slice(0, 3) : [],
    constraints_top5: Array.isArray(digestJson?.constraints_top5) ? digestJson.constraints_top5.slice(0, 5) : [],
    hard_boundaries_top5: Array.isArray(digestJson?.hard_boundaries_top5) ? digestJson.hard_boundaries_top5.slice(0, 5) : [],
    topic_anchors_top5: Array.isArray(digestJson?.topic_anchors_top5) ? digestJson.topic_anchors_top5.slice(0, 5) : [],
    shared_activity_preferences_top5: Array.isArray(digestJson?.shared_activity_preferences_top5)
      ? digestJson.shared_activity_preferences_top5.slice(0, 5)
      : [],
    quant_axes_top8: Array.isArray(digestJson?.quant_axes_top8) ? digestJson.quant_axes_top8.slice(0, 8) : [],
    risk_flags: Array.isArray(digestJson?.risk_flags) ? digestJson.risk_flags.slice(0, 5) : [],
    legal_ethics_guardrails: Array.isArray(digestJson?.legal_ethics_guardrails)
      ? digestJson.legal_ethics_guardrails.slice(0, 5)
      : []
  };
}

async function summarizePersonaDigestWithLlm({
  apiKey,
  personaSource,
  maxDigestTokens
}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY missing for digest fallback summarizer.');
  const prompt = [
    'Compress persona profile into strict JSON object.',
    'Allowed keys only:',
    'identity, goals_top3, constraints_top5, hard_boundaries_top5, topic_anchors_top5, shared_activity_preferences_top5, quant_axes_top8, risk_flags, legal_ethics_guardrails.',
    'Keep concise and safe. No markdown.',
    `Persona JSON: ${safeJson(personaSource)}`
  ].join('\n');
  const openaiRes = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: sanitizeText(resolveEnv(['OPENAI_OUTCOME_DIGEST_MODEL']) || 'gpt-5.4-nano', 80),
      input: prompt,
      max_output_tokens: clampInt(maxDigestTokens || DEFAULT_DIGEST_TOKEN_LIMIT, 300, 6000),
      reasoning: { effort: 'minimal', summary: 'auto' },
      text: { format: { type: 'json_object' }, verbosity: 'low' },
      store: false
    })
  });
  const data = await openaiRes.json().catch(() => ({}));
  if (!openaiRes.ok) {
    const message = sanitizeText(data?.error?.message || data?.error || 'Digest summarizer failed', 260);
    const error = new Error(message);
    error.status = openaiRes.status;
    throw error;
  }
  const parsed = parseJsonObject(String(data?.output_text || ''));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Digest summarizer returned invalid JSON output.');
  }
  const validation = validateDigestShape(parsed);
  if (!validation.ok) {
    throw new Error(`Digest summarizer output failed validation: ${validation.reason}`);
  }
  return parsed;
}

async function storeOutcomeContextRun({
  supabaseUrl,
  serviceRoleKey,
  row
}) {
  if (!supabaseUrl || !serviceRoleKey || !row?.user_id) return;
  try {
    await callSupabaseRest({
      supabaseUrl,
      serviceRoleKey,
      method: 'POST',
      path: '/rest/v1/outcome_context_runs',
      body: [row],
      prefer: 'return=minimal'
    });
  } catch (error) {
    console.warn('Could not store outcome context run:', error?.message || error);
  }
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const candidate = raw.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) {
      return null;
    }
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function getScenarioNodeByIndex(nodes, nodeIndex) {
  const list = toArray(nodes);
  return (
    list.find((item) => Number(item?.node_index || item?.index) === nodeIndex) ||
    list[nodeIndex - 1] ||
    null
  );
}

function extractRawNodesFromGeneratedPayload(parsed, nodeCount, actionsPerNode) {
  const directNodes = toArray(parsed?.nodes);
  if (directNodes.length) return directNodes;

  const directActionSpace = toArray(parsed?.action_space);
  if (directActionSpace.length) return directActionSpace;

  const scenarios = toArray(parsed?.scenarios).slice(0, actionsPerNode);
  if (!scenarios.length) return [];

  const outputNodes = [];
  for (let nodeIndex = 1; nodeIndex <= nodeCount; nodeIndex += 1) {
    const actions = [];
    for (let slotIndex = 1; slotIndex <= actionsPerNode; slotIndex += 1) {
      const scenario = scenarios[slotIndex - 1] || {};
      const scenarioNode = getScenarioNodeByIndex(scenario?.nodes, nodeIndex);
      const actionText = sanitizeText(
        scenarioNode?.action || scenarioNode?.step || scenarioNode?.description || '',
        180
      );
      if (!actionText) continue;

      const scenarioScores = scenario?.scores && typeof scenario.scores === 'object'
        ? scenario.scores
        : scenario?.chain_metrics && typeof scenario.chain_metrics === 'object'
          ? scenario.chain_metrics
          : {};
      const fit = clampInt(
        scenarioScores.personalization_fit_percent ??
          scenarioScores.fit ??
          scenarioScores.outcome_alignment_percent ??
          72,
        0,
        100
      );
      const feasibility = clampInt(
        scenarioScores.practicality_percent ?? scenarioScores.feasibility ?? scenarioScores.logicality_percent ?? 70,
        0,
        100
      );
      const ethics = clampInt(
        scenarioScores.ethics_legal_percent ?? scenarioScores.ethics ?? 84,
        0,
        100
      );
      const risk = clampInt(
        scenarioScores.risk ?? Math.max(6, 100 - ethics),
        0,
        100
      );
      const momentum = clampInt(
        scenarioScores.outcome_alignment_percent ?? scenarioScores.momentum ?? fit,
        0,
        100
      );
      const intensity = clampInt(24 + nodeIndex * 5 + (slotIndex - 1) * 3, 0, 100);

      actions.push({
        id: sanitizeText(scenarioNode?.id || `N${nodeIndex}A${slotIndex}`, 20),
        gene_slot: slotIndex,
        action: actionText,
        rationale: sanitizeText(
          scenarioNode?.next_link ||
            scenarioNode?.rationale ||
            `Node ${nodeIndex} step in scenario ${slotIndex}.`,
          220
        ),
        persona_anchor: sanitizeText(
          scenarioNode?.personalization_anchor || scenarioNode?.anchor || `Scenario ${slotIndex} persona fit`,
          140
        ),
        next_link_hint: sanitizeText(
          scenarioNode?.next_link || scenarioNode?.success_signal || 'Supports transition to the next node.',
          180
        ),
        scores: {
          fit,
          feasibility,
          ethics,
          risk,
          momentum,
          intensity
        }
      });
    }

    outputNodes.push({
      node_index: nodeIndex,
      node_title: sanitizeText(
        getScenarioNodeByIndex(scenarios?.[0]?.nodes, nodeIndex)?.node_title || `Node ${nodeIndex}`,
        90
      ),
      actions
    });
  }

  return outputNodes;
}

function compactProfile(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const qualitative = source.qualitative_data && typeof source.qualitative_data === 'object'
    ? source.qualitative_data
    : {};
  const quantitative = source.quantitative_data && typeof source.quantitative_data === 'object'
    ? source.quantitative_data
    : {};
  const critical = qualitative.critical_factors && typeof qualitative.critical_factors === 'object'
    ? qualitative.critical_factors
    : source.critical_factors && typeof source.critical_factors === 'object'
      ? source.critical_factors
      : {};
  return {
    personal_headline: sanitizeText(qualitative.personal_headline || '', 220),
    goals: sanitizeText(qualitative.goals || '', 220),
    communication_style: sanitizeText(qualitative.communication_style || '', 220),
    constraints: sanitizeText(qualitative.constraints || '', 220),
    critical_factors: Object.fromEntries(
      Object.entries(critical)
        .slice(0, 12)
        .map(([key, value]) => [sanitizeText(key, 60), sanitizeText(value, 220)])
    ),
    quantitative_axes_present: Object.keys(quantitative.axis_scores || {}).length
  };
}

function extractAxisScores(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const quantitative = source.quantitative_data && typeof source.quantitative_data === 'object'
    ? source.quantitative_data
    : {};
  const candidates = [
    quantitative.axis_scores,
    quantitative.axisScores,
    quantitative.axes,
    source.axis_scores,
    source.axisScores
  ];
  const axisSource = candidates.find((item) => item && typeof item === 'object') || {};
  const out = {};

  Object.entries(axisSource).forEach(([rawKey, rawValue]) => {
    const key = String(rawKey || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9 _/-]/g, '');
    if (!key) return;

    let numeric = Number.NaN;
    if (Number.isFinite(Number(rawValue))) {
      numeric = Number(rawValue);
    } else if (rawValue && typeof rawValue === 'object') {
      const valueCandidates = [rawValue.value, rawValue.score, rawValue.percent, rawValue.normalized];
      for (let i = 0; i < valueCandidates.length; i += 1) {
        const candidate = Number(valueCandidates[i]);
        if (Number.isFinite(candidate)) {
          numeric = candidate;
          break;
        }
      }
    }

    if (!Number.isFinite(numeric)) return;
    out[key] = clamp(numeric, 0, 100);
  });

  return out;
}

function summarizeCriticalFactors(compact) {
  const critical = compact?.critical_factors && typeof compact.critical_factors === 'object'
    ? compact.critical_factors
    : {};
  const entries = Object.entries(critical)
    .filter(([key, value]) => sanitizeText(key, 80) || sanitizeText(value, 140))
    .slice(0, 4)
    .map(([key, value]) => {
      const left = sanitizeText(key, 70);
      const right = sanitizeText(value, 140);
      if (left && right) return `${left}: ${right}`;
      return left || right;
    })
    .filter(Boolean);
  return entries.length ? entries.join(' | ') : 'None explicitly listed';
}

function summarizeInitialConditionsFromPersonas(personaA, personaB, userContext) {
  const personaALabel = sanitizeText(personaA?.label || personaA?.key || 'Persona A', 90);
  const personaBLabel = sanitizeText(personaB?.label || personaB?.key || 'Persona B', 90);
  const compactA = compactProfile(personaA?.profile);
  const compactB = compactProfile(personaB?.profile);

  const scoresA = extractAxisScores(personaA?.profile);
  const scoresB = extractAxisScores(personaB?.profile);
  const sharedAxisKeys = Object.keys(scoresA).filter((key) => Object.prototype.hasOwnProperty.call(scoresB, key));
  let avgDeviation = null;
  if (sharedAxisKeys.length) {
    const totalGap = sharedAxisKeys.reduce((sum, key) => sum + Math.abs((scoresA[key] || 0) - (scoresB[key] || 0)), 0);
    avgDeviation = totalGap / sharedAxisKeys.length;
  }
  const alignmentPercent = avgDeviation === null ? null : clamp(100 - avgDeviation, 0, 100);

  const userContextText = sanitizeText(userContext, 260);
  const parts = [
    `Initiator (${personaALabel}): goals "${compactA.goals || 'not specified'}"; communication "${compactA.communication_style || 'not specified'}"; constraints "${compactA.constraints || 'none stated'}".`,
    `Target (${personaBLabel}): goals "${compactB.goals || 'not specified'}"; communication "${compactB.communication_style || 'not specified'}"; constraints "${compactB.constraints || 'none stated'}".`,
    avgDeviation === null
      ? 'Quantitative alignment: insufficient shared numeric axes to compute trait deviation.'
      : `Quantitative alignment: ${sharedAxisKeys.length} shared axes, average deviation ${avgDeviation.toFixed(1)}/100, estimated alignment ${alignmentPercent.toFixed(1)}%.`,
    `Critical factors - Initiator: ${summarizeCriticalFactors(compactA)}.`,
    `Critical factors - Target: ${summarizeCriticalFactors(compactB)}.`,
    userContextText ? `Additional user-supplied context: ${userContextText}.` : ''
  ].filter(Boolean);

  return sanitizeText(parts.join(' '), 1200);
}

function buildPersonaModelContext(persona) {
  const raw = persona && typeof persona === 'object' ? persona : {};
  const dbRecord = raw?.db_record && typeof raw.db_record === 'object' ? raw.db_record : {};
  const dbProfile = dbRecord?.profile && typeof dbRecord.profile === 'object' ? dbRecord.profile : {};
  const sourceProfile = raw?.profile && typeof raw.profile === 'object' ? raw.profile : dbProfile;
  const compact = compactProfile(sourceProfile);
  const axes = extractAxisScores(sourceProfile);
  const trimmedAxes = Object.fromEntries(
    Object.entries(axes)
      .slice(0, 8)
      .map(([key, value]) => [sanitizeText(key, 48), Number(clamp(value, 0, 100).toFixed(1))])
      .filter(([key]) => Boolean(key))
  );
  const compactCritical = summarizeCriticalFactors(compact);

  return {
    key: sanitizePersonaKey(raw?.key),
    label: sanitizeText(raw?.label, 120),
    goals: sanitizeText(compact.goals || '', 140),
    communication_style: sanitizeText(compact.communication_style || '', 140),
    constraints: sanitizeText(compact.constraints || '', 140),
    critical_factors: sanitizeText(compactCritical, 240),
    quantitative_axes: trimmedAxes,
    quantitative_axes_count: Object.keys(trimmedAxes).length
  };
}

function buildPromptTemplateVariables({
  requestedOutcome,
  inferredInitialConditions,
  additionalContext,
  personaA,
  personaB,
  personaADigest,
  personaBDigest,
  nodeCount,
  actionsPerNode
}) {
  const safePersonaA = personaADigest && typeof personaADigest === 'object'
    ? personaADigest
    : buildPersonaModelContext(personaA);
  const safePersonaB = personaBDigest && typeof personaBDigest === 'object'
    ? personaBDigest
    : buildPersonaModelContext(personaB);
  return {
    requested_outcome: sanitizeText(requestedOutcome, 320),
    inferred_initial_conditions: sanitizeText(inferredInitialConditions, 1200),
    additional_context: sanitizeText(additionalContext, 320),
    persona_a_label: sanitizeText(personaA?.label || personaA?.key || 'Persona A', 120),
    persona_b_label: sanitizeText(personaB?.label || personaB?.key || 'Persona B', 120),
    persona_a_profile_json: safeJson(safePersonaA),
    persona_b_profile_json: safeJson(safePersonaB),
    node_count: String(clampInt(nodeCount, 1, 20)),
    actions_per_node: String(clampInt(actionsPerNode, 1, 12))
  };
}

function extractTextFromResponsesApi(data) {
  const candidates = [];
  const pushCandidate = (value) => {
    let text = '';
    if (typeof value === 'string') {
      text = value.trim();
    } else if (value && typeof value === 'object') {
      if (typeof value.text === 'string') {
        text = value.text.trim();
      } else if (typeof value.value === 'string') {
        text = value.value.trim();
      } else if (typeof value.output_text === 'string') {
        text = value.output_text.trim();
      }
    }
    if (!text) return;
    candidates.push(text);
  };

  pushCandidate(data?.output_text);

  if (data?.output_json && typeof data.output_json === 'object') {
    pushCandidate(JSON.stringify(data.output_json));
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  output.forEach((item) => {
    pushCandidate(item?.text);
    pushCandidate(item?.arguments);
    if (item?.json && typeof item.json === 'object') {
      pushCandidate(JSON.stringify(item.json));
    }
    const content = Array.isArray(item?.content) ? item.content : [];
    content.forEach((part) => {
      pushCandidate(part?.text);
      pushCandidate(part?.output_text);
      pushCandidate(part?.arguments);
      pushCandidate(part?.refusal);
      if (part?.json && typeof part.json === 'object') {
        pushCandidate(JSON.stringify(part.json));
      }
      if (part?.value && typeof part.value === 'object') {
        pushCandidate(JSON.stringify(part.value));
      }
      if (typeof part?.value === 'string') {
        pushCandidate(part.value);
      }
    });
  });

  if (!candidates.length) return '';
  const jsonCandidate = candidates.find((value) => value.startsWith('{') || value.startsWith('['));
  return (jsonCandidate || candidates.join('\n')).trim();
}

function extractResponseIncompleteReason(raw) {
  if (!raw || typeof raw !== 'object') return '';
  const directCandidates = [
    raw?.incomplete_details?.reason,
    raw?.incomplete_reason,
    raw?.status_details?.reason,
    raw?.status_details?.incomplete_reason
  ];
  for (let i = 0; i < directCandidates.length; i += 1) {
    const candidate = sanitizeText(directCandidates[i] || '', 120);
    if (candidate) return candidate;
  }

  const outputItems = Array.isArray(raw?.output) ? raw.output : [];
  for (let i = 0; i < outputItems.length; i += 1) {
    const item = outputItems[i] || {};
    const fromItem = sanitizeText(
      item?.incomplete_details?.reason ||
        item?.incomplete_reason ||
        item?.status_details?.reason ||
        '',
      120
    );
    if (fromItem) return fromItem;
  }

  return '';
}

async function requestCompletionWithPromptTemplate({
  apiKey,
  promptId,
  promptVersion,
  promptVariables,
  model,
  options = {}
}) {
  const promptPayload = {
    id: String(promptId || '').trim()
  };
  if (String(promptVersion || '').trim()) {
    promptPayload.version = String(promptVersion).trim();
  }
  if (promptVariables && typeof promptVariables === 'object' && Object.keys(promptVariables).length) {
    promptPayload.variables = promptVariables;
  }

  const requestBody = {
    prompt: promptPayload,
    max_output_tokens: clampInt(options.maxOutputTokens ?? DEFAULT_OUTCOME_MAX_OUTPUT_TOKENS, 600, MAX_OUTCOME_MAX_OUTPUT_TOKENS)
  };
  const inputText = sanitizeText(options.inputText || '', 24000);
  if (inputText) requestBody.input = inputText;
  if (model && parseBoolean(options.overridePromptModel, false)) {
    requestBody.model = model;
  }
  const reasoningEffort = sanitizeText(options.reasoningEffort || '', 16);
  const reasoningSummary = sanitizeText(options.reasoningSummary || '', 16);
  if (reasoningEffort || reasoningSummary) {
    requestBody.reasoning = {};
    if (reasoningEffort) requestBody.reasoning.effort = reasoningEffort;
    if (reasoningSummary) requestBody.reasoning.summary = reasoningSummary;
  }
  const textFormat = sanitizeText(options.textFormat || '', 32);
  if (options.forceJsonObject) {
    requestBody.text = {
      format: { type: 'json_object' }
    };
  } else if (textFormat) {
    requestBody.text = {
      format: { type: textFormat }
    };
  }
  const verbosity = sanitizeText(options.verbosity || '', 16);
  if (verbosity) {
    requestBody.text = {
      ...(requestBody.text || {}),
      verbosity
    };
  }
  if (typeof options.store === 'boolean') {
    requestBody.store = options.store;
  }
  if (Array.isArray(options.include) && options.include.length) {
    requestBody.include = options.include
      .map((item) => sanitizeText(item, 120))
      .filter(Boolean);
  }
  if (options.metadata && typeof options.metadata === 'object') {
    requestBody.metadata = options.metadata;
  }

  const timeoutMs = clampInt(options.timeoutMs ?? DEFAULT_OUTCOME_MODEL_TIMEOUT_MS, 10000, 290000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`OpenAI request timeout after ${timeoutMs}ms`)), timeoutMs);

  let openaiRes;
  let data;
  try {
    openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    data = await openaiRes.json().catch(() => ({}));
  } catch (error) {
    const isAbort = String(error?.name || '') === 'AbortError' || String(error?.message || '').includes('timeout');
    if (isAbort) {
      const timeoutError = new Error(`OpenAI responses request timed out after ${timeoutMs}ms`);
      timeoutError.status = 504;
      timeoutError.code = 'openai_timeout';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!openaiRes.ok) {
    const message = data?.error?.message || data?.error || 'OpenAI responses request failed';
    const err = new Error(message);
    err.status = openaiRes.status;
    err.openaiRequestId = sanitizeText(
      openaiRes.headers.get('x-request-id') || openaiRes.headers.get('openai-request-id') || '',
      120
    ) || '';
    const rateLimit = buildOpenAiRateLimitInfo(openaiRes.headers);
    err.rateLimit = rateLimit;
    err.retryAfterSeconds = Number(rateLimit.retry_after_seconds || 0) || 0;
    err.rateLimitResetRequestsSeconds = Number(rateLimit.reset_requests_seconds || 0) || 0;
    err.rateLimitResetTokensSeconds = Number(rateLimit.reset_tokens_seconds || 0) || 0;
    throw err;
  }
  const successRateLimit = buildOpenAiRateLimitInfo(openaiRes.headers);
  return {
    raw: data,
    text: extractTextFromResponsesApi(data),
    usage: extractUsageFromResponsesPayload(data),
    openaiRequestId: sanitizeText(
      openaiRes.headers.get('x-request-id') || openaiRes.headers.get('openai-request-id') || '',
      120
    ) || null,
    rateLimit: successRateLimit
  };
}

function normalizeScore(raw, fallback) {
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return clampInt(numeric, 0, 100);
  return clampInt(fallback, 0, 100);
}

function computeFallbackScores({
  slotMetrics,
  nodeIndex,
  actionIndex
}) {
  const logicality = clamp(Number(slotMetrics?.logicality_percent ?? 72), 0, 100);
  const practicality = clamp(Number(slotMetrics?.practicality_percent ?? 70), 0, 100);
  const ethicsLegalConsent = clamp(Number(slotMetrics?.ethics_legal_consent_percent ?? 84), 0, 100);
  const overallPass = clamp(Number(slotMetrics?.overall_pass_percent ?? 74), 0, 100);

  return {
    fit: clampInt((logicality * 0.42) + (practicality * 0.28) + (overallPass * 0.3), 0, 100),
    feasibility: clampInt((practicality * 0.78) + (logicality * 0.22), 0, 100),
    ethics: clampInt(ethicsLegalConsent, 0, 100),
    risk: clampInt(100 - ((overallPass * 0.72) + (ethicsLegalConsent * 0.28)), 5, 95),
    momentum: clampInt((logicality * 0.55) + (overallPass * 0.45), 0, 100),
    intensity: clampInt(24 + nodeIndex * 5 + actionIndex * 3, 0, 100)
  };
}

function normalizeAction(rawAction, nodeIndex, actionIndex, slotMetrics) {
  const raw = rawAction && typeof rawAction === 'object' ? rawAction : {};
  const scoreSource = raw.scores && typeof raw.scores === 'object' ? raw.scores : raw;
  const fallbackScores = computeFallbackScores({
    slotMetrics,
    nodeIndex,
    actionIndex
  });

  return {
    id: sanitizeText(raw.id || `N${nodeIndex + 1}A${actionIndex + 1}`, 20),
    gene_slot: clampInt(raw.gene_slot ?? raw.geneSlot ?? actionIndex + 1, 1, DEFAULT_ACTIONS_PER_NODE),
    action: sanitizeText(raw.action || raw.name || raw.title || `Action ${actionIndex + 1}`, 180),
    rationale: sanitizeText(
      raw.rationale || raw.why || raw.description || 'Supports the requested outcome.',
      220
    ),
    persona_anchor: sanitizeText(
      raw.persona_anchor || raw.personaAnchor || '',
      140
    ),
    next_link_hint: sanitizeText(
      raw.next_link_hint || raw.nextLinkHint || 'Transitions to the next step.',
      180
    ),
    scores: {
      fit: normalizeScore(scoreSource.fit, fallbackScores.fit),
      feasibility: normalizeScore(scoreSource.feasibility, fallbackScores.feasibility),
      ethics: normalizeScore(scoreSource.ethics, fallbackScores.ethics),
      risk: normalizeScore(scoreSource.risk, fallbackScores.risk),
      momentum: normalizeScore(scoreSource.momentum, fallbackScores.momentum),
      intensity: normalizeScore(scoreSource.intensity, fallbackScores.intensity)
    }
  };
}

function parseNodeIndexFromActionId(actionId) {
  const text = String(actionId || '').trim();
  const match = text.match(/^N(\d+)A(\d+)$/i);
  if (!match) return null;
  const nodeIndex = Number(match[1]);
  if (!Number.isFinite(nodeIndex) || nodeIndex <= 0) return null;
  return nodeIndex;
}

function resolveRawNodeAtIndex(rawNodes, nodeIndex) {
  const sourceNodes = Array.isArray(rawNodes) ? rawNodes : [];
  const fromIndex = sourceNodes[nodeIndex];
  const fromTag = sourceNodes.find((node) => Number(node?.node_index || node?.index) === nodeIndex + 1);
  return fromTag || fromIndex || null;
}

function validateGeneratedActionSpaceShape(rawNodes, nodeCount, actionsPerNode) {
  if (!Array.isArray(rawNodes) || !rawNodes.length) {
    return { ok: false, reason: 'OpenAI output had no nodes array.' };
  }
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const rawNode = resolveRawNodeAtIndex(rawNodes, nodeIndex);
    if (!rawNode || typeof rawNode !== 'object') {
      return { ok: false, reason: `Missing node at index ${nodeIndex + 1}.` };
    }
    const actions = Array.isArray(rawNode.actions) ? rawNode.actions : [];
    if (actions.length < actionsPerNode) {
      return {
        ok: false,
        reason: `Node ${nodeIndex + 1} has ${actions.length} actions; expected ${actionsPerNode}.`
      };
    }
    for (let actionIndex = 0; actionIndex < actionsPerNode; actionIndex += 1) {
      const rawAction = actions[actionIndex];
      if (!rawAction || typeof rawAction !== 'object') {
        return { ok: false, reason: `Node ${nodeIndex + 1} action ${actionIndex + 1} is missing.` };
      }
      const actionId = sanitizeText(rawAction.id || `N${nodeIndex + 1}A${actionIndex + 1}`, 20);
      if (!actionId) {
        return { ok: false, reason: `Node ${nodeIndex + 1} action ${actionIndex + 1} is missing id.` };
      }
      const actionText = sanitizeText(rawAction.action || rawAction.name || rawAction.title || '', 180);
      if (!actionText) {
        return { ok: false, reason: `Node ${nodeIndex + 1} action ${actionIndex + 1} has no action text.` };
      }
      const slot = Number(rawAction.gene_slot ?? rawAction.geneSlot ?? actionIndex + 1);
      if (!Number.isFinite(slot)) {
        return { ok: false, reason: `Node ${nodeIndex + 1} action ${actionIndex + 1} has invalid gene_slot.` };
      }
    }
  }
  return { ok: true };
}

function extractRawQualityGatesFromGeneratedPayload(parsed, actionsPerNode) {
  const direct = toArray(parsed?.chain_quality_gates);
  if (direct.length) return direct.slice(0, actionsPerNode);
  const fallback = toArray(parsed?.quality_gates);
  return fallback.slice(0, actionsPerNode);
}

function validateGeneratedQualityGatesShape(rawQualityGates, nodeCount, actionsPerNode) {
  const gates = Array.isArray(rawQualityGates) ? rawQualityGates : [];
  if (!gates.length) {
    return { ok: false, reason: 'OpenAI output had no chain_quality_gates array.' };
  }

  for (let slot = 1; slot <= actionsPerNode; slot += 1) {
    const gate = gates.find((item) => Number(item?.gene_slot) === slot) || gates[slot - 1];
    if (!gate || typeof gate !== 'object') {
      return { ok: false, reason: `Missing chain_quality_gates entry for gene_slot ${slot}.` };
    }
    const transitions = Array.isArray(gate.transitions) ? gate.transitions : [];
    if (transitions.length < Math.max(1, nodeCount - 1)) {
      return {
        ok: false,
        reason: `chain_quality_gates gene_slot ${slot} has ${transitions.length} transitions; expected at least ${Math.max(1, nodeCount - 1)}.`
      };
    }
    for (let i = 0; i < Math.max(1, nodeCount - 1); i += 1) {
      const transition = transitions[i];
      if (!transition || typeof transition !== 'object') {
        return { ok: false, reason: `chain_quality_gates gene_slot ${slot} transition ${i + 1} is missing.` };
      }
      const from = sanitizeText(transition.from || '', 24);
      const to = sanitizeText(transition.to || '', 24);
      if (!from || !to) {
        return { ok: false, reason: `chain_quality_gates gene_slot ${slot} transition ${i + 1} missing "from" or "to".` };
      }
      const requiredFlags = [
        'logicality_pass',
        'practicality_pass',
        'ethics_pass',
        'legality_pass',
        'consent_pass',
        'overall_pass'
      ];
      for (let j = 0; j < requiredFlags.length; j += 1) {
        const key = requiredFlags[j];
        if (typeof transition[key] !== 'boolean') {
          return { ok: false, reason: `chain_quality_gates gene_slot ${slot} transition ${i + 1} missing boolean "${key}".` };
        }
      }
    }
  }
  return { ok: true };
}

function normalizeQualityGates(rawQualityGates, nodeCount, actionsPerNode) {
  const gates = Array.isArray(rawQualityGates) ? rawQualityGates : [];
  const normalized = [];

  for (let slot = 1; slot <= actionsPerNode; slot += 1) {
    const gate = gates.find((item) => Number(item?.gene_slot) === slot) || gates[slot - 1] || {};
    const transitions = Array.isArray(gate.transitions) ? gate.transitions : [];
    const rows = [];
    for (let i = 0; i < Math.max(1, nodeCount - 1); i += 1) {
      const transition = transitions[i] || {};
      rows.push({
        from: sanitizeText(transition.from || `N${i + 1}A${slot}`, 24),
        to: sanitizeText(transition.to || `N${i + 2}A${slot}`, 24),
        logicality_pass: parseBoolean(transition.logicality_pass, false),
        practicality_pass: parseBoolean(transition.practicality_pass, false),
        ethics_pass: parseBoolean(transition.ethics_pass, false),
        legality_pass: parseBoolean(transition.legality_pass, false),
        consent_pass: parseBoolean(transition.consent_pass, false),
        overall_pass: parseBoolean(transition.overall_pass, false),
        note: sanitizeText(transition.note || '', 260)
      });
    }
    normalized.push({
      gene_slot: slot,
      transitions: rows
    });
  }

  return normalized;
}

function buildQualityGateSlotMetrics(rawQualityGates) {
  const map = new Map();
  const gates = Array.isArray(rawQualityGates) ? rawQualityGates : [];
  gates.forEach((gate, index) => {
    const slot = clampInt(gate?.gene_slot ?? index + 1, 1, DEFAULT_ACTIONS_PER_NODE);
    const transitions = Array.isArray(gate?.transitions) ? gate.transitions : [];
    if (!transitions.length) return;
    const asPct = (value) => (parseBoolean(value, false) ? 100 : 0);
    const logicality = average(transitions.map((t) => asPct(t?.logicality_pass)));
    const practicality = average(transitions.map((t) => asPct(t?.practicality_pass)));
    const ethics = average(transitions.map((t) => asPct(t?.ethics_pass)));
    const legality = average(transitions.map((t) => asPct(t?.legality_pass)));
    const consent = average(transitions.map((t) => asPct(t?.consent_pass)));
    const overall = average(transitions.map((t) => asPct(t?.overall_pass)));
    map.set(slot, {
      logicality_percent: logicality,
      practicality_percent: practicality,
      ethics_legal_consent_percent: average([ethics, legality, consent]),
      overall_pass_percent: overall
    });
  });
  return map;
}

function normalizeActionSpace(rawNodes, nodeCount, actionsPerNode, qualityGateSlotMetrics) {
  const sourceNodes = Array.isArray(rawNodes) ? rawNodes : [];
  const normalized = [];

  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const rawNode = resolveRawNodeAtIndex(sourceNodes, nodeIndex) || {};
    const rawActions = Array.isArray(rawNode?.actions) ? rawNode.actions : [];
    const actions = [];

    for (let actionIndex = 0; actionIndex < actionsPerNode; actionIndex += 1) {
      const rawAction = rawActions[actionIndex];
      const rawSlot = Number(rawAction?.gene_slot ?? rawAction?.geneSlot ?? actionIndex + 1);
      const slot = Number.isFinite(rawSlot) ? clampInt(rawSlot, 1, actionsPerNode) : actionIndex + 1;
      const slotMetrics = qualityGateSlotMetrics instanceof Map
        ? (qualityGateSlotMetrics.get(slot) || null)
        : null;
      actions.push(normalizeAction(rawAction, nodeIndex, actionIndex, slotMetrics));
    }

    normalized.push({
      node_index: nodeIndex + 1,
      node_title: sanitizeText(rawNode?.node_title || rawNode?.title || `Node ${nodeIndex + 1}`, 90),
      actions
    });
  }

  return normalized;
}

function tokenizeForContinuity(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function tokenOverlapScore(leftText, rightText) {
  const leftTokens = new Set(tokenizeForContinuity(leftText));
  const rightTokens = new Set(tokenizeForContinuity(rightText));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });
  const union = new Set([...leftTokens, ...rightTokens]).size;
  if (!union) return 0;
  return intersection / union;
}

const GENERIC_ACTION_PATTERNS = Object.freeze([
  /\bbe\s+(?:respectful|careful|thoughtful|open|nice)\b/i,
  /\bensure\b/i,
  /\bmaintain\b/i,
  /\btry\s+to\b/i,
  /\bfocus\s+on\b/i,
  /\brespect\s+(?:their|the)\b/i,
  /\bkeep\s+it\b/i
]);

const CONCRETE_ACTION_VERBS = Object.freeze([
  'invite',
  'text',
  'call',
  'ask',
  'book',
  'schedule',
  'propose',
  'confirm',
  'meet',
  'share',
  'send',
  'pick',
  'choose',
  'offer',
  'bring',
  'plan',
  'pay',
  'drive',
  'walk'
]);

const CONTEXT_ANCHOR_TERMS = Object.freeze([
  'today',
  'tonight',
  'tomorrow',
  'weekend',
  'after class',
  'before class',
  'on campus',
  'coffee',
  'tea',
  'dinner',
  'library',
  'message',
  'text',
  'call',
  '30-minute',
  '20-minute'
]);

function includesPattern(text, patterns) {
  const value = String(text || '');
  return patterns.some((pattern) => pattern.test(value));
}

function includesVerbToken(text, verbs) {
  const normalized = ` ${String(text || '').toLowerCase()} `;
  return verbs.some((verb) => normalized.includes(` ${verb} `));
}

function computeSpecificityPercent(actionText) {
  const text = String(actionText || '').trim();
  if (!text) return 0;
  const words = text.split(/\s+/g).filter(Boolean);
  const lengthScore = clamp((words.length / 14) * 28, 6, 28);
  const hasVerb = includesVerbToken(text, CONCRETE_ACTION_VERBS) ? 24 : 0;
  const hasAnchor = includesVerbToken(text, CONTEXT_ANCHOR_TERMS) ? 20 : 0;
  const hasNumber = /\b\d{1,3}\b/.test(text) ? 14 : 0;
  const punctuationCue = /[:,]/.test(text) ? 6 : 0;
  const genericPenalty = includesPattern(text, GENERIC_ACTION_PATTERNS) ? 24 : 0;
  return clamp(lengthScore + hasVerb + hasAnchor + hasNumber + punctuationCue - genericPenalty, 0, 100);
}

function scoreTransitionCheck(current, next) {
  const currentText = `${current?.action || ''} ${current?.rationale || ''} ${current?.next_link_hint || ''}`;
  const nextText = `${next?.node_title || ''} ${next?.action || ''} ${next?.rationale || ''}`;

  const overlap = tokenOverlapScore(currentText, nextText);
  const linkHintBonus = String(current?.next_link_hint || '').trim() ? 0.22 : 0;
  const rawLogicality = clamp01((overlap * 0.78) + linkHintBonus);
  const logicalityPercent = toPercent(rawLogicality);

  const currFeasibility = clamp(current?.scores?.feasibility, 0, 100);
  const nextFeasibility = clamp(next?.scores?.feasibility, 0, 100);
  const currIntensity = clamp(current?.scores?.intensity, 0, 100);
  const nextIntensity = clamp(next?.scores?.intensity, 0, 100);
  const intensityJump = Math.abs(nextIntensity - currIntensity);
  const intensityPenalty = Math.max(0, (intensityJump - 28) * 0.8);
  const specificityPenalty =
    Math.max(0, 55 - clamp(current?.specificity_percent, 0, 100)) * 0.16 +
    Math.max(0, 55 - clamp(next?.specificity_percent, 0, 100)) * 0.16;
  const practicalityPercent = clamp(((currFeasibility + nextFeasibility) / 2) - intensityPenalty - specificityPenalty, 0, 100);

  const currEthics = clamp(current?.scores?.ethics, 0, 100);
  const nextEthics = clamp(next?.scores?.ethics, 0, 100);
  const currRisk = clamp(current?.scores?.risk, 0, 100);
  const nextRisk = clamp(next?.scores?.risk, 0, 100);
  const ethicsLegalPercent = clamp((((currEthics + nextEthics) / 2) * 0.72) + (((200 - currRisk - nextRisk) / 2) * 0.28), 0, 100);

  const isPass =
    logicalityPercent >= 44 &&
    practicalityPercent >= 48 &&
    ethicsLegalPercent >= 62;

  let note = 'Transition is coherent and executable.';
  if (!isPass) {
    const reasons = [];
    if (logicalityPercent < 44) reasons.push('logic gap between steps');
    if (practicalityPercent < 48) reasons.push('practical execution gap');
    if (ethicsLegalPercent < 62) reasons.push('ethics/legal risk too high');
    note = `Needs revision: ${reasons.join(', ')}.`;
  }

  return {
    from_node_index: current?.node_index || null,
    to_node_index: next?.node_index || null,
    logicality_percent: Number(logicalityPercent.toFixed(2)),
    practicality_percent: Number(practicalityPercent.toFixed(2)),
    ethics_legal_percent: Number(ethicsLegalPercent.toFixed(2)),
    pass: isPass,
    note
  };
}

function selectActionForGeneSlot(node, slotIndex) {
  const actions = Array.isArray(node?.actions) ? node.actions : [];
  const bySlot = actions.find((action) => Number(action?.gene_slot) === slotIndex);
  if (bySlot) return bySlot;
  return actions[slotIndex - 1] || actions[0] || null;
}

function average(values) {
  if (!Array.isArray(values) || !values.length) return 0;
  const total = values.reduce((sum, value) => sum + Number(value || 0), 0);
  return total / values.length;
}

function toPercent(value) {
  return clamp(Number((clamp01(value) * 100).toFixed(2)), 0, 100);
}

function convertGateTransitionToCheck(transition) {
  const logicalityPass = parseBoolean(transition?.logicality_pass, false);
  const practicalityPass = parseBoolean(transition?.practicality_pass, false);
  const ethicsPass = parseBoolean(transition?.ethics_pass, false);
  const legalityPass = parseBoolean(transition?.legality_pass, false);
  const consentPass = parseBoolean(transition?.consent_pass, false);
  const overallPass = parseBoolean(
    transition?.overall_pass,
    logicalityPass && practicalityPass && ethicsPass && legalityPass && consentPass
  );
  const ethicsLegalPercent = Number(
    average([
      ethicsPass ? 100 : 0,
      legalityPass ? 100 : 0,
      consentPass ? 100 : 0
    ]).toFixed(2)
  );
  return {
    from_node_index: parseNodeIndexFromActionId(transition?.from),
    to_node_index: parseNodeIndexFromActionId(transition?.to),
    logicality_percent: logicalityPass ? 100 : 0,
    practicality_percent: practicalityPass ? 100 : 0,
    ethics_legal_percent: ethicsLegalPercent,
    pass: overallPass,
    note: sanitizeText(transition?.note || '', 240)
  };
}

function buildChainCandidates(actionSpace, requestedOutcome, initialConditions, actionsPerNode, qualityGates) {
  const chains = [];
  const nodeCount = actionSpace.length || 0;
  const qualityGateBySlot = new Map();
  if (Array.isArray(qualityGates)) {
    qualityGates.forEach((gate, index) => {
      const slot = clampInt(gate?.gene_slot ?? index + 1, 1, actionsPerNode);
      qualityGateBySlot.set(slot, gate);
    });
  }

  for (let slot = 1; slot <= actionsPerNode; slot += 1) {
    const steps = [];
    const realismParts = [];
    const ethicsLegalParts = [];
    const outcomeAlignParts = [];
    const specificityParts = [];

    for (let nodeIndex = 0; nodeIndex < actionSpace.length; nodeIndex += 1) {
      const node = actionSpace[nodeIndex];
      const action = selectActionForGeneSlot(node, slot);
      if (!action) continue;

      const fit = clamp(action?.scores?.fit, 0, 100) / 100;
      const feasibility = clamp(action?.scores?.feasibility, 0, 100) / 100;
      const ethics = clamp(action?.scores?.ethics, 0, 100) / 100;
      const risk = clamp(action?.scores?.risk, 0, 100) / 100;
      const momentum = clamp(action?.scores?.momentum, 0, 100) / 100;

      realismParts.push((fit * 0.4) + (feasibility * 0.6));
      ethicsLegalParts.push((ethics * 0.7) + ((1 - risk) * 0.3));
      outcomeAlignParts.push((fit * 0.55) + (momentum * 0.45));
      const specificityPercent = computeSpecificityPercent(action.action);
      specificityParts.push(specificityPercent / 100);

      steps.push({
        node_index: node.node_index,
        node_title: node.node_title,
        action_id: action.id,
        gene_slot: slot,
        action: action.action,
        rationale: action.rationale,
        persona_anchor: action.persona_anchor,
        next_link_hint: action.next_link_hint,
        specificity_percent: Number(specificityPercent.toFixed(2)),
        scores: action.scores
      });
    }

    let transitionChecks = [];
    const slotGate = qualityGateBySlot.get(slot);
    if (slotGate && Array.isArray(slotGate.transitions) && slotGate.transitions.length) {
      transitionChecks = slotGate.transitions
        .slice(0, Math.max(0, steps.length - 1))
        .map((transition) => convertGateTransitionToCheck(transition));
    }
    if (!transitionChecks.length) {
      transitionChecks = [];
      for (let i = 0; i < steps.length - 1; i += 1) {
        const current = steps[i];
        const next = steps[i + 1];
        transitionChecks.push(scoreTransitionCheck(current, next));
      }
    }

    const realism = average(realismParts);
    const ethicsLegal = average(ethicsLegalParts);
    const outcomeAlignment = average(outcomeAlignParts);
    const specificity = average(specificityParts);
    const continuity = transitionChecks.length
      ? average(transitionChecks.map((item) => clamp(item.logicality_percent / 100, 0, 1)))
      : 0.5;
    const practicality = transitionChecks.length
      ? average(transitionChecks.map((item) => clamp(item.practicality_percent / 100, 0, 1)))
      : 0.5;
    const transitionsPassCount = transitionChecks.filter((item) => item.pass).length;
    const transitionsTotal = transitionChecks.length;
    const transitionPassRatio = transitionsTotal ? transitionsPassCount / transitionsTotal : 1;

    const chainIntegrity =
      (realism * 0.27) +
      (ethicsLegal * 0.24) +
      (outcomeAlignment * 0.2) +
      (continuity * 0.13) +
      (practicality * 0.1) +
      (specificity * 0.06);
    const chainIsValid =
      transitionPassRatio >= 0.78 &&
      toPercent(ethicsLegal) >= 62 &&
      toPercent(specificity) >= 50;

    chains.push({
      chain_id: `G${slot}`,
      gene_slot: slot,
      chain_length: steps.length,
      chain_valid: chainIsValid,
      initial_conditions: sanitizeText(initialConditions, 220),
      requested_outcome: sanitizeText(requestedOutcome, 160),
      chain_metrics: {
        logicality_percent: toPercent(continuity),
        practicality_percent: toPercent(practicality),
        realism_percent: toPercent(realism),
        ethics_legal_percent: toPercent(ethicsLegal),
        specificity_percent: toPercent(specificity),
        outcome_alignment_percent: toPercent(outcomeAlignment),
        chain_integrity_percent: toPercent(chainIntegrity),
        transition_pass_percent: toPercent(transitionPassRatio),
        transitions_passed: transitionsPassCount,
        transitions_total: transitionsTotal
      },
      summary: `Gene slot ${slot} produces a ${steps.length}-step chain with ${transitionsPassCount}/${transitionsTotal} transition checks passing.`,
      transition_checks: transitionChecks,
      actions: steps
    });
  }

  return chains
    .filter((chain) => chain.chain_length === nodeCount)
    .sort(
      (left, right) =>
        Number(right?.chain_valid === true) - Number(left?.chain_valid === true) ||
        Number(right?.chain_metrics?.chain_integrity_percent || 0) -
        Number(left?.chain_metrics?.chain_integrity_percent || 0)
    );
}

function buildChainActionMatrix(actionSpace, actionsPerNode) {
  const nodes = Array.isArray(actionSpace) ? actionSpace : [];
  const columns = nodes.map((node, index) => {
    const nodeIndex = Number(node?.node_index || index + 1) || index + 1;
    return {
      node_index: nodeIndex,
      node_title: sanitizeText(node?.node_title || `Node ${nodeIndex}`, 90),
      column_key: `N${nodeIndex}`
    };
  });

  const rows = [];
  for (let slot = 1; slot <= actionsPerNode; slot += 1) {
    const actionIds = [];
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const action = selectActionForGeneSlot(nodes[nodeIndex], slot);
      const fallbackId = `N${nodeIndex + 1}A${slot}`;
      const actionId = sanitizeText(action?.id || fallbackId, 20) || fallbackId;
      actionIds.push(actionId);
    }
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
    columns,
    rows,
    chain_array_storage: rows.map((row) => [...row.action_ids])
  };
}

function computeNodePassPercent(action) {
  const scores = action?.scores && typeof action.scores === 'object' ? action.scores : {};
  const fit = clamp(scores.fit, 0, 100);
  const feasibility = clamp(scores.feasibility, 0, 100);
  const ethics = clamp(scores.ethics, 0, 100);
  const risk = clamp(scores.risk, 0, 100);
  const momentum = clamp(scores.momentum, 0, 100);
  const blended = fit * 0.36 + feasibility * 0.24 + ethics * 0.2 + momentum * 0.2 - risk * 0.26;
  return clamp(blended, 8, 97);
}

function randomInt(maxExclusive) {
  return Math.floor(Math.random() * maxExclusive);
}

function makeRandomChromosome(nodeCount, actionsPerNode) {
  const genes = [];
  for (let i = 0; i < nodeCount; i += 1) genes.push(randomInt(actionsPerNode));
  return genes;
}

function chromosomeKey(genes) {
  return genes.join('-');
}

function evaluateChromosome(genes, actionSpace) {
  let expectedSuccess = 1;
  let avgRisk = 0;
  let avgEthics = 0;
  let avgPass = 0;
  let intensityPenalty = 0;
  let previousIntensity = null;

  for (let nodeIndex = 0; nodeIndex < actionSpace.length; nodeIndex += 1) {
    const node = actionSpace[nodeIndex];
    const action = node.actions[genes[nodeIndex]] || node.actions[0];
    const passPercent = computeNodePassPercent(action);
    const pass = clamp01(passPercent / 100);
    expectedSuccess *= pass;
    avgPass += pass;

    const risk = clamp(action?.scores?.risk, 0, 100);
    const ethics = clamp(action?.scores?.ethics, 0, 100);
    const intensity = clamp(action?.scores?.intensity, 0, 100);
    avgRisk += risk;
    avgEthics += ethics;

    if (previousIntensity !== null) {
      const jump = Math.abs(intensity - previousIntensity);
      if (jump > 35) intensityPenalty += (jump - 35) * 0.0045;
    }
    previousIntensity = intensity;
  }

  const nodeCount = actionSpace.length || 1;
  avgPass /= nodeCount;
  avgRisk /= nodeCount;
  avgEthics /= nodeCount;

  const quality =
    avgPass * 0.45 +
    clamp01(avgEthics / 100) * 0.3 +
    (1 - clamp01(avgRisk / 100)) * 0.25;

  const riskPenalty = Math.max(0, (avgRisk - 62) * 0.0032);
  const ethicsPenalty = Math.max(0, (58 - avgEthics) * 0.01);
  const fitness = Math.max(0, expectedSuccess * 0.76 + quality * 0.24 - intensityPenalty - riskPenalty - ethicsPenalty);

  return {
    genes: [...genes],
    expected_success: expectedSuccess,
    quality,
    avg_risk: avgRisk,
    avg_ethics: avgEthics,
    fitness
  };
}

function tournamentSelect(scoredPopulation, tournamentSize = 4) {
  let best = null;
  for (let i = 0; i < tournamentSize; i += 1) {
    const candidate = scoredPopulation[randomInt(scoredPopulation.length)];
    if (!best || candidate.fitness > best.fitness) best = candidate;
  }
  return best;
}

function crossover(parentA, parentB, crossoverRate = 0.82) {
  const size = parentA.length;
  if (Math.random() > crossoverRate || size < 2) return [...parentA];
  const point = 1 + randomInt(size - 1);
  return [...parentA.slice(0, point), ...parentB.slice(point)];
}

function mutate(genes, actionsPerNode, mutationRate) {
  const mutated = [...genes];
  for (let i = 0; i < mutated.length; i += 1) {
    if (Math.random() <= mutationRate) {
      mutated[i] = randomInt(actionsPerNode);
    }
  }
  return mutated;
}

function evolvePathways({
  actionSpace,
  populationSize,
  generations,
  mutationRate,
  eliteCount
}) {
  const nodeCount = actionSpace.length;
  const actionsPerNode = actionSpace[0]?.actions?.length || DEFAULT_ACTIONS_PER_NODE;
  let population = Array.from({ length: populationSize }, () => makeRandomChromosome(nodeCount, actionsPerNode));

  for (let generation = 0; generation < generations; generation += 1) {
    const scored = population
      .map((genes) => evaluateChromosome(genes, actionSpace))
      .sort((left, right) => right.fitness - left.fitness);

    const next = scored.slice(0, eliteCount).map((item) => [...item.genes]);
    while (next.length < populationSize) {
      const selectedA = tournamentSelect(scored, 4);
      const selectedB = tournamentSelect(scored, 4);
      const crossed = crossover(selectedA.genes, selectedB.genes, 0.82);
      const child = mutate(crossed, actionsPerNode, mutationRate);
      next.push(child);
    }
    population = next;
  }

  const evaluated = population
    .map((genes) => evaluateChromosome(genes, actionSpace))
    .sort((left, right) => right.fitness - left.fitness);

  const deduped = [];
  const seen = new Set();
  evaluated.forEach((item) => {
    const key = chromosomeKey(item.genes);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });
  return deduped;
}

function runMonteCarlo(nodePassPercents, reps) {
  const failByNode = Array.from({ length: nodePassPercents.length }, () => 0);
  let success = 0;

  for (let rep = 0; rep < reps; rep += 1) {
    let failed = false;
    for (let nodeIndex = 0; nodeIndex < nodePassPercents.length; nodeIndex += 1) {
      const beta = Math.random() * 100;
      if (beta <= nodePassPercents[nodeIndex]) continue;
      failByNode[nodeIndex] += 1;
      failed = true;
      break;
    }
    if (!failed) success += 1;
  }

  const hotspots = failByNode
    .map((count, index) => ({ node_index: index + 1, fail_count: count }))
    .sort((left, right) => right.fail_count - left.fail_count)
    .slice(0, 3);

  return {
    success_reps: success,
    total_reps: reps,
    success_probability_percent: clamp(Number(((success / reps) * 100).toFixed(2)), 0, 100),
    failure_hotspots: hotspots
  };
}

function buildPathwayView(item, rank, actionSpace, simulationReps) {
  const actions = [];
  const nodePassPercents = [];
  let totalRisk = 0;
  let totalEthics = 0;

  for (let nodeIndex = 0; nodeIndex < actionSpace.length; nodeIndex += 1) {
    const node = actionSpace[nodeIndex];
    const action = node.actions[item.genes[nodeIndex]] || node.actions[0];
    const nodePassPercent = Number(computeNodePassPercent(action).toFixed(2));
    nodePassPercents.push(nodePassPercent);
    totalRisk += clamp(action?.scores?.risk, 0, 100);
    totalEthics += clamp(action?.scores?.ethics, 0, 100);

    actions.push({
      node_index: nodeIndex + 1,
      node_title: node.node_title,
      action_id: action.id,
      action: action.action,
      rationale: action.rationale,
      scores: action.scores,
      node_pass_percent: nodePassPercent
    });
  }

  const simulation = runMonteCarlo(nodePassPercents, simulationReps);
  const averageRisk = Number((totalRisk / actionSpace.length).toFixed(2));
  const averageEthics = Number((totalEthics / actionSpace.length).toFixed(2));

  return {
    rank,
    pathway_id: `P${rank}`,
    gene_key: chromosomeKey(item.genes),
    expected_success_percent: Number((item.expected_success * 100).toFixed(2)),
    empirical_success_percent: simulation.success_probability_percent,
    success_reps: simulation.success_reps,
    total_reps: simulation.total_reps,
    average_risk_percent: averageRisk,
    average_ethics_percent: averageEthics,
    failure_hotspots: simulation.failure_hotspots,
    actions
  };
}

function buildSummary(topPathway, requestedOutcome) {
  if (!topPathway) return 'No viable pathway generated.';
  const success = Number(topPathway.empirical_success_percent || 0).toFixed(2);
  const risk = Number(topPathway.average_risk_percent || 0).toFixed(1);
  const ethics = Number(topPathway.average_ethics_percent || 0).toFixed(1);
  return `Best pathway for "${sanitizeText(requestedOutcome, 120)}" simulated at ${success}% success with avg risk ${risk}% and ethics ${ethics}%.`;
}

function sanitizeConfig(rawConfig) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  return {
    node_count: clampInt(config.node_count ?? DEFAULT_NODE_COUNT, 1, 20),
    actions_per_node: clampInt(config.actions_per_node ?? DEFAULT_ACTIONS_PER_NODE, 1, 12),
    population_size: clampInt(config.population_size ?? DEFAULT_POPULATION_SIZE, 40, 260),
    generations: clampInt(config.generations ?? DEFAULT_GENERATIONS, 20, 220),
    mutation_rate: clamp(config.mutation_rate ?? DEFAULT_MUTATION_RATE, 0.03, 0.45),
    elite_count: clampInt(config.elite_count ?? DEFAULT_ELITE_COUNT, 2, 16),
    top_pathways: clampInt(config.top_pathways ?? DEFAULT_TOP_PATHWAYS, 1, 10),
    simulation_reps: clampInt(config.simulation_reps ?? DEFAULT_MONTE_CARLO_REPS, 200, 4000)
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const supabaseUrl = resolveEnv(['SUPABASE_URL']);
  const supabaseAnonKey = resolveEnv(['SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY_LOCAL']);
  const supabaseServiceRoleKey = resolveEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY_LOCAL']);
  const authHeader = String(req.headers.authorization || '');
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  let authenticatedUserId = '';

  if (supabaseUrl && supabaseAnonKey) {
    if (!accessToken) {
      return res.status(401).json({ error: 'Missing authenticated session token' });
    }

    const userResult = await fetchSupabaseUser(supabaseUrl, supabaseAnonKey, accessToken);
    if (!userResult.ok || !userResult.body?.id) {
      return res.status(401).json({ error: 'Invalid or expired session token' });
    }
    authenticatedUserId = sanitizeText(userResult.body.id, 64);
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const promptConfig = body?.prompt && typeof body.prompt === 'object' ? body.prompt : {};
  const modelSettings = mergePlainObjects(
    promptConfig.model_settings,
    promptConfig.modelSettings,
    body.model_settings,
    body.modelSettings
  );
  const modelReasoningSettings =
    modelSettings?.reasoning && typeof modelSettings.reasoning === 'object' && !Array.isArray(modelSettings.reasoning)
      ? modelSettings.reasoning
      : {};
  const modelTextSettings =
    modelSettings?.text && typeof modelSettings.text === 'object' && !Array.isArray(modelSettings.text)
      ? modelSettings.text
      : {};
  const userInitialContext = sanitizeText(body.initial_conditions || body.initialConditions || '', 1200);
  const requestedOutcome = sanitizeText(body.requested_outcome || body.requestedOutcome || '', 380);
  const personaA = body.personaA && typeof body.personaA === 'object' ? body.personaA : {};
  const personaB = body.personaB && typeof body.personaB === 'object' ? body.personaB : {};
  const promptVariablesRow =
    supabaseUrl && supabaseServiceRoleKey && authenticatedUserId
      ? await fetchOutcomePromptVariables({
        supabaseUrl,
        serviceRoleKey: supabaseServiceRoleKey,
        userId: authenticatedUserId
      }).catch((error) => {
        console.warn('Could not load outcome_prompt_variables:', error?.message || error);
        return null;
      })
      : null;
  const configInput = body?.config && typeof body.config === 'object' ? body.config : {};
  const config = sanitizeConfig({
    ...configInput,
    node_count: pickFirstPresent(configInput.node_count, promptVariablesRow?.node_count, DEFAULT_NODE_COUNT),
    actions_per_node: pickFirstPresent(configInput.actions_per_node, promptVariablesRow?.actions_per_node, DEFAULT_ACTIONS_PER_NODE)
  });
  const actionSpaceOnly = Boolean(body.action_space_only || body.actionSpaceOnly);
  const contextBudgetTokens = clampInt(
    pickFirstPresent(
      body.context_budget_tokens,
      body.contextBudgetTokens,
      modelSettings.context_budget_tokens,
      modelSettings.contextBudgetTokens,
      promptVariablesRow?.context_budget_tokens,
      DEFAULT_OUTCOME_CONTEXT_BUDGET_TOKENS
    ),
    500,
    12000
  );
  const requireFreshDigest = parseBoolean(
    pickFirstPresent(
      body.require_fresh_digest,
      body.requireFreshDigest,
      modelSettings.require_fresh_digest,
      modelSettings.requireFreshDigest
    ),
    false
  );
  const maxDigestAgeSeconds = clampInt(
    pickFirstPresent(
      body.max_digest_age_seconds,
      body.maxDigestAgeSeconds,
      modelSettings.max_digest_age_seconds,
      modelSettings.maxDigestAgeSeconds,
      promptVariablesRow?.max_digest_age_seconds,
      DEFAULT_OUTCOME_MAX_DIGEST_AGE_SECONDS
    ),
    60,
    1209600
  );
  const inferredInitialConditions = summarizeInitialConditionsFromPersonas(personaA, personaB, userInitialContext);
  const effectiveInitialConditions = sanitizeText(inferredInitialConditions, 1200);
  const fail = (status, stage, message, extra = {}) =>
    res.status(status).json({
      error: `Outcome AG failed at ${stage}: ${message}`,
      stage,
      ...extra
    });

  if (!requestedOutcome) {
    return res.status(400).json({ error: 'requested_outcome is required' });
  }

  let nodes = [];
  let chainQualityGates = [];
  let generatorSource = '';
  let modelUsed = '';
  let promptTemplateIdUsed = null;
  let promptTemplateVersionUsed = null;
  let promptTemplateResponseId = null;

  const apiKey = resolveEnv(['OPENAI_API_KEY', 'OPENAI_API_KEY_LOCAL', 'OPENAI_KEY']);
  const modelOverride = sanitizeText(
    pickFirstPresent(
      body.model_override,
      body.modelOverride,
      modelSettings.model_override,
      modelSettings.modelOverride,
      typeof modelSettings.model === 'string' ? modelSettings.model : undefined,
      resolveEnv(['OPENAI_OUTCOME_MODEL_OVERRIDE', 'OPENAI_OUTCOME_FORCE_MODEL'])
    ) || '',
    80
  );
  const overridePromptModel = parseBoolean(
    pickFirstPresent(
      body.override_prompt_model,
      body.overridePromptModel,
      modelSettings.override_prompt_model,
      modelSettings.overridePromptModel
    ),
    Boolean(modelOverride)
  );
  const reasoningEffortOverride = sanitizeText(
    pickFirstPresent(
      body.reasoning_effort,
      body.reasoningEffort,
      modelSettings.reasoning_effort,
      modelSettings.reasoningEffort,
      modelReasoningSettings.effort
    ) || '',
    16
  );
  const reasoningSummaryOverride = sanitizeText(
    pickFirstPresent(
      body.reasoning_summary,
      body.reasoningSummary,
      modelSettings.reasoning_summary,
      modelSettings.reasoningSummary,
      modelReasoningSettings.summary
    ) || '',
    16
  );
  const responseVerbosityOverride = sanitizeText(
    pickFirstPresent(
      body.verbosity,
      modelSettings.verbosity,
      modelTextSettings.verbosity
    ) || '',
    16
  );
  const modelTimeoutMs = clampInt(
    pickFirstPresent(
      body.model_timeout_ms,
      body.modelTimeoutMs,
      modelSettings.model_timeout_ms,
      modelSettings.modelTimeoutMs,
      resolveEnv(['OPENAI_OUTCOME_MODEL_TIMEOUT_MS']),
      DEFAULT_OUTCOME_MODEL_TIMEOUT_MS
    ),
    10000,
    290000
  );
  const configuredMaxOutputTokens = clampInt(
    pickFirstPresent(
      body.max_output_tokens,
      body.maxOutputTokens,
      modelSettings.max_output_tokens,
      modelSettings.maxOutputTokens,
      resolveEnv(['OPENAI_OUTCOME_MAX_OUTPUT_TOKENS']),
      DEFAULT_OUTCOME_MAX_OUTPUT_TOKENS
    ),
    600,
    MAX_OUTCOME_MAX_OUTPUT_TOKENS
  );
  const adaptiveOutputTokenCap = estimateAdaptiveOutputTokenCap(config.node_count, config.actions_per_node);
  const minAdaptiveOutputTokenCap = clampInt(
    pickFirstPresent(
      body.min_adaptive_output_tokens,
      body.minAdaptiveOutputTokens,
      modelSettings.min_adaptive_output_tokens,
      modelSettings.minAdaptiveOutputTokens,
      resolveEnv(['OPENAI_OUTCOME_MIN_ADAPTIVE_OUTPUT_CAP']),
      DEFAULT_OUTCOME_MIN_ADAPTIVE_OUTPUT_CAP
    ),
    600,
    MAX_OUTCOME_MAX_OUTPUT_TOKENS
  );
  const effectiveAdaptiveOutputTokenCap = Math.max(adaptiveOutputTokenCap, minAdaptiveOutputTokenCap);
  const maxOutputTokens = clampInt(
    configuredMaxOutputTokens,
    600,
    MAX_OUTCOME_MAX_OUTPUT_TOKENS
  );
  const reservationOutputTokenEstimate = clampInt(
    Math.min(maxOutputTokens, effectiveAdaptiveOutputTokenCap),
    600,
    MAX_OUTCOME_MAX_OUTPUT_TOKENS
  );
  const promptTemplateId = sanitizeText(
    pickFirstPresent(
      promptConfig.id,
      body.outcome_prompt_id,
      body.prompt_id,
      modelSettings.prompt_id,
      modelSettings.promptId,
      resolveEnv(['OPENAI_OUTCOME_PROMPT_ID']),
      DEFAULT_OUTCOME_PROMPT_ID
    ),
    128
  );
  // Intentionally keep prompt version unspecified so OpenAI always uses the prompt's latest default version.
  const promptTemplateVersion = '';
  const requirePromptTemplate = parseBoolean(
    body.require_prompt_template ??
      body.requirePromptTemplate ??
      resolveEnv(['OPENAI_OUTCOME_REQUIRE_PROMPT_TEMPLATE']) ??
      'true',
    true
  );
  const clientRequestId = sanitizeText(body.request_id || body.requestId || '', 80);
  const internalRequestId = clientRequestId || `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outcomeTpmLimit = clampInt(
    pickFirstPresent(
      body.outcome_tpm_limit,
      body.outcomeTpmLimit,
      modelSettings.outcome_tpm_limit,
      modelSettings.outcomeTpmLimit,
      modelSettings.tpm_limit,
      modelSettings.tpmLimit,
      resolveEnv(['OPENAI_OUTCOME_TPM_LIMIT']),
      DEFAULT_OUTCOME_GLOBAL_TPM_LIMIT
    ),
    1000,
    20_000_000
  );
  const outcomeTpmWindowSeconds = clampInt(
    pickFirstPresent(
      body.outcome_tpm_window_seconds,
      body.outcomeTpmWindowSeconds,
      modelSettings.outcome_tpm_window_seconds,
      modelSettings.outcomeTpmWindowSeconds,
      resolveEnv(['OPENAI_OUTCOME_TPM_WINDOW_SECONDS']),
      DEFAULT_OUTCOME_TPM_WINDOW_SECONDS
    ),
    20,
    300
  );
  const outcomeTpmWaitTimeoutMs = clampInt(
    pickFirstPresent(
      body.outcome_tpm_wait_timeout_ms,
      body.outcomeTpmWaitTimeoutMs,
      modelSettings.outcome_tpm_wait_timeout_ms,
      modelSettings.outcomeTpmWaitTimeoutMs,
      resolveEnv(['OPENAI_OUTCOME_TPM_WAIT_TIMEOUT_MS']),
      DEFAULT_OUTCOME_TPM_WAIT_TIMEOUT_MS
    ),
    5000,
    900000
  );

  if (requirePromptTemplate && !promptTemplateId) {
    return fail(
      500,
      'configuration.prompt_template',
      'require_prompt_template is true but no prompt template ID was provided.'
    );
  }

  if (!apiKey) {
    return fail(500, 'configuration.openai_key', 'OPENAI_API_KEY is missing.');
  }

  if (supabaseUrl && !supabaseServiceRoleKey) {
    return fail(
      500,
      'configuration.supabase_service_role_key',
      'SUPABASE_SERVICE_ROLE_KEY is required for global Outcome token scheduling.'
    );
  }

  let responseUsageSummary = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let responseTokenBudgetInfo = null;
  let responseContextBuild = null;
  let responsePromptVariables = null;
  let responseDigestVersions = {};
  let responsePackedInput = '';

  try {
    let failureStage = 'build_prompt_variables';
    const personaASource = buildPersonaSourceForDigest(personaA);
    const personaBSource = buildPersonaSourceForDigest(personaB);
    const personaAId = sanitizeText(personaASource.id || '', 120);
    const personaBId = sanitizeText(personaBSource.id || '', 120);
    const digestTokenLimit = clampInt(
      pickFirstPresent(
        modelSettings.max_digest_tokens,
        modelSettings.maxDigestTokens,
        promptVariablesRow?.compaction_policy?.max_digest_tokens,
        DEFAULT_DIGEST_TOKEN_LIMIT
      ),
      300,
      6000
    );

    const resolvePersonaDigest = async ({
      personaSource,
      personaId,
      personaLabel
    }) => {
      let effectivePersonaSource = personaSource;
      const hasEmbeddedProfile =
        personaSource?.profile &&
        typeof personaSource.profile === 'object' &&
        Object.keys(personaSource.profile).length > 0;
      if (!hasEmbeddedProfile && supabaseUrl && supabaseServiceRoleKey && authenticatedUserId && personaId) {
        const personaRow = await fetchPersonaRowForDigest({
          supabaseUrl,
          serviceRoleKey: supabaseServiceRoleKey,
          userId: authenticatedUserId,
          personaId
        }).catch((error) => {
          console.warn('Could not fetch persona row for digest:', error?.message || error);
          return null;
        });
        if (personaRow && typeof personaRow === 'object') {
          effectivePersonaSource = {
            id: sanitizeText(personaRow.id || '', 120),
            user_id: sanitizeText(personaRow.user_id || '', 120),
            persona_key: sanitizeText(personaRow.persona_key || personaSource?.persona_key || '', 120),
            name: sanitizeText(personaRow.name || personaLabel || personaSource?.name || 'Persona', 120),
            profile: personaRow.profile && typeof personaRow.profile === 'object' ? personaRow.profile : {},
            state: personaRow.state && typeof personaRow.state === 'object' ? personaRow.state : {},
            traits: personaRow.traits && typeof personaRow.traits === 'object' ? personaRow.traits : {}
          };
        }
      }
      const sourceHash = buildPersonaSourceHash(effectivePersonaSource);
      const existing = supabaseUrl && supabaseServiceRoleKey && authenticatedUserId && personaId
        ? await fetchPersonaDigestRow({
          supabaseUrl,
          serviceRoleKey: supabaseServiceRoleKey,
          userId: authenticatedUserId,
          personaId
        }).catch((error) => {
          console.warn('Could not fetch persona digest:', error?.message || error);
          return null;
        })
        : null;

      const hasExistingDigest = Boolean(existing?.digest_json && typeof existing.digest_json === 'object');
      const isHashMatch = hasExistingDigest && sanitizeText(existing?.source_hash || '', 180) === sourceHash;
      const ageSeconds = hasExistingDigest ? parseIsoAgeSeconds(existing?.updated_at) : Number.POSITIVE_INFINITY;
      const isReady = sanitizeText(existing?.status || '', 24) === 'ready';
      const stale = !hasExistingDigest || !isReady || !isHashMatch || ageSeconds > maxDigestAgeSeconds;

      if (stale && hasExistingDigest) {
        await enqueuePersonaDigestJob({
          supabaseUrl,
          serviceRoleKey: supabaseServiceRoleKey,
          userId: authenticatedUserId,
          personaId,
          reason: isHashMatch ? 'stale_digest_refresh' : 'source_hash_changed'
        });
      }

      if (stale && hasExistingDigest && requireFreshDigest && ageSeconds > maxDigestAgeSeconds) {
        const staleError = new Error(`Digest for ${personaLabel} is stale and freshness is required.`);
        staleError.status = 409;
        staleError.stage = 'context.digest_stale_requires_refresh';
        staleError.retryAfterSeconds = 15;
        throw staleError;
      }

      if (hasExistingDigest) {
        return {
          digestRow: existing,
          promptDigest: getDigestForPrompt(existing, effectivePersonaSource),
          source: stale ? 'stale_digest' : 'digest_cache'
        };
      }

      const deterministic = buildDeterministicPersonaDigest(effectivePersonaSource);
      let digestJson = deterministic.digest;
      let digestSource = 'sync_deterministic';
      if (shouldFallbackDigestToLlm({
        digest: digestJson,
        tokenEstimate: deterministic.token_estimate,
        maxDigestTokens: digestTokenLimit
      })) {
        digestJson = await summarizePersonaDigestWithLlm({
          apiKey,
          personaSource: effectivePersonaSource,
          maxDigestTokens: digestTokenLimit
        });
        digestSource = 'sync_llm_fallback';
      }
      const validation = validateDigestShape(digestJson);
      if (!validation.ok) {
        const digestShapeError = new Error(`Sync digest validation failed for ${personaLabel}: ${validation.reason}`);
        digestShapeError.status = 500;
        digestShapeError.stage = 'context.digest_sync_validation';
        throw digestShapeError;
      }
      const seededRow = {
        user_id: authenticatedUserId || null,
        persona_id: personaId || null,
        persona_key: sanitizeText(effectivePersonaSource.persona_key || '', 80),
        digest_json: digestJson,
        digest_version: Number(deterministic.digest_version || 1) || 1,
        source_hash: sourceHash,
        token_estimate: Math.max(1, Math.ceil(safeJson(digestJson).length / 4)),
        status: 'stale',
        last_error: null
      };
      if (supabaseUrl && supabaseServiceRoleKey && authenticatedUserId && personaId) {
        await upsertPersonaDigestRow({
          supabaseUrl,
          serviceRoleKey: supabaseServiceRoleKey,
          row: seededRow
        });
        await enqueuePersonaDigestJob({
          supabaseUrl,
          serviceRoleKey: supabaseServiceRoleKey,
          userId: authenticatedUserId,
          personaId,
          reason: 'sync_seed_missing_digest'
        });
      }
      return {
        digestRow: seededRow,
        promptDigest: getDigestForPrompt(seededRow, effectivePersonaSource),
        source: digestSource
      };
    };

    failureStage = 'context.digest_resolution';
    const personaADigestResolved = await resolvePersonaDigest({
      personaSource: personaASource,
      personaId: personaAId,
      personaLabel: sanitizeText(personaA?.label || personaA?.key || 'Persona A', 120)
    });
    const personaBDigestResolved = await resolvePersonaDigest({
      personaSource: personaBSource,
      personaId: personaBId,
      personaLabel: sanitizeText(personaB?.label || personaB?.key || 'Persona B', 120)
    });

    failureStage = 'context.pack_context';
    const packedContext = buildPackedOutcomeContext({
      requestedOutcome,
      inferredInitialConditions: effectiveInitialConditions,
      additionalContext: userInitialContext,
      personaADigest: personaADigestResolved.promptDigest,
      personaBDigest: personaBDigestResolved.promptDigest,
      contextBudgetTokens
    });

    const packedAdditionalContext = packedContext.sections
      .map((section) => section.text)
      .join(' ')
      .slice(0, 1600);
    const promptVariables = buildPromptTemplateVariables({
      requestedOutcome,
      inferredInitialConditions: packedContext.input,
      additionalContext: packedAdditionalContext,
      personaA,
      personaB,
      personaADigest: personaADigestResolved.promptDigest,
      personaBDigest: personaBDigestResolved.promptDigest,
      nodeCount: config.node_count,
      actionsPerNode: config.actions_per_node
    });
    const inputText = sanitizeText(packedContext.input, 12000);
    if (!inputText) {
      return fail(502, 'context.pack_context', 'Packed context input is empty.');
    }

    responseContextBuild = {
      source:
        personaADigestResolved.source === 'sync_llm_fallback' ||
        personaBDigestResolved.source === 'sync_llm_fallback'
          ? 'digest_plus_secondary_summarizer'
          : 'digest_only',
      input_tokens_estimate: packedContext.input_tokens_estimate,
      digest_versions: {
        persona_a: Number(personaADigestResolved?.digestRow?.digest_version || 0) || null,
        persona_b: Number(personaBDigestResolved?.digestRow?.digest_version || 0) || null
      },
      sections: Array.isArray(packedContext.sections) ? packedContext.sections : [],
      section_token_estimates:
        packedContext.section_token_estimates && typeof packedContext.section_token_estimates === 'object'
          ? packedContext.section_token_estimates
          : {},
      truncation_applied: Boolean(packedContext.truncation_applied),
      context_budget_tokens: contextBudgetTokens,
      max_digest_age_seconds: maxDigestAgeSeconds,
      require_fresh_digest: requireFreshDigest
    };
    responsePromptVariables = promptVariables;
    responseDigestVersions = responseContextBuild.digest_versions;
    responsePackedInput = inputText;

    let generatedText = '';
    let generationMode = '';
    let promptTemplateError = null;
    let promptTemplateRaw = null;
    let templateAttempted = false;
    let templateProducedOutput = false;
    let usageSummary = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    let tokenBudgetInfo = null;

    if (promptTemplateId) {
      templateAttempted = true;
      let reservation = null;
      let releaseSuccess = false;
      try {
        const estimatedInputTokens =
          estimateTokenCountFromJson(promptVariables) +
          estimateTokenCountFromText(responsePackedInput) +
          220;
        const estimatedRequestTokens = Math.max(
          700,
          clampInt(estimatedInputTokens + reservationOutputTokenEstimate, 700, 2_000_000)
        );

        if (supabaseUrl && supabaseServiceRoleKey) {
          reservation = await acquireOutcomeTokenReservation({
            supabaseUrl,
            serviceRoleKey: supabaseServiceRoleKey,
            estimatedTokens: estimatedRequestTokens,
            tpmLimit: outcomeTpmLimit,
            windowSeconds: outcomeTpmWindowSeconds,
            waitTimeoutMs: outcomeTpmWaitTimeoutMs,
            requestId: internalRequestId,
            userId: authenticatedUserId
          });
          tokenBudgetInfo = {
            estimated_input_tokens: Math.max(0, Math.round(toFiniteNumber(estimatedInputTokens, 0))),
            estimated_tokens: estimatedRequestTokens,
            limit_tokens: Math.max(0, Math.round(toFiniteNumber(reservation?.limit_tokens, outcomeTpmLimit))),
            remaining_tokens_after_reservation: Math.max(0, Math.round(toFiniteNumber(reservation?.remaining_tokens, 0))),
            reservation_output_tokens: Math.max(0, Math.round(toFiniteNumber(reservationOutputTokenEstimate, 0))),
            requested_max_output_tokens: Math.max(0, Math.round(toFiniteNumber(maxOutputTokens, 0))),
            queued_wait_ms: Math.max(0, Math.round(toFiniteNumber(reservation?.wait_ms, 0)))
          };
          responseTokenBudgetInfo = tokenBudgetInfo;
        }

        failureStage = 'openai.prompt_template.request';
        const templated = await requestCompletionWithPromptTemplate({
          apiKey,
          promptId: promptTemplateId,
          promptVersion: promptTemplateVersion,
          promptVariables,
          model: modelOverride,
          options: {
            inputText: responsePackedInput,
            textFormat: 'text',
            maxOutputTokens,
            timeoutMs: modelTimeoutMs,
            reasoningEffort: reasoningEffortOverride,
            reasoningSummary: reasoningSummaryOverride,
            verbosity: responseVerbosityOverride,
            store: true,
            include: [
              'reasoning.encrypted_content',
              'web_search_call.action.sources'
            ],
            overridePromptModel,
            metadata: {
              syntrae_feature: 'outcome_test',
              syntrae_stage: 'prompt_template_generation',
              syntrae_request_id: internalRequestId
            }
          }
        });
        promptTemplateRaw = templated?.raw || null;
        promptTemplateResponseId = sanitizeText(promptTemplateRaw?.id || '', 80) || null;
        generatedText = String(templated?.text || '').trim();
        usageSummary = templated?.usage && typeof templated.usage === 'object'
          ? templated.usage
          : extractUsageFromResponsesPayload(promptTemplateRaw);
        if (tokenBudgetInfo && typeof tokenBudgetInfo === 'object') {
          tokenBudgetInfo.actual_tokens = Math.max(0, Math.round(toFiniteNumber(usageSummary.total_tokens, 0)));
          tokenBudgetInfo.input_tokens = Math.max(0, Math.round(toFiniteNumber(usageSummary.input_tokens, 0)));
          tokenBudgetInfo.output_tokens = Math.max(0, Math.round(toFiniteNumber(usageSummary.output_tokens, 0)));
        }
        responseUsageSummary = usageSummary;
        responseTokenBudgetInfo = tokenBudgetInfo;

        if (generatedText) {
          generationMode = 'llm_prompt_template';
          promptTemplateIdUsed = promptTemplateId;
          promptTemplateVersionUsed = promptTemplateVersion || null;
          templateProducedOutput = true;
          releaseSuccess = true;
        }
      } catch (error) {
        generatedText = '';
        promptTemplateError = error;
      } finally {
        await releaseOutcomeTokenReservation({
          supabaseUrl,
          serviceRoleKey: supabaseServiceRoleKey,
          reservationId: reservation?.reservation_id || '',
          actualTokens: Math.max(0, Math.round(toFiniteNumber(usageSummary.total_tokens, 0))),
          success: releaseSuccess,
          requestId: internalRequestId,
          userId: authenticatedUserId,
          model: modelOverride || modelUsed || '',
          promptId: promptTemplateId,
          promptVersion: promptTemplateVersion || null,
          errorStage: releaseSuccess ? '' : failureStage
        });
      }
    }

    if (!generatedText && requirePromptTemplate) {
      const reason = sanitizeText(
        promptTemplateError?.message || 'Prompt template generation returned no output.',
        280
      );
      const upstreamStage = sanitizeText(promptTemplateError?.stage || '', 120).toLowerCase();
      const isConfigurationStage = upstreamStage.startsWith('configuration.');
      const hasSummaryMismatch = /unsupported value:\s*'concise'.*supported values are:\s*'detailed'/i.test(reason);
      const retryAfterSeconds = Math.max(
        Number(promptTemplateError?.retryAfterSeconds || 0) || 0,
        Number(parseRetryAfterSecondsFromText(reason) || 0) || 0
      );
      const rateLimitResetSeconds = Math.max(
        Number(promptTemplateError?.rateLimitResetRequestsSeconds || 0) || 0,
        Number(promptTemplateError?.rateLimitResetTokensSeconds || 0) || 0
      );
      const rawStatus = sanitizeText(promptTemplateRaw?.status || '', 60);
      const rawIncompleteReason = extractResponseIncompleteReason(promptTemplateRaw);
      const shouldMapToRateLimit = Number(promptTemplateError?.status) === 429 || retryAfterSeconds || rateLimitResetSeconds;
      const statusCode = isConfigurationStage
        ? (Number(promptTemplateError?.status) || 500)
        : (shouldMapToRateLimit ? 429 : 502);
      const failureStageLabel = isConfigurationStage ? upstreamStage : 'openai.prompt_template_generation';
      return fail(statusCode, failureStageLabel, reason, {
        prompt_template_id: promptTemplateId,
        prompt_template_version: promptTemplateVersion || null,
        hint: hasSummaryMismatch
          ? 'Your prompt template model settings currently use reasoning summary=concise, but this model only supports detailed. In the OpenAI prompt editor, change Summary to detailed (or auto/null) and click Update.'
          : null,
        response_status: rawStatus || null,
        response_incomplete_reason: rawIncompleteReason || null,
        response_id: sanitizeText(promptTemplateRaw?.id || '', 80) || null,
        retry_after_seconds: isConfigurationStage ? null : (retryAfterSeconds || null),
        rate_limit_reset_seconds: isConfigurationStage ? null : (rateLimitResetSeconds || null),
        rate_limit: promptTemplateError?.rateLimit && typeof promptTemplateError.rateLimit === 'object'
          ? promptTemplateError.rateLimit
          : null,
        openai_request_id: sanitizeText(promptTemplateError?.openaiRequestId || '', 120) || null,
        context_build: responseContextBuild,
        token_budget: responseTokenBudgetInfo,
        output_token_policy: {
          configured_max_output_tokens: configuredMaxOutputTokens,
          adaptive_cap: adaptiveOutputTokenCap,
          adaptive_floor: minAdaptiveOutputTokenCap,
          effective_adaptive_cap: effectiveAdaptiveOutputTokenCap,
          reservation_output_estimate: reservationOutputTokenEstimate,
          applied_max_output_tokens: maxOutputTokens
        }
      });
    }

    if (!generatedText && !nodes.length) {
      const reason = sanitizeText(
        promptTemplateError?.message || 'OpenAI returned no text output.',
        280
      );
      return fail(502, 'openai.generation_empty', reason, {
        prompt_template_id: templateAttempted ? promptTemplateId : null,
        prompt_template_version: templateAttempted ? (promptTemplateVersion || null) : null,
        context_build: responseContextBuild,
        token_budget: responseTokenBudgetInfo
      });
    }

    if (!nodes.length) {
      failureStage = 'openai.output_json_parse';
      const parsed = parseJsonObject(generatedText);
      if (!parsed || typeof parsed !== 'object') {
        const reason = 'OpenAI output is not valid JSON object.';
        return fail(502, failureStage, reason, {
          context_build: responseContextBuild,
          output_excerpt: sanitizeText(generatedText, 500)
        });
      }

      if (!chainQualityGates.length) {
        failureStage = 'openai.output_quality_gates_extraction';
        const rawQualityGates = extractRawQualityGatesFromGeneratedPayload(
          parsed,
          config.actions_per_node
        );
        if (!rawQualityGates.length) {
          const reason = 'No chain_quality_gates were found in OpenAI output.';
          return fail(502, failureStage, reason, {
            context_build: responseContextBuild,
            output_excerpt: sanitizeText(generatedText, 500)
          });
        }
        const gateShapeValidation = validateGeneratedQualityGatesShape(
          rawQualityGates,
          config.node_count,
          config.actions_per_node
        );
        if (!gateShapeValidation.ok) {
          const reason = sanitizeText(gateShapeValidation.reason, 320);
          return fail(502, 'openai.output_quality_gates_validation', reason, {
            context_build: responseContextBuild,
            output_excerpt: sanitizeText(generatedText, 500)
          });
        }
        chainQualityGates = normalizeQualityGates(
          rawQualityGates,
          config.node_count,
          config.actions_per_node
        );
      }

      if (!nodes.length) {
        failureStage = 'openai.output_node_extraction';
        const rawNodes = extractRawNodesFromGeneratedPayload(
          parsed,
          config.node_count,
          config.actions_per_node
        );
        if (!rawNodes.length) {
          const reason = 'No nodes were found in OpenAI output.';
          return fail(502, failureStage, reason, {
            context_build: responseContextBuild,
            output_excerpt: sanitizeText(generatedText, 500)
          });
        }

        if (!nodes.length) {
          failureStage = 'openai.output_validation';
          const shapeValidation = validateGeneratedActionSpaceShape(
            rawNodes,
            config.node_count,
            config.actions_per_node
          );
          if (!shapeValidation.ok) {
            const reason = sanitizeText(shapeValidation.reason, 320);
            return fail(502, failureStage, reason, {
              context_build: responseContextBuild,
              output_excerpt: sanitizeText(generatedText, 500)
            });
          }
        }

        if (!nodes.length) {
          failureStage = 'openai.output_normalization';
          const slotMetrics = buildQualityGateSlotMetrics(chainQualityGates);
          nodes = normalizeActionSpace(rawNodes, config.node_count, config.actions_per_node, slotMetrics);
          if (!nodes.length) {
            const reason = 'Normalized action space is empty.';
            return fail(502, failureStage, reason);
          }
        }
      }
    }

    if (!generatorSource) {
      generatorSource = generationMode || 'llm_prompt_template';
    }
    if (!modelUsed) {
      modelUsed = modelOverride || sanitizeText(promptTemplateRaw?.model || '', 80) || null;
    }
  } catch (error) {
    const reason = sanitizeText(error?.message || 'Unexpected outcome generation error.', 320);
    const retryAfterSeconds = Math.max(
      Number(error?.retryAfterSeconds || 0) || 0,
      Number(parseRetryAfterSecondsFromText(reason) || 0) || 0
    );
    const rateLimitResetSeconds = Math.max(
      Number(error?.rateLimitResetRequestsSeconds || 0) || 0,
      Number(error?.rateLimitResetTokensSeconds || 0) || 0
    );
    const errorStage = sanitizeText(error?.stage || '', 120) || 'openai.unhandled_exception';
    const mappedStatus = Number(error?.status) || 0;
    const statusCode = mappedStatus >= 400 && mappedStatus <= 599
      ? mappedStatus
      : (retryAfterSeconds || rateLimitResetSeconds ? 429 : 502);
    return fail(statusCode, errorStage, reason, {
      retry_after_seconds: retryAfterSeconds || null,
      rate_limit_reset_seconds: rateLimitResetSeconds || null,
      rate_limit: error?.rateLimit && typeof error.rateLimit === 'object' ? error.rateLimit : null,
      openai_request_id: sanitizeText(error?.openaiRequestId || '', 120) || null,
      context_build: responseContextBuild,
      token_budget: responseTokenBudgetInfo,
      output_token_policy: {
        configured_max_output_tokens: configuredMaxOutputTokens,
        adaptive_cap: adaptiveOutputTokenCap,
        adaptive_floor: minAdaptiveOutputTokenCap,
        effective_adaptive_cap: effectiveAdaptiveOutputTokenCap,
        reservation_output_estimate: reservationOutputTokenEstimate,
        applied_max_output_tokens: maxOutputTokens
      }
    });
  }

  if (!Array.isArray(nodes) || !nodes.length) {
    return fail(502, 'openai.output_normalization', 'No usable action-space nodes were produced.');
  }

  const personaAKey = sanitizePersonaKey(personaA?.key);
  const personaBKey = sanitizePersonaKey(personaB?.key);
  const personaKeys = [personaAKey, personaBKey].filter(Boolean);
  const dedupPersonaKeys = Array.from(new Set(personaKeys));
  const chainCandidates = buildChainCandidates(
    nodes,
    requestedOutcome,
    effectiveInitialConditions,
    config.actions_per_node,
    chainQualityGates
  );
  const chainActionMatrix = buildChainActionMatrix(nodes, config.actions_per_node);
  const bestChain = chainCandidates[0] || null;
  const personaARecordId = sanitizeText(extractPersonaDbRecord(personaA)?.id || personaA?.id || '', 120) || null;
  const personaBRecordId = sanitizeText(extractPersonaDbRecord(personaB)?.id || personaB?.id || '', 120) || null;
  await storeOutcomeContextRun({
    supabaseUrl,
    serviceRoleKey: supabaseServiceRoleKey,
    row: {
      request_id: internalRequestId,
      user_id: authenticatedUserId || null,
      persona_a_id: personaARecordId,
      persona_b_id: personaBRecordId,
      requested_outcome: sanitizeText(requestedOutcome, 500),
      packed_context_json: {
        input: responsePackedInput,
        sections: Array.isArray(responseContextBuild?.sections) ? responseContextBuild.sections : [],
        source: sanitizeText(responseContextBuild?.source || 'digest_only', 80)
      },
      section_token_estimates:
        responseContextBuild?.section_token_estimates && typeof responseContextBuild.section_token_estimates === 'object'
          ? responseContextBuild.section_token_estimates
          : {},
      final_input_token_estimate: Math.max(
        0,
        Math.round(
          toFiniteNumber(
            responseContextBuild?.input_tokens_estimate,
            estimateTokenCountFromText(responsePackedInput)
          )
        )
      ),
      prompt_variables_used:
        responsePromptVariables && typeof responsePromptVariables === 'object'
          ? responsePromptVariables
          : {},
      digest_versions_used:
        responseDigestVersions && typeof responseDigestVersions === 'object'
          ? responseDigestVersions
          : {},
      model: sanitizeText(modelUsed || modelOverride || '', 120) || null,
      response_id: promptTemplateResponseId
    }
  });

  if (actionSpaceOnly) {
    return res.status(200).json({
      report_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      generated_at: new Date().toISOString(),
      mode: 'action_generation_only',
      initial_conditions: effectiveInitialConditions,
      inferred_initial_conditions: inferredInitialConditions,
      user_initial_context: userInitialContext,
      requested_outcome: requestedOutcome,
      persona_a: {
        key: personaAKey,
        label: sanitizeText(personaA?.label || 'Persona A', 120)
      },
      persona_b: {
        key: personaBKey,
        label: sanitizeText(personaB?.label || 'Persona B', 120)
      },
      persona_keys: dedupPersonaKeys,
      config: {
        node_count: config.node_count,
        actions_per_node: config.actions_per_node
      },
      total_action_combinations: Math.pow(config.actions_per_node, config.node_count),
      action_space: nodes,
      chain_quality_gates: chainQualityGates,
      chain_action_matrix: chainActionMatrix,
      chain_candidates: chainCandidates,
      best_chain: bestChain,
      summary: `Generated ${config.node_count} nodes × ${config.actions_per_node} actions and chained them into ${chainCandidates.length} gene-based action chains.`,
      generator_source: generatorSource,
      model_used: modelUsed || null,
      prompt_template_id_used: promptTemplateIdUsed,
      prompt_template_version_used: promptTemplateVersionUsed,
      context_build: responseContextBuild,
      usage: responseUsageSummary,
      token_budget: responseTokenBudgetInfo,
      output_token_policy: {
        configured_max_output_tokens: configuredMaxOutputTokens,
        adaptive_cap: adaptiveOutputTokenCap,
        adaptive_floor: minAdaptiveOutputTokenCap,
        effective_adaptive_cap: effectiveAdaptiveOutputTokenCap,
        reservation_output_estimate: reservationOutputTokenEstimate,
        applied_max_output_tokens: maxOutputTokens
      }
    });
  }

  const evolved = evolvePathways({
    actionSpace: nodes,
    populationSize: config.population_size,
    generations: config.generations,
    mutationRate: config.mutation_rate,
    eliteCount: config.elite_count
  });

  const selected = evolved.slice(0, config.top_pathways);
  const topPathways = selected.map((item, index) =>
    buildPathwayView(item, index + 1, nodes, config.simulation_reps)
  );

  const best = topPathways[0] || null;

  const report = {
    report_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    generated_at: new Date().toISOString(),
    initial_conditions: effectiveInitialConditions,
    inferred_initial_conditions: inferredInitialConditions,
    user_initial_context: userInitialContext,
    requested_outcome: requestedOutcome,
    persona_a: {
      key: personaAKey,
      label: sanitizeText(personaA?.label || 'Persona A', 120)
    },
    persona_b: {
      key: personaBKey,
      label: sanitizeText(personaB?.label || 'Persona B', 120)
    },
    persona_keys: dedupPersonaKeys,
    config,
    total_action_combinations: Math.pow(config.actions_per_node, config.node_count),
    action_space: nodes,
    chain_quality_gates: chainQualityGates,
    chain_action_matrix: chainActionMatrix,
    chain_candidates: chainCandidates,
    best_chain: bestChain,
    top_pathways: topPathways,
    best_pathway: best,
    summary: buildSummary(best, requestedOutcome),
    generator_source: generatorSource,
    model_used: modelUsed || null,
    prompt_template_id_used: promptTemplateIdUsed,
    prompt_template_version_used: promptTemplateVersionUsed,
    context_build: responseContextBuild,
    usage: responseUsageSummary,
    token_budget: responseTokenBudgetInfo,
    output_token_policy: {
      configured_max_output_tokens: configuredMaxOutputTokens,
      adaptive_cap: adaptiveOutputTokenCap,
      adaptive_floor: minAdaptiveOutputTokenCap,
      effective_adaptive_cap: effectiveAdaptiveOutputTokenCap,
      reservation_output_estimate: reservationOutputTokenEstimate,
      applied_max_output_tokens: maxOutputTokens
    }
  };

  return res.status(200).json(report);
};
