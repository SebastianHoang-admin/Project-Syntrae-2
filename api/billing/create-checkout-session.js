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

const ACTIVE_LIKE_STATUSES = new Set(['trialing', 'active', 'past_due', 'unpaid', 'incomplete']);

function getStripeConfig() {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripePriceId = process.env.STRIPE_PRICE_PERSONA_MONTHLY_USD;
  const appBaseUrl = process.env.APP_BASE_URL;
  const missing = [];
  if (!stripeSecretKey) missing.push('STRIPE_SECRET_KEY');
  if (!stripePriceId) missing.push('STRIPE_PRICE_PERSONA_MONTHLY_USD');
  return { stripeSecretKey, stripePriceId, appBaseUrl, missing };
}

async function fetchBillingCustomerByUserId({ supabaseUrl, serviceRoleKey, userId }) {
  const result = await supabaseAdminRequest({
    supabaseUrl,
    serviceRoleKey,
    table: 'billing_customers',
    query: `user_id=eq.${encodeURIComponent(userId)}&select=user_id,stripe_customer_id,trial_consumed_at&limit=1`
  });
  if (!result.ok || !Array.isArray(result.body) || !result.body.length) return null;
  return result.body[0];
}

async function ensureStripeCustomer({ stripeSecretKey, user, existingCustomerId }) {
  if (existingCustomerId) return existingCustomerId;

  const form = new URLSearchParams();
  if (user?.email) form.set('email', String(user.email));
  form.set('metadata[user_id]', String(user.id));

  const created = await stripeRequest({
    secretKey: stripeSecretKey,
    path: '/v1/customers',
    method: 'POST',
    form
  });

  if (!created.ok || !created.body?.id) {
    throw new Error(safeStripeErrorMessage(created, 'Could not create Stripe customer'));
  }
  return created.body.id;
}

async function fetchPersonaSubscription({ supabaseUrl, serviceRoleKey, personaId, userId }) {
  const result = await supabaseAdminRequest({
    supabaseUrl,
    serviceRoleKey,
    table: 'persona_subscriptions',
    query: [
      `persona_id=eq.${encodeURIComponent(personaId)}`,
      `user_id=eq.${encodeURIComponent(userId)}`,
      'select=status,cancel_at_period_end,stripe_subscription_id,current_period_end',
      'limit=1'
    ].join('&')
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
  const { stripeSecretKey, stripePriceId, appBaseUrl, missing: stripeMissing } = getStripeConfig();
  const missing = [...supabaseMissing, ...stripeMissing];
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

  const existingSubscription = await fetchPersonaSubscription({
    supabaseUrl,
    serviceRoleKey: supabaseServiceRoleKey,
    personaId: persona.id,
    userId: user.id
  });
  if (existingSubscription) {
    const status = String(existingSubscription.status || '').toLowerCase();
    if (ACTIVE_LIKE_STATUSES.has(status)) {
      return res.status(409).json({
        code: 'already_subscribed',
        error: 'This persona already has a subscription in progress or active.'
      });
    }
  }

  const billingCustomer = await fetchBillingCustomerByUserId({
    supabaseUrl,
    serviceRoleKey: supabaseServiceRoleKey,
    userId: user.id
  });
  const stripeCustomerId = await ensureStripeCustomer({
    stripeSecretKey,
    user,
    existingCustomerId: billingCustomer?.stripe_customer_id || ''
  });

  if (!billingCustomer?.stripe_customer_id) {
    const insertResult = await supabaseAdminRequest({
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      table: 'billing_customers',
      query: 'on_conflict=user_id',
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        user_id: user.id,
        stripe_customer_id: stripeCustomerId
      }
    });
    if (!insertResult.ok) {
      return res.status(500).json({
        error: safeStripeErrorMessage(insertResult, 'Could not persist billing customer')
      });
    }
  }

  const trialEligible = !billingCustomer?.trial_consumed_at;
  const baseUrl = String(appBaseUrl || getOrigin(req) || '').replace(/\/+$/, '');
  if (!baseUrl) {
    return res.status(500).json({ error: 'Could not determine app base URL.' });
  }
  const successUrl =
    `${baseUrl}/Chat.html?persona=${encodeURIComponent(personaKey)}&billing=success`;
  const cancelUrl =
    `${baseUrl}/Chat.html?persona=${encodeURIComponent(personaKey)}&billing=cancel`;

  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('customer', stripeCustomerId);
  form.set('success_url', successUrl);
  form.set('cancel_url', cancelUrl);
  form.set('payment_method_types[0]', 'card');
  form.set('line_items[0][price]', stripePriceId);
  form.set('line_items[0][quantity]', '1');
  form.set('metadata[user_id]', String(user.id));
  form.set('metadata[persona_id]', String(persona.id));
  form.set('metadata[persona_key]', String(persona.persona_key || personaKey));
  form.set('subscription_data[metadata][user_id]', String(user.id));
  form.set('subscription_data[metadata][persona_id]', String(persona.id));
  form.set('subscription_data[metadata][persona_key]', String(persona.persona_key || personaKey));
  if (trialEligible) {
    form.set('subscription_data[trial_period_days]', '30');
  }

  const sessionResult = await stripeRequest({
    secretKey: stripeSecretKey,
    path: '/v1/checkout/sessions',
    method: 'POST',
    form
  });

  if (!sessionResult.ok || !sessionResult.body?.url) {
    return res.status(500).json({
      error: safeStripeErrorMessage(sessionResult, 'Could not create checkout session')
    });
  }

  return res.status(200).json({
    id: sessionResult.body.id,
    url: sessionResult.body.url,
    trialApplied: trialEligible
  });
};
