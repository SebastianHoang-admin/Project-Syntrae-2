const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 20;
const EMAIL_LIMIT = 5;
const ADMIN_PAGE_SIZE = 200;
const ipHits = new Map();
const emailHits = new Map();

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

function getIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function getRequestHost(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
}

function getOrigin(req, clientOrigin) {
  const requestHost = getRequestHost(req);
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim();
  const fallbackProto = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
  const fallbackOrigin = requestHost ? `${fallbackProto}://${requestHost}` : '';

  // Accept client origin only if it matches this request host.
  if (typeof clientOrigin === 'string' && clientOrigin.trim()) {
    try {
      const parsed = new URL(clientOrigin.trim());
      const validProtocol = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      const sameHost = !requestHost || parsed.host.toLowerCase() === requestHost.toLowerCase();
      if (validProtocol && sameHost) {
        return parsed.origin;
      }
    } catch (_) {
      // Fall back to request headers.
    }
  }

  return fallbackOrigin;
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

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  if (typeof req.body !== 'string') return {};
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

async function emailExists(supabaseUrl, serviceRoleKey, email) {
  for (let page = 1; ; page += 1) {
    const url = `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${ADMIN_PAGE_SIZE}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Admin lookup failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    const users = Array.isArray(data?.users) ? data.users : [];
    if (users.some((user) => String(user.email || '').toLowerCase() === email)) {
      return true;
    }
    if (users.length < ADMIN_PAGE_SIZE) {
      return false;
    }
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY_LOCAL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY_LOCAL;
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  if (missing.length > 0) {
    return res.status(500).json({
      error: 'Server auth configuration missing',
      missing
    });
  }

  const body = parseBody(req);
  const normalizedEmail = String(body.email || '').trim().toLowerCase();
  const captchaToken = String(body.captchaToken || '').trim();
  const clientOrigin = String(body.origin || '').trim();
  if (!normalizedEmail || !captchaToken) {
    return res.status(400).json({ error: 'email and captchaToken are required' });
  }
  if (!isPlausibleEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const ip = getIp(req);
  if (!hitAndCheck(ipHits, ip, IP_LIMIT) || !hitAndCheck(emailHits, normalizedEmail, EMAIL_LIMIT)) {
    return res.status(429).json({ error: 'Too many reset attempts. Please try again later.' });
  }

  // If service role is available, skip sending for unknown emails to reduce outbound email load.
  if (serviceRoleKey) {
    try {
      const exists = await emailExists(supabaseUrl, serviceRoleKey, normalizedEmail);
      if (!exists) {
        return res.status(200).json({ ok: true });
      }
    } catch (err) {
      // Do not block recovery on lookup issues. Recover endpoint itself is enumeration-safe.
      console.error('password-recovery lookup failed:', err);
    }
  }

  const origin = getOrigin(req, clientOrigin);
  if (!origin) {
    return res.status(500).json({ error: 'Could not determine redirect origin.' });
  }
  const redirectTo = `${origin.replace(/\/+$/, '')}/reset-password.html`;
  const recoverUrl = `${supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`;

  try {
    const response = await fetch(recoverUrl, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: normalizedEmail,
        captcha_token: captchaToken,
        gotrue_meta_security: {
          captcha_token: captchaToken
        }
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.msg || payload?.error_description || payload?.error || 'Password recovery failed';
      return res.status(response.status).json({ error: message });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('password-recovery send failed:', err);
    return res.status(500).json({ error: 'Could not request password reset right now.' });
  }
};
