"use strict";

const DEFAULT_TRIAL_CONFIG = Object.freeze({
  approachId: "Approach-1",
  outcomes: ["Outcome-1", "Outcome-2", "Outcome-3", "Outcome-4", "Outcome-5"],
  pathwaysPerOutcome: 1,
  nodesPerPathway: 10,
  pathwayReplications: 20,
  difficultyRange: { min: 10, max: 95 },
});

// Outcome-specific sensitivity to extension points:
// [relationship, timely, background]
const OUTCOME_BONUS_WEIGHTS = Object.freeze([
  [0.60, 0.25, 0.15],
  [0.25, 0.60, 0.15],
  [0.20, 0.20, 0.60],
  [0.45, 0.35, 0.20],
  [0.35, 0.45, 0.20],
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((acc, x) => acc + x, 0) / values.length;
}

function stddev(values) {
  if (values.length <= 1) return 0;
  const m = mean(values);
  const variance = mean(values.map((x) => (x - m) ** 2));
  return Math.sqrt(variance);
}

function randomIntInclusive(min, max, rng) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function rollD100(rng) {
  return randomIntInclusive(1, 100, rng);
}

function validateTrialConfig(config) {
  if (!Array.isArray(config.outcomes) || config.outcomes.length !== 5) {
    throw new Error("Trial must contain exactly 5 outcomes.");
  }
  if (config.pathwaysPerOutcome !== 1) {
    throw new Error("Each outcome must have exactly 1 pathway.");
  }
  if (config.nodesPerPathway !== 10) {
    throw new Error("Each pathway must have exactly 10 nodes.");
  }
  if (config.pathwayReplications !== 20) {
    throw new Error("Each pathway must be replicated exactly 20 times.");
  }
  const min = Number(config.difficultyRange?.min);
  const max = Number(config.difficultyRange?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max > 99 || min >= max) {
    throw new Error("difficultyRange must satisfy 1 <= min < max <= 99.");
  }
}

function sanitizeExtensionPoints(extensionPoints = {}) {
  const relationship = clamp(Number(extensionPoints.relationship || 0), -30, 30);
  const timely = clamp(Number(extensionPoints.timely || 0), -30, 30);
  const background = clamp(Number(extensionPoints.background || 0), -30, 30);

  return {
    relationship,
    timely,
    background,
  };
}

function computeOutcomeBetaBonus(outcomeIndex, extensionPoints) {
  const weights = OUTCOME_BONUS_WEIGHTS[outcomeIndex] || [1 / 3, 1 / 3, 1 / 3];
  const rawBonus =
    extensionPoints.relationship * weights[0] +
    extensionPoints.timely * weights[1] +
    extensionPoints.background * weights[2];
  return clamp(Math.round(rawBonus), -25, 25);
}

function adjustedBeta(rawBeta, outcomeBonus) {
  return clamp(rawBeta + outcomeBonus, 1, 100);
}

function nodePassProbability(difficultyDC, outcomeBonus) {
  let passCount = 0;
  for (let raw = 1; raw <= 100; raw += 1) {
    const beta = adjustedBeta(raw, outcomeBonus);
    if (beta > difficultyDC) passCount += 1;
  }
  return passCount / 100;
}

function pathwaySuccessProbability(difficulties, outcomeBonus) {
  return difficulties.reduce(
    (acc, dc) => acc * nodePassProbability(dc, outcomeBonus),
    1
  );
}

function cloneGenome(genome) {
  return genome.map((row) => row.slice());
}

function randomGenome(config, rng) {
  const { min, max } = config.difficultyRange;
  return Array.from({ length: config.outcomes.length }, () =>
    Array.from({ length: config.nodesPerPathway }, () =>
      randomIntInclusive(min, max, rng)
    )
  );
}

function crossover(parentA, parentB, rng) {
  const child = [];
  for (let o = 0; o < parentA.length; o += 1) {
    const row = [];
    for (let n = 0; n < parentA[o].length; n += 1) {
      row.push(rng() < 0.5 ? parentA[o][n] : parentB[o][n]);
    }
    child.push(row);
  }
  return child;
}

function mutate(genome, config, mutationRate, rng) {
  const { min, max } = config.difficultyRange;
  const out = cloneGenome(genome);
  for (let o = 0; o < out.length; o += 1) {
    for (let n = 0; n < out[o].length; n += 1) {
      if (rng() < mutationRate) {
        const delta = randomIntInclusive(-10, 10, rng);
        out[o][n] = clamp(out[o][n] + delta, min, max);
      }
    }
  }
  return out;
}

function evaluateGenome(genome, config, extensionPoints) {
  const outcomeRows = config.outcomes.map((outcomeId, index) => {
    const difficulties = genome[index];
    const betaBonus = computeOutcomeBetaBonus(index, extensionPoints);
    const probability = pathwaySuccessProbability(difficulties, betaBonus);
    return {
      outcomeId,
      index,
      betaBonus,
      difficulties,
      probability,
    };
  });

  const outcomeProbabilities = outcomeRows.map((row) => row.probability);
  const sumProbabilities = outcomeProbabilities.reduce((acc, p) => acc + p, 0);
  const outcomeVariation = stddev(outcomeProbabilities);

  const nodePassRates = outcomeRows.flatMap((row) =>
    row.difficulties.map((dc) => nodePassProbability(dc, row.betaBonus))
  );
  const nodeVariation = stddev(nodePassRates);
  const spread = Math.max(...outcomeProbabilities) - Math.min(...outcomeProbabilities);

  // Objective:
  // 1) Sum of outcome probabilities should be close to 1.0 (100%).
  // 2) Outcome probabilities should still vary (not all identical).
  // 3) Node pass rates should vary across nodes.
  let score = 0;
  score += -Math.abs(sumProbabilities - 1.0) * 60.0;
  score += outcomeVariation * 2.5;
  score += nodeVariation * 1.0;
  score += spread * 1.0;

  const targetMean = 1 / outcomeProbabilities.length;
  for (const p of outcomeProbabilities) {
    score -= Math.abs(p - targetMean) * 0.4;
    if (p < 0.02) score -= 1.5;
    if (p > 0.70) score -= 1.0;
  }

  return {
    score,
    sumProbabilities,
    outcomeRows,
    outcomeProbabilities,
  };
}

function tournamentSelect(scoredPopulation, rng, k = 4) {
  let best = null;
  for (let i = 0; i < k; i += 1) {
    const candidate = scoredPopulation[randomIntInclusive(0, scoredPopulation.length - 1, rng)];
    if (!best || candidate.eval.score > best.eval.score) best = candidate;
  }
  return best;
}

function optimizeDifficultiesEvolution({
  config,
  extensionPoints,
  rng = Math.random,
  generations = 120,
  populationSize = 80,
  eliteCount = 10,
  mutationRate = 0.18,
}) {
  validateTrialConfig(config);
  const safeExtensionPoints = sanitizeExtensionPoints(extensionPoints);

  let population = Array.from({ length: populationSize }, () =>
    randomGenome(config, rng)
  );

  let best = null;

  for (let generation = 0; generation < generations; generation += 1) {
    const scored = population
      .map((genome) => ({
        genome,
        eval: evaluateGenome(genome, config, safeExtensionPoints),
      }))
      .sort((a, b) => b.eval.score - a.eval.score);

    if (!best || scored[0].eval.score > best.eval.score) {
      best = {
        generation,
        genome: cloneGenome(scored[0].genome),
        eval: scored[0].eval,
      };
    }

    const nextPopulation = scored
      .slice(0, eliteCount)
      .map((entry) => cloneGenome(entry.genome));

    while (nextPopulation.length < populationSize) {
      const parentA = tournamentSelect(scored, rng).genome;
      const parentB = tournamentSelect(scored, rng).genome;
      const crossed = crossover(parentA, parentB, rng);
      const child = mutate(crossed, config, mutationRate, rng);
      nextPopulation.push(child);
    }

    population = nextPopulation;
  }

  return {
    bestGenome: best.genome,
    bestEval: best.eval,
    bestGeneration: best.generation,
    extensionPoints: safeExtensionPoints,
  };
}

function buildPathwayForOutcome(outcomeId, outcomeIndex, outcomeDifficulties, outcomeBonus) {
  return {
    outcomeId,
    outcomeIndex,
    betaBonus: outcomeBonus,
    pathwayId: `pathway-${outcomeIndex + 1}`,
    nodes: outcomeDifficulties.map((dc, idx) => ({
      id: `n${idx + 1}`,
      difficulty: dc,
    })),
  };
}

function evaluatePathwayReplication(pathway, rng) {
  for (const node of pathway.nodes) {
    const rawBeta = rollD100(rng);
    const finalBeta = adjustedBeta(rawBeta, pathway.betaBonus);
    const passed = finalBeta > node.difficulty;
    if (!passed) {
      return { passed: false, failedNodeId: node.id };
    }
  }
  return { passed: true, failedNodeId: null };
}

function simulateOutcome(outcomePathway, pathwayReplications, rng) {
  let passedReps = 0;
  let failedReps = 0;
  const failedNodeCounts = {};

  for (let rep = 1; rep <= pathwayReplications; rep += 1) {
    const result = evaluatePathwayReplication(outcomePathway, rng);
    if (result.passed) {
      passedReps += 1;
    } else {
      failedReps += 1;
      failedNodeCounts[result.failedNodeId] =
        (failedNodeCounts[result.failedNodeId] || 0) + 1;
    }
  }

  return {
    outcomeId: outcomePathway.outcomeId,
    pathwayId: outcomePathway.pathwayId,
    pathwayReplications,
    passedReps,
    failedReps,
    separateSuccessProbability: passedReps / pathwayReplications,
    failedNodeCounts,
    betaBonus: outcomePathway.betaBonus,
    nodes: outcomePathway.nodes,
  };
}

function simulateTrialFromGenome({
  config,
  genome,
  extensionPoints,
  rng = Math.random,
}) {
  validateTrialConfig(config);
  const safeExtensionPoints = sanitizeExtensionPoints(extensionPoints);

  const outcomePathways = config.outcomes.map((outcomeId, index) => {
    const bonus = computeOutcomeBetaBonus(index, safeExtensionPoints);
    return buildPathwayForOutcome(outcomeId, index, genome[index], bonus);
  });

  const outcomeResults = outcomePathways.map((pathway) =>
    simulateOutcome(pathway, config.pathwayReplications, rng)
  );

  const totalOutcomeCount = outcomeResults.length;
  const totalPathwayReps = totalOutcomeCount * config.pathwayReplications;
  const totalRepSlotsPerOutcome = config.nodesPerPathway * config.pathwayReplications; // 200
  const totalRepSlotsAllOutcomes = totalRepSlotsPerOutcome * totalOutcomeCount; // 1000
  const totalPassedPathwayReps = outcomeResults.reduce(
    (acc, row) => acc + row.passedReps,
    0
  );

  const separateProbabilitySum = outcomeResults.reduce(
    (acc, row) => acc + row.separateSuccessProbability,
    0
  );
  const separateProbabilityGapFrom100 = 1 - separateProbabilitySum;
  const separateProbabilityCloseTo100 = Math.abs(separateProbabilityGapFrom100) <= 0.05;

  return {
    config,
    extensionPoints: safeExtensionPoints,
    totalPathwayReps,
    totalRepSlotsPerOutcome,
    totalRepSlotsAllOutcomes,
    totalPassedPathwayReps,
    totalFailedPathwayReps: totalPathwayReps - totalPassedPathwayReps,
    outcomeResults,
    separateProbabilitySum,
    separateProbabilityGapFrom100,
    separateProbabilityCloseTo100,
  };
}

function printTrialSummary(trial) {
  console.log("\n=== Trial Setup ===");
  console.log(`Approach: ${trial.config.approachId}`);
  console.log(`Outcomes: ${trial.config.outcomes.join(", ")}`);
  console.log(`Pathways per outcome: ${trial.config.pathwaysPerOutcome}`);
  console.log(`Nodes per pathway: ${trial.config.nodesPerPathway}`);
  console.log(`Pathway replications per outcome: ${trial.config.pathwayReplications}`);
  console.log(
    `Configured rep slots per outcome: ${trial.totalRepSlotsPerOutcome} (10 nodes x 20 reps)`
  );
  console.log(
    `Configured rep slots total: ${trial.totalRepSlotsAllOutcomes} (5 outcomes x 200)`
  );

  console.log("\n=== Extension Points ===");
  console.log(`relationship: ${trial.extensionPoints.relationship}`);
  console.log(`timely: ${trial.extensionPoints.timely}`);
  console.log(`background: ${trial.extensionPoints.background}`);

  console.log("\n=== Outcome Results (separate) ===");
  for (const row of trial.outcomeResults) {
    console.log(
      `${row.outcomeId}: passed ${row.passedReps}/${row.pathwayReplications} = ${formatPercent(
        row.separateSuccessProbability
      )}, beta bonus ${row.betaBonus >= 0 ? "+" : ""}${row.betaBonus}`
    );
  }

  console.log(
    `Sum of separate outcome success probabilities: ${formatPercent(
      trial.separateProbabilitySum
    )}`
  );
  console.log(
    `Gap from 100%: ${formatPercent(Math.abs(trial.separateProbabilityGapFrom100))}`
  );
  console.log(
    `Close to 100% (within +/-5%): ${trial.separateProbabilityCloseTo100 ? "PASS" : "FAIL"}`
  );
}

function printOptimizedDifficulties(config, genome) {
  console.log("\n=== Optimized Node Difficulties ===");
  for (let o = 0; o < config.outcomes.length; o += 1) {
    const outcome = config.outcomes[o];
    const text = genome[o].map((dc, idx) => `n${idx + 1}:DC${dc}`).join(" -> ");
    console.log(`${outcome}: ${text}`);
  }
}

function printPredictedOutcomeProbabilities(bestEval) {
  const rows = bestEval.outcomeRows;

  console.log("\n=== Predicted Outcome Probabilities (from optimized difficulties) ===");
  for (let i = 0; i < rows.length; i += 1) {
    console.log(`${rows[i].outcomeId}: ${formatPercent(rows[i].probability)}`);
  }
  console.log(`Predicted separate-probability sum: ${formatPercent(bestEval.sumProbabilities)}`);
  console.log(
    `Predicted gap from 100%: ${formatPercent(Math.abs(1 - bestEval.sumProbabilities))}`
  );
}

function main() {
  const config = { ...DEFAULT_TRIAL_CONFIG };
  const rng = Math.random; // indeterministic

  // Task 2 input hooks: later populate from Syntrae persona/profile data.
  const extensionPoints = {
    relationship: 8, // I. relationship with persona
    timely: 5,       // II. temporary timing factors
    background: -2,  // III. user background advantages/disadvantages
  };

  const optimized = optimizeDifficultiesEvolution({
    config,
    extensionPoints,
    rng,
    generations: 120,
    populationSize: 80,
    eliteCount: 10,
    mutationRate: 0.18,
  });

  const trial = simulateTrialFromGenome({
    config,
    genome: optimized.bestGenome,
    extensionPoints,
    rng,
  });

  console.log("=== Evolution Optimization ===");
  console.log(`Best generation: ${optimized.bestGeneration}`);
  console.log(
    `Optimization objective (sum close to 100% + varied outcomes): ${optimized.bestEval.score.toFixed(
      4
    )}`
  );
  console.log(
    `Predicted sum of separate outcome probabilities: ${formatPercent(
      optimized.bestEval.sumProbabilities
    )}`
  );

  printOptimizedDifficulties(config, optimized.bestGenome);
  printPredictedOutcomeProbabilities(optimized.bestEval);
  printTrialSummary(trial);
  console.log("\n(Indeterministic mode: each execution re-rolls d100 and may produce different trial results.)");
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_TRIAL_CONFIG,
  OUTCOME_BONUS_WEIGHTS,
  adjustedBeta,
  computeOutcomeBetaBonus,
  evaluateGenome,
  formatPercent,
  nodePassProbability,
  optimizeDifficultiesEvolution,
  pathwaySuccessProbability,
  printPredictedOutcomeProbabilities,
  printOptimizedDifficulties,
  printTrialSummary,
  rollD100,
  sanitizeExtensionPoints,
  simulateOutcome,
  simulateTrialFromGenome,
  validateTrialConfig,
};
