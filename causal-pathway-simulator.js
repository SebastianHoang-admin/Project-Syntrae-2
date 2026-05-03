"use strict";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function shuffle(array, rng) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function difficultyTier(difficulty) {
  if (difficulty <= 25) return "easy";
  if (difficulty <= 50) return "moderate";
  if (difficulty <= 75) return "hard";
  return "very-hard";
}

/**
 * Creates a broad spread of difficulties across all nodes so not every node
 * feels similarly easy/hard. We build an evenly spaced ladder, add small jitter,
 * and shuffle assignments.
 */
function buildDistributedDifficulties({
  nodeCount,
  minDifficulty = 10,
  maxDifficulty = 95,
  jitter = 6,
  rng,
}) {
  const denominator = Math.max(1, nodeCount - 1);
  const ladder = Array.from({ length: nodeCount }, (_, i) => {
    const base = minDifficulty + ((maxDifficulty - minDifficulty) * i) / denominator;
    const noise = (rng() * 2 - 1) * jitter;
    return Math.round(clamp(base + noise, minDifficulty, maxDifficulty));
  });
  return shuffle(ladder, rng);
}

function rollD100(rng) {
  return Math.floor(rng() * 100) + 1;
}

function applyBetaAdjustments(baseBeta, node, decisionContext, betaAdjuster) {
  const adjustedBeta = betaAdjuster({
    baseBeta,
    node,
    factors: decisionContext,
  });

  if (!Number.isFinite(adjustedBeta)) {
    return clamp(Math.round(baseBeta), 1, 100);
  }

  return clamp(Math.round(adjustedBeta), 1, 100);
}

function defaultBetaAdjuster({ baseBeta }) {
  return baseBeta;
}

/**
 * Build ordered pathways like:
 * pathway-1: x1 -> y1 -> z1 (each node gets a difficulty threshold)
 * pathway-2: x2 -> y2 -> z2
 */
function buildPathways({
  pathwayCount,
  nodePrefixes,
  rng,
  difficultyConfig = {},
}) {
  const totalNodes = pathwayCount * nodePrefixes.length;
  const distributedDifficulties = buildDistributedDifficulties({
    nodeCount: totalNodes,
    rng,
    ...difficultyConfig,
  });
  let difficultyCursor = 0;

  return Array.from({ length: pathwayCount }, (_, i) => {
    const index = i + 1;
    const nodes = nodePrefixes.map((prefix) => ({
      id: `${prefix}${index}`,
      difficulty: distributedDifficulties[difficultyCursor++],
    }));

    return {
      id: `pathway-${index}`,
      nodes,
    };
  });
}

/**
 * Evaluate one pathway once (one rep).
 * Stops as soon as a node fails.
 * DnD-style gate: node passes only when adjusted beta is strictly greater than difficulty.
 * Both beta and difficulty are D100 integers in [1, 100].
 */
function evaluatePathway(
  pathway,
  rng,
  { betaAdjuster = defaultBetaAdjuster, decisionContext = {} } = {}
) {
  const nodeTrace = [];

  for (const node of pathway.nodes) {
    const rawBeta = rollD100(rng);
    const adjustedBeta = applyBetaAdjustments(
      rawBeta,
      node,
      decisionContext,
      betaAdjuster
    );
    const passed = adjustedBeta > node.difficulty;

    nodeTrace.push({
      nodeId: node.id,
      rawBeta,
      adjustedBeta,
      difficulty: node.difficulty,
      passed,
    });

    if (!passed) {
      return {
        passed: false,
        failedNodeId: node.id,
        nodeTrace,
      };
    }
  }

  return {
    passed: true,
    failedNodeId: null,
    nodeTrace,
  };
}

function simulateRun({
  pathways,
  repsPerPathway,
  rng,
  betaAdjuster = defaultBetaAdjuster,
  decisionContext = {},
}) {
  const pathwayResults = [];
  let successfulReps = 0;
  let totalReps = 0;

  for (const pathway of pathways) {
    const pathwayResult = {
      pathwayId: pathway.id,
      reps: repsPerPathway,
      passedReps: 0,
      failedReps: 0,
      failedNodeCounts: {},
      repResults: [],
    };

    for (let rep = 1; rep <= repsPerPathway; rep += 1) {
      const evaluation = evaluatePathway(pathway, rng, {
        betaAdjuster,
        decisionContext,
      });
      totalReps += 1;

      if (evaluation.passed) {
        pathwayResult.passedReps += 1;
        successfulReps += 1;
      } else {
        pathwayResult.failedReps += 1;
        const nodeId = evaluation.failedNodeId;
        pathwayResult.failedNodeCounts[nodeId] =
          (pathwayResult.failedNodeCounts[nodeId] || 0) + 1;
      }

      pathwayResult.repResults.push({
        rep,
        passed: evaluation.passed,
        failedNodeId: evaluation.failedNodeId,
      });
    }

    pathwayResults.push(pathwayResult);
  }

  return {
    totalReps,
    successfulReps,
    empiricalSuccessProbability: successfulReps / totalReps,
    pathwayResults,
  };
}

/**
 * Scalable structure:
 * - One approach can have many outcomes
 * - One outcome can have many pathways
 * - One pathway can have any ordered number of nodes
 */
function simulateApproachToOutcome({
  approachId,
  outcomeId,
  pathways,
  runs,
  pathwaysPerRun,
  repsPerPathway,
  rng,
  betaAdjuster = defaultBetaAdjuster,
  decisionContext = {},
}) {
  const selectedPathways = pathways.slice(0, pathwaysPerRun);
  if (selectedPathways.length < pathwaysPerRun) {
    throw new Error(
      `Requested ${pathwaysPerRun} pathways per run but only ${pathways.length} provided.`
    );
  }

  const runResults = [];
  let totalSuccesses = 0;
  let totalReps = 0;

  for (let run = 1; run <= runs; run += 1) {
    const runResult = simulateRun({
      pathways: selectedPathways,
      repsPerPathway,
      rng,
      betaAdjuster,
      decisionContext,
    });

    runResults.push({
      run,
      ...runResult,
    });

    totalSuccesses += runResult.successfulReps;
    totalReps += runResult.totalReps;
  }

  return {
    approachId,
    outcomeId,
    totalRuns: runs,
    pathwaysPerRun,
    repsPerPathway,
    totalReps,
    totalSuccesses,
    empiricalSuccessProbability: totalSuccesses / totalReps,
    runResults,
  };
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function printSummary(simulation, pathways) {
  console.log("\n=== Generated Pathways (Node Difficulties) ===");
  for (const pathway of pathways) {
    const nodeText = pathway.nodes
      .map((n) => {
        const expectedPassChance = ((100 - n.difficulty) / 100) * 100;
        return `${n.id}:DC${n.difficulty}(${difficultyTier(
          n.difficulty
        )},~${expectedPassChance.toFixed(0)}%)`;
      })
      .join(" -> ");
    console.log(`${pathway.id}: ${nodeText}`);
  }

  console.log("\n=== Simulation Summary ===");
  console.log(`Approach: ${simulation.approachId}`);
  console.log(`Outcome: ${simulation.outcomeId}`);
  console.log(`Runs (N): ${simulation.totalRuns}`);
  console.log(`Pathways per run (M): ${simulation.pathwaysPerRun}`);
  console.log(`Reps per pathway: ${simulation.repsPerPathway}`);
  console.log(`Total reps: ${simulation.totalReps}`);
  console.log(`Total successes: ${simulation.totalSuccesses}`);
  console.log("Pass rule: roll d100 beta, pass when beta > node DC");
  console.log(
    `Empirical success probability: ${formatPercent(
      simulation.empiricalSuccessProbability
    )}`
  );

  for (const runResult of simulation.runResults) {
    console.log(`\nRun ${runResult.run}:`);
    console.log(`  Successful reps: ${runResult.successfulReps}/${runResult.totalReps}`);
    console.log(
      `  Run success probability: ${formatPercent(
        runResult.empiricalSuccessProbability
      )}`
    );

    for (const pathwayResult of runResult.pathwayResults) {
      const pathwayRate = pathwayResult.passedReps / pathwayResult.reps;
      console.log(
        `  ${pathwayResult.pathwayId}: ${pathwayResult.passedReps}/${pathwayResult.reps} (${formatPercent(
          pathwayRate
        )})`
      );
    }
  }
}

function main() {
  // Your requested setup:
  // N = 1 run, M = 10 pathways, 10 reps each pathway => total reps = 100
  // Always non-deterministic: new rolls each execution.
  const generationRng = Math.random;
  const simulationRng = Math.random;

  // Hook for future user/persona factors from Syntrae:
  // Positive values increase beta (easier pass), negative values decrease beta.
  const decisionContext = {
    timelyMatters: 0,
    personaTraits: 0,
    relationshipWithPersona: 0,
  };

  const betaAdjuster = ({ baseBeta, factors }) => {
    const totalAdjustment =
      (factors.timelyMatters || 0) +
      (factors.personaTraits || 0) +
      (factors.relationshipWithPersona || 0);

    return baseBeta + totalAdjustment;
  };

  const pathways = buildPathways({
    pathwayCount: 10,
    nodePrefixes: ["x", "y", "z"],
    rng: generationRng,
    difficultyConfig: {
      minDifficulty: 10,
      maxDifficulty: 95,
      jitter: 6,
    },
  });

  const simulation = simulateApproachToOutcome({
    approachId: "Approach-1",
    outcomeId: "Outcome-1",
    pathways,
    runs: 1,
    pathwaysPerRun: 10,
    repsPerPathway: 10,
    rng: simulationRng,
    betaAdjuster,
    decisionContext,
  });

  printSummary(simulation, pathways);
  console.log("\n(Indeterministic mode: each execution generates new d100 rolls)");
}

if (require.main === module) {
  main();
}

module.exports = {
  applyBetaAdjustments,
  buildDistributedDifficulties,
  buildPathways,
  defaultBetaAdjuster,
  difficultyTier,
  evaluatePathway,
  rollD100,
  simulateRun,
  simulateApproachToOutcome,
};
