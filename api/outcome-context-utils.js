const crypto = require('crypto');

const DEFAULT_DIGEST_VERSION = 1;
const DEFAULT_DIGEST_TOKEN_LIMIT = 900;
const DEFAULT_CONTEXT_BUDGET_TOKENS = 2000;

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function clampInt(value, min, max) {
  return Math.round(clamp(value, min, max));
}

function sanitizeText(value, maxLength = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function estimateTokenCountFromText(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function stableObject(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => stableObject(item));
  if (typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).sort().forEach((key) => {
    out[key] = stableObject(value[key]);
  });
  return out;
}

function safeJson(value) {
  try {
    return JSON.stringify(value || {});
  } catch (_) {
    return '{}';
  }
}

function toPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function tokenizeListFromText(value) {
  return String(value || '')
    .split(/[\n\r;|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeList(input, maxItems, maxLength = 140) {
  const items = [];
  const seen = new Set();
  const push = (raw) => {
    const text = sanitizeText(raw, maxLength);
    if (!text) return;
    const dedupeKey = text.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    items.push(text);
  };

  if (Array.isArray(input)) {
    input.forEach((item) => {
      if (typeof item === 'string') {
        tokenizeListFromText(item).forEach(push);
        return;
      }
      if (item && typeof item === 'object') {
        Object.values(item).forEach((value) => {
          if (typeof value === 'string') tokenizeListFromText(value).forEach(push);
        });
      }
    });
  } else if (input && typeof input === 'object') {
    Object.entries(input).forEach(([key, rawValue]) => {
      const left = sanitizeText(key, 48);
      const right = sanitizeText(rawValue, maxLength);
      if (!left && !right) return;
      push(left && right ? `${left}: ${right}` : (right || left));
    });
  } else if (typeof input === 'string') {
    tokenizeListFromText(input).forEach(push);
  }

  return items.slice(0, Math.max(0, maxItems));
}

function extractAxisScores(profile) {
  const source = toPlainObject(profile);
  const quantitative = toPlainObject(source.quantitative_data);
  const candidates = [
    toPlainObject(quantitative.axis_scores),
    toPlainObject(quantitative.axisScores),
    toPlainObject(quantitative.axes),
    toPlainObject(source.axis_scores),
    toPlainObject(source.axisScores)
  ];

  const scores = {};
  candidates.forEach((candidate) => {
    Object.entries(candidate).forEach(([rawKey, rawValue]) => {
      const key = sanitizeText(rawKey, 48).toLowerCase();
      if (!key) return;
      let numeric = Number.NaN;
      if (Number.isFinite(Number(rawValue))) {
        numeric = Number(rawValue);
      } else if (rawValue && typeof rawValue === 'object') {
        const maybe = [rawValue.value, rawValue.score, rawValue.percent, rawValue.normalized]
          .map((value) => Number(value))
          .find((value) => Number.isFinite(value));
        if (Number.isFinite(maybe)) numeric = maybe;
      }
      if (!Number.isFinite(numeric)) return;
      scores[key] = Number(clamp(numeric, 0, 100).toFixed(2));
    });
  });
  return scores;
}

function extractPersonaIdentity(persona) {
  const source = toPlainObject(persona);
  const profile = toPlainObject(source.profile);
  const qualitative = toPlainObject(profile.qualitative_data);

  return {
    persona_key: sanitizeText(source.persona_key || source.key || '', 64),
    label: sanitizeText(source.name || source.label || source.persona_key || source.key || 'Persona', 120),
    personal_headline: sanitizeText(
      qualitative.personal_headline || profile.personal_headline || source.personal_headline || '',
      240
    ),
    communication_style: sanitizeText(
      qualitative.communication_style || profile.communication_style || source.communication_style || '',
      180
    )
  };
}

function buildDeterministicPersonaDigest(persona, options = {}) {
  const source = toPlainObject(persona);
  const profile = toPlainObject(source.profile);
  const qualitative = toPlainObject(profile.qualitative_data);
  const criticalFactors = {
    ...toPlainObject(profile.critical_factors),
    ...toPlainObject(qualitative.critical_factors)
  };
  const extras = {
    ...toPlainObject(profile.extras),
    ...toPlainObject(qualitative.extras_text),
    ...toPlainObject(profile.freeform_signals),
    ...toPlainObject(qualitative.freeform_signals)
  };

  const goalsTop3 = normalizeList(
    [qualitative.goals, profile.goals, source.goals, qualitative.strengths, profile.strengths],
    3,
    140
  );
  const constraintsTop5 = normalizeList(
    [qualitative.constraints, profile.constraints, source.constraints, criticalFactors],
    5,
    160
  );
  const hardBoundariesTop5 = normalizeList(
    [
      criticalFactors.boundaries,
      criticalFactors.hard_boundaries,
      criticalFactors.non_negotiables,
      criticalFactors.no_go,
      criticalFactors.safety,
      profile.hard_boundaries
    ],
    5,
    160
  );
  const topicAnchorsTop5 = normalizeList(
    [
      qualitative.personal_headline,
      qualitative.goals,
      profile.topic_anchors,
      extras.topic_anchors,
      extras.hobbies,
      extras.interests
    ],
    5,
    120
  );
  const sharedActivityPreferencesTop5 = normalizeList(
    [
      extras.activities,
      extras.activity_preferences,
      extras.shared_activity_preferences,
      extras.date_ideas,
      profile.shared_activity_preferences
    ],
    5,
    120
  );

  const quantAxesTop8 = Object.entries(extractAxisScores(profile))
    .slice(0, 8)
    .map(([axis, score]) => ({
      axis: sanitizeText(axis, 48),
      score: Number(clamp(score, 0, 100).toFixed(2))
    }));

  const riskFlags = normalizeList(
    [criticalFactors.risk_flags, criticalFactors.risks, criticalFactors.red_flags, profile.risk_flags, constraintsTop5],
    5,
    120
  );
  const legalEthicsGuardrails = normalizeList(
    [
      profile.legal_ethics_guardrails,
      criticalFactors.legal,
      criticalFactors.ethics,
      [
        'Respect explicit rejection and boundaries.',
        'No coercion, deception, or harassment.',
        'Use lawful and consent-respecting actions only.'
      ]
    ],
    5,
    120
  );

  const digest = {
    identity: extractPersonaIdentity(source),
    goals_top3: goalsTop3,
    constraints_top5: constraintsTop5,
    hard_boundaries_top5: hardBoundariesTop5,
    topic_anchors_top5: topicAnchorsTop5,
    shared_activity_preferences_top5: sharedActivityPreferencesTop5,
    quant_axes_top8: quantAxesTop8,
    risk_flags: riskFlags,
    legal_ethics_guardrails: legalEthicsGuardrails
  };

  const digestJson = safeJson(digest);
  return {
    digest,
    digest_version: clampInt(options.digestVersion || DEFAULT_DIGEST_VERSION, 1, 10_000),
    source_hash: buildPersonaSourceHash(source),
    token_estimate: estimateTokenCountFromText(digestJson)
  };
}

function validateDigestShape(digest) {
  const source = toPlainObject(digest);
  const identity = toPlainObject(source.identity);
  if (!sanitizeText(identity.label, 120)) return { ok: false, reason: 'identity.label is required' };
  const listKeys = [
    'goals_top3',
    'constraints_top5',
    'hard_boundaries_top5',
    'topic_anchors_top5',
    'shared_activity_preferences_top5',
    'risk_flags',
    'legal_ethics_guardrails'
  ];
  for (let i = 0; i < listKeys.length; i += 1) {
    const key = listKeys[i];
    if (!Array.isArray(source[key])) return { ok: false, reason: `${key} must be an array` };
  }
  if (!Array.isArray(source.quant_axes_top8)) return { ok: false, reason: 'quant_axes_top8 must be an array' };
  return { ok: true };
}

function buildPersonaSourceHash(persona) {
  return crypto
    .createHash('sha256')
    .update(safeJson(stableObject(toPlainObject(persona))))
    .digest('hex');
}

function trimTextToTokenBudget(text, tokenBudget) {
  const safeBudget = Math.max(0, Number(tokenBudget) || 0);
  const normalized = sanitizeText(text, 12000);
  if (!normalized || safeBudget <= 0) return '';
  const estimate = estimateTokenCountFromText(normalized);
  if (estimate <= safeBudget) return normalized;
  const maxChars = Math.max(12, safeBudget * 4);
  return sanitizeText(normalized, maxChars);
}

function buildPackedOutcomeContext({
  requestedOutcome,
  inferredInitialConditions,
  additionalContext,
  personaADigest,
  personaBDigest,
  contextBudgetTokens
}) {
  const budget = clampInt(contextBudgetTokens || DEFAULT_CONTEXT_BUDGET_TOKENS, 500, 12000);
  const a = toPlainObject(personaADigest);
  const b = toPlainObject(personaBDigest);

  const sectionSpecs = [
    {
      key: 'outcome_constraints',
      text: [
        `Requested outcome: ${sanitizeText(requestedOutcome, 320)}.`,
        sanitizeText(inferredInitialConditions, 900)
          ? `Inferred initial conditions: ${sanitizeText(inferredInitialConditions, 900)}.`
          : '',
        sanitizeText(additionalContext, 420) ? `Additional context: ${sanitizeText(additionalContext, 420)}.` : ''
      ].filter(Boolean).join(' ')
    },
    {
      key: 'boundaries_guardrails',
      text: [
        `Initiator boundaries: ${normalizeList(a.hard_boundaries_top5, 5, 120).join(' | ') || 'None listed'}.`,
        `Target boundaries: ${normalizeList(b.hard_boundaries_top5, 5, 120).join(' | ') || 'None listed'}.`,
        `Guardrails: ${normalizeList(a.legal_ethics_guardrails, 3, 120).join(' | ') || 'Respect consent and legality'}.`
      ].join(' ')
    },
    {
      key: 'goals_communication',
      text: [
        `Initiator goals/style: ${normalizeList(a.goals_top3, 3, 120).join(' | ') || 'N/A'} | ${sanitizeText(a.identity?.communication_style, 140) || 'style not specified'}.`,
        `Target goals/style: ${normalizeList(b.goals_top3, 3, 120).join(' | ') || 'N/A'} | ${sanitizeText(b.identity?.communication_style, 140) || 'style not specified'}.`,
        `Initiator constraints: ${normalizeList(a.constraints_top5, 3, 120).join(' | ') || 'none listed'}.`,
        `Target constraints: ${normalizeList(b.constraints_top5, 3, 120).join(' | ') || 'none listed'}.`
      ].join(' ')
    },
    {
      key: 'topic_anchors',
      text: [
        `Initiator topic anchors: ${normalizeList(a.topic_anchors_top5, 5, 100).join(' | ') || 'none listed'}.`,
        `Target topic anchors: ${normalizeList(b.topic_anchors_top5, 5, 100).join(' | ') || 'none listed'}.`,
        `Shared activity preferences: ${normalizeList(
          [...normalizeList(a.shared_activity_preferences_top5, 5, 100), ...normalizeList(b.shared_activity_preferences_top5, 5, 100)],
          6,
          100
        ).join(' | ') || 'none listed'}.`
      ].join(' ')
    },
    {
      key: 'low_priority_extras',
      text: [
        `Initiator risk flags: ${normalizeList(a.risk_flags, 5, 100).join(' | ') || 'none listed'}.`,
        `Target risk flags: ${normalizeList(b.risk_flags, 5, 100).join(' | ') || 'none listed'}.`,
        `Quant axes A: ${safeJson(normalizeList(a.quant_axes_top8, 8, 80))}.`,
        `Quant axes B: ${safeJson(normalizeList(b.quant_axes_top8, 8, 80))}.`
      ].join(' ')
    }
  ];

  let remaining = budget;
  let truncationApplied = false;
  const usedSections = [];
  const sectionTokenEstimates = {};

  sectionSpecs.forEach((section) => {
    sectionTokenEstimates[`${section.key}_raw`] = estimateTokenCountFromText(section.text);
    if (remaining <= 0) {
      sectionTokenEstimates[`${section.key}_used`] = 0;
      return;
    }
    const trimmed = trimTextToTokenBudget(section.text, remaining);
    const usedTokens = estimateTokenCountFromText(trimmed);
    sectionTokenEstimates[`${section.key}_used`] = usedTokens;
    if (!trimmed || usedTokens <= 0) return;
    if (trimmed !== section.text) truncationApplied = true;
    usedSections.push({
      key: section.key,
      text: trimmed
    });
    remaining = Math.max(0, remaining - usedTokens);
  });

  if (!usedSections.length) {
    usedSections.push({
      key: 'outcome_constraints',
      text: trimTextToTokenBudget(`Requested outcome: ${sanitizeText(requestedOutcome, 320)}.`, budget)
    });
  }

  const input = usedSections
    .map((section) => {
      const title = section.key.replace(/_/g, ' ').toUpperCase();
      return `${title}\n${section.text}`;
    })
    .join('\n\n');

  return {
    input,
    sections: usedSections,
    section_token_estimates: sectionTokenEstimates,
    input_tokens_estimate: estimateTokenCountFromText(input),
    truncation_applied: truncationApplied
  };
}

function shouldFallbackDigestToLlm({ digest, tokenEstimate, maxDigestTokens }) {
  const validation = validateDigestShape(digest);
  if (!validation.ok) return true;
  const maxTokens = clampInt(maxDigestTokens || DEFAULT_DIGEST_TOKEN_LIMIT, 200, 5000);
  return Number(tokenEstimate || 0) > maxTokens;
}

module.exports = {
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  DEFAULT_DIGEST_TOKEN_LIMIT,
  DEFAULT_DIGEST_VERSION,
  buildDeterministicPersonaDigest,
  buildPackedOutcomeContext,
  buildPersonaSourceHash,
  clamp,
  clampInt,
  estimateTokenCountFromText,
  safeJson,
  sanitizeText,
  shouldFallbackDigestToLlm,
  trimTextToTokenBudget,
  validateDigestShape
};
