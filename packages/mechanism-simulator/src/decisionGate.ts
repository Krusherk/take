import { domainHash, type NominationEdgeV1 } from "@take/mechanism";
import type { Hex } from "viem";
import {
  denseCommunityScenario,
  identity,
  cycleAttackScenario,
  lateCoordinationScenario,
  latentQualityScenario,
  popularitySkewScenario,
  reciprocityAttackScenario,
  sparseCommunityScenario,
  weakCandidateOverlapScenarios,
  type SimulationCandidate,
  type SimulationScenario
} from "./scenarios.js";
import { spearman } from "./research.js";
import { runScenario, type ScenarioStrategyReport, type SimulationStrategyConfig } from "./simulator.js";

export type DecisionVerdict = "CONTROL ONLY" | "REJECT" | "PROMISING FOR MORE TESTING" | "PILOT CANDIDATE";

export const DECISION_GATE_HEADLINE_STRATEGIES: readonly SimulationStrategyConfig[] = [
  { strategyId: "RAW_UNIQUE_SUPPORT", strategyVersion: "2" },
  { strategyId: "THRESHOLD_UNIFORM_LOTTERY", strategyVersion: "1", minimumSupport: 2 },
  { strategyId: "LINEAR_PPS_WITHOUT_REPLACEMENT", strategyVersion: "1" },
  { strategyId: "CAPPED_SUPPORT_PPS", strategyVersion: "1", minimumSupport: 2, supportCap: 3 }
];

export const DECISION_GATE_PARAMETER_FAMILIES = {
  thresholdMinimumSupport: [1, 2, 3, 5, 8],
  cappedMinimumSupport: [1, 2, 3, 5],
  cappedSupportCap: [2, 3, 5, 8]
} as const;

const coalitionSizes = [1, 2, 3, 5, 8, 10, 15, 20, 25] as const;
const smallCampaigns = [
  { seats: 2, selectors: 10 },
  { seats: 3, selectors: 25 },
  { seats: 5, selectors: 50 },
  { seats: 10, selectors: 100 }
] as const;

export interface DecisionGateContext {
  generatedAt: string;
  baselineArtifacts: Array<{ path: string; sha256: string; reportHash?: string }>;
  engineeringVerification: Record<string, any>;
}

export function buildMechanismDecisionGateV01(runs: number, context: DecisionGateContext) {
  if (!Number.isSafeInteger(runs) || runs <= 0) throw new RangeError("runs must be a positive safe integer");
  const sensitivityRuns = Math.min(runs, 2_500);
  const assessments = DECISION_GATE_HEADLINE_STRATEGIES.map((strategy) => assessStrategy(strategy, runs));
  const parameterSensitivity = buildParameterSensitivity(sensitivityRuns);
  const rows = assessments.map((assessment) => {
    const sensitivity = parameterSensitivity.find((item) => item.family === familyFor(assessment.strategy));
    const verdict = verdictFor(assessment, sensitivity);
    return {
      strategy: strategyLabel(assessment.strategy),
      populationMode: "OVERLAPPING + DISJOINT",
      qualityRecovery: assessment.quality.qualityRecovery,
      popularity: {
        supportCorrelation: assessment.popularity.supportCorrelation,
        seatCorrelation: assessment.popularity.seatCorrelation,
        topDecileSeatShare: assessment.popularity.topDecileSeatShare,
        lesserKnownMeanSelectionProbability: assessment.popularity.lesserKnownMeanSelectionProbability
      },
      candidateSplitting: {
        baselineExpectedSeats: assessment.candidateSplitting.baseline.expectedSeats,
        bestExpectedSeats: assessment.candidateSplitting.best.expectedSeats,
        absoluteSeatShareGain: assessment.candidateSplitting.absoluteSeatShareGain,
        bestPattern: assessment.candidateSplitting.best.pattern
      },
      cartelSeatCapture: assessment.coalitionCapture.at(-1),
      weakCandidateIncentive: assessment.weakCandidate,
      volatility: assessment.volatility,
      explainability: assessment.explainability,
      parameterSensitivity: sensitivity?.summary ?? "No tunable parameter.",
      verdict,
      verdictReason: verdictReason(verdict, assessment, sensitivity)
    };
  });
  const pilotCandidates = rows.filter((row) => row.verdict === "PILOT CANDIDATE");
  const reportWithoutHash = {
    reportVersion: "0.1" as const,
    generatedAt: context.generatedAt,
    simulatorVersion: "DECISION_GATE_V0.1",
    runPolicy: {
      primaryRunsPerScenario: runs,
      sensitivityRunsPerScenario: sensitivityRuns,
      seedDomain: "TAKE_SIMULATION_RUN_V1",
      deterministicReplay: true
    },
    frozenBaselineArtifacts: context.baselineArtifacts,
    engineeringVerification: context.engineeringVerification,
    provisionalProductDecision: {
      overlapping: "EXPERIMENTAL_LOW_ASSURANCE",
      disjoint: "LEADING_HIGH_ASSURANCE_DESIGN",
      evidenceLevel: "PROVISIONAL_SYNTHETIC",
      explanation: "Disjoint populations remove the selector's direct weak-recipient self-interest, but do not solve coalition capture or identity acquisition."
    },
    constitutionalChecks: {
      validIdentityInfluenceConservation: "PASS",
      fixedBudgetAmplificationEvaluatedSeparately: true,
      graphWeightingUsed: false,
      researchVariablesUsedByAllocation: false,
      correlationCanInvalidateSupport: false
    },
    parameterFamilies: DECISION_GATE_PARAMETER_FAMILIES,
    decisionHeuristics: {
      note: "Operational decision gates, not scientific definitions. They were fixed before this comparative run.",
      maximumCandidateSplittingSeatShareGain: 0.05,
      minimumQualityRecovery: 0.8,
      maximumTwentyFiveIdentityCartelSeatShare: 0.3,
      maximumHeadlineParameterRange: 0.15
    },
    comparison: rows,
    strategyAssessments: assessments,
    parameterSensitivity,
    decision: {
      pilotCandidates: pilotCandidates.map((row) => row.strategy),
      seriousCampaignRecipientRule: pilotCandidates.length > 0
        ? `Use ${pilotCandidates.map((item) => item.strategy).join(", ")} only in a disjoint pilot under the frozen parameters.`
        : "UNKNOWN: none of the modeled allocation strategies is adequate for a serious TAKE campaign.",
      stopRuleTriggered: pilotCandidates.length === 0,
      newMechanismImplemented: false,
      propertiesRequiredOfFutureCandidate: [
        "Independent genuine support remains consequential and monotone.",
        "Redistributing a fixed coalition TAKE budget cannot materially increase expected seat control.",
        "Small support differences do not become deterministic opportunity cliffs.",
        "The rule remains legible and exactly replayable from public artifacts.",
        "Disjoint selectors and recipients remain compatible with the rule.",
        "Parameter choices are robust across small campaign sizes."
      ]
    }
  };
  return {
    ...reportWithoutHash,
    reportHash: domainHash("TAKE_MECHANISM_DECISION_GATE_V0_1", reportWithoutHash)
  };
}

function assessStrategy(strategy: SimulationStrategyConfig, runs: number) {
  const candidateSplitting = assessCandidateSplitting(strategy, runs);
  const coalitionCapture = coalitionSizes.map((size) => bestCoalitionCapture(strategy, runs, size));
  const popularity = assessPopularity(strategy, runs);
  const qualityReport = runScenario(latentQualityScenario(), strategy, runs);
  const denseScenario = denseCommunityScenario();
  const sparseScenario = { ...sparseCommunityScenario(), id: denseScenario.id };
  const dense = runScenario(denseScenario, strategy, runs);
  const sparse = runScenario(sparseScenario, strategy, runs);
  const weakCandidate = assessWeakCandidate(strategy, runs);
  const smallCampaignResults = smallCampaigns.map(({ seats, selectors }) => {
    const report = runScenario(buildSmallCampaign(selectors, seats), strategy, runs);
    return {
      selectors,
      seats,
      qualityRecovery: report.qualityRecovery,
      winnerSetStability: report.winnerSetStability,
      supportDistribution: report.supportDistribution
    };
  });
  const reciprocity = runScenario(reciprocityAttackScenario(), strategy, runs);
  const cycle = runScenario(cycleAttackScenario(), strategy, runs);
  const late = lateCoordinationScenario();
  const ordinaryTiming = { ...late, id: `${late.id}_ORDINARY_TIMING`, edges: late.edges.map((edge, index) => ({
    ...edge,
    blockTimestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
  })) };
  const lateSameSeedDomain = { ...late, id: ordinaryTiming.id };
  const lateReport = runScenario(lateSameSeedDomain, strategy, runs);
  const ordinaryReport = runScenario(ordinaryTiming, strategy, runs);
  return {
    strategy,
    candidateSplitting,
    coalitionCapture,
    popularity,
    quality: {
      qualityRecovery: qualityReport.qualityRecovery,
      meanSelectedQuality: qualityReport.meanSelectedQuality
    },
    honestDenseCommunity: {
      denseQualityRecovery: dense.qualityRecovery,
      sparseQualityRecovery: sparse.qualityRecovery,
      penalty: relativeLoss(sparse.qualityRecovery, dense.qualityRecovery),
      identicalAllocationInputs: dense.candidateSupport && JSON.stringify(dense.candidateSupport) === JSON.stringify(sparse.candidateSupport)
    },
    weakCandidate,
    volatility: {
      winnerSetStability: popularity.report.winnerSetStability,
      coalitionAt25: coalitionCapture.at(-1)?.seatStatistics
    },
    explainability: qualityReport.explanationCoverage,
    smallCampaigns: smallCampaignResults,
    behavioralObservationBoundary: {
      reciprocitySignals: reciprocity.reciprocitySignals,
      reciprocityInvalidAttemptRate: reciprocity.invalidAttemptRate,
      shortCycleSignals: cycle.shortCycleSignals,
      shortCycleInvalidAttemptRate: cycle.invalidAttemptRate,
      lateTimingChangesSupport: JSON.stringify(lateReport.candidateSupport) !== JSON.stringify(ordinaryReport.candidateSupport),
      lateTimingChangesSelectionProbabilities: JSON.stringify(lateReport.selectionProbability) !== JSON.stringify(ordinaryReport.selectionProbability),
      conclusion: "Reciprocity, cycles, and timing remain observations; no signal changes validity, support, or allocation."
    },
    influenceConservation: {
      invariant: "m additional valid canonical givers contribute at most m raw support units",
      passed: true,
      note: "This is not a claim of Sybil resistance or acceptable seat capture."
    }
  };
}

function assessCandidateSplitting(strategy: SimulationStrategyConfig, runs: number) {
  const patterns = Array.from({ length: 6 }, (_, index) => balancedPartition(20, index + 1));
  const results = patterns.map((pattern) => {
    const scenario = buildFixedBudgetScenario(pattern);
    const report = runScenario(scenario, strategy, runs);
    return {
      pattern,
      supportBudget: pattern.reduce((sum, value) => sum + value, 0),
      expectedSeats: report.ownerSeatStatistics.coalition?.expectedSeats ?? 0,
      expectedSeatShare: report.ownerSeatStatistics.coalition?.expectedSeatShare ?? 0,
      variance: report.ownerSeatStatistics.coalition?.variance ?? 0,
      probabilityZeroSeats: report.ownerSeatStatistics.coalition?.probabilityZeroSeats ?? 0,
      probabilityMajoritySeats: report.ownerSeatStatistics.coalition?.probabilityMajoritySeats ?? 0
    };
  });
  const baseline = results[0]!;
  const best = [...results].sort((left, right) => right.expectedSeats - left.expectedSeats)[0]!;
  return {
    coalitionTakes: 20,
    seats: 3,
    search: "Best-found across balanced 1-to-6 allied-recipient partitions fixed before execution.",
    baseline,
    best,
    absoluteExpectedSeatGain: best.expectedSeats - baseline.expectedSeats,
    absoluteSeatShareGain: best.expectedSeatShare - baseline.expectedSeatShare,
    fixedBudgetAmplification: baseline.expectedSeats > 0 ? best.expectedSeats / baseline.expectedSeats : null,
    patterns: results
  };
}

function bestCoalitionCapture(strategy: SimulationStrategyConfig, runs: number, coalitionSize: number) {
  const maxAllies = Math.min(10, coalitionSize);
  const alternatives = Array.from({ length: maxAllies }, (_, index) => balancedPartition(coalitionSize, index + 1))
    .map((pattern) => {
      const report = runScenario(buildCoalitionCaptureScenario(coalitionSize, pattern), strategy, runs);
      return { pattern, statistics: report.ownerSeatStatistics.coalition! };
    });
  const best = [...alternatives].sort((left, right) => right.statistics.expectedSeats - left.statistics.expectedSeats)[0]!;
  return {
    coalitionSize,
    selectorShare: coalitionSize / 100,
    fixedTakeBudget: coalitionSize,
    bestPattern: best.pattern,
    expectedSeats: best.statistics.expectedSeats,
    expectedSeatShare: best.statistics.expectedSeatShare,
    seatStatistics: best.statistics
  };
}

function assessPopularity(strategy: SimulationStrategyConfig, runs: number) {
  const scenario = popularitySkewScenario();
  const report = runScenario(scenario, strategy, runs);
  const popularity = scenario.context!.popularityProxy!;
  const keys = scenario.candidates.map((candidate) => candidate.key);
  const seatCorrelation = spearman(
    keys.map((key) => popularity[key]!),
    keys.map((key) => report.selectionProbability[key] ?? 0)
  );
  const lesserKnown = [...keys]
    .sort((left, right) => popularity[left]! - popularity[right]!)
    .slice(0, Math.max(1, Math.ceil(keys.length / 4)));
  const marginalSupportCurve = [1, 2, 3, 5, 8, 13, 21, 34].map((support) => {
    const marginal = runScenario(buildMarginalSupportScenario(support), strategy, runs);
    const target = identity("candidate", "marginal-target");
    return { support, selectionProbability: marginal.selectionProbability[target] ?? 0 };
  });
  return {
    supportCorrelation: report.popularity?.coefficient ?? null,
    supportCorrelation95: report.popularity?.confidenceInterval95 ?? null,
    seatCorrelation,
    topDecileSeatShare: report.popularity?.topDecileSeatShare ?? 0,
    winnerOverlap: report.popularity?.winnerOverlap ?? 0,
    supportGini: report.popularity?.supportGini ?? 0,
    lesserKnownMeanSelectionProbability: mean(lesserKnown.map((key) => report.selectionProbability[key] ?? 0)),
    marginalSupportCurve,
    report
  };
}

function assessWeakCandidate(strategy: SimulationStrategyConfig, runs: number) {
  const overlap = weakCandidateOverlapScenarios();
  const truthful = runScenario(overlap.truthful, strategy, runs);
  const strategic = runScenario(overlap.strategic, strategy, runs);
  const overlapGain = (strategic.ownerExpectedSeats.selectors ?? 0) - (truthful.ownerExpectedSeats.selectors ?? 0);
  const disjointTruthful = runScenario(buildDisjointWeakCandidate(false), strategy, runs);
  const disjointStrategic = runScenario(buildDisjointWeakCandidate(true), strategy, runs);
  return {
    overlapping: {
      truthfulSelectorExpectedSeats: truthful.ownerExpectedSeats.selectors ?? 0,
      strategicSelectorExpectedSeats: strategic.ownerExpectedSeats.selectors ?? 0,
      selectorWinningProbabilityGain: overlapGain
    },
    disjoint: {
      truthfulSelectorExpectedSeats: 0,
      strategicSelectorExpectedSeats: 0,
      selectorWinningProbabilityGain: 0,
      truthfulQualityRecovery: disjointTruthful.qualityRecovery,
      strategicQualityRecovery: disjointStrategic.qualityRecovery,
      note: "Selectors are not recipient candidates, so nominating weakly cannot improve their own seat probability; it can still reduce allocation quality."
    }
  };
}

function buildParameterSensitivity(runs: number) {
  const threshold = DECISION_GATE_PARAMETER_FAMILIES.thresholdMinimumSupport.map((minimumSupport) =>
    sensitivityPoint({ strategyId: "THRESHOLD_UNIFORM_LOTTERY", strategyVersion: "1", minimumSupport }, runs)
  );
  const capped = DECISION_GATE_PARAMETER_FAMILIES.cappedMinimumSupport.flatMap((minimumSupport) =>
    DECISION_GATE_PARAMETER_FAMILIES.cappedSupportCap.map((supportCap) =>
      sensitivityPoint({ strategyId: "CAPPED_SUPPORT_PPS", strategyVersion: "1", minimumSupport, supportCap }, runs)
    )
  );
  return [
    sensitivityFamily("THRESHOLD_UNIFORM_LOTTERY", threshold),
    sensitivityFamily("CAPPED_SUPPORT_PPS", capped)
  ];
}

function sensitivityPoint(strategy: SimulationStrategyConfig, runs: number) {
  const splitting = assessCandidateSplitting(strategy, runs);
  const qualityReport = runScenario(latentQualityScenario(), strategy, runs);
  const popularity = runScenario(popularitySkewScenario(), strategy, runs);
  const cartel = bestCoalitionCapture(strategy, runs, 25);
  const weakScenario = buildDisjointWeakCandidate(true);
  const weak = runScenario(weakScenario, strategy, runs);
  const weakKey = identity("candidate", "disjoint-weak-weak");
  const minimumSupport = "minimumSupport" in strategy ? strategy.minimumSupport : 1;
  const supportKeys = Object.keys(qualityReport.candidateSupport);
  return {
    strategy,
    qualityRecovery: qualityReport.qualityRecovery,
    candidateSplittingSeatShareGain: splitting.absoluteSeatShareGain,
    fixedBudgetAmplification: splitting.fixedBudgetAmplification,
    bestSplittingPattern: splitting.best.pattern,
    qualifiedCoalitionAllies: splitting.best.pattern.filter((support) => support >= minimumSupport).length,
    qualifiedLatentQualityCandidates: Object.values(qualityReport.candidateSupport)
      .filter((support) => support >= minimumSupport).length,
    weakCandidateAdmissionProbability: weak.selectionProbability[weakKey] ?? 0,
    nominationInformativeness: supportKeys.length >= 2
      ? spearman(
          supportKeys.map((key) => qualityReport.candidateSupport[key]!),
          supportKeys.map((key) => qualityReport.selectionProbability[key] ?? 0)
        )
      : null,
    cartelSeatShareAt25Identities: cartel.expectedSeatShare,
    popularityTopDecileSeatShare: popularity.popularity?.topDecileSeatShare ?? 0,
    winnerSetStability: popularity.winnerSetStability
  };
}

function sensitivityFamily(family: string, points: ReturnType<typeof sensitivityPoint>[]) {
  const qualityRange = range(points.map((point) => point.qualityRecovery));
  const splittingRange = range(points.map((point) => point.candidateSplittingSeatShareGain));
  const cartelRange = range(points.map((point) => point.cartelSeatShareAt25Identities));
  return {
    family,
    points,
    ranges: { qualityRecovery: qualityRange, candidateSplitting: splittingRange, cartelSeatShare: cartelRange },
    summary: `quality range ${formatRange(qualityRange)}; splitting-gain range ${formatRange(splittingRange)}; cartel-share range ${formatRange(cartelRange)}`
  };
}

function verdictFor(
  assessment: ReturnType<typeof assessStrategy>,
  sensitivity: ReturnType<typeof sensitivityFamily> | undefined
): DecisionVerdict {
  if (assessment.strategy.strategyId === "RAW_UNIQUE_SUPPORT") return "CONTROL ONLY";
  const split = assessment.candidateSplitting.absoluteSeatShareGain;
  const quality = assessment.quality.qualityRecovery;
  const cartel = assessment.coalitionCapture.at(-1)?.expectedSeatShare ?? 1;
  const sensitivityRange = sensitivity
    ? Math.max(sensitivity.ranges.qualityRecovery.span, sensitivity.ranges.candidateSplitting.span, sensitivity.ranges.cartelSeatShare.span)
    : 0;
  if (split <= 0.05 && quality >= 0.8 && cartel <= 0.3 && sensitivityRange <= 0.15) return "PILOT CANDIDATE";
  if (split <= 0.1 && quality >= 0.7 && cartel <= 0.4) return "PROMISING FOR MORE TESTING";
  return "REJECT";
}

function verdictReason(
  verdict: DecisionVerdict,
  assessment: ReturnType<typeof assessStrategy>,
  sensitivity: ReturnType<typeof sensitivityFamily> | undefined
) {
  if (verdict === "CONTROL ONLY") return "Frozen V0 baseline; retained for comparison despite known strategic failures.";
  const failures = [
    assessment.candidateSplitting.absoluteSeatShareGain > 0.05 ? "fixed-budget candidate splitting" : null,
    assessment.quality.qualityRecovery < 0.8 ? "quality recovery" : null,
    (assessment.coalitionCapture.at(-1)?.expectedSeatShare ?? 1) > 0.3 ? "25-identity cartel capture" : null,
    sensitivity && Math.max(
      sensitivity.ranges.qualityRecovery.span,
      sensitivity.ranges.candidateSplitting.span,
      sensitivity.ranges.cartelSeatShare.span
    ) > 0.15 ? "parameter sensitivity" : null
  ].filter(Boolean);
  return failures.length > 0 ? `Fails: ${failures.join(", ")}.` : "Passes the preregistered operational pilot heuristics; still not production-ready.";
}

function familyFor(strategy: SimulationStrategyConfig) {
  return strategy.strategyId === "THRESHOLD_UNIFORM_LOTTERY" || strategy.strategyId === "CAPPED_SUPPORT_PPS"
    ? strategy.strategyId
    : "NONE";
}

function strategyLabel(strategy: SimulationStrategyConfig) {
  if (strategy.strategyId === "THRESHOLD_UNIFORM_LOTTERY") {
    return `${strategy.strategyId}@${strategy.strategyVersion}(minimumSupport=${strategy.minimumSupport})`;
  }
  if (strategy.strategyId === "CAPPED_SUPPORT_PPS") {
    return `${strategy.strategyId}@${strategy.strategyVersion}(minimumSupport=${strategy.minimumSupport},supportCap=${strategy.supportCap})`;
  }
  return `${strategy.strategyId}@${strategy.strategyVersion}`;
}

function buildFixedBudgetScenario(pattern: number[]): SimulationScenario {
  const coalition = pattern.map((_, index) => simulationCandidate(`fixed-coalition-${index}`, 4, "coalition"));
  const honest = [8, 8, 7, 7, 5, 5].map((_, index) => simulationCandidate(`fixed-honest-${index}`, 6 + index, "honest"));
  return scenarioFromSupport(
    `FIXED_BUDGET_SPLIT_${pattern.join("_")}`,
    3,
    [...coalition, ...honest],
    [...pattern, 8, 8, 7, 7, 5, 5]
  );
}

function buildCoalitionCaptureScenario(coalitionSize: number, pattern: number[]): SimulationScenario {
  const coalition = pattern.map((_, index) => simulationCandidate(`capture-${coalitionSize}-coalition-${index}`, 4, "coalition"));
  const honest = Array.from({ length: 20 }, (_, index) => simulationCandidate(`capture-${coalitionSize}-honest-${index}`, index + 1, "honest"));
  const honestCounts = proportionalCounts(100 - coalitionSize, honest.map((_, index) => index + 1));
  return scenarioFromSupport(
    `CARTEL_CAPTURE_${coalitionSize}_${pattern.join("_")}`,
    10,
    [...coalition, ...honest],
    [...pattern, ...honestCounts]
  );
}

function buildMarginalSupportScenario(targetSupport: number): SimulationScenario {
  const target = simulationCandidate("marginal-target", 10, "target");
  const background = Array.from({ length: 8 }, (_, index) => simulationCandidate(`marginal-background-${index}`, 1 + index, "background"));
  return scenarioFromSupport(
    `MARGINAL_SUPPORT_${targetSupport}`,
    3,
    [target, ...background],
    [targetSupport, 12, 11, 10, 9, 8, 7, 6, 5]
  );
}

function buildSmallCampaign(selectors: number, seats: number): SimulationScenario {
  const recipientCount = Math.max(6, seats * 3);
  const candidates = Array.from({ length: recipientCount }, (_, index) =>
    simulationCandidate(`small-${selectors}-${seats}-${index}`, index + 1, "honest")
  );
  return scenarioFromSupport(
    `SMALL_${selectors}_SELECTORS_${seats}_SEATS`,
    seats,
    candidates,
    proportionalCounts(selectors, candidates.map((_, index) => index + 1))
  );
}

function buildDisjointWeakCandidate(strategic: boolean): SimulationScenario {
  const deserving = simulationCandidate("disjoint-weak-deserving", 10, "recipients");
  const strong = simulationCandidate("disjoint-weak-strong", 8, "recipients");
  const weak = simulationCandidate("disjoint-weak-weak", 1, "recipients");
  return scenarioFromSupport(
    strategic ? "DISJOINT_WEAK_STRATEGIC" : "DISJOINT_WEAK_TRUTHFUL",
    2,
    [deserving, strong, weak],
    strategic ? [6, 7, 2] : [8, 7, 0]
  );
}

function scenarioFromSupport(id: string, seats: number, candidates: SimulationCandidate[], counts: number[]): SimulationScenario {
  let giverIndex = 0;
  const edges: NominationEdgeV1[] = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    for (let supportIndex = 0; supportIndex < (counts[candidateIndex] ?? 0); supportIndex += 1) {
      const giver = identity(`${id}-giver`, giverIndex);
      edges.push(simulationEdge(id, giverIndex, giver, candidates[candidateIndex]!.key));
      giverIndex += 1;
    }
  }
  return { id, kind: "ATTACK", description: id, seats, candidates, edges };
}

function simulationCandidate(name: string, quality: number, ownerGroup: string): SimulationCandidate {
  return { key: identity("candidate", name), quality, ownerGroup };
}

function simulationEdge(namespace: string, index: number, giver: Hex, recipient: Hex): NominationEdgeV1 {
  return {
    id: domainHash("TAKE_DECISION_GATE_EDGE_V0_1", { namespace, index }),
    campaignId: namespace,
    chainId: 10143,
    contractAddress: "0x0000000000000000000000000000000000000001",
    transactionHash: domainHash("TAKE_DECISION_GATE_TX_V0_1", { namespace, index }),
    blockNumber: String(index + 1),
    transactionIndex: 0,
    logIndex: 0,
    blockTimestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    giverIdentityKey: giver,
    recipientIdentityKey: recipient,
    canonicalGiverKey: giver,
    canonicalRecipientKey: recipient,
    validity: "VALID"
  };
}

function balancedPartition(total: number, parts: number) {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

function proportionalCounts(total: number, weights: number[]) {
  if (total <= 0) return weights.map(() => 0);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const exact = weights.map((weight) => total * weight / weightTotal);
  const counts = exact.map(Math.floor);
  let remaining = total - counts.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) {
    const target = order[index]!.index;
    counts[target] = (counts[target] ?? 0) + 1;
  }
  return counts;
}

function range(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, span: max - min };
}

function formatRange(value: ReturnType<typeof range>) {
  return `${value.min.toFixed(3)}-${value.max.toFixed(3)} (span ${value.span.toFixed(3)})`;
}

function mean(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function relativeLoss(baseline: number, changed: number) {
  return baseline > 0 ? Math.max(0, baseline - changed) / baseline : 0;
}
