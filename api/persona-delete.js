const {
  sanitizePersonaKey,
  parseJsonBody,
  getAccessToken,
  getSupabaseConfig,
  fetchSupabaseUser,
  fetchPersonaForUser,
  supabaseAdminRequest,
  shouldBlockPersonaDeletion,
  safeStripeErrorMessage
} = require('./_billing-common');

async function fetchPersonaSubscription({ supabaseUrl, serviceRoleKey, personaId, userId }) {
  const result = await supabaseAdminRequest({
    supabaseUrl,
    serviceRoleKey,
    table: 'persona_subscriptions',
    query: [
      `persona_id=eq.${encodeURIComponent(personaId)}`,
      `user_id=eq.${encodeURIComponent(userId)}`,
      'select=status,cancel_at_period_end,current_period_end',
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

  const { supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, missing } = getSupabaseConfig({
    requireServiceRole: true
  });
  if (missing.length) {
    return res.status(500).json({ error: 'Server configuration missing', missing });
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

  const subscription = await fetchPersonaSubscription({
    supabaseUrl,
    serviceRoleKey: supabaseServiceRoleKey,
    personaId: persona.id,
    userId: user.id
  });
  if (shouldBlockPersonaDeletion(subscription)) {
    return res.status(409).json({
      code: 'subscription_must_be_canceled',
      error: 'Cancel this persona subscription first. No refund is issued when deleting the persona.',
      subscription: {
        status: subscription.status,
        cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
        current_period_end: subscription.current_period_end || null
      }
    });
  }

  const deleteResult = await supabaseAdminRequest({
    supabaseUrl,
    serviceRoleKey: supabaseServiceRoleKey,
    table: 'personas',
    query: [
      `id=eq.${encodeURIComponent(persona.id)}`,
      `user_id=eq.${encodeURIComponent(user.id)}`
    ].join('&'),
    method: 'DELETE',
    prefer: 'return=minimal'
  });
  if (!deleteResult.ok) {
    return res.status(500).json({
      error: safeStripeErrorMessage(deleteResult, 'Could not delete persona')
    });
  }

  return res.status(200).json({
    ok: true,
    deletedPersonaId: persona.id
  });
};
