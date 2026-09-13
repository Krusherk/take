import { describe, expect, it } from "vitest";
import { publicGraphSnapshot } from "./graph.js";

describe("public graph artifacts", () => {
  it("publishes commitments and aggregate statuses without identity-level evidence", () => {
    const privateSnapshot = {
      id: "snapshot-1",
      campaignId: "campaign-1",
      edgeCutoffBlock: "42",
      edgeCutoffBlockHash: `0x${"ab".repeat(32)}`,
      inputHash: `0x${"cd".repeat(32)}`,
      algorithmVersion: "1",
      artifact: { edges: [{ giverIdentityKey: "secret-giver" }] },
      signals: [
        {
          signalType: "SHORT_CYCLE",
          status: "NEEDS_REVIEW",
          subjectKeys: ["secret-subject"],
          edgeIds: ["secret-edge"],
          evidence: { timing: "restricted" },
        },
        {
          signalType: "SHORT_CYCLE",
          status: "DISMISSED",
          subjectKeys: ["another-secret-subject"],
        },
      ],
    };

    const publicArtifact = publicGraphSnapshot(privateSnapshot);
    const serialized = JSON.stringify(publicArtifact);

    expect(publicArtifact.signalCounts).toEqual({
      "SHORT_CYCLE:NEEDS_REVIEW": 1,
      "SHORT_CYCLE:DISMISSED": 1,
    });
    expect(serialized).not.toContain("secret-giver");
    expect(serialized).not.toContain("secret-subject");
    expect(serialized).not.toContain("secret-edge");
    expect(serialized).not.toContain("restricted");
  });
});
