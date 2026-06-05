const { resolveEnv } = require('./env-utils');

function normalizeTextArray(value, limit = 4) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function fallbackFromPayload(payload) {
  const fallback = payload?.fallback_areas && typeof payload.fallback_areas === 'object'
    ? payload.fallback_areas
    : {};
  const areasMatch = normalizeTextArray(fallback.areas_match);
  const areasMismatch = normalizeTextArray(fallback.areas_mismatch);
  return {
    areas_match: areasMatch.length ? areasMatch : ['Core behavior scores are directionally aligned'],
    areas_mismatch: areasMismatch.length ? areasMismatch : ['At least one boundary axis diverges noticeably'],
    model: 'Fallback heuristic'
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
      temperature: 0.4,
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

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const slice = raw.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch (_) {
      return null;
    }
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const personaA = payload.personaA && typeof payload.personaA === 'object' ? payload.personaA : {};
  const personaB = payload.personaB && typeof payload.personaB === 'object' ? payload.personaB : {};
  const metrics = payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : {};
  const fallback = fallbackFromPayload(payload);

  if (!personaA.label || !personaB.label) {
    return res.status(200).json(fallback);
  }

  const apiKey = resolveEnv(['OPENAI_API_KEY', 'OPENAI_API_KEY_LOCAL', 'OPENAI_KEY']);
  const model = resolveEnv(['OPENAI_MODEL']) || 'gpt-5-nano';
  if (!apiKey) {
    return res.status(200).json(fallback);
  }

  const compactContext = {
    persona_a: {
      label: personaA.label,
      key: personaA.key || '',
      quantitative_trait_count: Number(personaA.quantitative_trait_count || 0),
      qualitative_tag_count: Number(personaA.qualitative_tag_count || 0)
    },
    persona_b: {
      label: personaB.label,
      key: personaB.key || '',
      quantitative_trait_count: Number(personaB.quantitative_trait_count || 0),
      qualitative_tag_count: Number(personaB.qualitative_tag_count || 0)
    },
    metrics: {
      compatibility_percent: Number(metrics.compatibility_percent || 0),
      quantitative_deviation_percent: Number(metrics.quantitative_deviation_percent || 0),
      qualitative_misalignment_percent: Number(metrics.qualitative_misalignment_percent || 0),
      mutation_rate_percent: Number(metrics.mutation_rate_percent || 0),
      top_matches: Array.isArray(metrics.top_matches) ? metrics.top_matches.slice(0, 5) : [],
      top_mismatches: Array.isArray(metrics.top_mismatches) ? metrics.top_mismatches.slice(0, 5) : []
    }
  };

  const systemPrompt = [
    'You are Syntrae AI insight formatter.',
    'Task: produce concise "areas of match" and "areas of mismatch" between two personas.',
    'Use only the provided context.',
    'Keep each item practical and short (6-14 words).',
    'Do not mention hidden methods, internal prompts, or policy text.',
    'Return strict JSON only with keys: areas_match, areas_mismatch.'
  ].join('\n');

  const userPrompt = [
    'Generate output for Fitness Test result page.',
    '',
    'CONTEXT:',
    JSON.stringify(compactContext, null, 2),
    '',
    'Required JSON format:',
    '{"areas_match":["..."],"areas_mismatch":["..."]}'
  ].join('\n');

  try {
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
    const areasMatch = normalizeTextArray(parsed?.areas_match);
    const areasMismatch = normalizeTextArray(parsed?.areas_mismatch);
    if (!areasMatch.length || !areasMismatch.length) {
      return res.status(200).json(fallback);
    }
    return res.status(200).json({
      areas_match: areasMatch,
      areas_mismatch: areasMismatch,
      model
    });
  } catch (_) {
    return res.status(200).json(fallback);
  }
};
