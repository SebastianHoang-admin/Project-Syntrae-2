const {
  sanitizePersonaKey,
  parseJsonBody,
  getAccessToken,
  getOrigin,
  getSupabaseConfig,
  fetchSupabaseUser,
  fetchPersonaForUser,
  supabaseAdminRequest,
  stripeRequest,
  safeStripeErrorMessage
} = require('../_billing-common');

async function fetchBillingCustomerByUserId({ supabaseUrl, serviceRoleKey, userId }) {
  const result = await supabaseAdminRequest({
    supabaseUrl,
    serviceRoleKey,
    table: 'billing_customers',
    query: `user_id=eq.${encodeURIComponent(userId)}&select=stripe_customer_id&limit=1`
  });
  if (!result.ok || !Array.isArray(result.body) || !result.body.length) return null;
  return result.body[0];
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, missing: supabaseMissing } = getSupabaseConfig({
    requireServiceRole: true
  });
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const appBaseUrl = process.env.APP_BASE_URL;
  const missing = [...supabaseMissing];
  if (!stripeSecretKey) missing.push('STRIPE_SECRET_KEY');
  if (missing.length) {
    return res.status(500).json({ error: 'Billing configuration missing', missing });
  }

  const accessToken = getAccessToken(req);
  if (!accessToken) {
    return res.status(401).json({ error: 'Missing authenticated session token' });
  }
  const userResult = await fetchSupabaseUser(supabaseUrl, supabaseAnonKey, accessToken);
  if (!userResult.ok || !userResult.user) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
  const user = userResult.user;

  const body = parseJsonBody(req);
  const personaKey = sanitizePersonaKey(body?.personaKey);
  if (!personaKey) {
    return res.status(400).json({ error: 'personaKey is required' });
  }

  const persona = await fetchPersonaForUser({
    supabaseUrl,
    anonKey: supabaseAnonKey,
    accessToken,
    userId: user.id,
    personaKey
  });
  if (!persona?.id) {
    return res.status(404).json({ code: 'persona_not_found', error: 'Persona not found' });
  }

  const customerRow = await fetchBillingCustomerByUserId({
    supabaseUrl,
    serviceRoleKey: supabaseServiceRoleKey,
    userId: user.id
  });
  if (!customerRow?.stripe_customer_id) {
    return res.status(404).json({ code: 'billing_customer_not_found', error: 'No billing profile found yet.' });
  }

  const baseUrl = String(appBaseUrl || getOrigin(req) || '').replace(/\/+$/, '');
  if (!baseUrl) {
    return res.status(500).json({ error: 'Could not determine app base URL.' });
  }

  const form = new URLSearchParams();
  form.set('customer', String(customerRow.stripe_customer_id));
  form.set('return_url', `${baseUrl}/Chat.html?persona=${encodeURIComponent(personaKey)}&billing=portal`);

  const portalResult = await stripeRequest({
    secretKey: stripeSecretKey,
    path: '/v1/billing_portal/sessions',
    method: 'POST',
    form
  });

  if (!portalResult.ok || !portalResult.body?.url) {
    return res.status(500).json({
      error: safeStripeErrorMessage(portalResult, 'Could not create billing portal session')
    });
  }

  return res.status(200).json({
    url: portalResult.body.url
  });
};
