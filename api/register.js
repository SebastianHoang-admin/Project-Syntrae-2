const dns = require('node:dns').promises;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 20;
const EMAIL_LIMIT = 3;
const ipHits = new Map();
const emailHits = new Map();

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
  const url = `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`;
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
  return Array.isArray(data?.users) && data.users.length > 0;
}

async function domainHasMx(domain) {
  try {
    const records = await dns.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
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

  const { fullName, email, password, website } = req.body || {};
  if (website) {
    // Honeypot field for simple bot traffic.
    return res.status(400).json({ error: 'Invalid request' });
  }
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'fullName, email, and password are required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedName = String(fullName).trim();
  const trimmedPassword = String(password);
  if (!EMAIL_RE.test(normalizedEmail)) {
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
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return res.status(400).json({ error: 'Disposable email domains are not allowed.' });
  }
  const hasMx = await domainHasMx(domain);
  if (!hasMx) {
    return res.status(400).json({ error: 'Email domain is not configured to receive mail.' });
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
    const signupRes = await fetch(`${supabaseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        apikey: signupKey,
        Authorization: `Bearer ${signupKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: normalizedEmail,
        password: trimmedPassword,
        options: {
          data: { full_name: normalizedName, profile_completed: false },
          emailRedirectTo
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
