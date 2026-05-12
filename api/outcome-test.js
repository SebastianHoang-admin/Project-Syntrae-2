const { resolveEnv } = require('./env-utils');

const DEFAULT_NODE_COUNT = 10;
const DEFAULT_ACTIONS_PER_NODE = 5;
const DEFAULT_POPULATION_SIZE = 140;
const DEFAULT_GENERATIONS = 90;
const DEFAULT_MUTATION_RATE = 0.14;
const DEFAULT_ELITE_COUNT = 8;
const DEFAULT_TOP_PATHWAYS = 5;
const DEFAULT_MONTE_CARLO_REPS = 1000;
const DEFAULT_OUTCOME_PROMPT_ID = 'pmpt_69fa2fb3eefc8196b8ca8889f95f756903f3f05aace493de';
const DEFAULT_OUTCOME_PROMPT_VERSION = '2';

const FALLBACK_NODE_TITLES = Object.freeze([
  'Define Objective',
  'Boundary Check',
  'Timing Calibration',
  'Opening Approach',
  'Value-Aligned Ask',
  'Friction Reduction',
  'Logistics Lock-in',
  'Execution',
  'Follow-up',
  'Outcome Consolidation'
]);

const FALLBACK_NODE_ACTIONS = Object.freeze([
  [
    'Write one sentence defining the exact outcome and deadline.',
    'Draft a low-pressure outcome version with an easy opt-out.',
    'Draft a medium-ambition outcome with a clear next step.',
    'Write a high-clarity outcome statement with boundaries included.',
    'Set a concrete outcome target plus a fallback outcome target.'
  ],
  [
    'List two hard boundaries and remove any conflicting action.',
    'Choose a channel (text/call/in-person) that minimizes pressure.',
    'Write an invitation sentence that explicitly allows decline.',
    'Check safety/legal constraints and remove risky logistics.',
    'Prepare a lower-pressure alternative ask for this same week.'
  ],
  [
    'Pick one exact send time and one backup send time.',
    'Choose a low-stress day window and avoid deadline periods.',
    'Set a 20-30 minute interaction window to reduce burden.',
    'Schedule outreach right after a shared context touchpoint.',
    'Delay outreach 24-72 hours if temporary stress is high.'
  ],
  [
    'Send a two-line opener referencing shared context and intent.',
    'Open with one shared interest, then ask one clear question.',
    'Use a low-pressure opener with an explicit "no pressure" line.',
    'Use a direct opener with one concrete plan option.',
    'Use a preference-first opener offering two simple options.'
  ],
  [
    'Propose a specific venue/activity aligned with known preferences.',
    'Offer Option A and Option B with the same time cost.',
    'Ask for a small first step (15-30 minutes) before bigger plans.',
    'Frame value around mutual interest, not obligation.',
    'Keep ask concrete: exact place, duration, and purpose.'
  ],
  [
    'Offer a lower-effort fallback (shorter time or closer venue).',
    'Reduce cost burden by proposing budget-friendly options.',
    'Add an explicit fallback line if timing is not good.',
    'Rewrite wording to preserve autonomy and easy exit.',
    'Remove extra logistics so the plan fits one message.'
  ],
  [
    'Confirm exact time and place in one concise follow-up.',
    'Confirm one comfort preference (food/noise/transport timing).',
    'Send one reminder only, then stop pushing.',
    'Lock one next step and avoid multi-ask messages.',
    'Confirm consent and expectations before meeting.'
  ],
  [
    'Execute the plan as agreed without adding surprise pressure.',
    'Watch response signals and adjust pace respectfully.',
    'Keep tone consistent with earlier communication style.',
    'Prioritize comfort, safety, and legal boundaries at all times.',
    'If hesitation appears, offer a clear graceful exit.'
  ],
  [
    'Send one same-day follow-up message acknowledging the interaction.',
    'Ask one short check-in question about comfort and fit.',
    'Express appreciation without adding immediate pressure.',
    'If declined, close respectfully and keep dignity intact.',
    'If positive, suggest one realistic second-step action.'
  ],
  [
    'Evaluate if the requested outcome was reached within timeline.',
    'If partial, define one incremental next action with date.',
    'If no success, pivot to a lower-friction and respectful outcome.',
    'Write what worked and what created friction for next run.',
    'Prioritize long-term trust over short-term escalation.'
  ]
]);

const FALLBACK_CHAIN_TEMPLATES = Object.freeze([
  [
    'After shared context ({context_anchor}), send one short text asking for a 25-minute tea/coffee break this week.',
    'At the meetup, ask about {topic_hint} and share one related personal story.',
    'Close the meetup by thanking them and asking if they would like to do this again next week.',
    'That night, send one concise good-night text referencing the best moment from the meetup.',
    'Wait 2-3 days, then propose a second meetup with a specific day/time window.',
    'During the second meetup, ask one values-based question and listen without interrupting.',
    'At the end, state romantic intent clearly and ask if they are open to an actual date.',
    'If yes, schedule a first official date with exact plan, duration, and location.',
    'After the date, send a short reflection text and ask for consent to keep progressing.',
    'If mutual interest is explicit, ask to define the relationship toward {outcome_short}.'
  ],
  [
    'Send a two-option message tied to {context_anchor}: Option A tea break, Option B short walk.',
    'Choose the accepted option and open conversation with {topic_hint} plus one open-ended question.',
    'Offer to cover a small part of cost only if they seem comfortable, without pressure.',
    'When leaving, ask if they got home safely and avoid repeated follow-up texts.',
    'After 72 hours, invite them to a low-noise activity aligned with {topic_hint}.',
    'At that activity, validate their preferences and ask what pace feels comfortable.',
    'State interest directly: "I like spending time with you and want to date intentionally."',
    'If they agree, propose a concrete second date plan with clear start/end time.',
    'Follow up the next day with one appreciation text and no escalation pressure.',
    'If consistent reciprocity is present, discuss relationship expectations and boundaries.'
  ],
  [
    'Right after group session, invite them to a 20-minute snack break near campus.',
    'Use the break to discuss {topic_hint} and ask what projects excite them right now.',
    'Before ending, confirm they felt comfortable and ask for preferred next activity type.',
    'Send one summary text: highlight shared interest and propose one specific next plan.',
    'Wait 48 hours, then ask for a weekend plan with an easy opt-out clause.',
    'During the weekend plan, keep interaction balanced: ask/listen ratio near 50/50.',
    'Near the end, ask whether they are open to trying an official date format.',
    'If yes, schedule the official date and confirm logistical preferences in one message.',
    'Afterward, check in briefly and ask how they felt about the date pace.',
    'If feedback is positive and consistent, ask to move toward exclusive dating.'
  ],
  [
    'Send a purpose-first message linked to {context_anchor}: "Want to swap ideas over tea for 30 minutes?"',
    'At the meetup, center conversation on {topic_hint} and one future-oriented question.',
    'Offer practical help related to their current workload only if invited.',
    'After meeting, send one gratitude text and one concrete follow-up suggestion.',
    'Pause 3-4 days, then invite them to a calm evening plan with exact timing.',
    'During that plan, ask about boundaries and preferred communication rhythm.',
    'Share your intention: "I’m interested in dating you if you’re open to it."',
    'If response is positive, agree on what "dating" means for both of you.',
    'Send a next-day check-in confirming consent and comfort with the new step.',
    'If alignment remains strong over repeated interactions, define the relationship.'
  ],
  [
    'Use a short voice note tied to {context_anchor} inviting them for a 30-minute dinner or tea.',
    'During the meetup, ask two curiosity questions anchored to {topic_hint}.',
    'Near midpoint, share one vulnerable but appropriate personal detail to build trust.',
    'At the end, ask directly whether they’d like a second one-on-one plan.',
    'If yes, send a calendar-ready invite with date/time/location and simple backup option.',
    'On the second plan, prioritize consent cues and avoid physical/romantic pressure.',
    'State your romantic interest and ask for their honest answer without urgency.',
    'If they are open, schedule a date progression plan they co-design.',
    'After each date, run one short check-in question about comfort and expectations.',
    'When reciprocity is explicit and sustained, ask to become partners.'
  ]
]);

const VARIANT_DELTAS = Object.freeze([
  { fit: 6, feasibility: 8, ethics: 5, risk: -6, momentum: -2, intensity: -12 },
  { fit: 10, feasibility: 6, ethics: 2, risk: 4, momentum: 7, intensity: 12 },
  { fit: 8, feasibility: 5, ethics: 4, risk: -1, momentum: 4, intensity: -2 },
  { fit: 7, feasibility: 9, ethics: 6, risk: -4, momentum: 1, intensity: -9 },
  { fit: 9, feasibility: 4, ethics: 1, risk: 8, momentum: 10, intensity: 16 }
]);

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function clampInt(value, min, max) {
  return Math.round(clamp(value, min, max));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (!text) return fallback;
    if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  }
  return fallback;
}

function sanitizeText(value, maxLength = 280) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function sanitizePersonaKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

function toJsonSafeValue(value, seen = new WeakSet(), depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 20) return '[Depth limit reached]';

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return value;
  if (valueType === 'bigint') return value.toString();
  if (valueType === 'function' || valueType === 'symbol') return undefined;

  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafeValue(item, seen, depth + 1));
  }

  if (valueType === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out = {};
    Object.entries(value).forEach(([key, nested]) => {
      const safeNested = toJsonSafeValue(nested, seen, depth + 1);
      if (safeNested !== undefined) out[key] = safeNested;
    });
    seen.delete(value);
    return out;
  }

  return String(value);
}

function safeJson(value) {
  try {
    return JSON.stringify(toJsonSafeValue(value || {}), null, 2);
  } catch (_) {
    return '{}';
  }
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const candidate = raw.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) {
      return null;
    }
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function getScenarioNodeByIndex(nodes, nodeIndex) {
  const list = toArray(nodes);
  return (
    list.find((item) => Number(item?.node_index || item?.index) === nodeIndex) ||
    list[nodeIndex - 1] ||
    null
  );
}

function extractRawNodesFromGeneratedPayload(parsed, nodeCount, actionsPerNode) {
  const directNodes = toArray(parsed?.nodes);
  if (directNodes.length) return directNodes;

  const directActionSpace = toArray(parsed?.action_space);
  if (directActionSpace.length) return directActionSpace;

  const scenarios = toArray(parsed?.scenarios).slice(0, actionsPerNode);
  if (!scenarios.length) return [];

  const outputNodes = [];
  for (let nodeIndex = 1; nodeIndex <= nodeCount; nodeIndex += 1) {
    const actions = [];
    for (let slotIndex = 1; slotIndex <= actionsPerNode; slotIndex += 1) {
      const scenario = scenarios[slotIndex - 1] || {};
      const scenarioNode = getScenarioNodeByIndex(scenario?.nodes, nodeIndex);
      const actionText = sanitizeText(
        scenarioNode?.action || scenarioNode?.step || scenarioNode?.description || '',
        180
      );
      if (!actionText) continue;

      const scenarioScores = scenario?.scores && typeof scenario.scores === 'object'
        ? scenario.scores
        : scenario?.chain_metrics && typeof scenario.chain_metrics === 'object'
          ? scenario.chain_metrics
          : {};
      const fit = clampInt(
        scenarioScores.personalization_fit_percent ??
          scenarioScores.fit ??
          scenarioScores.outcome_alignment_percent ??
          72,
        0,
        100
      );
      const feasibility = clampInt(
        scenarioScores.practicality_percent ?? scenarioScores.feasibility ?? scenarioScores.logicality_percent ?? 70,
        0,
        100
      );
      const ethics = clampInt(
        scenarioScores.ethics_legal_percent ?? scenarioScores.ethics ?? 84,
        0,
        100
      );
      const risk = clampInt(
        scenarioScores.risk ?? Math.max(6, 100 - ethics),
        0,
        100
      );
      const momentum = clampInt(
        scenarioScores.outcome_alignment_percent ?? scenarioScores.momentum ?? fit,
        0,
        100
      );
      const intensity = clampInt(24 + nodeIndex * 5 + (slotIndex - 1) * 3, 0, 100);

      actions.push({
        id: sanitizeText(scenarioNode?.id || `N${nodeIndex}A${slotIndex}`, 20),
        gene_slot: slotIndex,
        action: actionText,
        rationale: sanitizeText(
          scenarioNode?.next_link ||
            scenarioNode?.rationale ||
            `Node ${nodeIndex} step in scenario ${slotIndex}.`,
          220
        ),
        persona_anchor: sanitizeText(
          scenarioNode?.personalization_anchor || scenarioNode?.anchor || `Scenario ${slotIndex} persona fit`,
          140
        ),
        next_link_hint: sanitizeText(
          scenarioNode?.next_link || scenarioNode?.success_signal || 'Supports transition to the next node.',
          180
        ),
        scores: {
          fit,
          feasibility,
          ethics,
          risk,
          momentum,
          intensity
        }
      });
    }

    outputNodes.push({
      node_index: nodeIndex,
      node_title: sanitizeText(
        getScenarioNodeByIndex(scenarios?.[0]?.nodes, nodeIndex)?.node_title || `Node ${nodeIndex}`,
        90
      ),
      actions
    });
  }

  return outputNodes;
}

function extractTopicHintFromProfile(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const qualitative = source.qualitative_data && typeof source.qualitative_data === 'object'
    ? source.qualitative_data
    : {};
  const fields = [
    qualitative.personal_headline,
    qualitative.goals,
    qualitative.communication_style,
    qualitative.constraints,
    source?.personal_headline,
    source?.goals
  ]
    .map((item) => sanitizeText(item, 180))
    .filter(Boolean);

  const text = fields.join(' | ');
  if (!text) return 'a topic from their profile';
  const phrases = text
    .split(/[|.,;]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4);
  const phrase = phrases[0] || '';
  if (!phrase) return 'a topic from their profile';
  const words = phrase.split(/\s+/g).slice(0, 6).join(' ');
  return sanitizeText(words, 80) || 'a topic from their profile';
}

function buildContextAnchor(initialConditions) {
  const value = sanitizeText(initialConditions, 220);
  if (!value) return 'the current context';
  const words = value.split(/\s+/g).slice(0, 10).join(' ');
  return sanitizeText(words, 90) || 'the current context';
}

function shortOutcomeLabel(requestedOutcome) {
  const value = sanitizeText(requestedOutcome, 120);
  if (!value) return 'the requested outcome';
  const words = value.split(/\s+/g).slice(0, 8).join(' ');
  return sanitizeText(words, 90) || 'the requested outcome';
}

function fillFallbackTemplate(template, replacements) {
  return String(template || '').replace(/\{([a-z_]+)\}/gi, (_, key) => {
    const value = replacements?.[key];
    return sanitizeText(value, 90) || '';
  });
}

function compactProfile(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const qualitative = source.qualitative_data && typeof source.qualitative_data === 'object'
    ? source.qualitative_data
    : {};
  const quantitative = source.quantitative_data && typeof source.quantitative_data === 'object'
    ? source.quantitative_data
    : {};
  const critical = qualitative.critical_factors && typeof qualitative.critical_factors === 'object'
    ? qualitative.critical_factors
    : source.critical_factors && typeof source.critical_factors === 'object'
      ? source.critical_factors
      : {};
  return {
    personal_headline: sanitizeText(qualitative.personal_headline || '', 220),
    goals: sanitizeText(qualitative.goals || '', 220),
    communication_style: sanitizeText(qualitative.communication_style || '', 220),
    constraints: sanitizeText(qualitative.constraints || '', 220),
    critical_factors: Object.fromEntries(
      Object.entries(critical)
        .slice(0, 12)
        .map(([key, value]) => [sanitizeText(key, 60), sanitizeText(value, 220)])
    ),
    quantitative_axes_present: Object.keys(quantitative.axis_scores || {}).length
  };
}

function extractAxisScores(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const quantitative = source.quantitative_data && typeof source.quantitative_data === 'object'
    ? source.quantitative_data
    : {};
  const candidates = [
    quantitative.axis_scores,
    quantitative.axisScores,
    quantitative.axes,
    source.axis_scores,
    source.axisScores
  ];
  const axisSource = candidates.find((item) => item && typeof item === 'object') || {};
  const out = {};

  Object.entries(axisSource).forEach(([rawKey, rawValue]) => {
    const key = String(rawKey || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9 _/-]/g, '');
    if (!key) return;

    let numeric = Number.NaN;
    if (Number.isFinite(Number(rawValue))) {
      numeric = Number(rawValue);
    } else if (rawValue && typeof rawValue === 'object') {
      const valueCandidates = [rawValue.value, rawValue.score, rawValue.percent, rawValue.normalized];
      for (let i = 0; i < valueCandidates.length; i += 1) {
        const candidate = Number(valueCandidates[i]);
        if (Number.isFinite(candidate)) {
          numeric = candidate;
          break;
        }
      }
    }

    if (!Number.isFinite(numeric)) return;
    out[key] = clamp(numeric, 0, 100);
  });

  return out;
}

function summarizeCriticalFactors(compact) {
  const critical = compact?.critical_factors && typeof compact.critical_factors === 'object'
    ? compact.critical_factors
    : {};
  const entries = Object.entries(critical)
    .filter(([key, value]) => sanitizeText(key, 80) || sanitizeText(value, 140))
    .slice(0, 4)
    .map(([key, value]) => {
      const left = sanitizeText(key, 70);
      const right = sanitizeText(value, 140);
      if (left && right) return `${left}: ${right}`;
      return left || right;
    })
    .filter(Boolean);
  return entries.length ? entries.join(' | ') : 'None explicitly listed';
}

function summarizeInitialConditionsFromPersonas(personaA, personaB, userContext) {
  const personaALabel = sanitizeText(personaA?.label || personaA?.key || 'Persona A', 90);
  const personaBLabel = sanitizeText(personaB?.label || personaB?.key || 'Persona B', 90);
  const compactA = compactProfile(personaA?.profile);
  const compactB = compactProfile(personaB?.profile);

  const scoresA = extractAxisScores(personaA?.profile);
  const scoresB = extractAxisScores(personaB?.profile);
  const sharedAxisKeys = Object.keys(scoresA).filter((key) => Object.prototype.hasOwnProperty.call(scoresB, key));
  let avgDeviation = null;
  if (sharedAxisKeys.length) {
    const totalGap = sharedAxisKeys.reduce((sum, key) => sum + Math.abs((scoresA[key] || 0) - (scoresB[key] || 0)), 0);
    avgDeviation = totalGap / sharedAxisKeys.length;
  }
  const alignmentPercent = avgDeviation === null ? null : clamp(100 - avgDeviation, 0, 100);

  const userContextText = sanitizeText(userContext, 260);
  const parts = [
    `Initiator (${personaALabel}): goals "${compactA.goals || 'not specified'}"; communication "${compactA.communication_style || 'not specified'}"; constraints "${compactA.constraints || 'none stated'}".`,
    `Target (${personaBLabel}): goals "${compactB.goals || 'not specified'}"; communication "${compactB.communication_style || 'not specified'}"; constraints "${compactB.constraints || 'none stated'}".`,
    avgDeviation === null
      ? 'Quantitative alignment: insufficient shared numeric axes to compute trait deviation.'
      : `Quantitative alignment: ${sharedAxisKeys.length} shared axes, average deviation ${avgDeviation.toFixed(1)}/100, estimated alignment ${alignmentPercent.toFixed(1)}%.`,
    `Critical factors - Initiator: ${summarizeCriticalFactors(compactA)}.`,
    `Critical factors - Target: ${summarizeCriticalFactors(compactB)}.`,
    userContextText ? `Additional user-supplied context: ${userContextText}.` : ''
  ].filter(Boolean);

  return sanitizeText(parts.join(' '), 1200);
}

function buildGeneratorPrompt({
  inferredInitialConditions,
  additionalContext,
  requestedOutcome,
  personaA,
  personaB,
  nodeCount,
  actionsPerNode
}) {
  const safeOutcome = sanitizeText(requestedOutcome, 320);
  const safeInferredContext = sanitizeText(inferredInitialConditions, 2200);
  const safeAdditionalContext = sanitizeText(additionalContext, 320);
  const personaARecord = personaA?.db_record && typeof personaA.db_record === 'object'
    ? personaA.db_record
    : {};
  const personaBRecord = personaB?.db_record && typeof personaB.db_record === 'object'
    ? personaB.db_record
    : {};
  const safePersonaA = {
    key: sanitizePersonaKey(personaA?.key),
    label: sanitizeText(personaA?.label, 120),
    profile_compact: compactProfile(personaA?.profile),
    profile_full: personaA?.profile && typeof personaA.profile === 'object' ? personaA.profile : {},
    db_record_full: personaARecord
  };
  const safePersonaB = {
    key: sanitizePersonaKey(personaB?.key),
    label: sanitizeText(personaB?.label, 120),
    profile_compact: compactProfile(personaB?.profile),
    profile_full: personaB?.profile && typeof personaB.profile === 'object' ? personaB.profile : {},
    db_record_full: personaBRecord
  };

  const systemPrompt = [
    'You are Syntrae AI Outcome Test action-space generator.',
    'Role: a practical romantic wingman that gives clear step-by-step actions toward the requested relationship outcome.',
    'Generate realistic, ethical, legal social-action options.',
    'Never include coercion, manipulation, stalking, harassment, deception, or illegal advice.',
    'Actions must be practical for real-world respectful communication.',
    'Return strict JSON only. No markdown.'
  ].join('\n');

  const userPrompt = [
    'Build action-space for evolutionary optimization.',
    `Requested outcome: ${safeOutcome || '(missing)'}`,
    `Initial conditions inferred from both personas: ${safeInferredContext || '(missing)'}`,
    safeAdditionalContext ? `Additional context from user: ${safeAdditionalContext}` : 'Additional context from user: (none provided)',
    '',
    'IMPORTANT: Full Supabase database objects for both active personas are provided below.',
    'Use all available fields (including nested objects) to personalize actions.',
    'Do not reduce interpretation to only compact fields when full records are available.',
    '',
    'Persona A (initiator):',
    safeJson(safePersonaA),
    '',
    'Persona B (target):',
    safeJson(safePersonaB),
    '',
    `Requirements: exactly ${nodeCount} nodes, exactly ${actionsPerNode} actions per node.`,
    'Each node must provide five actions that map to gene slots 1..5.',
    'For each gene slot, the actions across nodes must chain coherently from initial conditions to requested outcome.',
    'Every action must be realistic, ethical, legal, and executable in sequence.',
    'Each action must be a specific executable move, not generic advice.',
    'Bad example: "Be respectful." Good example: "Send one short text after class asking for a 30-minute tea break this weekend."',
    'For Node 2 actions, include a personalized conversation topic anchor derived from Persona B profile.',
    'Each action should be distinct.',
    'Keep action and rationale concise.',
    'Each action must include scores:',
    '- fit (0-100): alignment with both personas and outcome',
    '- feasibility (0-100): realistic execution in current context',
    '- ethics (0-100): consent, dignity, legal/ethical safety',
    '- risk (0-100): social/relational downside risk (higher is worse)',
    '- momentum (0-100): chance the action advances toward outcome',
    '- intensity (0-100): social intensity level',
    '',
    'Output schema:',
    '{',
    '  "nodes":[',
    '    {',
    '      "node_index":1,',
    '      "node_title":"...",',
    '      "actions":[',
    '        {',
    '          "id":"N1A1",',
    '          "gene_slot":1,',
    '          "action":"...",',
    '          "rationale":"...",',
    '          "persona_anchor":"which persona trait/preference this action uses",',
    '          "next_link_hint":"How this action sets up the next node",',
    '          "scores":{"fit":0,"feasibility":0,"ethics":0,"risk":0,"momentum":0,"intensity":0}',
    '        }',
    '      ]',
    '    }',
    '  ]',
    '}'
  ].join('\n');

  return {
    systemPrompt,
    userPrompt
  };
}

async function requestCompletion({ apiKey, model, messages }) {
  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 2600,
      messages
    })
  });
  const data = await openaiRes.json().catch(() => ({}));
  if (!openaiRes.ok) {
    const message = data?.error?.message || data?.error || 'OpenAI request failed';
    const err = new Error(message);
    err.status = openaiRes.status;
    throw err;
  }
  return data;
}

function extractTextFromResponsesApi(data) {
  const candidates = [];
  const pushCandidate = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return;
    candidates.push(text);
  };

  pushCandidate(data?.output_text);

  if (data?.output_json && typeof data.output_json === 'object') {
    pushCandidate(JSON.stringify(data.output_json));
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  output.forEach((item) => {
    pushCandidate(item?.text);
    pushCandidate(item?.arguments);
    if (item?.json && typeof item.json === 'object') {
      pushCandidate(JSON.stringify(item.json));
    }
    const content = Array.isArray(item?.content) ? item.content : [];
    content.forEach((part) => {
      pushCandidate(part?.text);
      pushCandidate(part?.arguments);
      if (part?.json && typeof part.json === 'object') {
        pushCandidate(JSON.stringify(part.json));
      }
      if (part?.value && typeof part.value === 'object') {
        pushCandidate(JSON.stringify(part.value));
      }
    });
  });

  if (!candidates.length) return '';
  const jsonCandidate = candidates.find((value) => value.startsWith('{') || value.startsWith('['));
  return (jsonCandidate || candidates.join('\n')).trim();
}

async function requestCompletionWithPromptTemplate({
  apiKey,
  promptId,
  promptVersion,
  promptVariables,
  model,
  systemPrompt,
  userPrompt,
  options = {}
}) {
  const promptPayload = {
    id: String(promptId || '').trim()
  };
  if (String(promptVersion || '').trim()) {
    promptPayload.version = String(promptVersion).trim();
  }
  if (promptVariables && typeof promptVariables === 'object' && Object.keys(promptVariables).length) {
    promptPayload.variables = promptVariables;
  }

  const inputText = [String(systemPrompt || '').trim(), String(userPrompt || '').trim()]
    .filter(Boolean);

  const requestBody = {
    prompt: promptPayload,
    max_output_tokens: clampInt(options.maxOutputTokens ?? 4200, 800, 12000)
  };
  if (options.useMessageInput) {
    requestBody.input = [
      { role: 'developer', content: inputText[0] || '' },
      { role: 'user', content: inputText[1] || '' }
    ];
  } else {
    requestBody.input = inputText.join('\n\n');
  }
  if (model) {
    requestBody.model = model;
  }
  if (options.forceJsonObject) {
    requestBody.text = {
      format: { type: 'json_object' }
    };
  }

  const openaiRes = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });
  const data = await openaiRes.json().catch(() => ({}));
  if (!openaiRes.ok) {
    const message = data?.error?.message || data?.error || 'OpenAI responses request failed';
    const err = new Error(message);
    err.status = openaiRes.status;
    throw err;
  }
  return {
    raw: data,
    text: extractTextFromResponsesApi(data)
  };
}

function buildFallbackActionSpace({
  requestedOutcome,
  initialConditions,
  personaB,
  nodeCount,
  actionsPerNode
}) {
  const safeOutcome = sanitizeText(requestedOutcome, 140) || 'the requested outcome';
  const topicHint = extractTopicHintFromProfile(personaB?.profile);
  const contextAnchor = buildContextAnchor(initialConditions);
  const outcomeShort = shortOutcomeLabel(requestedOutcome);
  const nodes = [];

  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const title = FALLBACK_NODE_TITLES[nodeIndex] || `Node ${nodeIndex + 1}`;
    const nodeActions = FALLBACK_NODE_ACTIONS[nodeIndex] || [];
    const actions = [];

    for (let actionIndex = 0; actionIndex < actionsPerNode; actionIndex += 1) {
      const baseTemplate = nodeActions[actionIndex] || `Take a realistic action for step ${nodeIndex + 1}.`;
      const chainTemplate = FALLBACK_CHAIN_TEMPLATES?.[actionIndex]?.[nodeIndex];
      const baseText = fillFallbackTemplate(
        chainTemplate || baseTemplate
          .replaceAll('known preferences', topicHint)
          .replaceAll('shared context', contextAnchor),
        {
          topic_hint: topicHint,
          context_anchor: contextAnchor,
          outcome_short: outcomeShort
        }
      );
      const delta = VARIANT_DELTAS[actionIndex] || VARIANT_DELTAS[0];
      const fitBase = 64 + nodeIndex * 1.4;
      const feasibilityBase = 68 + (nodeIndex % 3) * 2.5;
      const ethicsBase = 86 - (nodeIndex % 2) * 1.5;
      const riskBase = 28 + (nodeIndex % 4) * 5;
      const momentumBase = 62 + nodeIndex * 2;
      const intensityBase = 30 + nodeIndex * 4;

      actions.push({
        id: `N${nodeIndex + 1}A${actionIndex + 1}`,
        gene_slot: actionIndex + 1,
        action: sanitizeText(baseText.replaceAll('the requested outcome', safeOutcome), 160),
        rationale: sanitizeText(`Supports progress toward ${safeOutcome} while preserving consent and dignity.`, 180),
        persona_anchor: sanitizeText(topicHint, 120),
        next_link_hint: sanitizeText(
          nodeIndex + 1 < nodeCount
            ? `Sets up node ${nodeIndex + 2} with low-friction continuity.`
            : `Consolidates into the final outcome: ${safeOutcome}.`,
          180
        ),
        scores: {
          fit: clampInt(fitBase + delta.fit, 0, 100),
          feasibility: clampInt(feasibilityBase + delta.feasibility, 0, 100),
          ethics: clampInt(ethicsBase + delta.ethics, 0, 100),
          risk: clampInt(riskBase + delta.risk, 0, 100),
          momentum: clampInt(momentumBase + delta.momentum, 0, 100),
          intensity: clampInt(intensityBase + delta.intensity, 0, 100)
        }
      });
    }

    nodes.push({
      node_index: nodeIndex + 1,
      node_title: title,
      actions
    });
  }

  return nodes;
}

function normalizeScore(raw, fallback) {
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return clampInt(numeric, 0, 100);
  return clampInt(fallback, 0, 100);
}

function normalizeAction(rawAction, nodeIndex, actionIndex) {
  const raw = rawAction && typeof rawAction === 'object' ? rawAction : {};
  const scoreSource = raw.scores && typeof raw.scores === 'object' ? raw.scores : raw;

  return {
    id: sanitizeText(raw.id || `N${nodeIndex + 1}A${actionIndex + 1}`, 20),
    gene_slot: clampInt(raw.gene_slot ?? raw.geneSlot ?? actionIndex + 1, 1, DEFAULT_ACTIONS_PER_NODE),
    action: sanitizeText(raw.action || raw.name || raw.title || `Action ${actionIndex + 1}`, 180),
    rationale: sanitizeText(
      raw.rationale || raw.why || raw.description || 'Supports the requested outcome.',
      220
    ),
    persona_anchor: sanitizeText(
      raw.persona_anchor || raw.personaAnchor || '',
      140
    ),
    next_link_hint: sanitizeText(
      raw.next_link_hint || raw.nextLinkHint || 'Transitions to the next step.',
      180
    ),
    scores: {
      fit: normalizeScore(scoreSource.fit, 0),
      feasibility: normalizeScore(scoreSource.feasibility, 0),
      ethics: normalizeScore(scoreSource.ethics, 0),
      risk: normalizeScore(scoreSource.risk, 0),
      momentum: normalizeScore(scoreSource.momentum, 0),
      intensity: normalizeScore(scoreSource.intensity, 0)
    }
  };
}

function resolveRawNodeAtIndex(rawNodes, nodeIndex) {
  const sourceNodes = Array.isArray(rawNodes) ? rawNodes : [];
  const fromIndex = sourceNodes[nodeIndex];
  const fromTag = sourceNodes.find((node) => Number(node?.node_index || node?.index) === nodeIndex + 1);
  return fromTag || fromIndex || null;
}

function validateGeneratedActionSpaceShape(rawNodes, nodeCount, actionsPerNode) {
  if (!Array.isArray(rawNodes) || !rawNodes.length) {
    return { ok: false, reason: 'OpenAI output had no nodes array.' };
  }
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const rawNode = resolveRawNodeAtIndex(rawNodes, nodeIndex);
    if (!rawNode || typeof rawNode !== 'object') {
      return { ok: false, reason: `Missing node at index ${nodeIndex + 1}.` };
    }
    const actions = Array.isArray(rawNode.actions) ? rawNode.actions : [];
    if (actions.length < actionsPerNode) {
      return {
        ok: false,
        reason: `Node ${nodeIndex + 1} has ${actions.length} actions; expected ${actionsPerNode}.`
      };
    }
    for (let actionIndex = 0; actionIndex < actionsPerNode; actionIndex += 1) {
      const rawAction = actions[actionIndex];
      if (!rawAction || typeof rawAction !== 'object') {
        return { ok: false, reason: `Node ${nodeIndex + 1} action ${actionIndex + 1} is missing.` };
      }
      const actionText = sanitizeText(rawAction.action || rawAction.name || rawAction.title || '', 180);
      if (!actionText) {
        return { ok: false, reason: `Node ${nodeIndex + 1} action ${actionIndex + 1} has no action text.` };
      }
      const scores = rawAction?.scores && typeof rawAction.scores === 'object' ? rawAction.scores : rawAction;
      const requiredScores = ['fit', 'feasibility', 'ethics', 'risk', 'momentum', 'intensity'];
      for (let i = 0; i < requiredScores.length; i += 1) {
        const key = requiredScores[i];
        const value = Number(scores?.[key]);
        if (!Number.isFinite(value)) {
          return {
            ok: false,
            reason: `Node ${nodeIndex + 1} action ${actionIndex + 1} is missing numeric score "${key}".`
          };
        }
      }
    }
  }
  return { ok: true };
}

function normalizeActionSpace(rawNodes, nodeCount, actionsPerNode) {
  const sourceNodes = Array.isArray(rawNodes) ? rawNodes : [];
  const normalized = [];

  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const rawNode = resolveRawNodeAtIndex(sourceNodes, nodeIndex) || {};
    const rawActions = Array.isArray(rawNode?.actions) ? rawNode.actions : [];
    const actions = [];

    for (let actionIndex = 0; actionIndex < actionsPerNode; actionIndex += 1) {
      const rawAction = rawActions[actionIndex];
      actions.push(normalizeAction(rawAction, nodeIndex, actionIndex));
    }

    normalized.push({
      node_index: nodeIndex + 1,
      node_title: sanitizeText(rawNode?.node_title || rawNode?.title || `Node ${nodeIndex + 1}`, 90),
      actions
    });
  }

  return normalized;
}

function tokenizeForContinuity(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function tokenOverlapScore(leftText, rightText) {
  const leftTokens = new Set(tokenizeForContinuity(leftText));
  const rightTokens = new Set(tokenizeForContinuity(rightText));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });
  const union = new Set([...leftTokens, ...rightTokens]).size;
  if (!union) return 0;
  return intersection / union;
}

const GENERIC_ACTION_PATTERNS = Object.freeze([
  /\bbe\s+(?:respectful|careful|thoughtful|open|nice)\b/i,
  /\bensure\b/i,
  /\bmaintain\b/i,
  /\btry\s+to\b/i,
  /\bfocus\s+on\b/i,
  /\brespect\s+(?:their|the)\b/i,
  /\bkeep\s+it\b/i
]);

const CONCRETE_ACTION_VERBS = Object.freeze([
  'invite',
  'text',
  'call',
  'ask',
  'book',
  'schedule',
  'propose',
  'confirm',
  'meet',
  'share',
  'send',
  'pick',
  'choose',
  'offer',
  'bring',
  'plan',
  'pay',
  'drive',
  'walk'
]);

const CONTEXT_ANCHOR_TERMS = Object.freeze([
  'today',
  'tonight',
  'tomorrow',
  'weekend',
  'after class',
  'before class',
  'on campus',
  'coffee',
  'tea',
  'dinner',
  'library',
  'message',
  'text',
  'call',
  '30-minute',
  '20-minute'
]);

function includesPattern(text, patterns) {
  const value = String(text || '');
  return patterns.some((pattern) => pattern.test(value));
}

function includesVerbToken(text, verbs) {
  const normalized = ` ${String(text || '').toLowerCase()} `;
  return verbs.some((verb) => normalized.includes(` ${verb} `));
}

function computeSpecificityPercent(actionText) {
  const text = String(actionText || '').trim();
  if (!text) return 0;
  const words = text.split(/\s+/g).filter(Boolean);
  const lengthScore = clamp((words.length / 14) * 28, 6, 28);
  const hasVerb = includesVerbToken(text, CONCRETE_ACTION_VERBS) ? 24 : 0;
  const hasAnchor = includesVerbToken(text, CONTEXT_ANCHOR_TERMS) ? 20 : 0;
  const hasNumber = /\b\d{1,3}\b/.test(text) ? 14 : 0;
  const punctuationCue = /[:,]/.test(text) ? 6 : 0;
  const genericPenalty = includesPattern(text, GENERIC_ACTION_PATTERNS) ? 24 : 0;
  return clamp(lengthScore + hasVerb + hasAnchor + hasNumber + punctuationCue - genericPenalty, 0, 100);
}

function scoreTransitionCheck(current, next) {
  const currentText = `${current?.action || ''} ${current?.rationale || ''} ${current?.next_link_hint || ''}`;
  const nextText = `${next?.node_title || ''} ${next?.action || ''} ${next?.rationale || ''}`;

  const overlap = tokenOverlapScore(currentText, nextText);
  const linkHintBonus = String(current?.next_link_hint || '').trim() ? 0.22 : 0;
  const rawLogicality = clamp01((overlap * 0.78) + linkHintBonus);
  const logicalityPercent = toPercent(rawLogicality);

  const currFeasibility = clamp(current?.scores?.feasibility, 0, 100);
  const nextFeasibility = clamp(next?.scores?.feasibility, 0, 100);
  const currIntensity = clamp(current?.scores?.intensity, 0, 100);
  const nextIntensity = clamp(next?.scores?.intensity, 0, 100);
  const intensityJump = Math.abs(nextIntensity - currIntensity);
  const intensityPenalty = Math.max(0, (intensityJump - 28) * 0.8);
  const specificityPenalty =
    Math.max(0, 55 - clamp(current?.specificity_percent, 0, 100)) * 0.16 +
    Math.max(0, 55 - clamp(next?.specificity_percent, 0, 100)) * 0.16;
  const practicalityPercent = clamp(((currFeasibility + nextFeasibility) / 2) - intensityPenalty - specificityPenalty, 0, 100);

  const currEthics = clamp(current?.scores?.ethics, 0, 100);
  const nextEthics = clamp(next?.scores?.ethics, 0, 100);
  const currRisk = clamp(current?.scores?.risk, 0, 100);
  const nextRisk = clamp(next?.scores?.risk, 0, 100);
  const ethicsLegalPercent = clamp((((currEthics + nextEthics) / 2) * 0.72) + (((200 - currRisk - nextRisk) / 2) * 0.28), 0, 100);

  const isPass =
    logicalityPercent >= 44 &&
    practicalityPercent >= 48 &&
    ethicsLegalPercent >= 62;

  let note = 'Transition is coherent and executable.';
  if (!isPass) {
    const reasons = [];
    if (logicalityPercent < 44) reasons.push('logic gap between steps');
    if (practicalityPercent < 48) reasons.push('practical execution gap');
    if (ethicsLegalPercent < 62) reasons.push('ethics/legal risk too high');
    note = `Needs revision: ${reasons.join(', ')}.`;
  }

  return {
    from_node_index: current?.node_index || null,
    to_node_index: next?.node_index || null,
    logicality_percent: Number(logicalityPercent.toFixed(2)),
    practicality_percent: Number(practicalityPercent.toFixed(2)),
    ethics_legal_percent: Number(ethicsLegalPercent.toFixed(2)),
    pass: isPass,
    note
  };
}

function selectActionForGeneSlot(node, slotIndex) {
  const actions = Array.isArray(node?.actions) ? node.actions : [];
  const bySlot = actions.find((action) => Number(action?.gene_slot) === slotIndex);
  if (bySlot) return bySlot;
  return actions[slotIndex - 1] || actions[0] || null;
}

function average(values) {
  if (!Array.isArray(values) || !values.length) return 0;
  const total = values.reduce((sum, value) => sum + Number(value || 0), 0);
  return total / values.length;
}

function toPercent(value) {
  return clamp(Number((clamp01(value) * 100).toFixed(2)), 0, 100);
}

function buildChainCandidates(actionSpace, requestedOutcome, initialConditions, actionsPerNode) {
  const chains = [];
  const nodeCount = actionSpace.length || 0;
  for (let slot = 1; slot <= actionsPerNode; slot += 1) {
    const steps = [];
    const realismParts = [];
    const ethicsLegalParts = [];
    const outcomeAlignParts = [];
    const specificityParts = [];

    for (let nodeIndex = 0; nodeIndex < actionSpace.length; nodeIndex += 1) {
      const node = actionSpace[nodeIndex];
      const action = selectActionForGeneSlot(node, slot);
      if (!action) continue;

      const fit = clamp(action?.scores?.fit, 0, 100) / 100;
      const feasibility = clamp(action?.scores?.feasibility, 0, 100) / 100;
      const ethics = clamp(action?.scores?.ethics, 0, 100) / 100;
      const risk = clamp(action?.scores?.risk, 0, 100) / 100;
      const momentum = clamp(action?.scores?.momentum, 0, 100) / 100;

      realismParts.push((fit * 0.4) + (feasibility * 0.6));
      ethicsLegalParts.push((ethics * 0.7) + ((1 - risk) * 0.3));
      outcomeAlignParts.push((fit * 0.55) + (momentum * 0.45));
      const specificityPercent = computeSpecificityPercent(action.action);
      specificityParts.push(specificityPercent / 100);

      steps.push({
        node_index: node.node_index,
        node_title: node.node_title,
        action_id: action.id,
        gene_slot: slot,
        action: action.action,
        rationale: action.rationale,
        persona_anchor: action.persona_anchor,
        next_link_hint: action.next_link_hint,
        specificity_percent: Number(specificityPercent.toFixed(2)),
        scores: action.scores
      });
    }

    const transitionChecks = [];
    for (let i = 0; i < steps.length - 1; i += 1) {
      const current = steps[i];
      const next = steps[i + 1];
      transitionChecks.push(scoreTransitionCheck(current, next));
    }

    const realism = average(realismParts);
    const ethicsLegal = average(ethicsLegalParts);
    const outcomeAlignment = average(outcomeAlignParts);
    const specificity = average(specificityParts);
    const continuity = transitionChecks.length
      ? average(transitionChecks.map((item) => clamp(item.logicality_percent / 100, 0, 1)))
      : 0.5;
    const practicality = transitionChecks.length
      ? average(transitionChecks.map((item) => clamp(item.practicality_percent / 100, 0, 1)))
      : 0.5;
    const transitionsPassCount = transitionChecks.filter((item) => item.pass).length;
    const transitionsTotal = transitionChecks.length;
    const transitionPassRatio = transitionsTotal ? transitionsPassCount / transitionsTotal : 1;

    const chainIntegrity =
      (realism * 0.27) +
      (ethicsLegal * 0.24) +
      (outcomeAlignment * 0.2) +
      (continuity * 0.13) +
      (practicality * 0.1) +
      (specificity * 0.06);
    const chainIsValid =
      transitionPassRatio >= 0.78 &&
      toPercent(ethicsLegal) >= 62 &&
      toPercent(specificity) >= 50;

    chains.push({
      chain_id: `G${slot}`,
      gene_slot: slot,
      chain_length: steps.length,
      chain_valid: chainIsValid,
      initial_conditions: sanitizeText(initialConditions, 220),
      requested_outcome: sanitizeText(requestedOutcome, 160),
      chain_metrics: {
        logicality_percent: toPercent(continuity),
        practicality_percent: toPercent(practicality),
        realism_percent: toPercent(realism),
        ethics_legal_percent: toPercent(ethicsLegal),
        specificity_percent: toPercent(specificity),
        outcome_alignment_percent: toPercent(outcomeAlignment),
        chain_integrity_percent: toPercent(chainIntegrity),
        transition_pass_percent: toPercent(transitionPassRatio),
        transitions_passed: transitionsPassCount,
        transitions_total: transitionsTotal
      },
      summary: `Gene slot ${slot} produces a ${steps.length}-step chain with ${transitionsPassCount}/${transitionsTotal} transition checks passing.`,
      transition_checks: transitionChecks,
      actions: steps
    });
  }

  return chains
    .filter((chain) => chain.chain_length === nodeCount)
    .sort(
      (left, right) =>
        Number(right?.chain_valid === true) - Number(left?.chain_valid === true) ||
        Number(right?.chain_metrics?.chain_integrity_percent || 0) -
        Number(left?.chain_metrics?.chain_integrity_percent || 0)
    );
}

function computeNodePassPercent(action) {
  const scores = action?.scores && typeof action.scores === 'object' ? action.scores : {};
  const fit = clamp(scores.fit, 0, 100);
  const feasibility = clamp(scores.feasibility, 0, 100);
  const ethics = clamp(scores.ethics, 0, 100);
  const risk = clamp(scores.risk, 0, 100);
  const momentum = clamp(scores.momentum, 0, 100);
  const blended = fit * 0.36 + feasibility * 0.24 + ethics * 0.2 + momentum * 0.2 - risk * 0.26;
  return clamp(blended, 8, 97);
}

function randomInt(maxExclusive) {
  return Math.floor(Math.random() * maxExclusive);
}

function makeRandomChromosome(nodeCount, actionsPerNode) {
  const genes = [];
  for (let i = 0; i < nodeCount; i += 1) genes.push(randomInt(actionsPerNode));
  return genes;
}

function chromosomeKey(genes) {
  return genes.join('-');
}

function evaluateChromosome(genes, actionSpace) {
  let expectedSuccess = 1;
  let avgRisk = 0;
  let avgEthics = 0;
  let avgPass = 0;
  let intensityPenalty = 0;
  let previousIntensity = null;

  for (let nodeIndex = 0; nodeIndex < actionSpace.length; nodeIndex += 1) {
    const node = actionSpace[nodeIndex];
    const action = node.actions[genes[nodeIndex]] || node.actions[0];
    const passPercent = computeNodePassPercent(action);
    const pass = clamp01(passPercent / 100);
    expectedSuccess *= pass;
    avgPass += pass;

    const risk = clamp(action?.scores?.risk, 0, 100);
    const ethics = clamp(action?.scores?.ethics, 0, 100);
    const intensity = clamp(action?.scores?.intensity, 0, 100);
    avgRisk += risk;
    avgEthics += ethics;

    if (previousIntensity !== null) {
      const jump = Math.abs(intensity - previousIntensity);
      if (jump > 35) intensityPenalty += (jump - 35) * 0.0045;
    }
    previousIntensity = intensity;
  }

  const nodeCount = actionSpace.length || 1;
  avgPass /= nodeCount;
  avgRisk /= nodeCount;
  avgEthics /= nodeCount;

  const quality =
    avgPass * 0.45 +
    clamp01(avgEthics / 100) * 0.3 +
    (1 - clamp01(avgRisk / 100)) * 0.25;

  const riskPenalty = Math.max(0, (avgRisk - 62) * 0.0032);
  const ethicsPenalty = Math.max(0, (58 - avgEthics) * 0.01);
  const fitness = Math.max(0, expectedSuccess * 0.76 + quality * 0.24 - intensityPenalty - riskPenalty - ethicsPenalty);

  return {
    genes: [...genes],
    expected_success: expectedSuccess,
    quality,
    avg_risk: avgRisk,
    avg_ethics: avgEthics,
    fitness
  };
}

function tournamentSelect(scoredPopulation, tournamentSize = 4) {
  let best = null;
  for (let i = 0; i < tournamentSize; i += 1) {
    const candidate = scoredPopulation[randomInt(scoredPopulation.length)];
    if (!best || candidate.fitness > best.fitness) best = candidate;
  }
  return best;
}

function crossover(parentA, parentB, crossoverRate = 0.82) {
  const size = parentA.length;
  if (Math.random() > crossoverRate || size < 2) return [...parentA];
  const point = 1 + randomInt(size - 1);
  return [...parentA.slice(0, point), ...parentB.slice(point)];
}

function mutate(genes, actionsPerNode, mutationRate) {
  const mutated = [...genes];
  for (let i = 0; i < mutated.length; i += 1) {
    if (Math.random() <= mutationRate) {
      mutated[i] = randomInt(actionsPerNode);
    }
  }
  return mutated;
}

function evolvePathways({
  actionSpace,
  populationSize,
  generations,
  mutationRate,
  eliteCount
}) {
  const nodeCount = actionSpace.length;
  const actionsPerNode = actionSpace[0]?.actions?.length || DEFAULT_ACTIONS_PER_NODE;
  let population = Array.from({ length: populationSize }, () => makeRandomChromosome(nodeCount, actionsPerNode));

  for (let generation = 0; generation < generations; generation += 1) {
    const scored = population
      .map((genes) => evaluateChromosome(genes, actionSpace))
      .sort((left, right) => right.fitness - left.fitness);

    const next = scored.slice(0, eliteCount).map((item) => [...item.genes]);
    while (next.length < populationSize) {
      const selectedA = tournamentSelect(scored, 4);
      const selectedB = tournamentSelect(scored, 4);
      const crossed = crossover(selectedA.genes, selectedB.genes, 0.82);
      const child = mutate(crossed, actionsPerNode, mutationRate);
      next.push(child);
    }
    population = next;
  }

  const evaluated = population
    .map((genes) => evaluateChromosome(genes, actionSpace))
    .sort((left, right) => right.fitness - left.fitness);

  const deduped = [];
  const seen = new Set();
  evaluated.forEach((item) => {
    const key = chromosomeKey(item.genes);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });
  return deduped;
}

function runMonteCarlo(nodePassPercents, reps) {
  const failByNode = Array.from({ length: nodePassPercents.length }, () => 0);
  let success = 0;

  for (let rep = 0; rep < reps; rep += 1) {
    let failed = false;
    for (let nodeIndex = 0; nodeIndex < nodePassPercents.length; nodeIndex += 1) {
      const beta = Math.random() * 100;
      if (beta <= nodePassPercents[nodeIndex]) continue;
      failByNode[nodeIndex] += 1;
      failed = true;
      break;
    }
    if (!failed) success += 1;
  }

  const hotspots = failByNode
    .map((count, index) => ({ node_index: index + 1, fail_count: count }))
    .sort((left, right) => right.fail_count - left.fail_count)
    .slice(0, 3);

  return {
    success_reps: success,
    total_reps: reps,
    success_probability_percent: clamp(Number(((success / reps) * 100).toFixed(2)), 0, 100),
    failure_hotspots: hotspots
  };
}

function buildPathwayView(item, rank, actionSpace, simulationReps) {
  const actions = [];
  const nodePassPercents = [];
  let totalRisk = 0;
  let totalEthics = 0;

  for (let nodeIndex = 0; nodeIndex < actionSpace.length; nodeIndex += 1) {
    const node = actionSpace[nodeIndex];
    const action = node.actions[item.genes[nodeIndex]] || node.actions[0];
    const nodePassPercent = Number(computeNodePassPercent(action).toFixed(2));
    nodePassPercents.push(nodePassPercent);
    totalRisk += clamp(action?.scores?.risk, 0, 100);
    totalEthics += clamp(action?.scores?.ethics, 0, 100);

    actions.push({
      node_index: nodeIndex + 1,
      node_title: node.node_title,
      action_id: action.id,
      action: action.action,
      rationale: action.rationale,
      scores: action.scores,
      node_pass_percent: nodePassPercent
    });
  }

  const simulation = runMonteCarlo(nodePassPercents, simulationReps);
  const averageRisk = Number((totalRisk / actionSpace.length).toFixed(2));
  const averageEthics = Number((totalEthics / actionSpace.length).toFixed(2));

  return {
    rank,
    pathway_id: `P${rank}`,
    gene_key: chromosomeKey(item.genes),
    expected_success_percent: Number((item.expected_success * 100).toFixed(2)),
    empirical_success_percent: simulation.success_probability_percent,
    success_reps: simulation.success_reps,
    total_reps: simulation.total_reps,
    average_risk_percent: averageRisk,
    average_ethics_percent: averageEthics,
    failure_hotspots: simulation.failure_hotspots,
    actions
  };
}

function buildSummary(topPathway, requestedOutcome) {
  if (!topPathway) return 'No viable pathway generated.';
  const success = Number(topPathway.empirical_success_percent || 0).toFixed(2);
  const risk = Number(topPathway.average_risk_percent || 0).toFixed(1);
  const ethics = Number(topPathway.average_ethics_percent || 0).toFixed(1);
  return `Best pathway for "${sanitizeText(requestedOutcome, 120)}" simulated at ${success}% success with avg risk ${risk}% and ethics ${ethics}%.`;
}

function sanitizeConfig(rawConfig) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  return {
    node_count: clampInt(config.node_count ?? DEFAULT_NODE_COUNT, 10, 10),
    actions_per_node: clampInt(config.actions_per_node ?? DEFAULT_ACTIONS_PER_NODE, 5, 5),
    population_size: clampInt(config.population_size ?? DEFAULT_POPULATION_SIZE, 40, 260),
    generations: clampInt(config.generations ?? DEFAULT_GENERATIONS, 20, 220),
    mutation_rate: clamp(config.mutation_rate ?? DEFAULT_MUTATION_RATE, 0.03, 0.45),
    elite_count: clampInt(config.elite_count ?? DEFAULT_ELITE_COUNT, 2, 16),
    top_pathways: clampInt(config.top_pathways ?? DEFAULT_TOP_PATHWAYS, 1, 10),
    simulation_reps: clampInt(config.simulation_reps ?? DEFAULT_MONTE_CARLO_REPS, 200, 4000)
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const userInitialContext = sanitizeText(body.initial_conditions || body.initialConditions || '', 1200);
  const requestedOutcome = sanitizeText(body.requested_outcome || body.requestedOutcome || '', 380);
  const personaA = body.personaA && typeof body.personaA === 'object' ? body.personaA : {};
  const personaB = body.personaB && typeof body.personaB === 'object' ? body.personaB : {};
  const config = sanitizeConfig(body.config);
  const actionSpaceOnly = Boolean(body.action_space_only || body.actionSpaceOnly);
  const inferredInitialConditions = summarizeInitialConditionsFromPersonas(personaA, personaB, userInitialContext);
  const effectiveInitialConditions = sanitizeText(inferredInitialConditions, 1200);
  const fail = (status, stage, message, extra = {}) =>
    res.status(status).json({
      error: `Outcome AG failed at ${stage}: ${message}`,
      stage,
      ...extra
    });

  if (!requestedOutcome) {
    return res.status(400).json({ error: 'requested_outcome is required' });
  }

  let nodes = [];
  let generatorSource = '';
  let modelUsed = '';
  let promptTemplateIdUsed = null;
  let promptTemplateVersionUsed = null;

  const apiKey = resolveEnv(['OPENAI_API_KEY', 'OPENAI_API_KEY_LOCAL', 'OPENAI_KEY']);
  const model = resolveEnv(['OPENAI_OUTCOME_MODEL', 'OPENAI_MODEL']) || 'gpt-5-nano';
  const promptTemplateId = sanitizeText(
    body?.prompt?.id ||
      body.outcome_prompt_id ||
      body.prompt_id ||
      resolveEnv(['OPENAI_OUTCOME_PROMPT_ID']) ||
      DEFAULT_OUTCOME_PROMPT_ID,
    128
  );
  const promptTemplateVersion = sanitizeText(
    body?.prompt?.version ||
      body.outcome_prompt_version ||
      body.prompt_version ||
      resolveEnv(['OPENAI_OUTCOME_PROMPT_VERSION']) ||
      DEFAULT_OUTCOME_PROMPT_VERSION,
    24
  );
  const requirePromptTemplate = parseBoolean(
    body.require_prompt_template ??
      body.requirePromptTemplate ??
      resolveEnv(['OPENAI_OUTCOME_REQUIRE_PROMPT_TEMPLATE']) ??
      'true',
    true
  );
  const usePromptVariables = parseBoolean(
    body.use_prompt_variables ??
      body.usePromptVariables ??
      resolveEnv(['OPENAI_OUTCOME_USE_PROMPT_VARIABLES']) ??
      'false',
    false
  );
  const allowInlineRetryAfterTemplateEmpty = parseBoolean(
    body.allow_inline_retry_after_template_empty ??
      body.allowInlineRetryAfterTemplateEmpty ??
      resolveEnv(['OPENAI_OUTCOME_ALLOW_INLINE_RETRY_AFTER_TEMPLATE_EMPTY']) ??
      'false',
    false
  );

  if (requirePromptTemplate && !promptTemplateId) {
    return fail(
      500,
      'configuration.prompt_template',
      'require_prompt_template is true but no prompt template ID was provided.'
    );
  }

  if (!apiKey) {
    return fail(500, 'configuration.openai_key', 'OPENAI_API_KEY is missing.');
  }

  try {
    let failureStage = 'build_generator_prompt';
    const { systemPrompt, userPrompt } = buildGeneratorPrompt({
      inferredInitialConditions,
      additionalContext: userInitialContext,
      requestedOutcome,
      personaA,
      personaB,
      nodeCount: config.node_count,
      actionsPerNode: config.actions_per_node
    });

    let generatedText = '';
    let generationMode = '';
    let promptTemplateError = null;
    let promptTemplateRaw = null;
    let templateAttempted = false;
    let templateProducedOutput = false;

    if (promptTemplateId) {
      templateAttempted = true;
      try {
        const promptVariables = usePromptVariables
          ? {
              requested_outcome: requestedOutcome,
              inferred_initial_conditions: effectiveInitialConditions,
              additional_context: userInitialContext,
              persona_a_label: sanitizeText(personaA?.label || personaA?.key || 'Persona A', 120),
              persona_b_label: sanitizeText(personaB?.label || personaB?.key || 'Persona B', 120),
              persona_a_profile_json: safeJson(compactProfile(personaA?.profile)),
              persona_b_profile_json: safeJson(compactProfile(personaB?.profile)),
              node_count: String(config.node_count),
              actions_per_node: String(config.actions_per_node)
            }
          : undefined;
        failureStage = 'openai.prompt_template.primary_request';
        const templated = await requestCompletionWithPromptTemplate({
          apiKey,
          promptId: promptTemplateId,
          promptVersion: promptTemplateVersion,
          promptVariables,
          model,
          systemPrompt,
          userPrompt,
          options: {
            useMessageInput: false,
            forceJsonObject: false,
            maxOutputTokens: 4200
          }
        });
        promptTemplateRaw = templated?.raw || null;
        generatedText = String(templated?.text || '').trim();

        if (!generatedText) {
          failureStage = 'openai.prompt_template.retry_request';
          const retryTemplated = await requestCompletionWithPromptTemplate({
            apiKey,
            promptId: promptTemplateId,
            promptVersion: promptTemplateVersion,
            promptVariables,
            model,
            systemPrompt,
            userPrompt,
            options: {
              useMessageInput: true,
              forceJsonObject: true,
              maxOutputTokens: 5200
            }
          });
          promptTemplateRaw = retryTemplated?.raw || promptTemplateRaw;
          generatedText = String(retryTemplated?.text || '').trim();
        }

        if (generatedText) {
          generationMode = 'llm_prompt_template';
          promptTemplateIdUsed = promptTemplateId;
          promptTemplateVersionUsed = promptTemplateVersion || null;
          templateProducedOutput = true;
        }
      } catch (error) {
        generatedText = '';
        promptTemplateError = error;
      }
    }

    if (!generatedText && requirePromptTemplate && !allowInlineRetryAfterTemplateEmpty) {
      const reason = sanitizeText(
        promptTemplateError?.message || 'Prompt template generation returned no output.',
        280
      );
      const rawStatus = sanitizeText(promptTemplateRaw?.status || '', 60);
      const rawIncompleteReason = sanitizeText(promptTemplateRaw?.incomplete_details?.reason || '', 120);
      return fail(502, 'openai.prompt_template_generation', reason, {
        prompt_template_id: promptTemplateId,
        prompt_template_version: promptTemplateVersion || null,
        response_status: rawStatus || null,
        response_incomplete_reason: rawIncompleteReason || null,
        response_id: sanitizeText(promptTemplateRaw?.id || '', 80) || null
      });
    }

    if (!generatedText) {
      failureStage = templateAttempted && !templateProducedOutput
        ? 'openai.inline_retry_after_template_empty'
        : 'openai.inline_generation';
      const completion = await requestCompletion({
        apiKey,
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      });
      generatedText = String(completion?.choices?.[0]?.message?.content || '').trim();
      if (generatedText) {
        generationMode = templateAttempted && !templateProducedOutput
          ? 'llm_inline_after_template_empty'
          : 'llm_inline_prompt';
        promptTemplateIdUsed = templateAttempted ? promptTemplateId : null;
        promptTemplateVersionUsed = templateAttempted ? (promptTemplateVersion || null) : null;
      }
    }

    if (!generatedText) {
      const reason = sanitizeText(
        promptTemplateError?.message || 'OpenAI returned no text output.',
        280
      );
      return fail(502, 'openai.generation_empty', reason, {
        prompt_template_id: templateAttempted ? promptTemplateId : null,
        prompt_template_version: templateAttempted ? (promptTemplateVersion || null) : null
      });
    }

    failureStage = 'openai.output_json_parse';
    const parsed = parseJsonObject(generatedText);
    if (!parsed || typeof parsed !== 'object') {
      return fail(502, failureStage, 'OpenAI output is not valid JSON object.', {
        output_excerpt: sanitizeText(generatedText, 500)
      });
    }

    failureStage = 'openai.output_node_extraction';
    const rawNodes = extractRawNodesFromGeneratedPayload(
      parsed,
      config.node_count,
      config.actions_per_node
    );
    if (!rawNodes.length) {
      return fail(502, failureStage, 'No nodes were found in OpenAI output.', {
        output_excerpt: sanitizeText(generatedText, 500)
      });
    }

    failureStage = 'openai.output_validation';
    const shapeValidation = validateGeneratedActionSpaceShape(
      rawNodes,
      config.node_count,
      config.actions_per_node
    );
    if (!shapeValidation.ok) {
      return fail(502, failureStage, sanitizeText(shapeValidation.reason, 320), {
        output_excerpt: sanitizeText(generatedText, 500)
      });
    }

    failureStage = 'openai.output_normalization';
    nodes = normalizeActionSpace(rawNodes, config.node_count, config.actions_per_node);
    if (!nodes.length) {
      return fail(502, failureStage, 'Normalized action space is empty.');
    }

    generatorSource = generationMode || 'llm_prompt_template';
    modelUsed = model;
  } catch (error) {
    const reason = sanitizeText(error?.message || 'Unexpected outcome generation error.', 320);
    return fail(502, 'openai.unhandled_exception', reason);
  }

  if (!Array.isArray(nodes) || !nodes.length) {
    return fail(502, 'openai.output_normalization', 'No usable action-space nodes were produced.');
  }

  const personaAKey = sanitizePersonaKey(personaA?.key);
  const personaBKey = sanitizePersonaKey(personaB?.key);
  const personaKeys = [personaAKey, personaBKey].filter(Boolean);
  const dedupPersonaKeys = Array.from(new Set(personaKeys));
  const chainCandidates = buildChainCandidates(
    nodes,
    requestedOutcome,
    effectiveInitialConditions,
    config.actions_per_node
  );
  const bestChain = chainCandidates[0] || null;

  if (actionSpaceOnly) {
    return res.status(200).json({
      report_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      generated_at: new Date().toISOString(),
      mode: 'action_generation_only',
      initial_conditions: effectiveInitialConditions,
      inferred_initial_conditions: inferredInitialConditions,
      user_initial_context: userInitialContext,
      requested_outcome: requestedOutcome,
      persona_a: {
        key: personaAKey,
        label: sanitizeText(personaA?.label || 'Persona A', 120)
      },
      persona_b: {
        key: personaBKey,
        label: sanitizeText(personaB?.label || 'Persona B', 120)
      },
      persona_keys: dedupPersonaKeys,
      config: {
        node_count: config.node_count,
        actions_per_node: config.actions_per_node
      },
      total_action_combinations: Math.pow(config.actions_per_node, config.node_count),
      action_space: nodes,
      chain_candidates: chainCandidates,
      best_chain: bestChain,
      summary: `Generated ${config.node_count} nodes × ${config.actions_per_node} actions and chained them into ${chainCandidates.length} gene-based action chains.`,
      generator_source: generatorSource,
      model_used: modelUsed || null,
      prompt_template_id_used: promptTemplateIdUsed,
      prompt_template_version_used: promptTemplateVersionUsed
    });
  }

  const evolved = evolvePathways({
    actionSpace: nodes,
    populationSize: config.population_size,
    generations: config.generations,
    mutationRate: config.mutation_rate,
    eliteCount: config.elite_count
  });

  const selected = evolved.slice(0, config.top_pathways);
  const topPathways = selected.map((item, index) =>
    buildPathwayView(item, index + 1, nodes, config.simulation_reps)
  );

  const best = topPathways[0] || null;

  const report = {
    report_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    generated_at: new Date().toISOString(),
    initial_conditions: effectiveInitialConditions,
    inferred_initial_conditions: inferredInitialConditions,
    user_initial_context: userInitialContext,
    requested_outcome: requestedOutcome,
    persona_a: {
      key: personaAKey,
      label: sanitizeText(personaA?.label || 'Persona A', 120)
    },
    persona_b: {
      key: personaBKey,
      label: sanitizeText(personaB?.label || 'Persona B', 120)
    },
    persona_keys: dedupPersonaKeys,
    config,
    total_action_combinations: Math.pow(config.actions_per_node, config.node_count),
    action_space: nodes,
    chain_candidates: chainCandidates,
    best_chain: bestChain,
    top_pathways: topPathways,
    best_pathway: best,
    summary: buildSummary(best, requestedOutcome),
    generator_source: generatorSource,
    model_used: modelUsed || null,
    prompt_template_id_used: promptTemplateIdUsed,
    prompt_template_version_used: promptTemplateVersionUsed
  };

  return res.status(200).json(report);
};
