const {
  toIso,
  getSupabaseConfig,
  supabaseAdminRequest,
  stripeRequest,
  verifyStripeSignature,
  readRawBody,
  safeStripeErrorMessage
} = require('../_billing-common');

function extractPriceId(subscription) {
  const price = subscription?.items?.data?.[0]?.price?.id;
  return price ? String(price) : '';
}

async function findSubscriptionByStripeId({ supabaseUrl, serviceRoleKey, stripeSubscriptionId }) {
  const result = await supabaseAdminRequest({
    supabaseUrl,
    serviceRoleKey,
    table: 'persona_subscriptions',
    query: [
      `stripe_subscription_id=eq.${encodeURIComponent(stripeSubscriptionId)}`,
      'select=persona_id,user_id,stripe_price_id,stripe_customer_id',
      'limit=1'
    ].join('&')
  });
  if (!result.ok || !Array.isArray(result.body) || !result.body.length) return null;
  return result.body[0];
}

async function getEventAlreadyProcessed({ supabaseUrl, serviceRoleKey, eventId }) {
  const result = await supabaseAdminRequest({
    supabaseUrl,
    serviceRoleKey,
    table: 'billing_webhook_events',
    query: `stripe_event_id=eq.${encodeURIComponent(eventId)}&select=stripe_event_id&limit=1`
  });
  return result.ok && Array.isArray(result.body) && result.body.length > 0;
}

async function recordWebhookEvent({ supabaseUrl, serviceRoleKey, eventId, eventType }) {
  return supabaseAdminRequest({
    supabaseUrl,
    serviceRoleKey,
    table: 'billing_webhook_events',
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      stripe_event_id: eventId,
      event_type: eventType
    }
  });
}

async function upsertBillingCustomer({ supabaseUrl, serviceRoleKey, userId, customerId, consumeTrial }) {
  const payload = {
    user_id: userId,
    stripe_customer_id: customerId
  };
  if (consumeTrial) {
    payload.trial_consumed_at = new Date().toISOString();
  }
  return supabaseAdminRequest({
    supabaseUrl,
    serviceRoleKey,
    table: 'billing_customers',
    query: 'on_conflict=user_id',
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: payload
  });
}

async function upsertPersonaSubscription({ supabaseUrl, serviceRoleKey, row }) {
  return supabaseAdminRequest({
    supabaseUrl,
    serviceRoleKey,
    table: 'persona_subscriptions',
    query: 'on_conflict=persona_id',
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: row
  });
}

async function fetchStripeSubscriptionById({ stripeSecretKey, subscriptionId }) {
  const path = `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`;
  const result = await stripeRequest({
    secretKey: stripeSecretKey,
    path,
    method: 'GET',
    query: 'expand[]=items.data.price'
  });
  if (!result.ok || !result.body?.id) {
    throw new Error(safeStripeErrorMessage(result, 'Could not fetch Stripe subscription'));
  }
  return result.body;
}

async function syncSubscriptionObject({ supabaseUrl, serviceRoleKey, subscription }) {
  const metadata = subscription?.metadata || {};
  const stripeSubscriptionId = String(subscription?.id || '');
  if (!stripeSubscriptionId) return { skipped: true, reason: 'missing_subscription_id' };

  const existing = await findSubscriptionByStripeId({
    supabaseUrl,
    serviceRoleKey,
    stripeSubscriptionId
  });

  const personaId = String(metadata.persona_id || existing?.persona_id || '').trim();
  const userId = String(metadata.user_id || existing?.user_id || '').trim();
  const customerId = String(subscription.customer || existing?.stripe_customer_id || '').trim();
  const stripePriceId = String(extractPriceId(subscription) || existing?.stripe_price_id || '').trim();
  const status = String(subscription.status || '').trim().toLowerCase();

  if (!personaId || !userId || !customerId || !stripePriceId || !status) {
    return { skipped: true, reason: 'missing_required_mapping' };
  }

  const trialStart = toIso(subscription.trial_start);
  const trialEnd = toIso(subscription.trial_end);
  const currentPeriodStart = toIso(subscription.current_period_start);
  const currentPeriodEnd = toIso(subscription.current_period_end);
  const canceledAt = toIso(subscription.canceled_at);
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  const consumeTrial =
    status === 'trialing' || (trialStart && trialEnd && (status === 'active' || status === 'past_due'));

  const customerResult = await upsertBillingCustomer({
    supabaseUrl,
    serviceRoleKey,
    userId,
    customerId,
    consumeTrial
  });
  if (!customerResult.ok) {
    throw new Error(safeStripeErrorMessage(customerResult, 'Could not sync billing customer'));
  }

  const upsertResult = await upsertPersonaSubscription({
    supabaseUrl,
    serviceRoleKey,
    row: {
      persona_id: personaId,
      user_id: userId,
      stripe_subscription_id: stripeSubscriptionId,
      stripe_customer_id: customerId,
      stripe_price_id: stripePriceId,
      status,
      cancel_at_period_end: cancelAtPeriodEnd,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      trial_start: trialStart,
      trial_end: trialEnd,
      canceled_at: canceledAt
    }
  });
  if (!upsertResult.ok) {
    throw new Error(safeStripeErrorMessage(upsertResult, 'Could not sync persona subscription'));
  }

  return { skipped: false };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { supabaseUrl, supabaseServiceRoleKey, missing: supabaseMissing } = getSupabaseConfig({
    requireServiceRole: true
  });
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const missing = [...supabaseMissing];
  if (!stripeSecretKey) missing.push('STRIPE_SECRET_KEY');
  if (!stripeWebhookSecret) missing.push('STRIPE_WEBHOOK_SECRET');
  if (missing.length) {
    return res.status(500).json({ error: 'Billing configuration missing', missing });
  }

  const rawBody = await readRawBody(req);
  const signatureHeader = req.headers['stripe-signature'];
  const signatureValid = verifyStripeSignature({
    rawBody,
    signatureHeader,
    webhookSecret: stripeWebhookSecret
  });
  if (!signatureValid) {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  let event = null;
  try {
    event = JSON.parse(rawBody);
  } catch (_) {
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }

  const eventId = String(event?.id || '');
  const eventType = String(event?.type || '');
  if (!eventId || !eventType) {
    return res.status(400).json({ error: 'Webhook payload missing id or type' });
  }

  try {
    const alreadyProcessed = await getEventAlreadyProcessed({
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      eventId
    });
    if (alreadyProcessed) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    const recordResult = await recordWebhookEvent({
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      eventId,
      eventType
    });
    if (!recordResult.ok) {
      return res.status(500).json({
        error: safeStripeErrorMessage(recordResult, 'Could not record webhook event')
      });
    }

    if (
      eventType === 'customer.subscription.created'
      || eventType === 'customer.subscription.updated'
      || eventType === 'customer.subscription.deleted'
    ) {
      await syncSubscriptionObject({
        supabaseUrl,
        serviceRoleKey: supabaseServiceRoleKey,
        subscription: event.data?.object || {}
      });
    } else if (eventType === 'checkout.session.completed') {
      const subscriptionId = String(event.data?.object?.subscription || '').trim();
      if (subscriptionId) {
        const subscription = await fetchStripeSubscriptionById({
          stripeSecretKey,
          subscriptionId
        });
        await syncSubscriptionObject({
          supabaseUrl,
          serviceRoleKey: supabaseServiceRoleKey,
          subscription
        });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Webhook processing failed' });
  }
};
