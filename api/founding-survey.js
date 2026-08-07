const crypto = require('node:crypto');
const { resolveEnv } = require('./env-utils');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SURVEY_COOKIE_NAME = 'syntrae_waitlist_survey';
const MAX_TEXT_LENGTH = 5000;

const ANSWER_FIELDS = Object.freeze({
  uncertainMoment: 'uncertain_moment',
  decisionArea: 'relationship_to_person',
  situationDetails: 'situation_details',
  possibleActions: 'possible_actions',
  fearedConsequences: 'feared_consequences',
  hopedOutcome: 'hoped_outcome',
  uncertaintyResponse: 'uncertainty_response',
  supportsUsed: 'supports_used',
  syntraeUsefulness: 'syntrae_usefulness',
  sharedSyntrae: 'shared_syntrae'
});

function requireSupabaseConfig() {
  const supabaseUrl = resolveEnv(['SUPABASE_URL']);
  const serviceRoleKey = resolveEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY_LOCAL']);
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) {
    const error = new Error('Survey server configuration missing.');
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

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (!name || valueParts.length === 0) continue;
    cookies[name] = decodeURIComponent(valueParts.join('='));
  }
  return cookies;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return '';
  return email;
}

function cleanText(value) {
  const text = String(value || '').trim();
  if (text.length > MAX_TEXT_LENGTH) {
    const error = new Error(`Please keep each survey answer under ${MAX_TEXT_LENGTH.toLocaleString()} characters.`);
    error.status = 400;
    throw error;
  }
  return text || null;
}

function getSurveyAnswers(body) {
  const row = {};
  const source = body?.answers && typeof body.answers === 'object' ? body.answers : body || {};
  for (const [clientName, columnName] of Object.entries(ANSWER_FIELDS)) {
    row[columnName] = cleanText(source[clientName]);
  }
  return row;
}

async function findWaitlistRow(req, fallbackEmail) {
  const cookies = parseCookies(req.headers.cookie);
  const surveyToken = String(cookies[SURVEY_COOKIE_NAME] || '').trim();
  if (/^[A-Za-z0-9_-]{32,128}$/.test(surveyToken)) {
    const tokenHash = hashToken(surveyToken);
    const rows = await supabaseRest(
      `waitlist?survey_token_hash=eq.${tokenHash}&status=eq.verified&select=id,email,status&limit=1`
    );
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }

  const normalizedEmail = normalizeEmail(fallbackEmail);
  if (!normalizedEmail) return null;
  const rows = await supabaseRest(
    `waitlist?email=eq.${encodeURIComponent(normalizedEmail)}&status=eq.verified&select=id,email,status&limit=1`
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

function getRequestMeta(req) {
  return {
    user_agent: cleanText(req.headers['user-agent']),
    page_referrer: cleanText(req.headers.referer || req.headers.referrer)
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const fallbackEmail = req.body?.waitlistEmail || req.body?.email;
    const waitlistRow = await findWaitlistRow(req, fallbackEmail);
    if (!waitlistRow) {
      return res.status(403).json({
        error: 'Please join and confirm your founding email before submitting the survey.'
      });
    }

    const surveyRow = {
      waitlist_id: waitlistRow.id,
      waitlist_email: waitlistRow.email,
      ...getSurveyAnswers(req.body),
      ...getRequestMeta(req),
      updated_at: new Date().toISOString()
    };

    const rows = await supabaseRest('founding_survey_responses?on_conflict=waitlist_id&select=id,waitlist_email,updated_at', {
      method: 'POST',
      body: surveyRow,
      prefer: 'resolution=merge-duplicates,return=representation'
    });

    const saved = Array.isArray(rows) ? rows[0] : null;
    return res.status(200).json({
      ok: true,
      survey: true,
      linkedEmail: saved?.waitlist_email || waitlistRow.email
    });
  } catch (err) {
    console.error('founding survey submit failed:', err);
    const status = Number(err?.status) || 500;
    const error = status === 500 ? 'Could not submit the survey right now.' : err.message;
    return res.status(status).json({
      error,
      missing: err?.missing || undefined
    });
  }
};
