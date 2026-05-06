const { resolveEnv } = require("./env-utils");
const {
  classifyDcRangeDeterministic,
  detectCriticalFactorOverride,
  drawDcInRange,
  sanitizeRangeId,
  selectRangeById,
  simulateDcPassRate,
  summarizeAxesForPrompt,
} = require("../task-dc-algorithm");

const PERSONA_KEY_RE = /[^a-z0-9_-]/g;

function sanitizePersonaKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  const cleaned = normalized.replace(PERSONA_KEY_RE, "");
  return cleaned || "";
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

function safeJson(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch (_) {
    return "{}";
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

async function fetchPersonaRow(supabaseUrl, anonKey, accessToken, userId, personaKey) {
  const filters = [
    `user_id=eq.${encodeURIComponent(userId)}`,
    "select=id,persona_key,name,state,traits,profile,updated_at",
    "order=updated_at.desc",
    "limit=1",
  ];
  if (personaKey) {
    filters.unshift(`persona_key=eq.${encodeURIComponent(personaKey)}`);
  }
  const url = `${supabaseUrl}/rest/v1/personas?${filters.join("&")}`;
  const { ok, body } = await fetchJson(url, {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  });
  if (!ok || !Array.isArray(body) || !body.length) return null;
  return body[0];
}

function buildPersonaProfile(personaRow) {
  if (!personaRow || typeof personaRow !== "object") return {};
  const state = personaRow.state && typeof personaRow.state === "object" ? personaRow.state : {};
  const derivedCriticalFactors = extractCriticalFactorsFromState(state);
  if (personaRow.profile && typeof personaRow.profile === "object") {
    if (personaRow.profile.critical_factors) return personaRow.profile;
    if (Object.keys(derivedCriticalFactors).length) {
      return {
        ...personaRow.profile,
        critical_factors: derivedCriticalFactors,
      };
    }
    return personaRow.profile;
  }
  const traits = personaRow.traits && typeof personaRow.traits === "object" ? personaRow.traits : {};
  return {
    personaName: state.personaName || personaRow.name || "",
    identityLayers: state.identityLayers || {},
    traits,
    extras: state.extras || {},
    usersInput: state.usersInput || "",
    critical_factors: derivedCriticalFactors,
  };
}

const CRITICAL_FIELD_ID_TO_KEY = Object.freeze({
  L6_S1_F1: "physical_incapability",
  L6_S1_F2: "hard_no_activities",
  L6_S1_F3: "absolute_boundaries",
  L6_S2_F1: "favorite_dishes",
  L6_S2_F2: "favorite_colors",
  L6_S2_F3: "preferred_activities",
  L6_S3_F1: "extreme_dislikes",
  L6_S3_F2: "strong_likes",
});

function extractCriticalFactorsFromState(state) {
  const answers = state?.answers && typeof state.answers === "object" ? state.answers : {};
  const critical = {};
  Object.entries(answers).forEach(([questionId, answer]) => {
    if (!answer || answer.type !== "free") return;
    const text = String(answer.text || "").trim();
    if (!text) return;
    const fieldName = String(answer.fieldName || "").trim();
    const keyFromField = fieldName ? fieldName : "";
    const keyFromId = CRITICAL_FIELD_ID_TO_KEY[questionId] || "";
    const key = keyFromField || keyFromId;
    if (!key) return;
    critical[key] = text;
  });
  return critical;
}

function normalizeModelRangeId(parsed) {
  const candidate =
    parsed?.range_id ??
    parsed?.rangeId ??
    parsed?.dc_range_id ??
    parsed?.dcRangeId;
  const rangeId = sanitizeRangeId(candidate);
  const confidenceRaw = Number(parsed?.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : null;
  const rationale = String(parsed?.rationale || parsed?.reason || "").trim();
  return {
    rangeId,
    confidence,
    rationale,
  };
}

function buildDcClassifierPrompt({
  taskText,
  userProfile,
  personaProfile,
  deterministic,
}) {
  return [
    "You are a DC range classifier for Syntrae.",
    "Classify one user task into exactly one DC range id: 1..5.",
    "Ranges:",
    "1 => 0-20",
    "2 => 20-40",
    "3 => 40-60",
    "4 => 60-80",
    "5 => 80-100",
    "",
    "Output JSON only with this schema:",
    "{",
    '  "range_id": 1|2|3|4|5,',
    '  "confidence": 0..1,',
    '  "rationale": "short explanation tied to persona traits and task context"',
    "}",
    "",
    `TASK_TEXT: ${String(taskText || "").trim()}`,
    "",
    "USER_PROFILE_JSON:",
    safeJson(userProfile),
    "",
    "PERSONA_PROFILE_JSON:",
    safeJson(personaProfile),
    "",
    "PERSONA_AXIS_SUMMARY_JSON (0-100):",
    safeJson(deterministic.axisSummary),
    "",
    "DETERMINISTIC_BASELINE_JSON:",
    safeJson({
      rawDifficultyScore: deterministic.rawDifficultyScore,
      baselineRangeId: deterministic.range.id,
      baselineRangeLabel: deterministic.range.label,
      detectedSignals: deterministic.signals,
    }),
    "",
    "Rules:",
    "- Pick one range id only.",
    "- Use persona traits as primary evidence.",
    "- If unsure, stay close to the deterministic baseline.",
  ].join("\n");
}

async function classifyRangeWithModel({
  apiKey,
  model,
  taskText,
  userProfile,
  personaProfile,
  deterministic,
}) {
  const prompt = buildDcClassifierPrompt({
    taskText,
    userProfile,
    personaProfile,
    deterministic,
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

  const rawOutput = data?.choices?.[0]?.message?.content || "{}";
  const parsed = parseJsonObject(rawOutput) || {};
  const normalized = normalizeModelRangeId(parsed);
  return {
    ...normalized,
    rawOutput,
    usage: data?.usage || null,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = req.body || {};
  const taskText = String(body.taskText || body.task || "").trim();
  if (!taskText) {
    return res.status(400).json({ error: "taskText is required" });
  }

  const supabaseUrl = resolveEnv(["SUPABASE_URL"]);
  const supabaseAnonKey = resolveEnv(["SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY_LOCAL"]);
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" });
  }

  const authHeader = String(req.headers.authorization || "");
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!accessToken) return res.status(401).json({ error: "Missing authenticated session token" });

  const apiKey = resolveEnv(["OPENAI_API_KEY", "OPENAI_API_KEY_LOCAL", "OPENAI_KEY"]);
  const model =
    String(body.model || "").trim() ||
    resolveEnv(["OPENAI_DC_CLASSIFIER_MODEL"]) ||
    resolveEnv(["OPENAI_MODEL"]) ||
    "";
  const useModel = body.useModel !== false;

  const safePersonaKey = sanitizePersonaKey(body.personaKey);
  const requestedRolls = Number(body.rolls);
  const rolls = Number.isFinite(requestedRolls) ? requestedRolls : 100;
  const includeRollLog = Boolean(body.includeRollLog);

  try {
    const userResult = await fetchSupabaseUser(supabaseUrl, supabaseAnonKey, accessToken);
    if (!userResult.ok || !userResult.body?.id) {
      return res.status(401).json({ error: "Invalid or expired session token" });
    }
    const userId = userResult.body.id;

    const [userProfileRow, personaRow] = await Promise.all([
      fetchUserProfile(supabaseUrl, supabaseAnonKey, accessToken, userId),
      fetchPersonaRow(supabaseUrl, supabaseAnonKey, accessToken, userId, safePersonaKey),
    ]);

    if (!personaRow) {
      return res.status(404).json({ error: "Active persona not found for this account." });
    }

    const personaProfile = buildPersonaProfile(personaRow);
    const deterministic = classifyDcRangeDeterministic({
      taskText,
      personaProfile,
    });
    const criticalOverride = detectCriticalFactorOverride({
      taskText,
      personaProfile,
      taskSignals: deterministic.signals,
    });

    let classifier = {
      source: "deterministic_traits",
      rangeId: deterministic.range.id,
      confidence: null,
      rationale: "Deterministic trait-based classifier used.",
      usage: null,
    };

    if (criticalOverride.fixedDC != null) {
      classifier = {
        source: "critical_override",
        rangeId: criticalOverride.fixedDC <= 20 ? 1 : 5,
        confidence: 1,
        rationale:
          criticalOverride.outcome === "conflict"
            ? "Critical factor contradiction detected. Fixed DC=90."
            : "Critical factor support detected. Fixed DC=10.",
        usage: null,
      };
    } else if (useModel && model && apiKey) {
      try {
        const modelResult = await classifyRangeWithModel({
          apiKey,
          model,
          taskText,
          userProfile: userProfileRow || {},
          personaProfile,
          deterministic,
        });

        classifier = {
          source: "llm_plus_traits",
          rangeId: modelResult.rangeId,
          confidence: modelResult.confidence,
          rationale: modelResult.rationale || "Model selected range from persona/task context.",
          usage: modelResult.usage || null,
          rawOutput: modelResult.rawOutput,
        };
      } catch (_) {
        // Silent fallback to deterministic classification.
      }
    }

    const selectedRange = selectRangeById(classifier.rangeId);
    const chosenDc =
      criticalOverride.fixedDC != null
        ? criticalOverride.fixedDC
        : drawDcInRange(selectedRange, Math.random);
    const simulation = simulateDcPassRate({
      dc: chosenDc,
      rolls,
      rng: Math.random,
    });

    const response = {
      taskText,
      persona: {
        key: personaRow.persona_key,
        name: personaRow.name || "",
      },
      classifier: {
        source: classifier.source,
        selectedRangeId: selectedRange.id,
        selectedRangeLabel: selectedRange.label,
        selectedRangeMin: selectedRange.min,
        selectedRangeMax: selectedRange.max,
        confidence: classifier.confidence,
        rationale: classifier.rationale,
        deterministicBaseline: {
          rawDifficultyScore: deterministic.rawDifficultyScore,
          rangeId: deterministic.range.id,
          rangeLabel: deterministic.range.label,
          detectedSignals: deterministic.signals,
        },
        criticalOverride: {
          isCritical: criticalOverride.isCritical,
          outcome: criticalOverride.outcome,
          fixedDC: criticalOverride.fixedDC,
          matched: criticalOverride.matched,
        },
      },
      dcRoll: {
        chosenDC: chosenDc,
        range: selectedRange,
      },
      trial: {
        totalRolls: simulation.totalRolls,
        successCount: simulation.successCount,
        failureCount: simulation.failureCount,
        successProbability: simulation.successProbability,
      },
    };

    if (includeRollLog) {
      response.trial.rollLog = simulation.rollLog;
    }

    return res.status(200).json(response);
  } catch (err) {
    const status = Number(err?.status) || 500;
    return res.status(status).json({
      error: err?.message || "Task probability simulation failed",
    });
  }
};
