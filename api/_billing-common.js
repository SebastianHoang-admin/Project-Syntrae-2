const crypto = require('node:crypto');

const PERSONA_KEY_RE = /[^a-z0-9_-]/g;
const CHAT_ALLOWED_STATUSES = new Set(['trialing', 'active']);
const DELETE_BLOCK_STATUSES = new Set(['trialing', 'active', 'past_due', 'unpaid', 'incomplete']);

function sanitizePersonaKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.replace(PERSONA_KEY_RE, '') || '';
}

function parseJsonBody(req) {
  if (!req || req.body == null) return {};
  if (typeof req.body === 'object') return req.body;
  if (typeof req.body !== 'string') return {};
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function getAccessToken(req) {
  const authHeader = String(req?.headers?.authorization || '');
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
}

function hasChatEntitlement(status) {
  return CHAT_ALLOWED_STATUSES.has(String(status || '').toLowerCase());
}

function shouldBlockPersonaDeletion(subscriptionRow) {
  if (!subscriptionRow || typeof subscriptionRow !== 'object') return false;
  const status = String(subscriptionRow.status || '').toLowerCase();
  const cancelAtPeriodEnd = Boolean(subscriptionRow.cancel_at_period_end);
  return DELETE_BLOCK_STATUSES.has(status) && !cancelAtPeriodEnd;
}

function getOrigin(req) {
  const proto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() || 'https';
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  if (!host) return '';
  return `${proto}://${host}`;
}

function toIso(unixSeconds) {
  if (typeof unixSeconds !== 'number' || !Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

function getSupabaseConfig({ requireServiceRole = false } = {}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY_LOCAL;
  const supabaseServiceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY_LOCAL;
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
  if (requireServiceRole && !supabaseServiceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    missing
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_) {
      body = null;
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text,
    body
  };
}

function supabaseHeaders(apiKey, bearerToken) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${bearerToken || apiKey}`
  };
}

async function fetchSupabaseUser(supabaseUrl, anonKey, accessToken) {
  const result = await fetchJson(`${supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: supabaseHeaders(anonKey, accessToken)
  });
  if (!result.ok || !result.body?.id) {
    return { ok: false, status: result.status, error: 'Invalid or expired session token', user: null };
  }
  return { ok: true, status: 200, error: null, user: result.body };
}

async function fetchPersonaForUser({ supabaseUrl, anonKey, accessToken, userId, personaKey = '' }) {
  const filters = [
    `user_id=eq.${encodeURIComponent(userId)}`,
    'select=id,persona_key,name,portrait_storage_path,state',
    'limit=1'
  ];
  if (personaKey) {
    filters.unshift(`persona_key=eq.${encodeURIComponent(personaKey)}`);
  } else {
    filters.push('order=updated_at.desc');
  }
  const result = await fetchJson(`${supabaseUrl}/rest/v1/personas?${filters.join('&')}`, {
    method: 'GET',
    headers: supabaseHeaders(anonKey, accessToken)
  });
  if (!result.ok || !Array.isArray(result.body) || !result.body.length) return null;
  return result.body[0];
}

async function supabaseAdminRequest({
  supabaseUrl,
  serviceRoleKey,
  table,
  query = '',
  method = 'GET',
  body = null,
  prefer = ''
}) {
  const headers = {
    ...supabaseHeaders(serviceRoleKey, serviceRoleKey)
  };
  if (prefer) headers.Prefer = prefer;
  const request = { method, headers };
  if (body != null) {
    headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(body);
  }
  const suffix = query ? `?${query}` : '';
  return fetchJson(`${supabaseUrl}/rest/v1/${table}${suffix}`, request);
}

async function stripeRequest({ secretKey, path, method = 'POST', form = null, query = '' }) {
  const headers = {
    Authorization: `Bearer ${secretKey}`
  };
  const request = { method, headers };
  if (form != null) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    request.body = form instanceof URLSearchParams ? form.toString() : String(form);
  }
  const q = query ? `?${query}` : '';
  return fetchJson(`https://api.stripe.com${path}${q}`, request);
}

function verifyStripeSignature({ rawBody, signatureHeader, webhookSecret, toleranceSeconds = 300 }) {
  if (!rawBody || !signatureHeader || !webhookSecret) return false;
  const parts = String(signatureHeader)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const timestampPart = parts.find((part) => part.startsWith('t='));
  const signatureParts = parts.filter((part) => part.startsWith('v1='));
  if (!timestampPart || !signatureParts.length) return false;

  const timestamp = Number(timestampPart.slice(2));
  if (!Number.isFinite(timestamp)) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;

  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload, 'utf8')
    .digest('hex');

  return signatureParts.some((part) => {
    const sig = part.slice(3);
    if (!sig || sig.length !== expected.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch (_) {
      return false;
    }
  });
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req?.body)) return req.body.toString('utf8');
  if (typeof req?.body === 'string') return req.body;
  if (req?.body && typeof req.body === 'object') return JSON.stringify(req.body);

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function safeStripeErrorMessage(result, fallback) {
  if (result?.body?.error?.message) return result.body.error.message;
  if (result?.body?.error) return String(result.body.error);
  if (result?.text) return result.text;
  return fallback;
}

module.exports = {
  sanitizePersonaKey,
  parseJsonBody,
  getAccessToken,
  hasChatEntitlement,
  shouldBlockPersonaDeletion,
  getOrigin,
  toIso,
  getSupabaseConfig,
  fetchJson,
  fetchSupabaseUser,
  fetchPersonaForUser,
  supabaseAdminRequest,
  stripeRequest,
  verifyStripeSignature,
  readRawBody,
  safeStripeErrorMessage
};
