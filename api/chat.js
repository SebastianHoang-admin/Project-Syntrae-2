const PERSONA_KEY_RE = /[^a-z0-9_-]/g;

function sanitizePersonaKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  const cleaned = normalized.replace(PERSONA_KEY_RE, '');
  return cleaned || '';
}

function normalizeMessages(messages) {
  return messages
    .filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant'))
    .map((msg) => ({
      role: msg.role,
      content: String(msg.content || '').trim()
    }))
    .filter((msg) => msg.content.length > 0)
    .slice(-40);
}

function safeJson(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch (_) {
    return '{}';
  }
}

function buildContextPrompt({ userProfile, personaProfile, personaName, personaKey }) {
  return [
    'You are Syntrae assistant.',
    'Use account-scoped profile context exactly as provided.',
    'If context fields are missing, ask concise follow-up questions instead of guessing.',
    '',
    `Active persona name: ${personaName || 'Unknown persona'}`,
    `Active persona key: ${personaKey || 'unknown'}`,
    '',
    'USER_PROFILE_JSON:',
    safeJson(userProfile),
    '',
    'PERSONA_PROFILE_JSON:',
    safeJson(personaProfile)
  ].join('\n');
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { method: 'GET', headers });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

async function fetchSupabaseUser(supabaseUrl, anonKey, accessToken) {
  return fetchJson(`${supabaseUrl}/auth/v1/user`, {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`
  });
}

async function fetchUserProfile(supabaseUrl, anonKey, accessToken, userId) {
  const url = `${supabaseUrl}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}&select=user_id,first_name,last_name,occupation,organization,location,profile&limit=1`;
  const { ok, body } = await fetchJson(url, {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`
  });
  if (!ok || !Array.isArray(body) || !body.length) return null;
  return body[0];
}

async function fetchPersonaRow(supabaseUrl, anonKey, accessToken, userId, personaKey) {
  const filters = [
    `user_id=eq.${encodeURIComponent(userId)}`,
    `select=id,persona_key,name,state,traits,profile`,
    `order=updated_at.desc`,
    'limit=1'
  ];
  if (personaKey) filters.unshift(`persona_key=eq.${encodeURIComponent(personaKey)}`);
  const url = `${supabaseUrl}/rest/v1/personas?${filters.join('&')}`;
  const { ok, body } = await fetchJson(url, {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`
  });
  if (!ok || !Array.isArray(body) || !body.length) return null;
  return body[0];
}

function fallbackUserProfileFromMetadata(user) {
  const meta = user?.user_metadata || {};
  return {
    first_name: meta.first_name || '',
    last_name: meta.last_name || '',
    occupation: meta.occupation || '',
    organization: meta.organization || '',
    location: meta.location || '',
    profile: {}
  };
}

function buildPersonaProfile(personaRow) {
  if (!personaRow || typeof personaRow !== 'object') return {};
  if (personaRow.profile && typeof personaRow.profile === 'object') return personaRow.profile;
  const state = personaRow.state && typeof personaRow.state === 'object' ? personaRow.state : {};
  const traits = personaRow.traits && typeof personaRow.traits === 'object' ? personaRow.traits : {};
  return {
    personaName: state.personaName || personaRow.name || '',
    identityLayers: state.identityLayers || {},
    traits,
    extras: state.extras || {},
    usersInput: state.usersInput || ''
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  const { messages, personaKey } = req.body || {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be an array' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY_LOCAL;
  const authHeader = String(req.headers.authorization || '');
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  let userProfile = {};
  let personaProfile = {};
  let activePersonaName = '';
  const safePersonaKey = sanitizePersonaKey(personaKey);

  if (supabaseUrl && supabaseAnonKey) {
    if (!accessToken) {
      return res.status(401).json({ error: 'Missing authenticated session token' });
    }

    const userResult = await fetchSupabaseUser(supabaseUrl, supabaseAnonKey, accessToken);
    if (!userResult.ok || !userResult.body?.id) {
      return res.status(401).json({ error: 'Invalid or expired session token' });
    }

    const user = userResult.body;
    const profileRow = await fetchUserProfile(supabaseUrl, supabaseAnonKey, accessToken, user.id);
    userProfile = profileRow || fallbackUserProfileFromMetadata(user);

    const personaRow = await fetchPersonaRow(
      supabaseUrl,
      supabaseAnonKey,
      accessToken,
      user.id,
      safePersonaKey
    );
    activePersonaName = personaRow?.name || '';
    personaProfile = buildPersonaProfile(personaRow);
  }

  const systemPrompt = buildContextPrompt({
    userProfile,
    personaProfile,
    personaName: activePersonaName,
    personaKey: safePersonaKey
  });

  const upstreamMessages = [
    { role: 'system', content: systemPrompt },
    ...normalizeMessages(messages)
  ];

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-nano',
        messages: upstreamMessages
      })
    });

    const data = await openaiRes.json().catch(() => ({}));
    if (!openaiRes.ok) {
      const message = data?.error?.message || data?.error || 'OpenAI request failed';
      return res.status(openaiRes.status).json({ error: message });
    }

    const reply = data?.choices?.[0]?.message?.content || 'No reply';
    return res.status(200).json({
      reply,
      usage: data?.usage || null
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'OpenAI request failed' });
  }
};
