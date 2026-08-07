const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const { resolveEnv } = require('./env-utils');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WAITLIST_REFERRAL_RE = /^[a-z0-9_:-]{1,80}$/i;
const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 20;
const EMAIL_LIMIT = 3;
const DOMAIN_LIMIT = 15;
const VERIFY_TTL_HOURS = 48;
const PENDING_RETENTION_DAYS = 30;
const DEFAULT_EMAIL_LOGO_URL = 'https://www.syntrae.app/assets/syntrae-logo.png';
const ipHits = new Map();
const emailHits = new Map();
const domainHits = new Map();

const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com',
  'dispostable.com',
  'getnada.com',
  'guerrillamail.com',
  'mailinator.com',
  'sharklasers.com',
  'tempmail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com'
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

function getIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function getPublicOrigin(req) {
  const requestOrigin = getOrigin(req);
  const configured = resolveEnv(['SITE_URL', 'PUBLIC_SITE_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL']);
  if (!configured) return requestOrigin;
  const normalized = configured.startsWith('http') ? configured : `https://${configured}`;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(requestOrigin)) return requestOrigin;
  return normalized.replace(/\/+$/, '');
}

function isLocalRequest(req) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(getOrigin(req));
}

function normalizeReferralSource(value) {
  const text = String(value || '').trim();
  if (!text || !WAITLIST_REFERRAL_RE.test(text)) return 'founding_waitlist';
  return text.toLowerCase();
}

function isTruthy(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function isPlausibleEmail(email) {
  if (!EMAIL_RE.test(email)) return false;
  if (email.length > 254) return false;
  const [local, domain] = email.split('@');
  if (!local || !domain) return false;
  if (local.length > 64 || domain.length > 253) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (/^(.)\1{5,}$/.test(local)) return false;
  const labels = domain.split('.');
  if (labels.some((label) => !label || label.length > 63)) return false;
  if (labels.some((label) => label.startsWith('-') || label.endsWith('-'))) return false;
  const tld = labels[labels.length - 1];
  return /^[a-z]{2,63}$/i.test(tld);
}

function isDnsMissingError(err) {
  return ['ENOTFOUND', 'ENODATA', 'NODATA', 'ENONAME', 'NOTFOUND', 'NXDOMAIN'].includes(err?.code);
}

function isDnsTemporaryError(err) {
  return ['ETIMEOUT', 'SERVFAIL', 'EAI_AGAIN', 'REFUSED', 'TIMEOUT', 'ESERVFAIL'].includes(err?.code);
}

async function domainHasAddressRecord(domain) {
  const [a4, a6] = await Promise.allSettled([dns.resolve4(domain), dns.resolve6(domain)]);
  const hasA4 = a4.status === 'fulfilled' && Array.isArray(a4.value) && a4.value.length > 0;
  const hasA6 = a6.status === 'fulfilled' && Array.isArray(a6.value) && a6.value.length > 0;
  if (hasA4 || hasA6) return { ok: true };

  const temporary = [a4, a6].some((result) => result.status === 'rejected' && isDnsTemporaryError(result.reason));
  if (temporary) return { ok: true, reason: 'dns_unchecked' };
  return { ok: false, reason: 'undeliverable' };
}

async function classifyEmailDomain(domain) {
  if (DISPOSABLE_DOMAINS.has(domain)) return { ok: false, reason: 'disposable' };

  try {
    const records = await dns.resolveMx(domain);
    if (Array.isArray(records) && records.length > 0 && !records.some((mx) => mx.exchange === '.')) {
      return { ok: true };
    }
    return domainHasAddressRecord(domain);
  } catch (err) {
    if (isDnsMissingError(err)) return domainHasAddressRecord(domain);
    if (isDnsTemporaryError(err)) return { ok: true, reason: 'dns_unchecked' };
    return { ok: true, reason: 'dns_unchecked' };
  }
}

function requireSupabaseConfig() {
  const supabaseUrl = resolveEnv(['SUPABASE_URL']);
  const serviceRoleKey = resolveEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY_LOCAL']);
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) {
    const error = new Error('Waitlist server configuration missing.');
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

async function cleanupExpiredPending() {
  const cutoff = new Date(now() - PENDING_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await supabaseRest(`waitlist?status=eq.pending&created_at=lt.${encodeURIComponent(cutoff)}`, {
    method: 'DELETE',
    prefer: 'return=minimal'
  });
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function createVerificationToken(req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const verificationUrl = new URL('/api/waitlist-verify', getPublicOrigin(req));
  verificationUrl.searchParams.set('token', token);
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now() + VERIFY_TTL_HOURS * 60 * 60 * 1000).toISOString(),
    verificationUrl: verificationUrl.toString()
  };
}

function escapeHtml(value) {
  const entities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return String(value).replace(/[&<>"']/g, (char) => entities[char]);
}

function getEmailAssetUrl(baseUrl, assetPath) {
  try {
    return new URL(assetPath, baseUrl).toString();
  } catch (_) {
    return assetPath;
  }
}

function getEmailLogoUrl(baseUrl) {
  const configured = resolveEnv(['WAITLIST_EMAIL_LOGO_URL', 'SYNTRAE_EMAIL_LOGO_URL', 'PUBLIC_LOGO_URL']);
  if (!configured) return DEFAULT_EMAIL_LOGO_URL;
  if (configured.startsWith('http')) return configured;
  const assetPath = configured.startsWith('/') ? configured : `/${configured}`;
  return getEmailAssetUrl(baseUrl, assetPath);
}

async function getWaitlistRow(email) {
  const rows = await supabaseRest(`waitlist?email=eq.${encodeURIComponent(email)}&select=id,status`, {
    prefer: 'return=representation'
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertPendingWaitlistRow({ email, fullName, referralSource, tokenHash, expiresAt }) {
  const existing = await getWaitlistRow(email);
  if (existing?.status === 'verified') {
    return { row: existing, alreadyVerified: true };
  }

  const row = {
    email,
    full_name: fullName || null,
    referral_source: referralSource,
    status: 'pending',
    consent_to_updates: true,
    verification_token_hash: tokenHash,
    verification_sent_at: new Date().toISOString(),
    verification_expires_at: expiresAt,
    updated_at: new Date().toISOString()
  };

  if (existing) {
    const rows = await supabaseRest(`waitlist?email=eq.${encodeURIComponent(email)}&select=id,status`, {
      method: 'PATCH',
      body: row
    });
    return { row: Array.isArray(rows) ? rows[0] : existing, alreadyVerified: false };
  }

  const rows = await supabaseRest('waitlist?select=id,status', {
    method: 'POST',
    body: row
  });
  return { row: Array.isArray(rows) ? rows[0] : null, alreadyVerified: false };
}

async function sendConfirmationEmail({ email, fullName, verificationUrl }) {
  const apiKey = resolveEnv(['RESEND_API_KEY', 'RESEND_API_KEY_LOCAL']);
  if (!apiKey) {
    return { sent: false, reason: 'missing_email_provider' };
  }

  const from = resolveEnv(['WAITLIST_FROM_EMAIL', 'SYNTRAE_FROM_EMAIL', 'RESEND_FROM_EMAIL']) || 'Syntrae <hello@syntrae.app>';
  const firstName = String(fullName || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const safeGreeting = escapeHtml(greeting);
  const safeVerificationUrl = escapeHtml(verificationUrl);
  const safeLogoUrl = escapeHtml(getEmailLogoUrl(verificationUrl));
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Confirm your Syntrae waitlist email',
      html: `
        <!doctype html>
        <html>
          <body style="margin:0;background:#f6faf6;padding:0;font-family:Inter,Arial,sans-serif;color:#203236;">
            <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
              Confirm your email to join the Syntrae waitlist.
            </div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6faf6;padding:36px 16px;">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dce9e3;border-radius:18px;overflow:hidden;box-shadow:0 18px 46px rgba(31,74,68,0.12);">
                    <tr>
                      <td style="padding:34px 34px 18px;text-align:center;background:#fbfdf8;">
                        <img src="${safeLogoUrl}" width="168" alt="Syntrae - Less guessing. More caring." style="display:block;margin:0 auto 18px;max-width:168px;height:auto;border:0;">
                        <p style="margin:0;color:#218879;font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">Founding Waitlist</p>
                        <h1 style="margin:12px 0 0;color:#203236;font-size:30px;line-height:1.15;font-weight:800;">Confirm your Syntrae waitlist email</h1>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:8px 34px 34px;">
                        <p style="margin:0 0 16px;color:#506865;font-size:16px;line-height:1.65;">${safeGreeting}</p>
                        <p style="margin:0 0 18px;color:#506865;font-size:16px;line-height:1.65;">Please confirm this email to finish joining the Syntrae waitlist for romantic relationship decision tools.</p>
                        <p style="margin:0 0 26px;color:#506865;font-size:16px;line-height:1.65;">After confirmation, you will be on the verified list for early Syntrae updates, product previews, and optional feedback invitations.</p>
                        <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 26px;">
                          <tr>
                            <td style="border-radius:10px;background:#f3c94f;box-shadow:0 8px 20px rgba(243,201,79,0.28);">
                              <a href="${safeVerificationUrl}" style="display:inline-block;padding:14px 24px;color:#203236;font-size:15px;font-weight:800;text-decoration:none;border-radius:10px;">Confirm my email</a>
                            </td>
                          </tr>
                        </table>
                        <div style="background:#ecf8f4;border:1px solid #cbe7df;border-radius:12px;padding:14px 16px;margin:0 0 18px;">
                          <p style="margin:0;color:#3f5f5a;font-size:14px;line-height:1.55;">This link expires in ${VERIFY_TTL_HOURS} hours. If you did not request this, you can safely ignore this email.</p>
                        </div>
                        <p style="margin:0 0 8px;color:#6b7c79;font-size:13px;line-height:1.55;">If the button does not work, open this link:</p>
                        <p style="margin:0;word-break:break-all;font-size:13px;line-height:1.55;"><a href="${safeVerificationUrl}" style="color:#1b8174;text-decoration:underline;">${safeVerificationUrl}</a></p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:20px 34px;background:#f0f8f4;border-top:1px solid #dce9e3;text-align:center;">
                        <p style="margin:0;color:#506865;font-size:13px;line-height:1.5;font-weight:700;">Syntrae LLC</p>
                        <p style="margin:4px 0 0;color:#7c8b88;font-size:12px;line-height:1.5;">Less guessing. More caring.</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
      text: `${greeting}\n\nPlease confirm this email to finish joining the Syntrae waitlist for romantic relationship decision tools:\n${verificationUrl}\n\nThis link expires in ${VERIFY_TTL_HOURS} hours. If you did not request this, you can ignore this email.\n\nSyntrae LLC\nLess guessing. More caring.`
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error('Could not send confirmation email right now.');
    error.status = 502;
    error.body = text;
    throw error;
  }

  return { sent: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { fullName, email, website, referralSource, consentToUpdates } = req.body || {};
    if (website) return res.status(400).json({ error: 'Invalid request.' });
    if (!isTruthy(consentToUpdates)) {
      return res.status(400).json({ error: 'Consent to updates is required to join the waitlist.' });
    }

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedName = String(fullName || '').trim();
    const normalizedReferralSource = normalizeReferralSource(referralSource);
    if (!normalizedEmail) return res.status(400).json({ error: 'Email is required.' });
    if (!isPlausibleEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (normalizedName.length > 120) {
      return res.status(400).json({ error: 'Please keep your name under 120 characters.' });
    }

    const ip = getIp(req);
    const [, domain = ''] = normalizedEmail.split('@');
    if (!hitAndCheck(ipHits, ip, IP_LIMIT)) {
      return res.status(429).json({ error: 'Too many sign-up attempts. Please try again later.' });
    }
    if (!hitAndCheck(emailHits, normalizedEmail, EMAIL_LIMIT)) {
      return res.status(429).json({ error: 'Too many attempts for this email. Please try again later.' });
    }
    if (!hitAndCheck(domainHits, domain, DOMAIN_LIMIT)) {
      return res.status(429).json({ error: 'Too many attempts for this email domain. Please try again later.' });
    }

    const domainStatus = await classifyEmailDomain(domain);
    if (!domainStatus.ok) {
      if (domainStatus.reason === 'disposable') {
        return res.status(400).json({ error: 'Disposable email domains are not allowed.' });
      }
      if (domainStatus.reason === 'undeliverable') {
        return res.status(400).json({ error: 'This email domain cannot receive mail.' });
      }
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    await cleanupExpiredPending().catch((error) => {
      console.warn('waitlist opportunistic cleanup failed:', error?.message || error);
    });

    const verification = createVerificationToken(req);
    const result = await upsertPendingWaitlistRow({
      email: normalizedEmail,
      fullName: normalizedName,
      referralSource: normalizedReferralSource,
      tokenHash: verification.tokenHash,
      expiresAt: verification.expiresAt
    });

    if (result.alreadyVerified) {
      return res.status(200).json({
        ok: true,
        waitlist: true,
        status: 'verified',
        requiresEmailConfirmation: false
      });
    }

    const emailResult = await sendConfirmationEmail({
      email: normalizedEmail,
      fullName: normalizedName,
      verificationUrl: verification.verificationUrl
    });

    if (!emailResult.sent && !isLocalRequest(req)) {
      return res.status(500).json({ error: 'Confirmation email service is not configured yet.' });
    }

    const payload = {
      ok: true,
      waitlist: true,
      status: 'pending',
      requiresEmailConfirmation: true,
      emailSent: emailResult.sent
    };

    if (!emailResult.sent && isLocalRequest(req)) {
      payload.devVerificationUrl = verification.verificationUrl;
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error('waitlist signup failed:', err);
    const status = Number(err?.status) || 500;
    const error = status === 500 ? 'Could not complete waitlist sign-up right now.' : err.message;
    return res.status(status).json({
      error,
      missing: err?.missing || undefined
    });
  }
};
