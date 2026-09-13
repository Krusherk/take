import { describe, expect, it } from "vitest";
import { domainHash } from "./canonical.js";
import {
  createEvidenceObservation,
  discordSnowflakeCreatedAt,
  evaluateEligibility,
  unavailableEvidence
} from "./eligibility.js";
import type { EligibilityPolicyV1, EvidenceObservationV1 } from "./types.js";

const subjectKey = domainHash("TAKE_TEST_IDENTITY_V1", { id: "subject" });
const cutoffAt = "2026-09-01T00:00:00.000Z";

function observed(input: Pick<EvidenceObservationV1, "id" | "source" | "fact" | "value"> & {
  scope?: Record<string, string>;
}): EvidenceObservationV1 {
  return createEvidenceObservation({
    ...input,
    subjectKey,
    status: "OBSERVED",
    observedAt: cutoffAt,
    collectedAt: cutoffAt
  });
}

describe("eligibility evaluation", () => {
  it("passes only when every required rule has verified evidence", () => {
    const policy: EligibilityPolicyV1 = {
      audience: "NOMINATOR",
      population: { type: "TAKE_IDENTITIES_AS_OF_CUTOFF" },
      allOf: [
        { id: "take-account", version: 1, type: "TAKE_ACCOUNT_REQUIRED" },
        { id: "x-age", version: 1, type: "X_ACCOUNT_MIN_AGE", minimumDays: 365 }
      ]
    };
    const result = evaluateEligibility({
      policy,
      subjectKey,
      cutoffAt,
      observations: [
        observed({ id: "take", source: "TAKE_DATABASE", fact: "TAKE_ACCOUNT", value: { exists: true } }),
        observed({
          id: "x",
          source: "X_API",
          fact: "SOCIAL_ACCOUNT",
          scope: { provider: "twitter" },
          value: { connected: true, providerCreatedAt: "2020-01-01T00:00:00.000Z" }
        })
      ]
    });

    expect(result.decision).toBe("PASS");
    expect(result.eligible).toBe(true);
    expect(result.evaluations.every((evaluation) => evaluation.evidenceObservationIds.length === 1)).toBe(true);
  });

  it("distinguishes a failed rule from unavailable provider evidence", () => {
    const policy: EligibilityPolicyV1 = {
      audience: "RECIPIENT",
      population: { type: "TAKE_IDENTITIES_AS_OF_CUTOFF" },
      allOf: [{ id: "github", version: 1, type: "GITHUB_CONNECTED" }]
    };
    const failed = evaluateEligibility({
      policy,
      subjectKey,
      cutoffAt,
      observations: [observed({
        id: "github",
        source: "PRIVY",
        fact: "SOCIAL_ACCOUNT",
        scope: { provider: "github" },
        value: { connected: false }
      })]
    });
    const unavailable = evaluateEligibility({
      policy,
      subjectKey,
      cutoffAt,
      observations: [unavailableEvidence({
        id: "github-down",
        subjectKey,
        source: "PRIVY",
        fact: "SOCIAL_ACCOUNT",
        scope: { provider: "github" },
        observedAt: cutoffAt,
        errorCode: "PRIVY_UNAVAILABLE"
      })]
    });

    expect(failed.decision).toBe("FAIL");
    expect(failed.evaluations[0]?.reasonCode).toBe("GITHUB_NOT_CONNECTED");
    expect(unavailable.decision).toBe("UNKNOWN");
    expect(unavailable.evaluations[0]?.reasonCode).toBe("PRIVY_UNAVAILABLE");
  });

  it("derives Discord creation time from the immutable snowflake", () => {
    expect(discordSnowflakeCreatedAt("175928847299117063")).toBe("2016-04-30T11:18:25.796Z");
  });

  it("treats a verified missing X account as FAIL rather than provider UNKNOWN", () => {
    const policy: EligibilityPolicyV1 = {
      audience: "NOMINATOR",
      population: { type: "TAKE_IDENTITIES_AS_OF_CUTOFF" },
      allOf: [{ id: "x-age", version: 1, type: "X_ACCOUNT_MIN_AGE", minimumDays: 30 }],
    };
    const result = evaluateEligibility({
      policy,
      subjectKey,
      cutoffAt,
      observations: [observed({
        id: "x-not-found",
        source: "X_API",
        fact: "SOCIAL_ACCOUNT",
        scope: { provider: "twitter" },
        value: { exists: false, subject: "deleted-user" },
      })],
    });

    expect(result.decision).toBe("FAIL");
    expect(result.evaluations[0]).toMatchObject({
      decision: "FAIL",
      reasonCode: "X_USER_NOT_FOUND",
    });
  });
});
