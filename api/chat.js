const { resolveEnv } = require('./env-utils');

const PERSONA_KEY_RE = /[^a-z0-9_-]/g;
const IDENTITY_LEAK_RE =
  /\b(as an ai|i(?:\s*am|'m)\s+(?:an?\s+)?(?:ai|llm|language model|virtual assistant|assistant|software|program|chatbot|model))\b/i;
const VIRTUAL_LIMITATION_RE =
  /\b(i(?:\s*can(?:not|'t)|\s*won't)\s+(?:physically\s+)?(?:join|go|come|meet|be there|attend)|virtual\s+(?:assistant|buddy|coach|companion|dining|gym|swimming)|cannot\s+physically|can't\s+physically)\b/i;
const REAL_PERSON_CHAT_STYLE_RE =
  /\b(what should we chat about today|nice to reconnect|i can swing by|do you want me to come over|should we meet at yours|let me know what fits your schedule)\b/i;
const FIRST_PERSON_BIO_RE =
  /\b(i(?:'m| am)\s+\d{1,2}\b|i(?:'m| am)\s+(?:a|an)\s+(?:student|major|developer|engineer|employee)\b)\b/i;
const MAX_TEST_HISTORY_ITEMS = 8;
const COMPATIBILITY_INTENT_RE =
  /\b(compatib(?:ility)?|fitness\s*test|fit\s*score|match\s*score|how\s+well\s+.*\b(match|fit|align))\b/i;

const CRITICAL_FIELD_ID_TO_KEY = Object.freeze({
  L6_S1_F1: 'physical_incapability',
  L6_S1_F2: 'hard_no_activities',
  L6_S1_F3: 'absolute_boundaries',
  L6_S2_F1: 'favorite_dishes',
  L6_S2_F2: 'favorite_colors',
  L6_S2_F3: 'preferred_activities',
  L6_S3_F1: 'extreme_dislikes',
  L6_S3_F2: 'strong_likes'
});

function sanitizePersonaKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  const cleaned = normalized.replace(PERSONA_KEY_RE, '');
  return cleaned || '';
}

function sanitizeText(value, maxLength = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function toPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function sanitizeTextArray(value, itemLimit = 4, itemMaxLength = 180) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeText(item, itemMaxLength))
    .filter(Boolean)
    .slice(0, itemLimit);
}

function collectPersonaKeysFromReport(report) {
  if (!report || typeof report !== 'object') return [];
  const directKeys = [
    report?.personaKey,
    report?.persona_key,
    report?.targetPersonaKey,
    report?.target_persona_key,
    report?.personaA?.key,
    report?.personaB?.key,
    report?.persona_a_key,
    report?.persona_b_key
  ];
  const listKeys = Array.isArray(report?.persona_keys) ? report.persona_keys : [];
  const merged = [...directKeys, ...listKeys];
  const deduped = new Set();
  merged.forEach((key) => {
    const safe = sanitizePersonaKey(key);
    if (safe) deduped.add(safe);
  });
  return Array.from(deduped);
}

function isReportRelatedToPersona(report, activePersonaKey) {
  const safeActive = sanitizePersonaKey(activePersonaKey);
  if (!safeActive) return false;
  const keys = collectPersonaKeysFromReport(report);
  return keys.includes(safeActive);
}

function sanitizeFitnessAxisEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const axisName = sanitizeText(entry.axis_name || entry.axis_id || '', 80);
  if (!axisName) return null;
  return {
    axis_name: axisName,
    deviation: toPercent(Number(entry.deviation) * 100),
    persona_a_value: toPercent(Number(entry.persona_a_value) * 100),
    persona_b_value: toPercent(Number(entry.persona_b_value) * 100)
  };
}

function sanitizeFitnessReport(report, activePersonaKey) {
  if (!report || typeof report !== 'object') return null;
  if (!isReportRelatedToPersona(report, activePersonaKey)) return null;
  return {
    report_id: sanitizeText(report.report_id || '', 64),
    compared_at: sanitizeText(report.comparedAt || report.compared_at || report.generated_at || '', 40),
    compatibility_percent: toPercent(report.compatibilityPercent),
    quantitative_deviation_percent: toPercent(report.quantitativeDeviationPercent),
    qualitative_misalignment_percent: toPercent(report.qualitativeMisalignmentPercent),
    mutation_rate_percent: toPercent(report.mutationRatePercent),
    persona_a: {
      key: sanitizePersonaKey(report?.personaA?.key || report?.persona_a_key || ''),
      label: sanitizeText(report?.personaA?.label || report?.persona_a_label || '', 80)
    },
    persona_b: {
      key: sanitizePersonaKey(report?.personaB?.key || report?.persona_b_key || ''),
      label: sanitizeText(report?.personaB?.label || report?.persona_b_label || '', 80)
    },
    areas_match: sanitizeTextArray(report.areas_match, 4, 160),
    areas_mismatch: sanitizeTextArray(report.areas_mismatch, 4, 160),
    top_matches_axes: (Array.isArray(report.top_matches_axes) ? report.top_matches_axes : [])
      .map((entry) => sanitizeFitnessAxisEntry(entry))
      .filter(Boolean)
      .slice(0, 5),
    top_mismatches_axes: (Array.isArray(report.top_mismatches_axes) ? report.top_mismatches_axes : [])
      .map((entry) => sanitizeFitnessAxisEntry(entry))
      .filter(Boolean)
      .slice(0, 5)
  };
}

function sanitizeOutcomeItem(outcome) {
  if (!outcome || typeof outcome !== 'object') return null;
  const label = sanitizeText(
    outcome.label || outcome.name || outcome.outcome || outcome.outcome_name || '',
    100
  );
  const probability = toPercent(
    outcome.probability_percent ??
      outcome.probabilityPercent ??
      outcome.success_probability_percent ??
      outcome.successProbabilityPercent ??
      outcome.percent
  );
  if (!label && probability === null) return null;
  return {
    label,
    probability_percent: probability
  };
}

function sanitizeOutcomeReport(report, activePersonaKey) {
  if (!report || typeof report !== 'object') return null;
  if (!isReportRelatedToPersona(report, activePersonaKey)) return null;
  const singleProbability = toPercent(
    report.probability_percent ??
      report.probabilityPercent ??
      report.success_probability_percent ??
      report.successProbabilityPercent ??
      report.percent
  );
  const outcomes = (Array.isArray(report.outcomes) ? report.outcomes : [])
    .map((item) => sanitizeOutcomeItem(item))
    .filter(Boolean)
    .slice(0, 10);
  return {
    report_id: sanitizeText(report.report_id || '', 64),
    generated_at: sanitizeText(report.generatedAt || report.generated_at || report.comparedAt || '', 40),
    summary: sanitizeText(report.summary || report.title || report.note || '', 240),
    probability_percent: singleProbability,
    outcomes
  };
}

function reportTimeValue(report) {
  const value =
    report?.compared_at || report?.generated_at || report?.comparedAt || report?.generatedAt || '';
  const epoch = Date.parse(String(value || ''));
  return Number.isFinite(epoch) ? epoch : 0;
}

function sortReportsNewestFirst(left, right) {
  return reportTimeValue(right) - reportTimeValue(left);
}

function dedupeReportsByIdAndTime(reports) {
  const seen = new Set();
  const deduped = [];
  reports.forEach((report) => {
    if (!report || typeof report !== 'object') return;
    const id = sanitizeText(report.report_id || report.id || '', 64);
    const stamp =
      sanitizeText(report.compared_at || report.generated_at || report.comparedAt || report.generatedAt || '', 40);
    const fingerprint = `${id}|${stamp}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    deduped.push(report);
  });
  return deduped;
}

function sanitizePersonaTestContext(rawContext, activePersonaKey) {
  const safeActive = sanitizePersonaKey(activePersonaKey);
  if (!safeActive || !rawContext || typeof rawContext !== 'object') {
    return {
      active_persona_key: safeActive || '',
      fitness: { latest: null, history: [] },
      outcomes: { latest: null, history: [] }
    };
  }

  const fitnessBlock = rawContext.fitness && typeof rawContext.fitness === 'object' ? rawContext.fitness : {};
  const outcomeBlock = rawContext.outcomes && typeof rawContext.outcomes === 'object' ? rawContext.outcomes : {};

  const fitnessCandidates = [
    fitnessBlock.latest,
    ...(Array.isArray(fitnessBlock.history) ? fitnessBlock.history : []),
    ...(Array.isArray(rawContext.fitnessReports) ? rawContext.fitnessReports : [])
  ];
  const outcomeCandidates = [
    outcomeBlock.latest,
    ...(Array.isArray(outcomeBlock.history) ? outcomeBlock.history : []),
    ...(Array.isArray(rawContext.outcomeReports) ? rawContext.outcomeReports : [])
  ];

  const sanitizedFitness = dedupeReportsByIdAndTime(
    fitnessCandidates
      .map((report) => sanitizeFitnessReport(report, safeActive))
      .filter(Boolean)
  )
    .sort(sortReportsNewestFirst)
    .slice(0, MAX_TEST_HISTORY_ITEMS);

  const sanitizedOutcomes = dedupeReportsByIdAndTime(
    outcomeCandidates
      .map((report) => sanitizeOutcomeReport(report, safeActive))
      .filter(Boolean)
  )
    .sort(sortReportsNewestFirst)
    .slice(0, MAX_TEST_HISTORY_ITEMS);

  return {
    active_persona_key: safeActive,
    fitness: {
      latest: sanitizedFitness[0] || null,
      history: sanitizedFitness
    },
    outcomes: {
      latest: sanitizedOutcomes[0] || null,
      history: sanitizedOutcomes
    }
  };
}

function buildPersonaTestContextFromAccountProfile(profileJson, activePersonaKey) {
  const profile = profileJson && typeof profileJson === 'object' ? profileJson : {};
  const insightLab = profile?.insight_lab && typeof profile.insight_lab === 'object'
    ? profile.insight_lab
    : {};

  const fitnessReports = Array.isArray(insightLab.fitness_reports) ? insightLab.fitness_reports : [];
  const outcomeReports = Array.isArray(insightLab.outcome_reports) ? insightLab.outcome_reports : [];

  return sanitizePersonaTestContext(
    {
      fitness: { history: fitnessReports },
      outcomes: { history: outcomeReports }
    },
    activePersonaKey
  );
}

function hasRealPersonImpersonation(text, personaName) {
  const value = String(text || '').trim();
  if (!value) return false;
  const lower = value.toLowerCase();
  const safeName = String(personaName || '').trim().toLowerCase();
  if (safeName) {
    if (
      lower.includes(`i'm ${safeName}`) ||
      lower.includes(`i am ${safeName}`) ||
      lower.includes(`this is ${safeName}`)
    ) {
      return true;
    }
  }
  return FIRST_PERSON_BIO_RE.test(value) || REAL_PERSON_CHAT_STYLE_RE.test(value);
}

function hasPolicyBreak(text, personaName) {
  const value = String(text || '');
  if (!value) return false;
  return (
    IDENTITY_LEAK_RE.test(value) ||
    VIRTUAL_LIMITATION_RE.test(value) ||
    hasRealPersonImpersonation(value, personaName)
  );
}

function normalizeMessages(messages, personaName) {
  return messages
    .filter((msg) => {
      if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) return false;
      const content = String(msg.content || '').trim();
      if (!content) return false;
      if (msg.role === 'assistant' && hasPolicyBreak(content, personaName)) return false;
      return true;
    })
    .map((msg) => ({
      role: msg.role,
      content: String(msg.content || '').trim()
    }))
    .slice(-40);
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

async function fetchPersonaSummaries(supabaseUrl, anonKey, accessToken, userId) {
  const url = `${supabaseUrl}/rest/v1/personas?user_id=eq.${encodeURIComponent(
    userId
  )}&select=persona_key,name,updated_at&order=updated_at.desc&limit=25`;
  const { ok, body } = await fetchJson(url, {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`
  });
  if (!ok || !Array.isArray(body)) return [];
  return body.map((row) => ({
    persona_key: sanitizePersonaKey(row?.persona_key || ''),
    name: String(row?.name || '').trim() || sanitizePersonaKey(row?.persona_key || ''),
    updated_at: row?.updated_at || null
  }));
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

function extractCriticalFactorsFromState(state) {
  const answers = state?.answers && typeof state.answers === 'object' ? state.answers : {};
  const critical = {};
  Object.entries(answers).forEach(([questionId, answer]) => {
    if (!answer || answer.type !== 'free') return;
    const text = String(answer.text || '').trim();
    if (!text) return;
    const fieldName = String(answer.fieldName || '').trim();
    const key = fieldName || CRITICAL_FIELD_ID_TO_KEY[questionId] || '';
    if (!key) return;
    critical[key] = text;
  });
  return critical;
}

function safeParseLayer(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue) return {};
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function normalizeStringRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  Object.entries(value).forEach(([key, raw]) => {
    const text = String(raw || '').trim();
    if (!text) return;
    normalized[key] = text;
  });
  return normalized;
}

function stripInsightLabFromProfile(profileJson) {
  if (!profileJson || typeof profileJson !== 'object') return {};
  const clone = { ...profileJson };
  if (clone.insight_lab && typeof clone.insight_lab === 'object') {
    delete clone.insight_lab;
  }
  return clone;
}

function enrichProfileDataSplit(profileInput, state, derivedCriticalFactors) {
  const profile = profileInput && typeof profileInput === 'object' ? profileInput : {};

  const axisScores =
    profile?.quantitative_data?.axis_scores && typeof profile.quantitative_data.axis_scores === 'object'
      ? profile.quantitative_data.axis_scores
      : profile?.axis_scores && typeof profile.axis_scores === 'object'
        ? profile.axis_scores
        : {
            L1: safeParseLayer(state?.identityLayers?.L1),
            L2: safeParseLayer(state?.identityLayers?.L2),
            L3: safeParseLayer(state?.identityLayers?.L3)
          };

  const criticalFactors = {
    ...normalizeStringRecord(profile?.critical_factors),
    ...normalizeStringRecord(profile?.qualitative_data?.critical_factors),
    ...normalizeStringRecord(derivedCriticalFactors)
  };

  const qualitativeData = {
    ...(profile?.qualitative_data && typeof profile.qualitative_data === 'object'
      ? profile.qualitative_data
      : {}),
    critical_factors: criticalFactors
  };

  return {
    ...profile,
    quantitative_data: {
      ...(profile?.quantitative_data && typeof profile.quantitative_data === 'object'
        ? profile.quantitative_data
        : {}),
      axis_scores: axisScores
    },
    qualitative_data: qualitativeData,
    critical_factors: criticalFactors,
    axis_scores: profile?.axis_scores && typeof profile.axis_scores === 'object'
      ? profile.axis_scores
      : axisScores
  };
}

function buildPersonaProfile(personaRow) {
  if (!personaRow || typeof personaRow !== 'object') return {};
  const state = personaRow.state && typeof personaRow.state === 'object' ? personaRow.state : {};
  const derivedCriticalFactors = extractCriticalFactorsFromState(state);

  if (personaRow.profile && typeof personaRow.profile === 'object') {
    return enrichProfileDataSplit(personaRow.profile, state, derivedCriticalFactors);
  }

  const traits = personaRow.traits && typeof personaRow.traits === 'object' ? personaRow.traits : {};
  return enrichProfileDataSplit({
    personaName: state.personaName || personaRow.name || '',
    identityLayers: state.identityLayers || {},
    traits,
    extras: state.extras || {},
    usersInput: state.usersInput || '',
    critical_factors: derivedCriticalFactors
  }, state, derivedCriticalFactors);
}

function buildFallbackInsightReply(latestUserMessage) {
  const text = String(latestUserMessage || '').trim();
  if (!text) {
    return 'Syntrae AI is an insight tool. Share a specific situation and I will help with likely preferences, likely response, and best next step.';
  }
  return 'Syntrae AI is an insight tool, not the real person. Share the exact action you want to take and I will give profile-based guidance and a better outreach strategy.';
}

function hasCompatibilityIntent(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  return COMPATIBILITY_INTENT_RE.test(value);
}

function buildNoFitnessResultReply() {
  return 'I don\'t have a Fitness Test result for this persona yet. Go to "Insight Lab" and hit "Run Fitness Test", then ask again.';
}

function buildCompatibilityReplyFromFitnessReport({ personaName, fitnessReport }) {
  const report = fitnessReport && typeof fitnessReport === 'object' ? fitnessReport : {};
  const compatibility = toPercent(
    report.compatibility_percent ?? report.compatibilityPercent ?? report.percent
  );
  if (compatibility === null) return buildNoFitnessResultReply();

  const matchAxis = sanitizeText(
    report?.top_matches_axes?.[0]?.axis_name || report?.top_matches_axes?.[0]?.axis_id || '',
    80
  );
  const mismatchAxis = sanitizeText(
    report?.top_mismatches_axes?.[0]?.axis_name || report?.top_mismatches_axes?.[0]?.axis_id || '',
    80
  );
  const safePersonaName = sanitizeText(personaName || 'this persona', 80) || 'this persona';

  const line1 = `Compatibility with ${safePersonaName}: ${compatibility}%.`;
  const line2 = `Top match: ${matchAxis || 'not available yet'}. Top mismatch: ${mismatchAxis || 'not available yet'}.`;
  const line3 = 'To refresh this score, go to "Insight Lab" and hit "Run Fitness Test".';
  return `${line1} ${line2} ${line3}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { messages, personaKey } = req.body || {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be an array' });

  const supabaseUrl = resolveEnv(['SUPABASE_URL']);
  const supabaseAnonKey = resolveEnv(['SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY_LOCAL']);
  const authHeader = String(req.headers.authorization || '');
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  let userProfile = {};
  let personaProfile = {};
  let accountPersonas = [];
  let activePersonaName = '';
  const safePersonaKey = sanitizePersonaKey(personaKey);
  let personaTestContext = buildPersonaTestContextFromAccountProfile({}, safePersonaKey);

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
    personaTestContext = buildPersonaTestContextFromAccountProfile(userProfile?.profile, safePersonaKey);

    const personaRow = await fetchPersonaRow(
      supabaseUrl,
      supabaseAnonKey,
      accessToken,
      user.id,
      safePersonaKey
    );
    activePersonaName = personaRow?.name || '';
    personaProfile = buildPersonaProfile(personaRow);
    accountPersonas = await fetchPersonaSummaries(
      supabaseUrl,
      supabaseAnonKey,
      accessToken,
      user.id
    );
  }

  const normalizedHistory = normalizeMessages(messages, activePersonaName);
  const latestUserMessage =
    [...normalizedHistory].reverse().find((msg) => msg.role === 'user')?.content || '';

  if (hasCompatibilityIntent(latestUserMessage)) {
    const latestFitness = personaTestContext?.fitness?.latest || null;
    const reply = latestFitness
      ? buildCompatibilityReplyFromFitnessReport({
          personaName: activePersonaName,
          fitnessReport: latestFitness
        })
      : buildNoFitnessResultReply();
    return res.status(200).json({ reply, usage: null });
  }

  return res.status(200).json({
    reply: buildFallbackInsightReply(latestUserMessage),
    usage: null
  });
};
