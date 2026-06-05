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

  return res.status(200).json({
    ...fallback,
    model: 'Deterministic heuristic'
  });
};
