const { resolveEnv } = require('./env-utils');
const {
  DEFAULT_DIGEST_TOKEN_LIMIT,
  buildDeterministicPersonaDigest,
  sanitizeText,
  shouldFallbackDigestToLlm,
  validateDigestShape
} = require('./outcome-context-utils');

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function clampInt(value, min, max) {
  return Math.round(clamp(value, min, max));
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
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (_) {
      return null;
    }
  }
}

function supabaseHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json'
  };
}

async function supabaseRequest({ supabaseUrl, serviceRoleKey, method, path, body, prefer }) {
  const headers = supabaseHeaders(serviceRoleKey);
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = sanitizeText(
      json?.message || json?.hint || json?.error || `${method} ${path} failed`,
      280
    ) || `${method} ${path} failed`;
    const error = new Error(message);
    error.status = response.status;
    error.data = json;
    throw error;
  }
  return json;
}

async function claimDigestJobs({ supabaseUrl, serviceRoleKey, workerId, limit }) {
  const body = {
    p_worker_id: sanitizeText(workerId || 'digest-worker', 120) || 'digest-worker',
    p_limit: clampInt(limit || 5, 1, 30)
  };
  const result = await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    method: 'POST',
    path: '/rest/v1/rpc/claim_persona_digest_jobs',
    body,
    prefer: 'return=representation'
  });
  return Array.isArray(result) ? result : [];
}

async function fetchPersonaRow({ supabaseUrl, serviceRoleKey, personaId }) {
  const query = [
    'select=id,user_id,persona_key,name,profile,state,traits,updated_at',
    `id=eq.${encodeURIComponent(personaId)}`,
    'limit=1'
  ].join('&');
  const result = await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    method: 'GET',
    path: `/rest/v1/personas?${query}`
  });
  return Array.isArray(result) && result.length ? result[0] : null;
}

async function fetchExistingDigest({ supabaseUrl, serviceRoleKey, personaId }) {
  const query = [
    'select=id,persona_id,source_hash,status,digest_version,updated_at',
    `persona_id=eq.${encodeURIComponent(personaId)}`,
    'limit=1'
  ].join('&');
  const result = await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    method: 'GET',
    path: `/rest/v1/persona_context_digests?${query}`
  });
  return Array.isArray(result) && result.length ? result[0] : null;
}

async function upsertDigest({
  supabaseUrl,
  serviceRoleKey,
  row
}) {
  await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    method: 'POST',
    path: '/rest/v1/persona_context_digests?on_conflict=persona_id',
    body: [row],
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

async function updateDigestJob({ supabaseUrl, serviceRoleKey, jobId, patch }) {
  await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    method: 'PATCH',
    path: `/rest/v1/persona_digest_jobs?id=eq.${encodeURIComponent(jobId)}`,
    body: patch,
    prefer: 'return=minimal'
  });
}

async function enqueueDigestRefresh({ supabaseUrl, serviceRoleKey, userId, personaId, reason }) {
  try {
    await supabaseRequest({
      supabaseUrl,
      serviceRoleKey,
      method: 'POST',
      path: '/rest/v1/rpc/enqueue_persona_digest_job',
      body: {
        p_user_id: userId,
        p_persona_id: personaId,
        p_reason: reason
      },
      prefer: 'return=minimal'
    });
  } catch (error) {
    console.warn('Could not enqueue digest refresh job:', error?.message || error);
  }
}

async function summarizeDigestWithLlm({ apiKey, persona, maxDigestTokens }) {
  const prompt = [
    'Compress this persona profile into strict JSON with this shape only:',
    '{',
    '"identity": {"persona_key":"", "label":"", "personal_headline":"", "communication_style":""},',
    '"goals_top3": [""],',
    '"constraints_top5": [""],',
    '"hard_boundaries_top5": [""],',
    '"topic_anchors_top5": [""],',
    '"shared_activity_preferences_top5": [""],',
    '"quant_axes_top8": [{"axis":"", "score":0}],',
    '"risk_flags": [""],',
    '"legal_ethics_guardrails": [""]',
    '}',
    'Rules: keep concise, no markdown, no extra keys, legal and consent-focused.',
    `Persona source JSON: ${JSON.stringify(persona || {})}`
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: resolveEnv(['OPENAI_OUTCOME_DIGEST_MODEL']) || 'gpt-5.4-nano',
      input: prompt,
      text: { format: { type: 'json_object' }, verbosity: 'low' },
      max_output_tokens: clampInt(maxDigestTokens || DEFAULT_DIGEST_TOKEN_LIMIT, 300, 6000),
      reasoning: { effort: 'minimal', summary: 'auto' },
      store: false
    })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = sanitizeText(json?.error?.message || json?.error || 'Digest LLM fallback failed', 280);
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  const text = String(json?.output_text || '').trim();
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Digest LLM fallback produced invalid JSON output');
  }
  return parsed;
}

function nextRetryIso(attemptCount) {
  const attempt = Math.max(1, Number(attemptCount) || 1);
  const backoffSeconds = Math.min(15 * Math.pow(2, Math.max(0, attempt - 1)), 300);
  return new Date(Date.now() + backoffSeconds * 1000).toISOString();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const supabaseUrl = resolveEnv(['SUPABASE_URL']);
  const serviceRoleKey = resolveEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY_LOCAL']);
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({
      error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for digest worker.'
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const workerId = sanitizeText(body.worker_id || body.workerId || 'digest-worker', 120) || 'digest-worker';
  const limit = clampInt(body.limit || body.batch_size || 5, 1, 30);
  const forceRecompute = Boolean(body.force_recompute || body.forceRecompute);
  const maxDigestTokens = clampInt(body.max_digest_tokens || body.maxDigestTokens || DEFAULT_DIGEST_TOKEN_LIMIT, 300, 6000);
  const maxAttempts = clampInt(body.max_attempts || body.maxAttempts || 3, 1, 10);
  const apiKey = resolveEnv(['OPENAI_API_KEY', 'OPENAI_API_KEY_LOCAL', 'OPENAI_KEY']);

  const claimed = await claimDigestJobs({
    supabaseUrl,
    serviceRoleKey,
    workerId,
    limit
  });

  const results = [];
  for (let i = 0; i < claimed.length; i += 1) {
    const job = claimed[i];
    const jobId = sanitizeText(job?.id || '', 120);
    const personaId = sanitizeText(job?.persona_id || '', 120);
    const userId = sanitizeText(job?.user_id || '', 120);

    if (!jobId || !personaId || !userId) {
      continue;
    }

    let status = 'done';
    let errorText = '';
    let digestSource = 'deterministic';
    let tokenEstimate = 0;
    let nextDigestVersion = 1;

    try {
      const persona = await fetchPersonaRow({ supabaseUrl, serviceRoleKey, personaId });
      if (!persona) {
        throw new Error('Persona row not found for digest job.');
      }

      const existing = await fetchExistingDigest({ supabaseUrl, serviceRoleKey, personaId });
      const deterministic = buildDeterministicPersonaDigest({
        key: persona.persona_key,
        persona_key: persona.persona_key,
        name: persona.name,
        profile: persona.profile,
        state: persona.state,
        traits: persona.traits
      });
      let digestJson = deterministic.digest;
      tokenEstimate = deterministic.token_estimate;
      const existingVersion = Number(existing?.digest_version || 0) || 0;
      const baseVersion = Number(deterministic.digest_version || 1) || 1;
      nextDigestVersion = existingVersion > 0 ? existingVersion + 1 : baseVersion;

      if (!forceRecompute && existing?.status === 'ready' && existing?.source_hash === deterministic.source_hash) {
        await updateDigestJob({
          supabaseUrl,
          serviceRoleKey,
          jobId,
          patch: {
            status: 'done',
            locked_at: null,
            locked_by: null,
            last_error: null
          }
        });
        results.push({
          job_id: jobId,
          persona_id: personaId,
          status: 'done',
          skipped: true,
          source: 'cache_noop'
        });
        continue;
      }

      const shouldFallback = shouldFallbackDigestToLlm({
        digest: digestJson,
        tokenEstimate,
        maxDigestTokens
      });

      if (shouldFallback) {
        const validation = validateDigestShape(digestJson);
        if (!apiKey) {
          const fallbackReason = validation.ok
            ? `Deterministic digest exceeded token limit (${tokenEstimate} > ${maxDigestTokens}) and OPENAI_API_KEY is missing for fallback.`
            : `Deterministic digest invalid (${validation.reason}) and OPENAI_API_KEY is missing for fallback.`;
          throw new Error(fallbackReason);
        }
        digestJson = await summarizeDigestWithLlm({
          apiKey,
          persona: {
            persona_key: persona.persona_key,
            name: persona.name,
            profile: persona.profile,
            state: persona.state,
            traits: persona.traits
          },
          maxDigestTokens
        });
        const llmShape = validateDigestShape(digestJson);
        if (!llmShape.ok) {
          throw new Error(`Digest LLM fallback failed validation: ${llmShape.reason}`);
        }
        tokenEstimate = Math.max(1, Math.ceil(JSON.stringify(digestJson).length / 4));
        digestSource = 'llm_fallback';
      }

      await upsertDigest({
        supabaseUrl,
        serviceRoleKey,
        row: {
          user_id: userId,
          persona_id: personaId,
          persona_key: sanitizeText(persona.persona_key || '', 80),
          digest_json: digestJson,
          digest_version: nextDigestVersion,
          source_hash: deterministic.source_hash,
          token_estimate: tokenEstimate,
          status: 'ready',
          last_error: null
        }
      });

      await updateDigestJob({
        supabaseUrl,
        serviceRoleKey,
        jobId,
        patch: {
          status: 'done',
          locked_at: null,
          locked_by: null,
          last_error: null
        }
      });
    } catch (error) {
      status = 'failed';
      errorText = sanitizeText(error?.message || 'Digest generation failed', 500);
      const attemptCount = Number(job?.attempt_count || 1) || 1;
      const canRetry = attemptCount < maxAttempts;
      const nextStatus = canRetry ? 'queued' : 'failed';
      const patch = {
        status: nextStatus,
        locked_at: null,
        locked_by: null,
        last_error: errorText,
        next_run_at: canRetry ? nextRetryIso(attemptCount + 1) : new Date().toISOString()
      };
      await updateDigestJob({
        supabaseUrl,
        serviceRoleKey,
        jobId,
        patch
      });
      if (canRetry) {
        await enqueueDigestRefresh({
          supabaseUrl,
          serviceRoleKey,
          userId,
          personaId,
          reason: 'retry'
        });
      }
      results.push({
        job_id: jobId,
        persona_id: personaId,
        status: nextStatus,
        error: errorText
      });
      continue;
    }

    results.push({
      job_id: jobId,
      persona_id: personaId,
      status,
      source: digestSource,
      token_estimate: tokenEstimate
    });
  }

  return res.status(200).json({
    worker_id: workerId,
    claimed: claimed.length,
    processed: results.length,
    results
  });
};
