import { describe, expect, it } from "vitest";
import {
  allocationInputHashV0,
  buildAllocationInputsV0,
  campaignExperimentProtocolV0Schema,
  domainHash,
  experimentProtocolHash,
  orderRecipientsForViewer,
  PRIMARY_RESEARCH_QUESTIONS_V0,
  TAKE_EXPERIMENT_VERSION,
  type CampaignExperimentProtocolV0,
  type NominationEdgeV1
} from "./index.js";

const campaignId = "00000000-0000-4000-8000-000000000001";

describe("TAKE experiment V0", () => {
  it("hashes a complete locked protocol deterministically", () => {
    const protocol: CampaignExperimentProtocolV0 = {
      experimentVersion: TAKE_EXPERIMENT_VERSION,
      campaignId,
      mechanismConfigId: "00000000-0000-4000-8000-000000000002",
      variant: "OVERLAPPING",
      resource: { type: "ACCESS", name: "Pilot spots", seatCount: 3 },
      eligibility: {
        giverSnapshotId: "00000000-0000-4000-8000-000000000003",
        giverRoot: identity("giver-root"),
        recipientSnapshotId: "00000000-0000-4000-8000-000000000004",
        recipientRoot: identity("recipient-root"),
        cutoffAt: "2026-09-01T00:00:00.000Z"
      },
      nomination: { takesPerEligibleCanonicalGiver: 1, recipientPopulation: "ROSTERED" },
      activeInformationPolicy: "HIDE_NOMINATION_DERIVED_SOCIAL_PROOF",
      recipientOrderingPolicy: "PER_VIEWER_DETERMINISTIC_SUPPORT_INDEPENDENT",
      allocation: { strategyId: "RAW_UNIQUE_SUPPORT", strategyVersion: "2" },
      popularity: {
        primaryProxy: "X_FOLLOWER_COUNT",
        selectedProxy: "ORGANIZER_FAMILIARITY",
        fallbackScale: {
          0: "ORGANIZER_DOES_NOT_RECOGNIZE",
          1: "MINIMALLY_VISIBLE",
          2: "MODERATELY_VISIBLE",
          3: "HIGHLY_VISIBLE"
        },
        affectsMechanism: false
      },
      primaryResearchQuestions: [...PRIMARY_RESEARCH_QUESTIONS_V0],
      operationalWarnings: {
        popularitySpearmanLowerBound: 0.7,
        winnerOverlap: 0.8,
        topDecileSeatShareMultiple: 3,
        interpretation: "OPERATIONAL_HEURISTIC_NOT_SCIENTIFIC_DEFINITION"
      },
      informationModel: {
        productHidesActiveSupport: true,
        cryptographicBallotSecrecy: false,
        chainEventsMayBeReconstructed: true
      }
    };

    expect(campaignExperimentProtocolV0Schema.parse(protocol)).toEqual(protocol);
    expect(experimentProtocolHash(protocol)).toBe(experimentProtocolHash(protocol));
  });

  it("gives stable viewer-specific recipient exposure without support inputs", () => {
    const recipients = Array.from({ length: 12 }, (_, index) => ({
      canonicalRecipientId: identity(`recipient-${index}`),
      label: `recipient-${index}`
    }));
    const first = orderRecipientsForViewer({
      campaignId,
      canonicalViewerId: identity("viewer-a"),
      recipients
    });
    const repeated = orderRecipientsForViewer({
      campaignId,
      canonicalViewerId: identity("viewer-a"),
      recipients
    });
    const secondViewer = orderRecipientsForViewer({
      campaignId,
      canonicalViewerId: identity("viewer-b"),
      recipients
    });

    expect(first).toEqual(repeated);
    expect(first.map((item) => item.label)).not.toEqual(secondViewer.map((item) => item.label));
  });

  it("separates objective validity from one-unit allocation inputs", () => {
    const giver = identity("giver");
    const recipient = identity("recipient");
    const valid = edge("valid", giver, recipient, 1);
    const duplicate = edge("duplicate", giver, identity("other"), 2);
    const invalid = { ...edge("invalid", identity("other-giver"), recipient, 3), validity: "INVALID" as const, invalidReason: "KNOWN_CANONICAL_SELF_NOMINATION" };
    const built = buildAllocationInputsV0([duplicate, invalid, valid]);

    expect(built.inputs).toEqual([{
      edgeId: valid.id,
      canonicalGiverId: giver,
      canonicalRecipientId: recipient,
      supportUnits: 1
    }]);
    expect(built.excluded.map((item) => item.reason).sort()).toEqual([
      "KNOWN_CANONICAL_SELF_NOMINATION",
      "SECOND_TAKE_FROM_CANONICAL_GIVER"
    ]);
    expect(allocationInputHashV0({ campaignId, seatCount: 1, inputs: built.inputs }))
      .toMatch(/^0x[0-9a-f]{64}$/);
  });
});

function identity(value: string) {
  return domainHash("TAKE_EXPERIMENT_TEST_IDENTITY", { value });
}

function edge(id: string, giver: `0x${string}`, recipient: `0x${string}`, order: number): NominationEdgeV1 {
  return {
    id,
    campaignId,
    chainId: 10143,
    contractAddress: "0x0000000000000000000000000000000000000001",
    transactionHash: domainHash("TAKE_EXPERIMENT_TEST_TX", { id }),
    blockNumber: String(order),
    transactionIndex: 0,
    logIndex: 0,
    blockTimestamp: new Date(Date.UTC(2026, 8, 1, 0, 0, order)).toISOString(),
    giverIdentityKey: giver,
    recipientIdentityKey: recipient,
    canonicalGiverKey: giver,
    canonicalRecipientKey: recipient,
    validity: "VALID"
  };
}
