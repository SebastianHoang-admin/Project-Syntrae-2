const { resolveEnv } = require('./env-utils');

const DEFAULT_NODE_COUNT = 10;
const DEFAULT_ACTIONS_PER_NODE = 5;
const DEFAULT_POPULATION_SIZE = 140;
const DEFAULT_GENERATIONS = 90;
const DEFAULT_MUTATION_RATE = 0.14;
const DEFAULT_ELITE_COUNT = 8;
const DEFAULT_TOP_PATHWAYS = 5;
const DEFAULT_MONTE_CARLO_REPS = 1000;

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
    'Write a one-line definition of the requested outcome.',
    'Define a conservative version of the same outcome.',
    'Define an ambitious version of the same outcome.',
    'List the non-negotiable ethical constraints before acting.',
    'Set a realistic time window for the outcome.'
  ],
  [
    'Check hard boundaries and known dislikes before outreach.',
    'Remove any step that could pressure or corner the target.',
    'Choose an ask format that allows an easy decline.',
    'Ensure the ask can be completed safely and legally.',
    'Prepare a fallback outcome with lower pressure.'
  ],
  [
    'Pick a timing window that matches likely energy and availability.',
    'Avoid high-stress hours and rushed time slots.',
    'Schedule the ask when context supports receptivity.',
    'Delay the ask if temporary conditions are unfavorable.',
    'Choose a short interaction window to reduce friction.'
  ],
  [
    'Open with a concise, respectful context statement.',
    'Start with shared interest before proposing the ask.',
    'Use a low-pressure opener with explicit optionality.',
    'Use a direct opener with clear intent and no ambiguity.',
    'Use a curiosity opener and ask for preference first.'
  ],
  [
    'Propose an action tightly aligned with known preferences.',
    'Offer two options with equal dignity and easy opt-out.',
    'Ask for a small, reversible commitment first.',
    'Frame the ask around mutual value, not pressure.',
    'Keep scope narrow and concrete to increase clarity.'
  ],
  [
    'Offer a low-effort version of the same plan.',
    'Reduce cost, distance, or time burden where possible.',
    'Give an explicit no-pressure fallback path.',
    'Adapt wording to respect autonomy and boundaries.',
    'Remove unnecessary complexity from the plan.'
  ],
  [
    'Confirm exact time/place with a brief check-in.',
    'Confirm preferences that matter for comfort.',
    'Send one concise reminder and avoid repeated nudges.',
    'Keep logistics simple with one clear next step.',
    'Confirm consent and expectations before proceeding.'
  ],
  [
    'Execute exactly as agreed with no last-minute pressure.',
    'Stay attentive to feedback and adjust respectfully.',
    'Keep tone consistent with prior expectations.',
    'Prioritize comfort, safety, and legal boundaries.',
    'If resistance appears, de-escalate and offer an exit.'
  ],
  [
    'Send a concise follow-up acknowledging their response.',
    'Ask one short reflection question to understand fit.',
    'Express appreciation without escalating pressure.',
    'If declined, close respectfully and keep dignity intact.',
    'If positive, suggest one realistic next step.'
  ],
  [
    'Evaluate whether requested outcome was achieved.',
    'If partial success, define one incremental next action.',
    'If no success, pivot to a lower-friction outcome.',
    'Document what worked and what created resistance.',
    'Preserve long-term trust over short-term gains.'
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

function safeJson(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
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

function buildGeneratorPrompt({
  initialConditions,
  requestedOutcome,
  personaA,
  personaB,
  nodeCount,
  actionsPerNode
}) {
  const safeOutcome = sanitizeText(requestedOutcome, 320);
  const safeContext = sanitizeText(initialConditions, 560);
  const safePersonaA = {
    key: sanitizePersonaKey(personaA?.key),
    label: sanitizeText(personaA?.label, 120),
    profile: compactProfile(personaA?.profile)
  };
  const safePersonaB = {
    key: sanitizePersonaKey(personaB?.key),
    label: sanitizeText(personaB?.label, 120),
    profile: compactProfile(personaB?.profile)
  };

  const systemPrompt = [
    'You are Syntrae AI Outcome Test action-space generator.',
    'Generate realistic, ethical, legal social-action options.',
    'Never include coercion, manipulation, stalking, harassment, deception, or illegal advice.',
    'Actions must be practical for real-world respectful communication.',
    'Return strict JSON only. No markdown.'
  ].join('\n');

  const userPrompt = [
    'Build action-space for evolutionary optimization.',
    `Requested outcome: ${safeOutcome || '(missing)'}`,
    `Initial conditions/context: ${safeContext || '(missing)'}`,
    '',
    'Persona A (initiator):',
    safeJson(safePersonaA),
    '',
    'Persona B (target):',
    safeJson(safePersonaB),
    '',
    `Requirements: exactly ${nodeCount} nodes, exactly ${actionsPerNode} actions per node.`,
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
    '          "action":"...",',
    '          "rationale":"...",',
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

function buildFallbackActionSpace({ requestedOutcome, nodeCount, actionsPerNode }) {
  const safeOutcome = sanitizeText(requestedOutcome, 140) || 'the requested outcome';
  const nodes = [];

  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const title = FALLBACK_NODE_TITLES[nodeIndex] || `Node ${nodeIndex + 1}`;
    const nodeActions = FALLBACK_NODE_ACTIONS[nodeIndex] || [];
    const actions = [];

    for (let actionIndex = 0; actionIndex < actionsPerNode; actionIndex += 1) {
      const baseText = nodeActions[actionIndex] || `Take a realistic action for step ${nodeIndex + 1}.`;
      const delta = VARIANT_DELTAS[actionIndex] || VARIANT_DELTAS[0];
      const fitBase = 64 + nodeIndex * 1.4;
      const feasibilityBase = 68 + (nodeIndex % 3) * 2.5;
      const ethicsBase = 86 - (nodeIndex % 2) * 1.5;
      const riskBase = 28 + (nodeIndex % 4) * 5;
      const momentumBase = 62 + nodeIndex * 2;
      const intensityBase = 30 + nodeIndex * 4;

      actions.push({
        id: `N${nodeIndex + 1}A${actionIndex + 1}`,
        action: sanitizeText(baseText.replaceAll('the requested outcome', safeOutcome), 160),
        rationale: sanitizeText(`Supports progress toward ${safeOutcome} while preserving consent and dignity.`, 180),
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

function normalizeAction(rawAction, fallbackAction, nodeIndex, actionIndex) {
  const raw = rawAction && typeof rawAction === 'object' ? rawAction : {};
  const fallback = fallbackAction && typeof fallbackAction === 'object' ? fallbackAction : {};
  const scoreSource = raw.scores && typeof raw.scores === 'object' ? raw.scores : raw;
  const fallbackScores = fallback.scores && typeof fallback.scores === 'object' ? fallback.scores : {};

  return {
    id: sanitizeText(raw.id || `N${nodeIndex + 1}A${actionIndex + 1}`, 20),
    action: sanitizeText(raw.action || raw.name || raw.title || fallback.action || `Action ${actionIndex + 1}`, 180),
    rationale: sanitizeText(
      raw.rationale || raw.why || raw.description || fallback.rationale || 'Supports the requested outcome.',
      220
    ),
    scores: {
      fit: normalizeScore(scoreSource.fit, fallbackScores.fit ?? 70),
      feasibility: normalizeScore(scoreSource.feasibility, fallbackScores.feasibility ?? 70),
      ethics: normalizeScore(scoreSource.ethics, fallbackScores.ethics ?? 80),
      risk: normalizeScore(scoreSource.risk, fallbackScores.risk ?? 35),
      momentum: normalizeScore(scoreSource.momentum, fallbackScores.momentum ?? 65),
      intensity: normalizeScore(scoreSource.intensity, fallbackScores.intensity ?? 40)
    }
  };
}

function normalizeActionSpace(rawNodes, fallbackNodes, nodeCount, actionsPerNode) {
  const sourceNodes = Array.isArray(rawNodes) ? rawNodes : [];
  const normalized = [];

  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const fallbackNode = fallbackNodes[nodeIndex];
    const fromIndex = sourceNodes[nodeIndex];
    const fromTag = sourceNodes.find((node) => Number(node?.node_index) === nodeIndex + 1);
    const rawNode = fromTag || fromIndex || {};
    const rawActions = Array.isArray(rawNode?.actions) ? rawNode.actions : [];
    const actions = [];

    for (let actionIndex = 0; actionIndex < actionsPerNode; actionIndex += 1) {
      const fallbackAction = fallbackNode.actions[actionIndex];
      const rawAction = rawActions[actionIndex];
      actions.push(normalizeAction(rawAction, fallbackAction, nodeIndex, actionIndex));
    }

    normalized.push({
      node_index: nodeIndex + 1,
      node_title: sanitizeText(rawNode?.node_title || rawNode?.title || fallbackNode.node_title, 90),
      actions
    });
  }

  return normalized;
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
  const initialConditions = sanitizeText(body.initial_conditions || body.initialConditions || '', 1200);
  const requestedOutcome = sanitizeText(body.requested_outcome || body.requestedOutcome || '', 380);
  const personaA = body.personaA && typeof body.personaA === 'object' ? body.personaA : {};
  const personaB = body.personaB && typeof body.personaB === 'object' ? body.personaB : {};
  const config = sanitizeConfig(body.config);
  const actionSpaceOnly = Boolean(body.action_space_only || body.actionSpaceOnly);

  if (!requestedOutcome) {
    return res.status(400).json({ error: 'requested_outcome is required' });
  }

  const fallbackNodes = buildFallbackActionSpace({
    requestedOutcome,
    nodeCount: config.node_count,
    actionsPerNode: config.actions_per_node
  });

  let nodes = fallbackNodes;
  let generatorSource = 'fallback';
  let modelUsed = '';

  const apiKey = resolveEnv(['OPENAI_API_KEY', 'OPENAI_API_KEY_LOCAL', 'OPENAI_KEY']);
  const model = resolveEnv(['OPENAI_OUTCOME_MODEL', 'OPENAI_MODEL']) || 'gpt-5-nano';

  if (apiKey) {
    try {
      const { systemPrompt, userPrompt } = buildGeneratorPrompt({
        initialConditions,
        requestedOutcome,
        personaA,
        personaB,
        nodeCount: config.node_count,
        actionsPerNode: config.actions_per_node
      });
      const completion = await requestCompletion({
        apiKey,
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      });
      const text = completion?.choices?.[0]?.message?.content || '';
      const parsed = parseJsonObject(text);
      const rawNodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
      nodes = normalizeActionSpace(rawNodes, fallbackNodes, config.node_count, config.actions_per_node);
      generatorSource = rawNodes.length ? 'llm' : 'fallback';
      modelUsed = model;
    } catch (_) {
      nodes = fallbackNodes;
      generatorSource = 'fallback';
      modelUsed = '';
    }
  }

  const personaAKey = sanitizePersonaKey(personaA?.key);
  const personaBKey = sanitizePersonaKey(personaB?.key);
  const personaKeys = [personaAKey, personaBKey].filter(Boolean);
  const dedupPersonaKeys = Array.from(new Set(personaKeys));

  if (actionSpaceOnly) {
    return res.status(200).json({
      report_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      generated_at: new Date().toISOString(),
      mode: 'action_generation_only',
      initial_conditions: initialConditions,
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
      summary: `Generated ${config.node_count} nodes × ${config.actions_per_node} actions for the requested outcome.`,
      generator_source: generatorSource,
      model_used: modelUsed || null
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
    initial_conditions: initialConditions,
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
    top_pathways: topPathways,
    best_pathway: best,
    summary: buildSummary(best, requestedOutcome),
    generator_source: generatorSource,
    model_used: modelUsed || null
  };

  return res.status(200).json(report);
};
