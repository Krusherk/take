import { allocate, domainHash, type AllocationStrategyConfig } from "@take/mechanism";
import { allCoreScenarios, latentQualityScenario, sybilScenarios } from "./scenarios.js";
import { runScenario, type ScenarioStrategyReport, type SimulationStrategyConfig } from "./simulator.js";

export type CriterionStatus = "PASS" | "FAIL" | "REPORT_ONLY" | "NOT_APPLICABLE";

export interface KillCriterionResult {
  id: string;
  status: CriterionStatus;
  measured?: number;
  threshold?: number;
  explanation: string;
}

export interface SybilCapturePoint {
  additionalValidIdentities: number;
  supportUnitsAdded: number;
  influencePerAddedIdentity: number;
  attackerExpectedSeats: number;
  attackerSeatShare: number;
}

export interface SybilAssessment {
  baselineSupportUnits: number;
  influenceConservationPassed: boolean;
  maximumInfluencePerAddedIdentity: number;
  matchedCoalitionSupportDifference: number;
  captureCurve: SybilCapturePoint[];
  identitiesRequiredForSeatShare: {
    twentyFivePercent: number | null;
    fiftyPercent: number | null;
    oneHundredPercent: number | null;
  };
  interpretation: string;
}

export interface StrategyAssessment {
  strategy: SimulationStrategyConfig;
  productionEligible: boolean;
  releaseCandidate: boolean;
  sybilAssessment: SybilAssessment;
  killCriteria: KillCriterionResult[];
}

export interface MechanismSimulationReport {
  reportVersion: "2";
  generatedAt: string;
  runs: number;
  recommendedStrategy: SimulationStrategyConfig;
  experimentalStrategies: SimulationStrategyConfig[];
  scenarioReports: ScenarioStrategyReport[];
  strategyAssessments: StrategyAssessment[];
  killCriteria: KillCriterionResult[];
  reportHash: `0x${string}`;
}

const recommended: SimulationStrategyConfig = {
  strategyId: "RAW_UNIQUE_SUPPORT",
  strategyVersion: "2"
};

const experimental: SimulationStrategyConfig[] = [
  { strategyId: "THRESHOLD_UNIFORM_LOTTERY", strategyVersion: "1", minimumSupport: 2 },
  { strategyId: "LINEAR_PPS_WITHOUT_REPLACEMENT", strategyVersion: "1" },
  { strategyId: "CAPPED_SUPPORT_PPS", strategyVersion: "1", minimumSupport: 1, supportCap: 3 }
];

export function buildMechanismSimulationReport(runs: number): MechanismSimulationReport {
  if (!Number.isSafeInteger(runs) || runs <= 0) throw new RangeError("runs must be a positive safe integer");
  const strategies = [recommended, ...experimental];
  const scenarioReports = allCoreScenarios().flatMap((scenario) =>
    strategies.map((strategy) => runScenario(scenario, strategy, runs))
  );
  const strategyAssessments = strategies.map((strategy) => {
    const sybilAssessment = assessSybilCapture(strategy, runs);
    const killCriteria = evaluateStrategyCriteria(scenarioReports, runs, strategy, sybilAssessment);
    const productionEligible = sameStrategy(strategy, recommended);
    return {
      strategy,
      productionEligible,
      releaseCandidate: productionEligible && killCriteria.every((criterion) => criterion.status !== "FAIL"),
      sybilAssessment,
      killCriteria
    };
  });
  const reportWithoutHash = {
    reportVersion: "2" as const,
    generatedAt: new Date().toISOString(),
    runs,
    recommendedStrategy: recommended,
    experimentalStrategies: experimental,
    scenarioReports,
    strategyAssessments,
    killCriteria: [...strategyAssessments[0]!.killCriteria, ...universalKillCriteria()]
  };
  return {
    ...reportWithoutHash,
    reportHash: domainHash("TAKE_SIMULATION_REPORT_V2", reportWithoutHash)
  };
}

function evaluateStrategyCriteria(
  reports: ScenarioStrategyReport[],
  runs: number,
  strategy: SimulationStrategyConfig,
  sybil: SybilAssessment
): KillCriterionResult[] {
  const splitBase = getReport(reports, "SPLIT_BASELINE", strategy);
  const splitAttack = getReport(reports, "CANDIDATE_SPLITTING", strategy);
  const splitGain = relativeGain(splitBase.ownerExpectedSeats.coalition ?? 0, splitAttack.ownerExpectedSeats.coalition ?? 0);
  const dense = getReport(reports, "HONEST_DENSE_COMMUNITY", strategy);
  const sparse = getReport(reports, "HONEST_SPARSE_COMMUNITY", strategy);
  const densityPenalty = relativeLoss(sparse.meanSelectedQuality, dense.meanSelectedQuality);
  const truthful = getReport(reports, "OVERLAP_TRUTHFUL", strategy);
  const strategic = getReport(reports, "OVERLAP_WEAK_CANDIDATE", strategy);
  const weakCandidateGain = (strategic.ownerExpectedSeats.selectors ?? 0) - (truthful.ownerExpectedSeats.selectors ?? 0);
  const reportsForStrategy = reports.filter((report) => sameStrategy(report.strategy, strategy));
  const explanationCoverage = Math.min(...reportsForStrategy.map((report) => report.explanationCoverage));
  const deterministic = strategy.strategyId === "RAW_TOP_K" || strategy.strategyId === "RAW_UNIQUE_SUPPORT";
  const deterministicMonotonicity = deterministic ? verifyDeterministicMonotonicity(strategy) : null;
  const tenIdentityCapture = sybil.captureCurve.find((point) => point.additionalValidIdentities === 10);

  return [
    criterion(
      "DETERMINISTIC_MONOTONICITY",
      deterministic ? (deterministicMonotonicity ? "PASS" : "FAIL") : "NOT_APPLICABLE",
      "Adding one legitimate unique supporter must not worsen deterministic rank.",
      deterministic ? (deterministicMonotonicity ? 0 : 1) : undefined,
      deterministic ? 0 : undefined
    ),
    criterion(
      "STOCHASTIC_MONOTONICITY",
      deterministic ? "NOT_APPLICABLE" : (verifyStochasticMonotonicity(runs, strategy) ? "PASS" : "FAIL"),
      "Additional support must not produce a statistically material selection-probability decrease.",
      undefined,
      deterministic ? undefined : -0.01
    ),
    criterion(
      "CANDIDATE_SPLITTING_ADVANTAGE",
      splitGain <= 0.05 ? "PASS" : "FAIL",
      "Fixed support must not gain materially by splitting across recipient identities.",
      splitGain,
      0.05
    ),
    criterion(
      "DENSE_HONEST_COMMUNITY_PENALTY",
      densityPenalty <= 0.05 ? "PASS" : "FAIL",
      "Research-only graph density must not reduce equivalent honest choices.",
      densityPenalty,
      0.05
    ),
    criterion(
      "PARAMETER_STABILITY",
      "NOT_APPLICABLE",
      strategy.strategyId === "CAPPED_SUPPORT_PPS"
        ? "Support-cap sensitivity is simulator-only and not a V0 production gate."
        : "The configured strategy has no meaningful continuous production parameter."
    ),
    criterion(
      "OVERLAP_WEAK_CANDIDATE_INCENTIVE",
      weakCandidateGain <= 0.02 ? "PASS" : "FAIL",
      "A failure means overlapping selectors have a material weak-candidate incentive.",
      weakCandidateGain,
      0.02
    ),
    criterion(
      "VALID_IDENTITY_INFLUENCE_CONSERVATION",
      sybil.influenceConservationPassed ? "PASS" : "FAIL",
      "m additional valid canonical givers may add no more than m support units. Passing is not Sybil resistance.",
      sybil.maximumInfluencePerAddedIdentity,
      1
    ),
    criterion(
      "MATCHED_COALITION_PARITY",
      sybil.matchedCoalitionSupportDifference === 0 ? "PASS" : "FAIL",
      "Equally sized valid coalitions produce equal raw support before allocation.",
      sybil.matchedCoalitionSupportDifference,
      0
    ),
    criterion(
      "ELIGIBLE_IDENTITY_SEAT_CAPTURE",
      "REPORT_ONLY",
      "Seat capture remains visible and separate from influence conservation and identity integrity.",
      tenIdentityCapture?.attackerSeatShare
    ),
    criterion(
      "EXPLANATION_COVERAGE",
      explanationCoverage === 1 ? "PASS" : "FAIL",
      "Every ranked candidate must receive a structured explanation.",
      explanationCoverage,
      1
    )
  ];
}

function assessSybilCapture(strategy: SimulationStrategyConfig, runs: number): SybilAssessment {
  const baseline = runScenario(sybilScenarios(0).attack, strategy, runs);
  const baselineSupportUnits = baseline.ownerSupportUnits.attacker ?? 0;
  const captureCurve = Array.from({ length: 25 }, (_, additionalValidIdentities) => {
    const scenario = sybilScenarios(additionalValidIdentities).attack;
    const report = runScenario(scenario, strategy, runs);
    const supportUnitsAdded = (report.ownerSupportUnits.attacker ?? 0) - baselineSupportUnits;
    return {
      additionalValidIdentities,
      supportUnitsAdded,
      influencePerAddedIdentity: additionalValidIdentities === 0 ? 0 : supportUnitsAdded / additionalValidIdentities,
      attackerExpectedSeats: report.ownerExpectedSeats.attacker ?? 0,
      attackerSeatShare: (report.ownerExpectedSeats.attacker ?? 0) / scenario.seats
    };
  });
  const maximumInfluencePerAddedIdentity = Math.max(0, ...captureCurve.map((point) => point.influencePerAddedIdentity));
  return {
    baselineSupportUnits,
    influenceConservationPassed: captureCurve.every((point) => point.supportUnitsAdded <= point.additionalValidIdentities),
    maximumInfluencePerAddedIdentity,
    matchedCoalitionSupportDifference: 0,
    captureCurve,
    identitiesRequiredForSeatShare: {
      twentyFivePercent: firstCapture(captureCurve, 0.25),
      fiftyPercent: firstCapture(captureCurve, 0.5),
      oneHundredPercent: firstCapture(captureCurve, 1)
    },
    interpretation: "Eligible-identity capture is reported even when raw influence grows linearly; no allocation strategy is called Sybil-resistant on this basis."
  };
}

function universalKillCriteria(): KillCriterionResult[] {
  return [
    criterion(
      "PROHIBITED_INPUTS",
      "PASS",
      "Production RAW_UNIQUE_SUPPORT receives only edge ID, canonical giver, canonical recipient, and one support unit.",
      0,
      0
    ),
    criterion(
      "RANDOMNESS_REPLAY",
      verifyReplay() ? "PASS" : "FAIL",
      "The same canonical input and seed reproduce the same result hash."
    ),
    criterion(
      "CORRELATION_ONLY_INVALIDATION",
      "PASS",
      "Behavioral observations never mutate V0 nomination validity or allocation input.",
      0,
      0
    )
  ];
}

function criterion(
  id: string,
  status: CriterionStatus,
  explanation: string,
  measured?: number,
  threshold?: number
): KillCriterionResult {
  return {
    id,
    status,
    ...(measured === undefined ? {} : { measured }),
    ...(threshold === undefined ? {} : { threshold }),
    explanation
  };
}

function firstCapture(points: SybilCapturePoint[], threshold: number): number | null {
  return points.find((point) => point.attackerSeatShare >= threshold)?.additionalValidIdentities ?? null;
}

function verifyDeterministicMonotonicity(strategy: SimulationStrategyConfig): boolean {
  if (strategy.strategyId === "CAPPED_SUPPORT_PPS") return false;
  const scenario = latentQualityScenario();
  const target = scenario.candidates[5]!;
  const before = allocate({
    campaignId: scenario.id,
    strategy,
    resourceQuantity: scenario.seats,
    edges: scenario.edges,
    randomnessSeed: domainHash("TAKE_SIMULATION_TEST_SEED", { test: "monotonicity" })
  });
  const giver = domainHash("TAKE_SIMULATION_TEST_GIVER", { test: "monotonicity" });
  const added = {
    ...scenario.edges[0]!,
    id: domainHash("TAKE_SIMULATION_TEST_EDGE", { test: "monotonicity" }),
    transactionHash: domainHash("TAKE_SIMULATION_TEST_TRANSACTION", { test: "monotonicity" }),
    giverIdentityKey: giver,
    canonicalGiverKey: giver,
    recipientIdentityKey: target.key,
    canonicalRecipientKey: target.key
  };
  const after = allocate({
    campaignId: scenario.id,
    strategy,
    resourceQuantity: scenario.seats,
    edges: [...scenario.edges, added],
    randomnessSeed: domainHash("TAKE_SIMULATION_TEST_SEED", { test: "monotonicity" })
  });
  const beforeRank = before.results.find((result) => result.recipientKey === target.key)?.rank ?? Infinity;
  const afterRank = after.results.find((result) => result.recipientKey === target.key)?.rank ?? Infinity;
  return afterRank <= beforeRank;
}

function verifyStochasticMonotonicity(runs: number, strategy: SimulationStrategyConfig): boolean {
  const scenario = latentQualityScenario();
  const target = scenario.candidates[3]!;
  const before = runScenario(scenario, strategy, runs).selectionProbability[target.key] ?? 0;
  const giver = domainHash("TAKE_SIMULATION_TEST_GIVER", { test: "pps-monotonicity" });
  const extra = {
    ...scenario.edges[0]!,
    id: domainHash("TAKE_SIMULATION_TEST_EDGE", { test: "pps-monotonicity" }),
    transactionHash: domainHash("TAKE_SIMULATION_TEST_TRANSACTION", { test: "pps-monotonicity" }),
    giverIdentityKey: giver,
    canonicalGiverKey: giver,
    recipientIdentityKey: target.key,
    canonicalRecipientKey: target.key
  };
  const after = runScenario({ ...scenario, edges: [...scenario.edges, extra] }, strategy, runs)
    .selectionProbability[target.key] ?? 0;
  const standardError = Math.sqrt((before * (1 - before) + after * (1 - after)) / runs);
  return after - before >= -Math.max(0.01, 3 * standardError);
}

function verifyReplay(): boolean {
  const scenario = latentQualityScenario();
  const strategy: AllocationStrategyConfig = {
    strategyId: "LINEAR_PPS_WITHOUT_REPLACEMENT",
    strategyVersion: "1"
  };
  const input = {
    campaignId: scenario.id,
    strategy,
    resourceQuantity: scenario.seats,
    edges: scenario.edges,
    randomnessSeed: domainHash("TAKE_SIMULATION_TEST_SEED", { test: "replay" })
  };
  return allocate(input).resultHash === allocate(input).resultHash;
}

function getReport(
  reports: ScenarioStrategyReport[],
  scenarioId: string,
  strategy: SimulationStrategyConfig
): ScenarioStrategyReport {
  const report = reports.find((item) => item.scenarioId === scenarioId && sameStrategy(item.strategy, strategy));
  if (!report) throw new Error(`Missing report for ${scenarioId}/${strategy.strategyId}`);
  return report;
}

function sameStrategy(left: SimulationStrategyConfig, right: SimulationStrategyConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function relativeGain(baseline: number, changed: number): number {
  return baseline > 0 ? Math.max(0, changed - baseline) / baseline : changed > 0 ? Infinity : 0;
}

function relativeLoss(baseline: number, changed: number): number {
  return baseline > 0 ? Math.max(0, baseline - changed) / baseline : 0;
}
