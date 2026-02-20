const dns = require('node:dns').promises;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 20;
const EMAIL_LIMIT = 3;
const DOMAIN_LIMIT = 10;
const ADMIN_PAGE_SIZE = 200;
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

async function emailExists(supabaseUrl, serviceRoleKey, email) {
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
    if (users.some((user) => String(user.email || '').toLowerCase() === email)) {
      return true;
    }
    if (users.length < ADMIN_PAGE_SIZE) {
      return false;
    }
  }
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

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY_LOCAL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY_LOCAL;
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Server auth configuration missing',
      missing
    });
  }

  const { fullName, email, password, website, captchaToken } = req.body || {};
  if (website) {
    // Honeypot field for simple bot traffic.
    return res.status(400).json({ error: 'Invalid request' });
  }
  if (!fullName || !email || !password || !captchaToken) {
    return res.status(400).json({ error: 'fullName, email, password, and captchaToken are required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedName = String(fullName).trim();
  const trimmedPassword = String(password);
  if (!isPlausibleEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (trimmedPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
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

  try {
    const exists = await emailExists(supabaseUrl, serviceRoleKey, normalizedEmail);
    if (exists) {
      return res.status(409).json({ code: 'email_exists', error: 'This account already exists.' });
    }
  } catch (err) {
    console.error('register email lookup failed:', err);
    return res.status(500).json({ error: 'Could not verify email right now.' });
  }

  const emailRedirectTo = `${getOrigin(req)}/sign-in.html?verified=true`;

  try {
    const signupKey = anonKey || serviceRoleKey;
    const signupUrl = `${supabaseUrl}/auth/v1/signup?redirect_to=${encodeURIComponent(emailRedirectTo)}`;
    const signupRes = await fetch(signupUrl, {
      method: 'POST',
      headers: {
        apikey: signupKey,
        Authorization: `Bearer ${signupKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: normalizedEmail,
        password: trimmedPassword,
        gotrue_meta_security: {
          captcha_token: String(captchaToken)
        },
        options: {
          data: { full_name: normalizedName, profile_completed: false },
          captchaToken: String(captchaToken)
        }
      })
    });

    const payload = await signupRes.json().catch(() => ({}));
    if (!signupRes.ok) {
      const message = payload?.msg || payload?.error_description || payload?.error || 'Sign-up failed';
      return res.status(signupRes.status).json({ error: message });
    }

    return res.status(200).json({
      ok: true,
      requiresEmailConfirmation: !payload?.session
    });
  } catch (err) {
    console.error('register signup failed:', err);
    return res.status(500).json({ error: 'Could not complete sign-up right now.' });
  }
};
