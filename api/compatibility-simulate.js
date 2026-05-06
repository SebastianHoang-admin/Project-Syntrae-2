const {
  DEFAULT_TRIAL_CONFIG,
  optimizeDifficultiesGradientDescent,
  simulateTrialFromGenome,
  sanitizeExtensionPoints,
} = require("../causal-pathway-simulator.js");
const { resolveEnv } = require("./env-utils");

const PERSONA_KEY_RE = /[^a-z0-9_-]/g;
const AXIS_IDS = Object.freeze([
  "L1_A1", "L1_A2", "L1_A3", "L1_A4", "L1_A5", "L1_A6",
  "L2_A1", "L2_A2", "L2_A3", "L2_A4", "L2_A5", "L2_A6",
  "L3_A1", "L3_A2", "L3_A3", "L3_A4", "L3_A5", "L3_A6",
]);

function sanitizePersonaKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  const cleaned = normalized.replace(PERSONA_KEY_RE, "");
  return cleaned || "";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeJson(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch (_) {
    return "{}";
  }
}

function normalizeAxisValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num > 1) return clamp(num / 100, 0, 1);
  return clamp(num, 0, 1);
}

function parseJsonObject(content) {
  if (content && typeof content === "object" && !Array.isArray(content)) return content;
  if (typeof content !== "string") return null;
  const stripped = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch (_) {
    return null;
  }
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { method: "GET", headers });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

async function fetchSupabaseUser(supabaseUrl, anonKey, accessToken) {
  return fetchJson(`${supabaseUrl}/auth/v1/user`, {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  });
}

async function fetchUserProfile(supabaseUrl, anonKey, accessToken, userId) {
  const url = `${supabaseUrl}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(
    userId
  )}&select=user_id,first_name,last_name,occupation,organization,location,profile&limit=1`;
  const { ok, body } = await fetchJson(url, {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  });
  if (!ok || !Array.isArray(body) || !body.length) return null;
  return body[0];
}

async function fetchPersonaByKey(supabaseUrl, anonKey, accessToken, userId, personaKey) {
  const filters = [
    `user_id=eq.${encodeURIComponent(userId)}`,
    `persona_key=eq.${encodeURIComponent(personaKey)}`,
    "select=id,persona_key,name,state,traits,profile,updated_at",
    "limit=1",
  ];
  const url = `${supabaseUrl}/rest/v1/personas?${filters.join("&")}`;
  const { ok, body } = await fetchJson(url, {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  });
  if (!ok || !Array.isArray(body) || !body.length) return null;
  return body[0];
}

async function fetchPersonasForUser(supabaseUrl, anonKey, accessToken, userId) {
  const url = `${supabaseUrl}/rest/v1/personas?user_id=eq.${encodeURIComponent(
    userId
  )}&select=persona_key,name,updated_at&order=updated_at.desc&limit=100`;
  const { ok, body } = await fetchJson(url, {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  });
  if (!ok || !Array.isArray(body)) return [];
  return body
    .map((row) => ({
      key: sanitizePersonaKey(row?.persona_key || ""),
      name: String(row?.name || "").trim() || sanitizePersonaKey(row?.persona_key || ""),
      updatedAt: row?.updated_at || null,
    }))
    .filter((row) => row.key);
}

function buildPersonaProfile(personaRow) {
  if (!personaRow || typeof personaRow !== "object") return {};
  if (personaRow.profile && typeof personaRow.profile === "object") return personaRow.profile;
  const state = personaRow.state && typeof personaRow.state === "object" ? personaRow.state : {};
  const traits = personaRow.traits && typeof personaRow.traits === "object" ? personaRow.traits : {};
  return {
    personaName: state.personaName || personaRow.name || "",
    identityLayers: state.identityLayers || {},
    traits,
    extras: state.extras || {},
    usersInput: state.usersInput || "",
  };
}

function extractAxisScores(profile) {
  const axisScores = profile?.axis_scores || {};
  const merged = {
    ...(axisScores.L1 || {}),
    ...(axisScores.L2 || {}),
    ...(axisScores.L3 || {}),
  };
  const out = {};
  for (const axisId of AXIS_IDS) {
    const raw = merged?.[axisId];
    const value =
      raw && typeof raw === "object" && raw.value != null
        ? raw.value
        : raw;
    out[axisId] = normalizeAxisValue(value);
  }
  return out;
}

function computeAlignmentSummary(userScores, crushScores) {
  let sumAlignment = 0;
  let counted = 0;
  const perAxis = {};

  for (const axisId of AXIS_IDS) {
    const a = userScores?.[axisId];
    const b = crushScores?.[axisId];
    if (typeof a !== "number" || typeof b !== "number") continue;
    const gap = Math.abs(a - b);
    const alignment = 1 - gap;
    perAxis[axisId] = { user: a, crush: b, gap, alignment };
    sumAlignment += alignment;
    counted += 1;
  }

  const meanAlignment = counted ? sumAlignment / counted : 0.5;
  return {
    countedAxes: counted,
    meanAlignment,
    meanGap: 1 - meanAlignment,
    perAxis,
  };
}

const QUAL_LABEL_SCORES = Object.freeze({
  very_low: -24,
  low: -12,
  medium: 0,
  neutral: 0,
  high: 12,
  very_high: 24,
});

function keywordScore(text, positives, negatives) {
  const lower = String(text || "").toLowerCase();
  let score = 0;
  for (const w of positives) if (lower.includes(w)) score += 4;
  for (const w of negatives) if (lower.includes(w)) score -= 4;
  return score;
}

function mapQualToScore(raw, channel) {
  if (typeof raw === "number" && Number.isFinite(raw)) return clamp(raw, -30, 30);

  const positiveByChannel = {
    relationship: ["close", "trust", "warm", "familiar", "secure", "bonded"],
    timely: ["good timing", "available", "free", "receptive", "open", "calm"],
    background: ["advantage", "fit", "aligned", "leverage", "credible", "stable"],
  };
  const negativeByChannel = {
    relationship: ["distant", "cold", "conflict", "strained", "awkward", "mistrust"],
    timely: ["bad timing", "busy", "stressed", "overwhelmed", "crisis", "breakup"],
    background: ["disadvantage", "mismatch", "incompatible", "unstable", "weak leverage"],
  };

  if (typeof raw === "string") {
    const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
    const label = QUAL_LABEL_SCORES[key] ?? 0;
    const kw = keywordScore(raw, positiveByChannel[channel] || [], negativeByChannel[channel] || []);
    return clamp(label + kw, -30, 30);
  }

  if (raw && typeof raw === "object") {
    const explicit = Number(raw.score);
    if (Number.isFinite(explicit)) return clamp(explicit, -30, 30);
    const labelKey = String(raw.level || raw.label || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    const label = QUAL_LABEL_SCORES[labelKey] ?? 0;
    const intensity = clamp(Number(raw.intensity ?? 1), 0, 2);
    const text = String(raw.text || raw.notes || "").trim();
    const kw = keywordScore(text, positiveByChannel[channel] || [], negativeByChannel[channel] || []);
    return clamp(Math.round((label + kw) * intensity), -30, 30);
  }

  return 0;
}

function qualitativeToExtensionPoints(qualitativeInput = {}) {
  return sanitizeExtensionPoints({
    relationship: mapQualToScore(qualitativeInput.relationship, "relationship"),
    timely: mapQualToScore(qualitativeInput.timely, "timely"),
    background: mapQualToScore(qualitativeInput.background, "background"),
  });
}

function deterministicExtensionPointsFromData({ alignmentSummary }) {
  const relationship = clamp(Math.round((alignmentSummary.meanAlignment - 0.5) * 44), -30, 30);
  const timely = 0;
  const background = clamp(Math.round((alignmentSummary.meanAlignment - 0.5) * 20), -30, 30);
  return sanitizeExtensionPoints({ relationship, timely, background });
}

function normalizeInterpretedExtensionPoints(parsed) {
  const relationship = clamp(Number(parsed?.relationship || 0), -30, 30);
  const timely = clamp(Number(parsed?.timely || 0), -30, 30);
  const background = clamp(Number(parsed?.background || 0), -30, 30);
  const rationale = typeof parsed?.rationale === "string" ? parsed.rationale.trim() : "";
  return { relationship, timely, background, rationale };
}

function buildInterpretationPrompt({
  userProfile,
  userPersona,
  crushPersona,
  alignmentSummary,
  userIntent,
  context,
}) {
  return [
    "You are an interpretation layer for Syntrae simulation.",
    "Return JSON only.",
    "Output schema:",
    "{",
    '  "relationship": integer [-30..30],',
    '  "timely": integer [-30..30],',
    '  "background": integer [-30..30],',
    '  "rationale": "short explanation"',
    "}",
    "",
    "USER_PROFILE_JSON:",
    safeJson(userProfile),
    "",
    "USER_PERSONA_PROFILE_JSON:",
    safeJson(userPersona),
    "",
    "CRUSH_PERSONA_PROFILE_JSON:",
    safeJson(crushPersona),
    "",
    "ALIGNMENT_SUMMARY_JSON:",
    safeJson(alignmentSummary),
    "",
    `USER_INTENT: ${String(userIntent || "").trim() || "(none)"}`,
    `RUN_CONTEXT_JSON: ${safeJson(context || {})}`,
  ].join("\n");
}

async function interpretWithModel({
  apiKey,
  model,
  userProfile,
  userPersona,
  crushPersona,
  alignmentSummary,
  userIntent,
  context,
}) {
  const prompt = buildInterpretationPrompt({
    userProfile,
    userPersona,
    crushPersona,
    alignmentSummary,
    userIntent,
    context,
  });

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return valid JSON only." },
        { role: "user", content: prompt },
      ],
    }),
  });

  const data = await openaiRes.json().catch(() => ({}));
  if (!openaiRes.ok) {
    const message = data?.error?.message || data?.error || "OpenAI request failed";
    const err = new Error(message);
    err.status = openaiRes.status;
    throw err;
  }

  const raw = data?.choices?.[0]?.message?.content || "{}";
  const parsed = parseJsonObject(raw) || {};
  return {
    extensionPoints: normalizeInterpretedExtensionPoints(parsed),
    usage: data?.usage || null,
    rawModelOutput: raw,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const supabaseUrl = resolveEnv(["SUPABASE_URL"]);
  const supabaseAnonKey = resolveEnv(["SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY_LOCAL"]);
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" });
  }

  const authHeader = String(req.headers.authorization || "");
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!accessToken) return res.status(401).json({ error: "Missing authenticated session token" });

  const apiKey = resolveEnv(["OPENAI_API_KEY", "OPENAI_API_KEY_LOCAL", "OPENAI_KEY"]);
  const body = req.body || {};
  const userPersonaKey = sanitizePersonaKey(body.userPersonaKey);
  const crushPersonaKey = sanitizePersonaKey(body.crushPersonaKey);
  const model =
    String(body.model || "").trim() ||
    resolveEnv(["OPENAI_INTERPRETER_MODEL"]) ||
    resolveEnv(["OPENAI_MODEL"]) ||
    "";

  try {
    const userResult = await fetchSupabaseUser(supabaseUrl, supabaseAnonKey, accessToken);
    if (!userResult.ok || !userResult.body?.id) {
      return res.status(401).json({ error: "Invalid or expired session token" });
    }
    const user = userResult.body;

    if (!userPersonaKey || !crushPersonaKey) {
      const personaOptions = await fetchPersonasForUser(
        supabaseUrl,
        supabaseAnonKey,
        accessToken,
        user.id
      );
      return res.status(400).json({
        error: "Persona selection required",
        requiresPersonaSelection: true,
        prompt: "Choose two personas to compare.",
        personaOptions,
      });
    }
    if (userPersonaKey === crushPersonaKey) {
      return res.status(400).json({ error: "Choose two different personas." });
    }

    const [userProfileRow, userPersonaRow, crushPersonaRow] = await Promise.all([
      fetchUserProfile(supabaseUrl, supabaseAnonKey, accessToken, user.id),
      fetchPersonaByKey(supabaseUrl, supabaseAnonKey, accessToken, user.id, userPersonaKey),
      fetchPersonaByKey(supabaseUrl, supabaseAnonKey, accessToken, user.id, crushPersonaKey),
    ]);

    if (!userPersonaRow) {
      return res.status(404).json({ error: `user persona not found: ${userPersonaKey}` });
    }
    if (!crushPersonaRow) {
      return res.status(404).json({ error: `crush persona not found: ${crushPersonaKey}` });
    }

    const userPersonaProfile = buildPersonaProfile(userPersonaRow);
    const crushPersonaProfile = buildPersonaProfile(crushPersonaRow);
    const userAxisScores = extractAxisScores(userPersonaProfile);
    const crushAxisScores = extractAxisScores(crushPersonaProfile);
    const alignmentSummary = computeAlignmentSummary(userAxisScores, crushAxisScores);

    let extensionPoints = null;
    let interpretation = null;
    let extensionPointSource = "deterministic_from_account_data";

    if (body.extensionPoints && typeof body.extensionPoints === "object") {
      extensionPoints = sanitizeExtensionPoints(body.extensionPoints);
      extensionPointSource = "provided_extension_points";
    } else if (body.qualitativeInput && typeof body.qualitativeInput === "object") {
      extensionPoints = qualitativeToExtensionPoints(body.qualitativeInput);
      extensionPointSource = "qualitative_mapping_function";
    } else if (model) {
      if (!apiKey) {
        return res.status(500).json({
          error: "Missing OpenAI key for model interpretation.",
        });
      }
      interpretation = await interpretWithModel({
        apiKey,
        model,
        userProfile: userProfileRow || {},
        userPersona: userPersonaProfile,
        crushPersona: crushPersonaProfile,
        alignmentSummary,
        userIntent: body.userIntent || "",
        context: body.context || {},
      });
      extensionPoints = sanitizeExtensionPoints(interpretation.extensionPoints);
      extensionPointSource = "llm_interpretation";
    } else {
      extensionPoints = deterministicExtensionPointsFromData({ alignmentSummary });
      extensionPointSource = "deterministic_from_account_data";
    }

    const config = {
      ...DEFAULT_TRIAL_CONFIG,
      approachId: String(body.approachId || DEFAULT_TRIAL_CONFIG.approachId),
    };
    const optimized = optimizeDifficultiesGradientDescent({
      config,
      extensionPoints,
      rng: Math.random,
      ...(body.optimizer && typeof body.optimizer === "object" ? body.optimizer : {}),
    });
    const trial = simulateTrialFromGenome({
      config,
      genome: optimized.bestGenome,
      extensionPoints,
      rng: Math.random,
    });

    return res.status(200).json({
      model: model || null,
      extensionPointSource,
      extensionPoints,
      personas: {
        userPersona: {
          key: userPersonaRow.persona_key,
          name: userPersonaRow.name || "",
        },
        crushPersona: {
          key: crushPersonaRow.persona_key,
          name: crushPersonaRow.name || "",
        },
      },
      alignmentSummary: {
        countedAxes: alignmentSummary.countedAxes,
        meanAlignment: alignmentSummary.meanAlignment,
        meanGap: alignmentSummary.meanGap,
      },
      optimization: {
        bestIteration: optimized.bestIteration,
        bestLoss: optimized.bestLoss,
        predictedSumProbability: optimized.bestEval.sumProbabilities,
        predictedGapFrom100: 1 - optimized.bestEval.sumProbabilities,
      },
      trialSummary: {
        simulatedSumProbability: trial.separateProbabilitySum,
        simulatedGapFrom100: trial.separateProbabilityGapFrom100,
      },
      interpretation: interpretation
        ? {
            rationale: interpretation.extensionPoints.rationale || "",
            usage: interpretation.usage || null,
          }
        : null,
      trial,
    });
  } catch (err) {
    const status = Number(err?.status) || 500;
    return res.status(status).json({
      error: err?.message || "Compatibility simulation failed",
    });
  }
};
