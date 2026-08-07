const dns = require('node:dns').promises;
const crypto = require('node:crypto');
const { resolveEnv } = require('./env-utils');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 20;
const EMAIL_LIMIT = 3;
const DOMAIN_LIMIT = 10;
const ADMIN_PAGE_SIZE = 200;
const WAITLIST_REFERRAL_RE = /^[a-z0-9_-]{1,64}$/i;
const SURVEY_COOKIE_NAME = 'syntrae_waitlist_survey';
const WAITLIST_SURVEY_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const ipHits = new Map();
const emailHits = new Map();
const domainHits = new Map();

// Minimal high-risk disposable domains. Extend over time as needed.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  '10minutemail.com',
  'guerrillamail.com',
  'tempmail.com',
  'yopmail.com',
  'trashmail.com',
  'sharklasers.com',
  'dispostable.com'
]);

function now() {
  return Date.now();
}

function sweep(map) {
  const cutoff = now() - WINDOW_MS;
  for (const [key, values] of map.entries()) {
    const kept = values.filter((ts) => ts > cutoff);
    if (kept.length === 0) map.delete(key);
    else map.set(key, kept);
  }
}

function hitAndCheck(map, key, max) {
  sweep(map);
  const values = map.get(key) || [];
  values.push(now());
  map.set(key, values);
  return values.length <= max;
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function getIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

async function findAuthUserByEmail(supabaseUrl, serviceRoleKey, email) {
  // Some Auth versions ignore ?email filter on admin/users, so we page and compare explicitly.
  for (let page = 1; ; page += 1) {
    const url = `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${ADMIN_PAGE_SIZE}`;
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`Admin lookup failed (${r.status}): ${txt}`);
    }
    const data = await r.json();
    const users = Array.isArray(data?.users) ? data.users : [];
    const match = users.find((user) => String(user.email || '').toLowerCase() === email);
    if (match) return match;
    if (users.length < ADMIN_PAGE_SIZE) {
      return null;
    }
  }
}

async function emailExists(supabaseUrl, serviceRoleKey, email) {
  return !!(await findAuthUserByEmail(supabaseUrl, serviceRoleKey, email));
}

function isTruthy(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function sanitizeReferralSource(value, fallback = 'founding_waitlist') {
  const text = String(value || '').trim();
  if (!text || !WAITLIST_REFERRAL_RE.test(text)) return fallback;
  return text.toLowerCase();
}

function compactMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
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

async function supabaseServiceRest(supabaseUrl, serviceRoleKey, path, { method = 'GET', body, prefer = 'return=representation' } = {}) {
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

function httpError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function findVerifiedWaitlistRow(req, supabaseUrl, serviceRoleKey, normalizedEmail) {
  const cookies = parseCookies(req.headers.cookie);
  const surveyToken = String(cookies[SURVEY_COOKIE_NAME] || '').trim();
  if (!WAITLIST_SURVEY_TOKEN_RE.test(surveyToken)) {
    throw httpError('Please confirm your waitlist email before creating an account.', 403, 'waitlist_not_verified');
  }

  const tokenHash = hashToken(surveyToken);
  const rows = await supabaseServiceRest(
    supabaseUrl,
    serviceRoleKey,
    `waitlist?survey_token_hash=eq.${tokenHash}&status=eq.verified&email=eq.${encodeURIComponent(normalizedEmail)}&select=id,email,full_name,status,user_id&limit=1`
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    throw httpError('Please use the same email address you confirmed for the founding waitlist.', 403, 'waitlist_not_verified');
  }
  return row;
}

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null
  };
}

function extractAuthUser(payload) {
  const user = payload?.user || payload;
  if (!user?.id) {
    throw httpError('Could not create the account right now.', 500, 'auth_user_missing');
  }
  return user;
}

async function createConfirmedAuthUser(supabaseUrl, serviceRoleKey, account) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: account.userMetadata,
      app_metadata: account.appMetadata
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || 'Sign-up failed';
    const duplicate = /already|exists|registered/i.test(message);
    throw httpError(duplicate ? 'This founding email already has a Syntrae account. Please sign in.' : message, duplicate ? 409 : response.status, duplicate ? 'email_exists' : 'auth_create_failed');
  }
  return extractAuthUser(payload);
}

async function upsertUserProfile(supabaseUrl, serviceRoleKey, userId, fullName) {
  const { firstName, lastName } = splitName(fullName);
  await supabaseServiceRest(supabaseUrl, serviceRoleKey, 'user_profiles?on_conflict=user_id', {
    method: 'POST',
    body: {
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      profile: {
        profile_completed: false,
        founding_waitlist: true
      },
      updated_at: new Date().toISOString()
    },
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

async function linkWaitlistUser(supabaseUrl, serviceRoleKey, waitlistId, userId, fullName) {
  const body = {
    user_id: userId,
    updated_at: new Date().toISOString()
  };
  if (fullName) body.full_name = fullName;
  await supabaseServiceRest(supabaseUrl, serviceRoleKey, `waitlist?id=eq.${encodeURIComponent(waitlistId)}`, {
    method: 'PATCH',
    body,
    prefer: 'return=minimal'
  });
}

function isDuplicateWaitlistError(status, text) {
  return status === 409 && /23505|duplicate key|waitlist.*email/i.test(text || '');
}

async function insertWaitlistEntry(supabaseUrl, apiKey, entry) {
  const url = `${supabaseUrl}/rest/v1/waitlist`;
  const row = {
    email: entry.email,
    referral_source: entry.referralSource,
    status: entry.status || 'pending',
    consent_to_updates: true
  };
  if (entry.fullName) row.full_name = entry.fullName;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(row)
  });

  if (!response.ok) {
    const txt = await response.text().catch(() => '');
    if (isDuplicateWaitlistError(response.status, txt)) {
      return { inserted: false, duplicate: true };
    }
    throw new Error(`Waitlist insert failed (${response.status}): ${txt}`);
  }

  return { inserted: true, duplicate: false };
}

function isDnsMissingError(err) {
  return ['ENOTFOUND', 'ENODATA', 'NODATA', 'ENONAME', 'NOTFOUND', 'NXDOMAIN'].includes(err?.code);
}

function isDnsTemporaryError(err) {
  return ['ETIMEOUT', 'SERVFAIL', 'EAI_AGAIN', 'REFUSED', 'TIMEOUT', 'ESERVFAIL'].includes(err?.code);
}

function isPlausibleEmail(email) {
  if (!EMAIL_RE.test(email)) return false;
  if (email.length > 254) return false;
  const [local, domain] = email.split('@');
  if (!local || !domain) return false;
  if (local.length > 64) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (domain.length > 253 || domain.includes('..')) return false;
  const labels = domain.split('.');
  if (labels.some((label) => !label || label.length > 63)) return false;
  if (labels.some((label) => label.startsWith('-') || label.endsWith('-'))) return false;
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,63}$/i.test(tld)) return false;
  return true;
}

async function domainHasAddressRecord(domain) {
  const [a4, a6] = await Promise.allSettled([dns.resolve4(domain), dns.resolve6(domain)]);
  const hasA4 = a4.status === 'fulfilled' && Array.isArray(a4.value) && a4.value.length > 0;
  const hasA6 = a6.status === 'fulfilled' && Array.isArray(a6.value) && a6.value.length > 0;
  if (hasA4 || hasA6) return { ok: true };

  const err4 = a4.status === 'rejected' ? a4.reason : null;
  const err6 = a6.status === 'rejected' ? a6.reason : null;
  const temporary = [err4, err6].some((err) => isDnsTemporaryError(err));
  if (temporary) return { ok: false, reason: 'dns-temporary' };
  return { ok: false, reason: 'missing' };
}

async function classifyEmailDomain(domain) {
  try {
    const records = await dns.resolveMx(domain);
    if (!Array.isArray(records) || records.length === 0) {
      const addressFallback = await domainHasAddressRecord(domain);
      if (addressFallback.ok) return { ok: true };
      if (addressFallback.reason === 'dns-temporary') return { ok: false, reason: 'unverifiable' };
      return { ok: false, reason: 'undeliverable' };
    }
    if (records.some((mx) => mx.exchange === '.')) {
      return { ok: false, reason: 'undeliverable' };
    }
    return { ok: true };
  } catch (err) {
    if (isDnsMissingError(err)) {
      const addressFallback = await domainHasAddressRecord(domain);
      if (addressFallback.ok) return { ok: true };
      if (addressFallback.reason === 'dns-temporary') return { ok: false, reason: 'unverifiable' };
      return { ok: false, reason: 'undeliverable' };
    }
    if (isDnsTemporaryError(err)) {
      return { ok: false, reason: 'unverifiable' };
    }
    return { ok: false, reason: 'unverifiable' };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { fullName, email, password, website, captchaToken, waitlist, waitlistVerified, referralSource, consentToUpdates } = req.body || {};
  const isWaitlistSignup = isTruthy(waitlist) || sanitizeReferralSource(referralSource, '') !== '';
  const isVerifiedWaitlistAccount = isTruthy(waitlistVerified);
  const supabaseUrl = resolveEnv(['SUPABASE_URL']);
  const anonKey = resolveEnv(['SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY_LOCAL']);
  const serviceRoleKey = resolveEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY_LOCAL']);
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  if (!isWaitlistSignup && !serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || (!isWaitlistSignup && !serviceRoleKey)) {
    return res.status(500).json({
      error: 'Server auth configuration missing',
      missing
    });
  }

  if (website) {
    // Honeypot field for simple bot traffic.
    return res.status(400).json({ error: 'Invalid request' });
  }
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  if (!isWaitlistSignup && (!fullName || !password || !captchaToken)) {
    return res.status(400).json({ error: 'fullName, email, password, and captchaToken are required' });
  }
  if (isWaitlistSignup && consentToUpdates === false) {
    return res.status(400).json({ error: 'Consent to updates is required to join the waitlist.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedName = String(fullName || '').trim();
  const trimmedPassword = password === undefined || password === null ? '' : String(password);
  const hasPassword = trimmedPassword.length > 0;
  const normalizedReferralSource = sanitizeReferralSource(referralSource, 'founding_waitlist');
  if (!isPlausibleEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!isWaitlistSignup && hasPassword && trimmedPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (!isWaitlistSignup && !hasPassword) {
    return res.status(400).json({ error: 'Password is required' });
  }

  const ip = getIp(req);
  if (!hitAndCheck(ipHits, ip, IP_LIMIT)) {
    return res.status(429).json({ error: 'Too many sign-up attempts. Please try again later.' });
  }
  if (!hitAndCheck(emailHits, normalizedEmail, EMAIL_LIMIT)) {
    return res.status(429).json({ error: 'Too many attempts for this email. Please try again later.' });
  }

  const [, domain = ''] = normalizedEmail.split('@');
  if (!hitAndCheck(domainHits, domain, DOMAIN_LIMIT)) {
    return res.status(429).json({ error: 'Too many attempts for this email domain. Please try again later.' });
  }
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return res.status(400).json({ error: 'Disposable email domains are not allowed.' });
  }
  const domainStatus = await classifyEmailDomain(domain);
  if (!domainStatus.ok) {
    if (domainStatus.reason === 'undeliverable') {
      return res.status(400).json({ error: 'This email domain cannot receive mail.' });
    }
    return res.status(503).json({ error: 'Email domain could not be verified right now. Please try again.' });
  }

  let verifiedWaitlistRow = null;
  try {
    if (!isWaitlistSignup) {
      if (isVerifiedWaitlistAccount) {
        verifiedWaitlistRow = await findVerifiedWaitlistRow(req, supabaseUrl, serviceRoleKey, normalizedEmail);
        if (verifiedWaitlistRow.user_id) {
          return res.status(409).json({
            code: 'email_exists',
            error: 'This founding email already has a Syntrae account. Please sign in.'
          });
        }
      }

      const existingUser = await findAuthUserByEmail(supabaseUrl, serviceRoleKey, normalizedEmail);
      if (existingUser) {
        return res.status(409).json({ code: 'email_exists', error: 'This account already exists.' });
      }
    }
  } catch (err) {
    if (err?.status && err.status < 500) {
      return res.status(err.status).json({ code: err.code, error: err.message });
    }
    console.error('register email lookup failed:', err);
    return res.status(500).json({ error: 'Could not verify email right now.' });
  }

  const emailRedirectTo = `${getOrigin(req)}/sign-in.html?verified=true`;

  const waitlistEntry = {
    email: normalizedEmail,
    fullName: normalizedName,
    referralSource: normalizedReferralSource,
    status: 'pending'
  };

  try {
    if (isWaitlistSignup) {
      const waitlistResult = await insertWaitlistEntry(supabaseUrl, anonKey, waitlistEntry);
      return res.status(200).json({
        ok: true,
        waitlist: true,
        stored: true,
        alreadyJoined: !!waitlistResult.duplicate,
        requiresEmailConfirmation: false
      });
    }

    if (isVerifiedWaitlistAccount) {
      const userMetadata = compactMetadata({
        full_name: normalizedName || verifiedWaitlistRow?.full_name,
        profile_completed: false,
        waitlist: true,
        referral_source: 'founding_form',
        waitlist_id: verifiedWaitlistRow?.id ? String(verifiedWaitlistRow.id) : undefined
      });
      const authUser = await createConfirmedAuthUser(supabaseUrl, serviceRoleKey, {
        email: normalizedEmail,
        password: trimmedPassword,
        userMetadata,
        appMetadata: {
          founding_waitlist: true,
          waitlist_id: verifiedWaitlistRow?.id ? String(verifiedWaitlistRow.id) : undefined
        }
      });
      await linkWaitlistUser(supabaseUrl, serviceRoleKey, verifiedWaitlistRow.id, authUser.id, normalizedName);
      await upsertUserProfile(supabaseUrl, serviceRoleKey, authUser.id, normalizedName || verifiedWaitlistRow?.full_name || '');

      return res.status(200).json({
        ok: true,
        waitlist: false,
        accountCreated: true,
        autoSignIn: true,
        requiresEmailConfirmation: false,
        redirectTo: '/founding-welcome.html?verified=true'
      });
    }

    const signupKey = anonKey;
    const signupUrl = `${supabaseUrl}/auth/v1/signup?redirect_to=${encodeURIComponent(emailRedirectTo)}`;
    const userMetadata = compactMetadata({
      full_name: normalizedName,
      profile_completed: false,
      waitlist: isWaitlistSignup,
      referral_source: isWaitlistSignup ? normalizedReferralSource : undefined
    });
    const signupBody = {
      email: normalizedEmail,
      password: trimmedPassword,
      data: userMetadata,
      options: {
        data: userMetadata
      }
    };
    if (captchaToken) {
      signupBody.gotrue_meta_security = {
        captcha_token: String(captchaToken)
      };
      signupBody.options.captchaToken = String(captchaToken);
    }

    const signupRes = await fetch(signupUrl, {
      method: 'POST',
      headers: {
        apikey: signupKey,
        Authorization: `Bearer ${signupKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(signupBody)
    });

    const payload = await signupRes.json().catch(() => ({}));
    if (!signupRes.ok) {
      const message = payload?.msg || payload?.error_description || payload?.error || 'Sign-up failed';
      return res.status(signupRes.status).json({ error: message });
    }

    return res.status(200).json({
      ok: true,
      waitlist: false,
      requiresEmailConfirmation: !payload?.session
    });
  } catch (err) {
    console.error('register signup failed:', err);
    const status = Number(err?.status) || 500;
    if (status < 500) {
      return res.status(status).json({ code: err?.code, error: err.message || 'Could not complete sign-up right now.' });
    }
    return res.status(500).json({ error: 'Could not complete sign-up right now.' });
  }
};
