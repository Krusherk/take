import { beforeAll, describe, expect, it } from "vitest";
import { buildMechanismDecisionGateV01 } from "./decisionGate.js";

const context = {
  generatedAt: "2026-09-13T15:15:00.000Z",
  baselineArtifacts: [{ path: "baseline.json", sha256: "abc" }],
  engineeringVerification: { foundryRegression: { passed: 16, failed: 0 } }
};

let report: ReturnType<typeof buildMechanismDecisionGateV01>;

describe("mechanism decision gate v0.1", () => {
  beforeAll(() => {
    report = buildMechanismDecisionGateV01(4, context);
  });

  it("keeps the control frozen and compares all preregistered strategy families", () => {
    expect(report.comparison).toHaveLength(4);
    expect(report.comparison[0]).toMatchObject({
      strategy: "RAW_UNIQUE_SUPPORT@2",
      verdict: "CONTROL ONLY"
    });
    expect(report.parameterSensitivity.find((item) => item.family === "THRESHOLD_UNIFORM_LOTTERY")?.points)
      .toHaveLength(5);
    expect(report.parameterSensitivity.find((item) => item.family === "CAPPED_SUPPORT_PPS")?.points)
      .toHaveLength(16);
    expect(report.strategyAssessments.every((item) => item.influenceConservation.passed)).toBe(true);
  });

  it("holds TAKE budgets fixed and keeps graph evidence observational", () => {
    for (const assessment of report.strategyAssessments) {
      expect(assessment.candidateSplitting.patterns.every((item) => item.supportBudget === 20)).toBe(true);
      expect(assessment.behavioralObservationBoundary.reciprocitySignals).toBeGreaterThan(0);
      expect(assessment.behavioralObservationBoundary.shortCycleSignals).toBeGreaterThan(0);
      expect(assessment.behavioralObservationBoundary.reciprocityInvalidAttemptRate).toBe(0);
      expect(assessment.behavioralObservationBoundary.shortCycleInvalidAttemptRate).toBe(0);
      expect(assessment.behavioralObservationBoundary.lateTimingChangesSupport).toBe(false);
      expect(assessment.behavioralObservationBoundary.lateTimingChangesSelectionProbabilities).toBe(false);
    }
  });
});
