"use strict";

const DC_RANGES = Object.freeze([
  { id: 1, label: "0-20", min: 0, max: 20 },
  { id: 2, label: "20-40", min: 20, max: 40 },
  { id: 3, label: "40-60", min: 40, max: 60 },
  { id: 4, label: "60-80", min: 60, max: 80 },
  { id: 5, label: "80-100", min: 80, max: 100 },
]);

const AXIS_META = Object.freeze([
  { id: "L1_A1", name: "Initiative" },
  { id: "L1_A2", name: "Persistence" },
  { id: "L1_A3", name: "Risk Engagement" },
  { id: "L1_A4", name: "Social Energy Direction" },
  { id: "L1_A5", name: "Conflict Response" },
  { id: "L1_A6", name: "Adaptation Speed" },
  { id: "L2_A1", name: "Stability ↔ Growth" },
  { id: "L2_A2", name: "Autonomy ↔ Coordination" },
  { id: "L2_A3", name: "Immediate ↔ Deferred Reward" },
  { id: "L2_A4", name: "Status ↔ Belonging" },
  { id: "L2_A5", name: "Internal ↔ External Validation" },
  { id: "L2_A6", name: "Depth ↔ Breadth" },
  { id: "L3_A1", name: "Honesty Boundary" },
  { id: "L3_A2", name: "Respect / Dignity Boundary" },
  { id: "L3_A3", name: "Loyalty / Commitment Boundary" },
  { id: "L3_A4", name: "Autonomy Intrusion Boundary" },
  { id: "L3_A5", name: "Fairness / Reciprocity Boundary" },
  { id: "L3_A6", name: "Risk / Safety Boundary" },
]);

const TASK_PATTERNS = Object.freeze({
  physical: /\b(boulder|bouldering|climb|hike|run|swim|gym|workout|sport|tennis|ski|surf|boxing|marathon)\b/i,
  social: /\b(date|dinner|lunch|restaurant|hang out|party|concert|bar|club|event|friends|group)\b/i,
  commitment: /\b(exclusive|relationship|commit|marry|marriage|move in|parents|long[- ]term|serious)\b/i,
  vulnerability: /\b(confess|apologize|sorry|honest|truth|feelings|open up|vulnerable|heart-to-heart)\b/i,
  resource: /\b(travel|trip|flight|drive|weekend|money|pay|buy|expensive|loan|help me move)\b/i,
  low_stakes: /\b(coffee|text|chat|call|walk|quick|short|casual)\b/i,
});

const NONE_TEXT_RE = /\b(none|nope|not sure|unknown|n\/a|na|nil|nothing)\b/i;
const CRITICAL_FIXED_DC = Object.freeze({
  conflict: 90,
  support: 10,
});

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function hasMeaningfulText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return !NONE_TEXT_RE.test(text);
}

function toUniqueList(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function splitTerms(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  return toUniqueList(
    raw
      .split(/[,\n;|/]+/)
      .map((part) => normalizeText(part))
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter((part) => part.length >= 2 && !NONE_TEXT_RE.test(part))
  );
}

function includesTerm(text, term) {
  const haystack = normalizeText(text);
  const needle = normalizeText(term);
  if (!haystack || !needle) return false;
  return haystack.includes(needle);
}

function extractCriticalFactorsFromPersona(personaProfile) {
  const factors =
    personaProfile?.critical_factors && typeof personaProfile.critical_factors === "object"
      ? personaProfile.critical_factors
      : {};

  return {
    physicalIncapability: String(factors.physical_incapability || "").trim(),
    hardNoActivities: String(factors.hard_no_activities || "").trim(),
    absoluteBoundaries: String(factors.absolute_boundaries || "").trim(),
    favoriteDishes: String(factors.favorite_dishes || "").trim(),
    favoriteColors: String(factors.favorite_colors || "").trim(),
    preferredActivities: String(factors.preferred_activities || "").trim(),
    extremeDislikes: String(factors.extreme_dislikes || "").trim(),
    strongLikes: String(factors.strong_likes || "").trim(),
  };
}

function detectCriticalFactorOverride({ taskText, personaProfile, taskSignals }) {
  const text = String(taskText || "").trim();
  const lowerTask = normalizeText(text);
  const factors = extractCriticalFactorsFromPersona(personaProfile);
  const signals = taskSignals || detectTaskSignals(text);

  const hardNoActivities = splitTerms(factors.hardNoActivities);
  const absoluteBoundaries = splitTerms(factors.absoluteBoundaries);
  const extremeDislikes = splitTerms(factors.extremeDislikes);
  const favoriteDishes = splitTerms(factors.favoriteDishes);
  const favoriteColors = splitTerms(factors.favoriteColors);
  const preferredActivities = splitTerms(factors.preferredActivities);
  const strongLikes = splitTerms(factors.strongLikes);

  const conflictMatches = [];
  const supportMatches = [];

  if (signals.physical && hasMeaningfulText(factors.physicalIncapability)) {
    conflictMatches.push({
      source: "physical_incapability",
      term: factors.physicalIncapability,
      reason: "Task appears physical while profile states physical incapability.",
    });
  }

  for (const term of hardNoActivities) {
    if (includesTerm(lowerTask, term)) {
      conflictMatches.push({
        source: "hard_no_activities",
        term,
        reason: "Task matches an activity marked as hard-no.",
      });
    }
  }

  for (const term of absoluteBoundaries) {
    if (includesTerm(lowerTask, term)) {
      conflictMatches.push({
        source: "absolute_boundaries",
        term,
        reason: "Task matches an absolute boundary.",
      });
    }
  }

  for (const term of extremeDislikes) {
    if (includesTerm(lowerTask, term)) {
      conflictMatches.push({
        source: "extreme_dislikes",
        term,
        reason: "Task matches an extreme dislike.",
      });
    }
  }

  for (const term of favoriteDishes) {
    if (includesTerm(lowerTask, term)) {
      supportMatches.push({
        source: "favorite_dishes",
        term,
        reason: "Task matches favorite dish/food preference.",
      });
    }
  }

  for (const term of favoriteColors) {
    if (includesTerm(lowerTask, term)) {
      supportMatches.push({
        source: "favorite_colors",
        term,
        reason: "Task matches favorite color preference.",
      });
    }
  }

  for (const term of preferredActivities) {
    if (includesTerm(lowerTask, term)) {
      supportMatches.push({
        source: "preferred_activities",
        term,
        reason: "Task matches preferred activity.",
      });
    }
  }

  for (const term of strongLikes) {
    if (includesTerm(lowerTask, term)) {
      supportMatches.push({
        source: "strong_likes",
        term,
        reason: "Task matches strong like.",
      });
    }
  }

  if (conflictMatches.length) {
    return {
      isCritical: true,
      outcome: "conflict",
      fixedDC: CRITICAL_FIXED_DC.conflict,
      matched: conflictMatches,
      factors,
    };
  }

  if (supportMatches.length) {
    return {
      isCritical: true,
      outcome: "support",
      fixedDC: CRITICAL_FIXED_DC.support,
      matched: supportMatches,
      factors,
    };
  }

  return {
    isCritical: false,
    outcome: null,
    fixedDC: null,
    matched: [],
    factors,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomIntInclusive(min, max, rng) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function rollD100(rng = Math.random) {
  return randomIntInclusive(1, 100, rng);
}

function normalizeAxisValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.5;
  if (num > 1) return clamp(num / 100, 0, 1);
  return clamp(num, 0, 1);
}

function extractAxisScoresFromPersonaProfile(personaProfile) {
  const axisScores = personaProfile?.axis_scores || {};
  const merged = {
    ...(axisScores.L1 || {}),
    ...(axisScores.L2 || {}),
    ...(axisScores.L3 || {}),
  };

  const out = {};
  for (const axis of AXIS_META) {
    const raw = merged[axis.id];
    const value =
      raw && typeof raw === "object" && raw.value != null
        ? raw.value
        : raw;
    out[axis.id] = normalizeAxisValue(value);
  }
  return out;
}

function summarizeAxesForPrompt(axisScoresById) {
  return AXIS_META.map((axis) => ({
    axis_id: axis.id,
    axis_name: axis.name,
    score_0_to_100: Math.round(clamp((axisScoresById[axis.id] ?? 0.5) * 100, 0, 100)),
  }));
}

function detectTaskSignals(taskText) {
  const text = String(taskText || "").trim();
  return {
    physical: TASK_PATTERNS.physical.test(text),
    social: TASK_PATTERNS.social.test(text),
    commitment: TASK_PATTERNS.commitment.test(text),
    vulnerability: TASK_PATTERNS.vulnerability.test(text),
    resource: TASK_PATTERNS.resource.test(text),
    lowStakes: TASK_PATTERNS.low_stakes.test(text),
  };
}

function chooseRangeByScore(score) {
  const clamped = clamp(Math.round(score), 0, 100);
  if (clamped <= 20) return DC_RANGES[0];
  if (clamped <= 40) return DC_RANGES[1];
  if (clamped <= 60) return DC_RANGES[2];
  if (clamped <= 80) return DC_RANGES[3];
  return DC_RANGES[4];
}

function classifyDcRangeDeterministic({ taskText, personaProfile }) {
  const axis = extractAxisScoresFromPersonaProfile(personaProfile);
  const signals = detectTaskSignals(taskText);

  const initiative = axis.L1_A1;
  const persistence = axis.L1_A2;
  const riskEngagement = axis.L1_A3;
  const socialEnergy = axis.L1_A4;
  const adaptation = axis.L1_A6;
  const belonging = axis.L2_A4;
  const commitmentBoundary = axis.L3_A3;
  const intrusionBoundary = axis.L3_A4;
  const riskSafetyBoundary = axis.L3_A6;

  let score = 50;

  if (signals.physical) {
    score += 10;
    score += (riskSafetyBoundary - 0.5) * 22;
    score -= (riskEngagement - 0.5) * 16;
    score -= (adaptation - 0.5) * 8;
  }

  if (signals.social) {
    score -= (socialEnergy - 0.5) * 18;
    score -= (belonging - 0.5) * 10;
    score += (intrusionBoundary - 0.5) * 10;
  }

  if (signals.commitment) {
    score += 15;
    score += (commitmentBoundary - 0.5) * 20;
    score += (intrusionBoundary - 0.5) * 10;
  }

  if (signals.vulnerability) {
    score += 8;
    score += (commitmentBoundary - 0.5) * 10;
  }

  if (signals.resource) {
    score += 8;
    score += (persistence - 0.5) * 4;
  }

  if (signals.lowStakes) {
    score -= 10;
  }

  score -= (initiative - 0.5) * 8;

  const chosenRange = chooseRangeByScore(score);
  return {
    source: "deterministic_traits",
    rawDifficultyScore: clamp(Math.round(score), 0, 100),
    range: chosenRange,
    signals,
    axisScores: axis,
    axisSummary: summarizeAxesForPrompt(axis),
  };
}

function sanitizeRangeId(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  const rounded = Math.round(n);
  return clamp(rounded, 1, 5);
}

function selectRangeById(rangeId) {
  return DC_RANGES.find((r) => r.id === rangeId) || DC_RANGES[2];
}

function drawDcInRange(range, rng = Math.random) {
  const min = clamp(Math.round(range.min), 0, 100);
  const max = clamp(Math.round(range.max), min, 100);
  return randomIntInclusive(min, max, rng);
}

function simulateDcPassRate({
  dc,
  rolls = 100,
  rng = Math.random,
}) {
  const totalRolls = clamp(Math.round(Number(rolls) || 100), 1, 10000);
  let successCount = 0;
  const rollLog = [];

  for (let i = 0; i < totalRolls; i += 1) {
    const beta = rollD100(rng);
    const passed = beta > dc;
    if (passed) successCount += 1;
    rollLog.push({
      rep: i + 1,
      beta,
      passed,
    });
  }

  return {
    dc,
    totalRolls,
    successCount,
    failureCount: totalRolls - successCount,
    successProbability: successCount / totalRolls,
    rollLog,
  };
}

function runTaskDcSimulation({
  taskText,
  personaProfile,
  rangeId,
  rolls = 100,
  rng = Math.random,
}) {
  const baseClassification = classifyDcRangeDeterministic({
    taskText,
    personaProfile,
  });
  const criticalOverride = detectCriticalFactorOverride({
    taskText,
    personaProfile,
    taskSignals: baseClassification.signals,
  });
  if (criticalOverride.fixedDC != null) {
    const selectedRange = chooseRangeByScore(criticalOverride.fixedDC);
    const simulation = simulateDcPassRate({
      dc: criticalOverride.fixedDC,
      rolls,
      rng,
    });
    return {
      taskText: String(taskText || "").trim(),
      range: selectedRange,
      classification: baseClassification,
      simulation,
      criticalOverride,
    };
  }

  const selectedRange = rangeId
    ? selectRangeById(sanitizeRangeId(rangeId))
    : baseClassification.range;
  const dc = drawDcInRange(selectedRange, rng);
  const simulation = simulateDcPassRate({ dc, rolls, rng });

  return {
    taskText: String(taskText || "").trim(),
    range: selectedRange,
    classification: baseClassification,
    simulation,
    criticalOverride,
  };
}

module.exports = {
  AXIS_META,
  CRITICAL_FIXED_DC,
  DC_RANGES,
  classifyDcRangeDeterministic,
  detectCriticalFactorOverride,
  detectTaskSignals,
  drawDcInRange,
  extractAxisScoresFromPersonaProfile,
  rollD100,
  runTaskDcSimulation,
  sanitizeRangeId,
  selectRangeById,
  simulateDcPassRate,
  summarizeAxesForPrompt,
};
