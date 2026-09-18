import { describe, expect, it } from "vitest";
import { evaluateSelectorEligibility, type SelectorEligibilityPolicyV1 } from "./eligibilityStack.js";
import type { RuleEvaluationV1 } from "./types.js";

const policy: SelectorEligibilityPolicyV1 = {
  version: "TAKE_SELECTOR_ELIGIBILITY_V1",
  campaignId: "00000000-0000-4000-8000-000000000001",
  candidateAllowlistId: "00000000-0000-4000-8000-000000000002",
  preset: "CUSTOM",
  cutoffAt: "2026-09-15T00:00:00.000Z",
  categories: [
    {
      id: "SOCIAL",
      label: "Social history",
      enabled: true,
      maximumPoints: 20,
      rules: [{ id: "x", label: "X connected", points: 20, source: "AUTOMATED", evidenceRule: { id: "x", version: 1, type: "X_CONNECTED" } }]
    },
    {
      id: "BUILDER",
      label: "Builder history",
      enabled: true,
      maximumPoints: 40,
      rules: [{ id: "project", label: "Project verified", points: 40, source: "REVIEWED_SUBMISSION", evidenceType: "GITHUB_OR_PROJECT", instructions: "Submit a project." }]
    }
  ],
  requiredTotalPoints: 60,
  minimumDistinctCategories: 2,
  allowAppeals: true,
  integrityScreeningEnabled: true,
  newcomerPath: { enabled: false }
};

const xPass: RuleEvaluationV1 = {
  ruleId: "x",
  ruleType: "X_CONNECTED",
  ruleVersion: 1,
  decision: "PASS",
  reasonCode: "PASS",
  evidenceObservationIds: ["x-observation"],
  publicExplanation: "X connected."
};

describe("selector eligibility stack", () => {
  it("awards only declared points and preserves category caps", () => {
    const result = evaluateSelectorEligibility({
      policy,
      automatedEvaluations: [xPass],
      reviewedEvidence: [{ ruleId: "project", status: "VERIFIED", evidenceIds: ["submission"] }]
    });
    expect(result).toMatchObject({ status: "ELIGIBLE", totalPoints: 60, qualifyingCategoryCount: 2 });
    expect(result.categories[1]?.rules[0]).toMatchObject({ pointsAwarded: 40, status: "VERIFIED" });
  });

  it("does not turn an organizer review into arbitrary eligibility", () => {
    const result = evaluateSelectorEligibility({
      policy,
      automatedEvaluations: [xPass],
      reviewedEvidence: [{ ruleId: "project", status: "REJECTED", evidenceIds: ["submission"] }]
    });
    expect(result.status).toBe("NOT_ELIGIBLE");
    expect(result.totalPoints).toBe(20);
  });
});
