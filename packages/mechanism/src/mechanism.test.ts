import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import {
  allocate,
  allocatePrepared,
  prepareAllocation,
  selectPreparedRecipientKeys
} from "./allocation.js";
import { domainHash } from "./canonical.js";
import { analyzeNominationGraph } from "./graph.js";
import { applyRejectLaterReciprocity } from "./reciprocity.js";
import { committedDrandRound, deriveAllocationSeed } from "./randomness.js";
import type { NominationEdgeV1 } from "./types.js";

const contractAddress = "0x0000000000000000000000000000000000000001" as const;

function identity(name: string): Hex {
  return domainHash("TAKE_TEST_IDENTITY_V1", { name });
}

function edge(index: number, giver: Hex, recipient: Hex, overrides: Partial<NominationEdgeV1> = {}): NominationEdgeV1 {
  return {
    id: `edge-${index}`,
    campaignId: "campaign",
    chainId: 10143,
    contractAddress,
    transactionHash: domainHash("TAKE_TEST_TRANSACTION_V1", { index }),
    blockNumber: String(index + 10),
    transactionIndex: 0,
    logIndex: 0,
    blockTimestamp: new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString(),
    giverIdentityKey: giver,
    recipientIdentityKey: recipient,
    canonicalGiverKey: giver,
    canonicalRecipientKey: recipient,
    validity: "VALID",
    ...overrides
  };
}

describe("canonical allocation", () => {
  it("merges aliases and counts each canonical giver once", () => {
    const giver = identity("giver");
    const giverAlias = identity("giver-alias");
    const recipient = identity("recipient");
    const recipientAlias = identity("recipient-alias");
    const artifact = allocate({
      campaignId: "campaign",
      strategy: { strategyId: "RAW_UNIQUE_SUPPORT", strategyVersion: "2" },
      resourceQuantity: 1,
      randomnessSeed: identity("seed"),
      edges: [
        edge(1, giver, recipient),
        edge(2, giverAlias, recipientAlias, {
          canonicalGiverKey: giver,
          canonicalRecipientKey: recipient
        })
      ]
    });

    expect(artifact.results).toHaveLength(1);
    expect(artifact.results[0]).toMatchObject({ recipientKey: recipient, uniqueSupport: 1, selected: true });
  });

  it("hashes the complete chain-ordered input and records exclusions", () => {
    const valid = edge(1, identity("a"), identity("recipient"));
    const invalid = edge(2, identity("b"), identity("recipient"), {
      validity: "INVALID",
      invalidReason: "INELIGIBLE_GIVER"
    });
    const input = {
      campaignId: "campaign",
      strategy: { strategyId: "RAW_TOP_K", strategyVersion: "1" } as const,
      resourceQuantity: 1,
      randomnessSeed: identity("seed")
    };
    const forward = allocate({ ...input, edges: [valid, invalid] });
    const reversed = allocate({ ...input, edges: [invalid, valid] });

    expect(reversed.inputSnapshotHash).toBe(forward.inputSnapshotHash);
    expect(reversed.resultHash).toBe(forward.resultHash);
    expect(forward.excludedEdges).toEqual([{ edgeId: invalid.id, reason: "INELIGIBLE_GIVER" }]);
  });

  it("replays probabilistic allocation exactly from the same seed", () => {
    const edges = Array.from({ length: 12 }, (_, index) => edge(
      index,
      identity(`giver-${index}`),
      identity(`recipient-${index % 4}`)
    ));
    const input = {
      campaignId: "campaign",
      strategy: { strategyId: "LINEAR_PPS_WITHOUT_REPLACEMENT", strategyVersion: "1" } as const,
      resourceQuantity: 2,
      randomnessSeed: identity("seed"),
      edges
    };
    expect(allocate(input)).toEqual(allocate(input));
  });

  it("reuses canonical preparation without changing the allocation artifact", () => {
    const edges = Array.from({ length: 12 }, (_, index) => edge(
      index,
      identity(`prepared-giver-${index}`),
      identity(`prepared-recipient-${index % 4}`)
    ));
    const input = {
      campaignId: "campaign",
      strategy: { strategyId: "RAW_UNIQUE_SUPPORT", strategyVersion: "2" } as const,
      resourceQuantity: 2,
      randomnessSeed: identity("prepared-seed"),
      edges
    };

    const prepared = prepareAllocation(input);
    expect(allocatePrepared(prepared, input.randomnessSeed)).toEqual(allocate(input));
  });

  it("selects the same recipients through the simulation fast path", () => {
    const edges = Array.from({ length: 24 }, (_, index) => edge(
      index,
      identity(`selection-giver-${index}`),
      identity(`selection-recipient-${index % 7}`)
    ));
    const strategies = [
      { strategyId: "RAW_TOP_K", strategyVersion: "1" },
      { strategyId: "RAW_UNIQUE_SUPPORT", strategyVersion: "2" },
      { strategyId: "THRESHOLD_UNIFORM_LOTTERY", strategyVersion: "1", minimumSupport: 2 },
      { strategyId: "LINEAR_PPS_WITHOUT_REPLACEMENT", strategyVersion: "1" }
    ] as const;

    for (const strategy of strategies) {
      const prepared = prepareAllocation({
        campaignId: "campaign",
        strategy,
        resourceQuantity: 3,
        edges
      });
      for (let run = 0; run < 20; run += 1) {
        const seed = identity(`selection-seed-${run}`);
        const selectedFromArtifact = allocatePrepared(prepared, seed).results
          .filter((result) => result.selected)
          .map((result) => result.recipientKey)
          .sort();
        expect(selectPreparedRecipientKeys(prepared, seed).sort()).toEqual(selectedFromArtifact);
      }
    }
  });
});

describe("graph evidence", () => {
  it("invalidates only the later direct-reciprocal edge", () => {
    const a = identity("a");
    const b = identity("b");
    const later = edge(9, b, a);
    const earlier = edge(1, a, b);
    const result = applyRejectLaterReciprocity([later, earlier]);

    expect(result.edges.find((item) => item.id === earlier.id)?.validity).toBe("VALID");
    expect(result.edges.find((item) => item.id === later.id)).toMatchObject({
      validity: "INVALID",
      invalidReason: "DIRECT_RECIPROCITY_REJECT_LATER_EDGE"
    });
    expect(result.signals[0]?.signalType).toBe("DIRECT_RECIPROCITY");
  });

  it("records correlation signals without mutating otherwise valid edges", () => {
    const a = identity("cycle-a");
    const b = identity("cycle-b");
    const c = identity("cycle-c");
    const result = analyzeNominationGraph([edge(1, a, b), edge(2, b, c), edge(3, c, a)], {
      temporalBurstMinimumEdges: 99
    });

    expect(result.signals.some((signal) => signal.signalType === "SHORT_CYCLE" && signal.status === "NEEDS_REVIEW")).toBe(true);
    expect(result.edges.every((item) => item.validity === "VALID")).toBe(true);
    expect(result.signals.filter((signal) => signal.status === "NOT_RUN")).toHaveLength(3);
  });

  it("keeps correlation signals completely outside allocation", () => {
    const a = identity("dense-a");
    const b = identity("dense-b");
    const c = identity("dense-c");
    const d = identity("dense-d");
    const inputEdges = [
      edge(1, a, b),
      edge(2, b, c),
      edge(3, c, a),
      edge(4, d, b),
    ];
    const analysis = analyzeNominationGraph(inputEdges, { temporalBurstMinimumEdges: 3 });
    const allocationInput = {
      campaignId: "campaign",
      strategy: { strategyId: "RAW_UNIQUE_SUPPORT", strategyVersion: "2" } as const,
      resourceQuantity: 2,
      randomnessSeed: identity("dense-seed"),
    };

    expect(analysis.signals.some((signal) => signal.status === "NEEDS_REVIEW")).toBe(true);
    expect(allocate({ ...allocationInput, edges: analysis.edges }))
      .toEqual(allocate({ ...allocationInput, edges: inputEdges }));
  });
});

describe("drand commitments", () => {
  it("chooses the first round at or after end plus ten minutes", () => {
    const result = committedDrandRound("2026-09-01T00:00:00.000Z", {
      genesis_time: 1_700_000_000,
      period: 3
    });
    const notBeforeSeconds = Date.parse(result.notBefore) / 1_000;
    const roundTime = 1_700_000_000 + (result.round - 1) * 3;
    expect(result.notBefore).toBe("2026-09-01T00:10:00.000Z");
    expect(roundTime).toBeGreaterThanOrEqual(notBeforeSeconds);
    expect(roundTime - notBeforeSeconds).toBeLessThan(3);
  });

  it("domain-separates drand randomness into a campaign allocation seed", () => {
    const common = {
      chainId: 10143,
      managerAddress: contractAddress,
      onchainCampaignId: "1",
      rulesHash: identity("rules"),
      inputSnapshotHash: identity("input"),
      drandChainHash: "04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3",
      drandRound: 42,
      randomness: identity("randomness")
    };
    expect(deriveAllocationSeed(common)).toBe(deriveAllocationSeed(common));
    expect(deriveAllocationSeed({ ...common, onchainCampaignId: "2" })).not.toBe(deriveAllocationSeed(common));
  });
});
