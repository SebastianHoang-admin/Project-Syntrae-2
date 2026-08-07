const crypto = require('node:crypto');
const { resolveEnv } = require('./env-utils');

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const SURVEY_COOKIE_NAME = 'syntrae_waitlist_survey';
const SURVEY_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function pageUrl(req, pathname, params = {}, hash = '') {
  const url = new URL(pathname, getOrigin(req));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  if (hash) url.hash = hash;
  return url.toString();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function createSurveyAccessToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashToken(token)
  };
}

function requireSupabaseConfig() {
  const supabaseUrl = resolveEnv(['SUPABASE_URL']);
  const serviceRoleKey = resolveEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY_LOCAL']);
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) {
    const error = new Error('Waitlist verification configuration missing.');
    error.status = 500;
    error.missing = missing;
    throw error;
  }
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), serviceRoleKey };
}

async function supabaseRest(path, { method = 'GET', body, prefer = 'return=representation' } = {}) {
  const { supabaseUrl, serviceRoleKey } = requireSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: prefer
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text().catch(() => '');
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }
  }
  if (!response.ok) {
    const error = new Error(json?.message || json?.error || `Supabase request failed (${response.status}).`);
    error.status = response.status;
    error.body = text;
    throw error;
  }
  return json;
}

function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.end();
}

function buildSurveyCookie(req, token) {
  const origin = getOrigin(req);
  const secure = /^https:/i.test(origin) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(origin);
  const parts = [
    `${SURVEY_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${SURVEY_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const token = String(req.query?.token || '').trim();
    if (!TOKEN_RE.test(token)) {
      return redirect(res, pageUrl(req, '/landing.html', { waitlist: 'invalid' }, 'founding'));
    }

    const tokenHash = hashToken(token);
    const rows = await supabaseRest(`waitlist?verification_token_hash=eq.${tokenHash}&select=id,email,full_name,status,verification_expires_at&limit=1`);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) {
      return redirect(res, pageUrl(req, '/landing.html', { waitlist: 'invalid' }, 'founding'));
    }

    const expiresAt = row.verification_expires_at ? new Date(row.verification_expires_at).getTime() : 0;
    if (!expiresAt || expiresAt < Date.now()) {
      await supabaseRest(`waitlist?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        body: {
          verification_token_hash: null,
          verification_expires_at: null,
          updated_at: new Date().toISOString()
        },
        prefer: 'return=minimal'
      }).catch((error) => {
        console.warn('waitlist expired token cleanup failed:', error?.message || error);
      });
      return redirect(res, pageUrl(req, '/landing.html', { waitlist: 'expired' }, 'founding'));
    }

    const surveyAccess = createSurveyAccessToken();
    await supabaseRest(`waitlist?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      body: {
        status: 'verified',
        verified_at: new Date().toISOString(),
        verification_token_hash: null,
        verification_expires_at: null,
        survey_token_hash: surveyAccess.tokenHash,
        survey_token_created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      prefer: 'return=minimal'
    });

    res.setHeader('Set-Cookie', buildSurveyCookie(req, surveyAccess.token));
    return redirect(res, pageUrl(req, '/sign-up.html', {
      waitlist: 'verified',
      email: row.email,
      name: row.full_name || ''
    }));
  } catch (err) {
    console.error('waitlist verification failed:', err);
    return redirect(res, pageUrl(req, '/landing.html', { waitlist: 'error' }, 'founding'));
  }
};
