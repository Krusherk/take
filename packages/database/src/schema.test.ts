import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "./schema.js";

describe("mechanism database contract", () => {
  it("keeps campaign deployment and mechanism versions explicit", () => {
    const columns = getTableColumns(schema.campaigns);

    expect(getTableName(schema.campaigns)).toBe("campaigns");
    expect(columns).toHaveProperty("managerContractAddress");
    expect(columns).toHaveProperty("managerVersion");
    expect(columns).toHaveProperty("mechanismConfigId");
    expect(columns).toHaveProperty("experimentId");
  });

  it("stores immutable evidence provenance without OAuth token columns", () => {
    const columns = getTableColumns(schema.evidenceObservations);

    expect(columns).toHaveProperty("providerObservedAt");
    expect(columns).toHaveProperty("observedAt");
    expect(columns).toHaveProperty("collectedAt");
    expect(columns).toHaveProperty("payloadHash");
    expect(columns).toHaveProperty("evidenceHash");
    expect(columns).toHaveProperty("deduplicationKey");
    expect(columns).toHaveProperty("retentionClass");
    expect(columns).not.toHaveProperty("accessToken");
    expect(columns).not.toHaveProperty("refreshToken");
  });

  it("separates canonical chain edges, graph signals, review decisions, and allocations", () => {
    expect(getTableName(schema.nominationEdges)).toBe("nomination_edges");
    expect(getTableName(schema.graphSignalObservations)).toBe("graph_signal_observations");
    expect(getTableName(schema.reviewDecisions)).toBe("review_decisions");
    expect(getTableName(schema.randomnessArtifacts)).toBe("randomness_artifacts");
    expect(getTableName(schema.simulationRuns)).toBe("simulation_runs");
    expect(getTableName(schema.campaignExperiments)).toBe("campaign_experiments");
    expect(getTableName(schema.experimentContextObservations)).toBe("experiment_context_observations");
    expect(getTableName(schema.recipientDiscoveryExposures)).toBe("recipient_discovery_exposures");
    expect(getTableName(schema.nominationAttempts)).toBe("nomination_attempts");
  });
});
