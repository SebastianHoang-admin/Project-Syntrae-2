const crypto = require('crypto');
const { resolveEnv } = require('./env-utils');

const PERSONA_KEY_RE = /[^a-z0-9_-]/g;
const DEFAULT_PROMPT_ID = 'pmpt_6a1f5906ae24819391a3a339620b83bd0ad5cc0a81140d0b';
const DEFAULT_PROMPT_VERSION = '4';
const MAX_STALE_DIGESTS = 10;

function sanitizePersonaKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.replace(PERSONA_KEY_RE, '') || '';
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function hashPayload(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function safeJsonParse(text) {
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

function extractResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  const parts = [];
  output.forEach((item) => {
    const content = Array.isArray(item?.content) ? item.content : [];
    content.forEach((part) => {
      if (typeof part?.text === 'string') parts.push(part.text);
      if (typeof part?.output_text === 'string') parts.push(part.output_text);
    });
  });
  return parts.join('\n').trim();
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

async function fetchSupabaseUser(supabaseUrl, anonKey, accessToken) {
  return fetchJson(`${supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`
    }
  });
}

async function fetchPersonaRow(supabaseUrl, anonKey, accessToken, userId, personaKey) {
  const params = [
    `user_id=eq.${encodeURIComponent(userId)}`,
    `persona_key=eq.${encodeURIComponent(personaKey)}`,
    'select=id,user_id,persona_key,name,portrait_data_url,portrait_storage_path,state,traits,profile,digest_cache,stale_digests',
    'limit=1'
  ];
  return fetchJson(`${supabaseUrl}/rest/v1/personas?${params.join('&')}`, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`
    }
  });
}

async function updatePersonaDigest(supabaseUrl, anonKey, accessToken, personaId, digestCache, staleDigests) {
  return fetchJson(`${supabaseUrl}/rest/v1/personas?id=eq.${encodeURIComponent(personaId)}`, {
    method: 'PATCH',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      digest_cache: digestCache,
      stale_digests: staleDigests
    })
  });
}

function buildRawPersonaPayload(row) {
  return {
    persona_key: row.persona_key,
    name: row.name,
    portrait_data_url: row.portrait_data_url || null,
    portrait_storage_path: row.portrait_storage_path || null,
    state: row.state || {},
    traits: row.traits || {},
    profile: row.profile || {}
  };
}

function buildSummarizerInput(rawPersonaPayload) {
  return [
    'Summarize this full raw Syntrae persona JSON into a prompt-ready digest.',
    'Preserve high-signal identity, preferences, dislikes, hard boundaries, behavioral tendencies, interaction guidance, and critical factors.',
    'Return the format specified by the configured Syntrae LLM Summarizer prompt.',
    '',
    'RAW_PERSONA_JSON:',
    JSON.stringify(rawPersonaPayload, null, 2)
  ].join('\n');
}

async function runOpenAISummarizer({ apiKey, promptId, promptVersion, rawPersonaPayload }) {
  const body = {
    prompt: {
      id: promptId,
      version: promptVersion
    },
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: buildSummarizerInput(rawPersonaPayload)
          }
        ]
      }
    ]
  };

  const maxOutputTokens = Number(resolveEnv(['OPENAI_PERSONA_DIGEST_MAX_OUTPUT_TOKENS']));
  if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
    body.max_output_tokens = Math.round(maxOutputTokens);
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.error || 'OpenAI persona digest request failed';
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  const text = extractResponseText(data);
  if (!text) {
    const err = new Error('OpenAI persona digest response returned no output text');
    err.status = 502;
    throw err;
  }
  return {
    text,
    parsed: safeJsonParse(text),
    model: data?.model || '',
    response_id: data?.id || '',
    usage: data?.usage || null
  };
}

function buildStaleDigests(existingDigest, existingStaleDigests) {
  const history = Array.isArray(existingStaleDigests) ? existingStaleDigests : [];
  if (!existingDigest || typeof existingDigest !== 'object' || !Object.keys(existingDigest).length) {
    return history.slice(0, MAX_STALE_DIGESTS);
  }
  return [
    {
      ...existingDigest,
      stale_at: new Date().toISOString()
    },
    ...history
  ].slice(0, MAX_STALE_DIGESTS);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const apiKey = resolveEnv(['OPENAI_API_KEY', 'OPENAI_API_KEY_LOCAL', 'OPENAI_KEY']);
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OpenAI API key for persona digest summarizer' });
  }

  const supabaseUrl = resolveEnv(['SUPABASE_URL']);
  const supabaseAnonKey = resolveEnv(['SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY_LOCAL']);
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Missing Supabase configuration for persona digest storage' });
  }

  const authHeader = String(req.headers.authorization || '');
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!accessToken) {
    return res.status(401).json({ error: 'Missing authenticated session token' });
  }

  const personaKey = sanitizePersonaKey(req.body?.personaKey || req.body?.persona_key || '');
  if (!personaKey) {
    return res.status(400).json({ error: 'personaKey is required' });
  }

  try {
    const userResult = await fetchSupabaseUser(supabaseUrl, supabaseAnonKey, accessToken);
    if (!userResult.ok || !userResult.body?.id) {
      return res.status(401).json({ error: 'Invalid or expired session token' });
    }

    const personaResult = await fetchPersonaRow(
      supabaseUrl,
      supabaseAnonKey,
      accessToken,
      userResult.body.id,
      personaKey
    );
    if (!personaResult.ok) {
      return res.status(personaResult.status || 500).json({
        error: personaResult.body?.message || personaResult.body?.error || 'Unable to load persona for digest generation'
      });
    }
    const row = Array.isArray(personaResult.body) ? personaResult.body[0] : null;
    if (!row?.id) {
      return res.status(404).json({ error: 'Persona not found for digest generation' });
    }

    const rawPersonaPayload = buildRawPersonaPayload(row);
    const profileHash = hashPayload(rawPersonaPayload);
    const existingDigest = row.digest_cache && typeof row.digest_cache === 'object' ? row.digest_cache : {};
    if (existingDigest.profile_hash === profileHash && existingDigest.status === 'ready') {
      return res.status(200).json({
        status: 'skipped',
        reason: 'digest_current',
        profile_hash: profileHash,
        digest_cache: existingDigest
      });
    }

    const promptId = resolveEnv(['OPENAI_PERSONA_DIGEST_PROMPT_ID']) || DEFAULT_PROMPT_ID;
    const promptVersion = resolveEnv(['OPENAI_PERSONA_DIGEST_PROMPT_VERSION']) || DEFAULT_PROMPT_VERSION;
    const generated = await runOpenAISummarizer({
      apiKey,
      promptId,
      promptVersion,
      rawPersonaPayload
    });

    const digestVersion = Number(existingDigest.digest_version || 0) + 1;
    const digestCache = {
      status: 'ready',
      profile_hash: profileHash,
      digest_version: digestVersion,
      generated_at: new Date().toISOString(),
      prompt_id: promptId,
      prompt_version: promptVersion,
      model: generated.model,
      response_id: generated.response_id,
      source_persona_key: row.persona_key,
      summary_text:
        typeof generated.parsed?.summary_text === 'string'
          ? generated.parsed.summary_text
          : generated.text,
      structured_digest: generated.parsed,
      raw_text: generated.text,
      usage: generated.usage
    };
    const staleDigests = buildStaleDigests(existingDigest, row.stale_digests);
    const updateResult = await updatePersonaDigest(
      supabaseUrl,
      supabaseAnonKey,
      accessToken,
      row.id,
      digestCache,
      staleDigests
    );
    if (!updateResult.ok) {
      return res.status(updateResult.status || 500).json({
        error: updateResult.body?.message || updateResult.body?.error || 'Unable to store persona digest in Supabase'
      });
    }

    return res.status(200).json({
      status: 'updated',
      profile_hash: profileHash,
      digest_cache: digestCache
    });
  } catch (err) {
    const status = Number(err?.status) || 500;
    return res.status(status).json({
      error: err?.message || 'Persona digest generation failed'
    });
  }
};
