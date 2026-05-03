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

function deriveOutcomeDifficultyBounds(config, extensionPoints, globalBias = 0) {
  const safe = sanitizeExtensionPoints(extensionPoints);
  const rel = safe.relationship / 30;
  const tim = safe.timely / 30;
  const bg = safe.background / 30;
  const globalMin = config.difficultyRange.min;
  const globalMax = config.difficultyRange.max;
  const globalSpan = globalMax - globalMin;

  return config.outcomes.map((outcomeId, index) => {
    const weights = OUTCOME_BONUS_WEIGHTS[index] || [1 / 3, 1 / 3, 1 / 3];
    const signedSignal = rel * weights[0] + tim * weights[1] + bg * weights[2];
    const confidence = Math.abs(signedSignal);

    const baseCenter = 30 + index * 3;
    const shiftedCenter = baseCenter - signedSignal * 12 + globalBias;
    const baseSpan = 28;
    const tightenedSpan = baseSpan - confidence * 8;
    const finalSpan = clamp(tightenedSpan, 16, 34);

    let minDC = Math.round(shiftedCenter - finalSpan / 2);
    let maxDC = Math.round(shiftedCenter + finalSpan / 2);

    const floorOffset = Math.round(globalSpan * 0.03);
    const ceilOffset = Math.round(globalSpan * 0.03);
    minDC = clamp(minDC, globalMin + floorOffset, globalMax - 6);
    maxDC = clamp(maxDC, globalMin + 6, globalMax - ceilOffset);

    if (maxDC - minDC < 12) {
      const mid = Math.round((minDC + maxDC) / 2);
      minDC = clamp(mid - 6, globalMin, globalMax - 12);
      maxDC = clamp(mid + 6, globalMin + 12, globalMax);
    }

    return {
      outcomeId,
      index,
      minDC,
      maxDC,
      centerDC: Math.round((minDC + maxDC) / 2),
      signedSignal,
      confidence,
    };
  });
}

function initializeGenomeFromBounds(config, bounds, rng) {
  return bounds.map((bound) =>
    Array.from({ length: config.nodesPerPathway }, () => {
      const spread = Math.max(2, Math.round((bound.maxDC - bound.minDC) * 0.18));
      const seed = randomIntInclusive(bound.centerDC - spread, bound.centerDC + spread, rng);
      return clamp(seed, bound.minDC, bound.maxDC);
    })
  );
}

function approxNodePassProbabilityLinear(dc, betaBonus) {
  // Continuous D100 approximation of:
  // pass iff adjusted beta > DC, with adjusted beta = raw beta + bonus.
  // This closely tracks exact discrete probabilities while remaining differentiable
  // almost everywhere for gradient updates.
  return clamp((100 + betaBonus - dc) / 100, 0, 1);
}

function computeApproxPathwayProbability(difficulties, betaBonus) {
  const nodePassProbs = difficulties.map((dc) =>
    approxNodePassProbabilityLinear(dc, betaBonus)
  );
  const pathwayProb = nodePassProbs.reduce((acc, p) => acc * p, 1);
  return {
    pathwayProb,
    nodePassProbs,
  };
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

function runGradientDescentWithBounds({
  config,
  extensionPoints,
  bounds,
  rng,
  iterations,
  initialLearningRate,
  minLearningRate,
  decay,
  marginRatio,
  sumWeight,
  marginWeight,
  floorCapWeight,
  minOutcomeProbability,
  maxOutcomeProbability,
}) {
  let genome = initializeGenomeFromBounds(config, bounds, rng);
  let bestGenome = cloneGenome(genome);
  let bestLoss = Number.POSITIVE_INFINITY;
  let bestIter = -1;
  let bestApprox = null;

  for (let iter = 0; iter < iterations; iter += 1) {
    const gradients = genome.map((row) => row.map(() => 0));
    const approxOutcomeRows = [];

    for (let o = 0; o < config.outcomes.length; o += 1) {
      const betaBonus = computeOutcomeBetaBonus(o, extensionPoints);
      const approx = computeApproxPathwayProbability(genome[o], betaBonus);
      approxOutcomeRows.push({
        outcomeId: config.outcomes[o],
        betaBonus,
        pathwayProb: approx.pathwayProb,
        nodePassProbs: approx.nodePassProbs,
      });
    }

    const sumProb = approxOutcomeRows.reduce((acc, row) => acc + row.pathwayProb, 0);
    let loss = sumWeight * (sumProb - 1) ** 2;

    const dLoss_dOutcomeProb = approxOutcomeRows.map(
      () => 2 * sumWeight * (sumProb - 1)
    );

    for (let o = 0; o < approxOutcomeRows.length; o += 1) {
      const p = approxOutcomeRows[o].pathwayProb;
      if (p < minOutcomeProbability) {
        const delta = minOutcomeProbability - p;
        loss += floorCapWeight * delta ** 2;
        dLoss_dOutcomeProb[o] += -2 * floorCapWeight * delta;
      } else if (p > maxOutcomeProbability) {
        const delta = p - maxOutcomeProbability;
        loss += floorCapWeight * delta ** 2;
        dLoss_dOutcomeProb[o] += 2 * floorCapWeight * delta;
      }
    }

    for (let o = 0; o < config.outcomes.length; o += 1) {
      const bound = bounds[o];
      const lowerSafe = bound.minDC + (bound.maxDC - bound.minDC) * marginRatio;
      const upperSafe = bound.maxDC - (bound.maxDC - bound.minDC) * marginRatio;
      const pathwayProb = approxOutcomeRows[o].pathwayProb;
      const nodePassProbs = approxOutcomeRows[o].nodePassProbs;

      for (let n = 0; n < config.nodesPerPathway; n += 1) {
        const dc = genome[o][n];
        const pass = nodePassProbs[n];
        let dP_dDC = 0;
        if (pass > 0 && pass < 1 && pathwayProb > 0) {
          dP_dDC = (pathwayProb / pass) * (-0.01);
        }

        gradients[o][n] += dLoss_dOutcomeProb[o] * dP_dDC;

        if (dc < lowerSafe) {
          const delta = lowerSafe - dc;
          loss += marginWeight * delta ** 2;
          gradients[o][n] += -2 * marginWeight * delta;
        } else if (dc > upperSafe) {
          const delta = dc - upperSafe;
          loss += marginWeight * delta ** 2;
          gradients[o][n] += 2 * marginWeight * delta;
        }
      }
    }

    if (loss < bestLoss) {
      bestLoss = loss;
      bestIter = iter;
      bestGenome = cloneGenome(genome);
      bestApprox = {
        sumProb,
        outcomeRows: approxOutcomeRows.map((row) => ({
          outcomeId: row.outcomeId,
          probability: row.pathwayProb,
          betaBonus: row.betaBonus,
        })),
      };
    }

    const lr = Math.max(minLearningRate, initialLearningRate * Math.pow(decay, iter));
    for (let o = 0; o < config.outcomes.length; o += 1) {
      for (let n = 0; n < config.nodesPerPathway; n += 1) {
        genome[o][n] -= lr * gradients[o][n];
        genome[o][n] = clamp(genome[o][n], bounds[o].minDC, bounds[o].maxDC);
      }
    }
  }

  const roundedGenome = bestGenome.map((row) => row.map((x) => Math.round(x)));
  return {
    roundedGenome,
    bestIter,
    bestLoss,
    bestApprox,
  };
}

function optimizeDifficultiesGradientDescent({
  config,
  extensionPoints,
  rng = Math.random,
  iterations = 2500,
  initialLearningRate = 0.9,
  minLearningRate = 0.04,
  decay = 0.998,
  marginRatio = 0.18,
  sumWeight = 140,
  marginWeight = 0.65,
  floorCapWeight = 4.5,
  minOutcomeProbability = 0.03,
  maxOutcomeProbability = 0.62,
  boundAdjustIterations = 8,
  boundAdjustStep = 8,
}) {
  validateTrialConfig(config);
  const safeExtensionPoints = sanitizeExtensionPoints(extensionPoints);
  let bias = 0;
  let bestCandidate = null;

  for (let round = 0; round < boundAdjustIterations; round += 1) {
    const bounds = deriveOutcomeDifficultyBounds(config, safeExtensionPoints, bias);
    const descent = runGradientDescentWithBounds({
      config,
      extensionPoints: safeExtensionPoints,
      bounds,
      rng,
      iterations,
      initialLearningRate,
      minLearningRate,
      decay,
      marginRatio,
      sumWeight,
      marginWeight,
      floorCapWeight,
      minOutcomeProbability,
      maxOutcomeProbability,
    });

    const exactEval = evaluateGenome(descent.roundedGenome, config, safeExtensionPoints);
    const gap = 1 - exactEval.sumProbabilities;

    const candidate = {
      bounds,
      roundedGenome: descent.roundedGenome,
      bestIter: descent.bestIter,
      bestLoss: descent.bestLoss,
      bestApprox: descent.bestApprox,
      bestEval: exactEval,
      bias,
      gapAbs: Math.abs(gap),
    };

    if (!bestCandidate || candidate.gapAbs < bestCandidate.gapAbs) {
      bestCandidate = candidate;
    }

    bias -= gap * boundAdjustStep;
    bias = clamp(bias, -20, 20);
  }

  return {
    bestGenome: bestCandidate.roundedGenome,
    bestEval: bestCandidate.bestEval,
    bestIteration: bestCandidate.bestIter,
    bestLoss: bestCandidate.bestLoss,
    bestApprox: bestCandidate.bestApprox,
    bounds: bestCandidate.bounds,
    boundBias: bestCandidate.bias,
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

function printOutcomeBounds(bounds) {
  console.log("\n=== Outcome DC Bounds (factor-driven) ===");
  for (const bound of bounds) {
    console.log(
      `${bound.outcomeId}: minDC=${bound.minDC}, maxDC=${bound.maxDC}, center=${bound.centerDC}, signal=${bound.signedSignal.toFixed(
        3
      )}`
    );
  }
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

  const optimized = optimizeDifficultiesGradientDescent({
    config,
    extensionPoints,
    rng,
    iterations: 2500,
    initialLearningRate: 0.9,
    minLearningRate: 0.04,
    decay: 0.998,
  });

  const trial = simulateTrialFromGenome({
    config,
    genome: optimized.bestGenome,
    extensionPoints,
    rng,
  });

  console.log("=== Gradient Descent Optimization ===");
  console.log(`Best iteration: ${optimized.bestIteration}`);
  console.log(`Best optimization loss: ${optimized.bestLoss.toFixed(6)}`);
  console.log(
    `Optimization objective score (sum close to 100% + varied outcomes): ${optimized.bestEval.score.toFixed(
      4
    )}`
  );
  console.log(
    `Predicted sum of separate outcome probabilities: ${formatPercent(
      optimized.bestEval.sumProbabilities
    )}`
  );

  printOutcomeBounds(optimized.bounds);
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
  computeApproxPathwayProbability,
  deriveOutcomeDifficultyBounds,
  evaluateGenome,
  formatPercent,
  nodePassProbability,
  optimizeDifficultiesGradientDescent,
  pathwaySuccessProbability,
  printOutcomeBounds,
  printPredictedOutcomeProbabilities,
  printOptimizedDifficulties,
  printTrialSummary,
  rollD100,
  sanitizeExtensionPoints,
  simulateOutcome,
  simulateTrialFromGenome,
  validateTrialConfig,
};
