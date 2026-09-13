import { campaignExperimentProtocolV0Schema } from "@take/mechanism";
import { describe, expect, it } from "vitest";
import { buildMechanismSimulationReport } from "./report.js";
import {
  allCoreScenarios,
  latentQualityScenario,
  popularitySkewScenario,
  reciprocityAttackScenario,
  splitAttackScenarios
} from "./scenarios.js";
import { runScenario, simulationSeed } from "./simulator.js";

describe("mechanism simulation report", () => {
  it("is complete, replayable, and candid about experimental strategies", () => {
    const report = buildMechanismSimulationReport(24);

    expect(report.recommendedStrategy).toEqual({
      strategyId: "RAW_UNIQUE_SUPPORT",
      strategyVersion: "2"
    });
    expect(report.scenarioReports.length).toBeGreaterThan(0);
    expect(report.scenarioReports.every((scenario) => scenario.explanationCoverage === 1)).toBe(true);
    expect(report.scenarioReports.every((scenario) => Number.isFinite(scenario.qualityRecovery))).toBe(true);
    expect(report.scenarioReports.every((scenario) => Number.isFinite(scenario.selectionConcentration))).toBe(true);
    expect(report.scenarioReports.every((scenario) => scenario.winnerSetStability >= 0 && scenario.winnerSetStability <= 1)).toBe(true);
    expect(report.strategyAssessments).toHaveLength(4);
    expect(report.strategyAssessments.every((assessment) => assessment.killCriteria.length > 0)).toBe(true);
    expect(report.strategyAssessments.filter((assessment) => assessment.productionEligible)).toHaveLength(1);
    expect(report.killCriteria.find((criterion) => criterion.id === "RANDOMNESS_REPLAY")?.status).toBe("PASS");
    expect(report.killCriteria.find((criterion) => criterion.id === "CORRELATION_ONLY_INVALIDATION")?.status).toBe("PASS");
    expect(report.killCriteria.find((criterion) => criterion.id === "VALID_IDENTITY_INFLUENCE_CONSERVATION"))
      .toMatchObject({ status: "PASS", measured: 1, threshold: 1 });
    expect(report.killCriteria.find((criterion) => criterion.id === "ELIGIBLE_IDENTITY_SEAT_CAPTURE")?.status)
      .toBe("REPORT_ONLY");

    const raw = report.strategyAssessments[0]!;
    expect(raw.sybilAssessment.identitiesRequiredForSeatShare.fiftyPercent).not.toBeNull();
    expect(raw.sybilAssessment.interpretation).toContain("no allocation strategy is called Sybil-resistant");
    expect(report.experimentalStrategies.some((strategy) => strategy.strategyId === "CAPPED_SUPPORT_PPS")).toBe(true);
  });

  it("rejects invalid run counts", () => {
    expect(() => buildMechanismSimulationReport(0)).toThrow(/runs/);
  });

  it("replays an exact scenario and run seed", () => {
    const scenario = latentQualityScenario();
    const strategy = { strategyId: "LINEAR_PPS_WITHOUT_REPLACEMENT", strategyVersion: "1" } as const;

    expect(simulationSeed(scenario.id, strategy, 37)).toBe(simulationSeed(scenario.id, strategy, 37));
    expect(runScenario(scenario, strategy, 64)).toEqual(runScenario(scenario, strategy, 64));
  });

  it("keeps every scenario at one edge per canonical giver", () => {
    for (const scenario of allCoreScenarios()) {
      const giverKeys = scenario.edges.map((edge) => edge.canonicalGiverKey);
      expect(new Set(giverKeys).size, scenario.id).toBe(giverKeys.length);
    }
  });

  it("keeps reciprocity valid and records it as a behavioral observation", () => {
    const scenario = reciprocityAttackScenario();
    const report = runScenario(scenario, {
      strategyId: "RAW_UNIQUE_SUPPORT",
      strategyVersion: "2"
    }, 8);

    expect(scenario.edges.every((edge) => edge.validity === "VALID")).toBe(true);
    expect(report.invalidAttemptRate).toBe(0);
    expect(report.reciprocitySignals).toBeGreaterThan(0);
  });

  it("models candidate splitting with distinct recipient identities and fixed giver power", () => {
    const { baseline, attack } = splitAttackScenarios();
    const baselineGivers = new Set(baseline.edges.map((edge) => edge.canonicalGiverKey));
    const attackGivers = new Set(attack.edges.map((edge) => edge.canonicalGiverKey));

    expect(attack.candidates.length).toBeGreaterThan(baseline.candidates.length);
    expect(attackGivers).toEqual(baselineGivers);
  });

  it("reports preregistered popularity diagnostics without making them strategy inputs", () => {
    const scenario = popularitySkewScenario();
    const report = runScenario(scenario, {
      strategyId: "RAW_UNIQUE_SUPPORT",
      strategyVersion: "2"
    }, 8);

    expect(report.popularity).toMatchObject({ sampleSize: 10, missing: 0 });
    expect(Number.isFinite(report.popularity?.coefficient)).toBe(true);
    expect(report.popularity?.confidenceInterval95).toHaveLength(2);
    expect(report.popularity?.supportGini).toBeGreaterThan(0);
  });

  it("does not allow simulator-only capped support in a V0 protocol", () => {
    expect(campaignExperimentProtocolV0Schema.shape.allocation.safeParse({
      strategyId: "CAPPED_SUPPORT_PPS",
      strategyVersion: "1",
      minimumSupport: 1,
      supportCap: 3
    }).success).toBe(false);
  });
});
