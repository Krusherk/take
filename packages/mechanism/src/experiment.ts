import { z } from "zod";
import type { Hex } from "viem";
import { domainHash } from "./canonical.js";
import { compareChainOrder } from "./reciprocity.js";
import type { NominationEdgeV1 } from "./types.js";

export const TAKE_EXPERIMENT_VERSION = "TAKE_EXPERIMENT_V0" as const;

export const experimentVariantSchema = z.enum(["OVERLAPPING", "DISJOINT"]);
export type ExperimentVariantV0 = z.infer<typeof experimentVariantSchema>;

export const popularityProxyTypeSchema = z.enum([
  "X_FOLLOWER_COUNT",
  "ORGANIZER_FAMILIARITY"
]);
export type PopularityProxyTypeV0 = z.infer<typeof popularityProxyTypeSchema>;

export const organizerFamiliaritySchema = z.number().int().min(0).max(3);

export const PRIMARY_RESEARCH_QUESTIONS_V0 = [
  "POPULARITY_DEPENDENCE",
  "STRATEGIC_BEHAVIOR",
  "COMPREHENSION_AND_PARTICIPATION",
  "SELECTOR_INCENTIVE_DESIGN",
  "ORGANIZER_TRUST"
] as const;

export const campaignExperimentProtocolV0Schema = z.object({
  experimentVersion: z.literal(TAKE_EXPERIMENT_VERSION),
  campaignId: z.string().uuid(),
  mechanismConfigId: z.string().uuid(),
  variant: experimentVariantSchema,
  resource: z.object({
    type: z.string().min(1).max(64),
    name: z.string().min(1).max(160),
    seatCount: z.number().int().positive()
  }),
  eligibility: z.object({
    giverSnapshotId: z.string().uuid(),
    giverRoot: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    recipientSnapshotId: z.string().uuid(),
    recipientRoot: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    cutoffAt: z.string().datetime({ offset: true })
  }),
  nomination: z.object({
    takesPerEligibleCanonicalGiver: z.literal(1),
    recipientPopulation: z.literal("ROSTERED")
  }),
  activeInformationPolicy: z.literal("HIDE_NOMINATION_DERIVED_SOCIAL_PROOF"),
  recipientOrderingPolicy: z.literal("PER_VIEWER_DETERMINISTIC_SUPPORT_INDEPENDENT"),
  allocation: z.object({
    strategyId: z.literal("RAW_UNIQUE_SUPPORT"),
    strategyVersion: z.literal("2")
  }),
  popularity: z.object({
    primaryProxy: z.literal("X_FOLLOWER_COUNT"),
    selectedProxy: popularityProxyTypeSchema,
    fallbackScale: z.object({
      0: z.literal("ORGANIZER_DOES_NOT_RECOGNIZE"),
      1: z.literal("MINIMALLY_VISIBLE"),
      2: z.literal("MODERATELY_VISIBLE"),
      3: z.literal("HIGHLY_VISIBLE")
    }),
    affectsMechanism: z.literal(false)
  }),
  primaryResearchQuestions: z.tuple([
    z.literal(PRIMARY_RESEARCH_QUESTIONS_V0[0]),
    z.literal(PRIMARY_RESEARCH_QUESTIONS_V0[1]),
    z.literal(PRIMARY_RESEARCH_QUESTIONS_V0[2]),
    z.literal(PRIMARY_RESEARCH_QUESTIONS_V0[3]),
    z.literal(PRIMARY_RESEARCH_QUESTIONS_V0[4])
  ]),
  operationalWarnings: z.object({
    popularitySpearmanLowerBound: z.literal(0.7),
    winnerOverlap: z.literal(0.8),
    topDecileSeatShareMultiple: z.literal(3),
    interpretation: z.literal("OPERATIONAL_HEURISTIC_NOT_SCIENTIFIC_DEFINITION")
  }),
  informationModel: z.object({
    productHidesActiveSupport: z.literal(true),
    cryptographicBallotSecrecy: z.literal(false),
    chainEventsMayBeReconstructed: z.literal(true)
  })
});
export type CampaignExperimentProtocolV0 = z.infer<typeof campaignExperimentProtocolV0Schema>;

export const campaignExperimentDraftV0Schema = z.object({
  variant: experimentVariantSchema,
  giverSnapshotId: z.string().uuid(),
  recipientSnapshotId: z.string().uuid(),
  popularityProxy: popularityProxyTypeSchema,
  popularityObservations: z.array(z.object({
    canonicalRecipientKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    value: z.number().int().nonnegative(),
    observedAt: z.string().datetime({ offset: true }),
    provenance: z.record(z.string(), z.unknown())
  })).min(1)
});
export type CampaignExperimentDraftV0 = z.infer<typeof campaignExperimentDraftV0Schema>;

export const nominationValidityReasonV0Schema = z.enum([
  "VALID",
  "GIVER_NOT_ELIGIBLE",
  "INVALID_SNAPSHOT_PROOF",
  "SECOND_TAKE_FROM_CANONICAL_GIVER",
  "KNOWN_CANONICAL_SELF_NOMINATION",
  "MALFORMED_NOMINATION",
  "INVALID_CAMPAIGN_STATE"
]);
export type NominationValidityReasonV0 = z.infer<typeof nominationValidityReasonV0Schema>;

export interface NominationValidityV0 {
  experimentVersion: typeof TAKE_EXPERIMENT_VERSION;
  valid: boolean;
  reason: NominationValidityReasonV0;
}

export interface AllocationInputV0 {
  edgeId: string;
  canonicalGiverId: Hex;
  canonicalRecipientId: Hex;
  supportUnits: 1;
}

export interface BehavioralObservationV0 {
  experimentVersion: typeof TAKE_EXPERIMENT_VERSION;
  signalType: string;
  subjectKeys: Hex[];
  edgeIds: string[];
  affectsNominationValidity: false;
  affectsAllocationInput: false;
}

export interface AllocationResultV0 {
  experimentVersion: typeof TAKE_EXPERIMENT_VERSION;
  strategyId: "RAW_UNIQUE_SUPPORT";
  strategyVersion: "2";
  inputHash: Hex;
  resultHash: Hex;
  selectedRecipientIds: Hex[];
}

export interface AllocationArtifactV0 {
  artifactVersion: "0";
  experimentVersion: typeof TAKE_EXPERIMENT_VERSION;
  campaignId: string;
  strategy: { strategyId: "RAW_UNIQUE_SUPPORT"; strategyVersion: "2" };
  resourceQuantity: number;
  inputs: AllocationInputV0[];
  excludedEdges: Array<{ edgeId: string; reason: string }>;
  randomnessSeed: Hex;
  results: Array<{
    recipientKey: Hex;
    uniqueSupport: number;
    selected: boolean;
    rank: number;
    selectionOrder?: number;
    tieBreaker: Hex;
    explanation: {
      strategyId: "RAW_UNIQUE_SUPPORT";
      strategyVersion: "2";
      uniqueSupport: number;
      tieBreaker: Hex;
    };
  }>;
  inputSnapshotHash: Hex;
  resultHash: Hex;
}

export function experimentProtocolHash(protocol: CampaignExperimentProtocolV0): Hex {
  return domainHash("TAKE_EXPERIMENT_PROTOCOL_V0", protocol);
}

export function recipientExposureOrderKey(input: {
  campaignId: string;
  canonicalViewerId: Hex;
  experimentVersion: typeof TAKE_EXPERIMENT_VERSION;
  canonicalRecipientId: Hex;
}): Hex {
  return domainHash("TAKE_RECIPIENT_ORDER_V0", input);
}

export function orderRecipientsForViewer<T extends { canonicalRecipientId: Hex }>(input: {
  campaignId: string;
  canonicalViewerId: Hex;
  experimentVersion?: typeof TAKE_EXPERIMENT_VERSION;
  recipients: readonly T[];
}): T[] {
  const experimentVersion = input.experimentVersion ?? TAKE_EXPERIMENT_VERSION;
  return [...input.recipients]
    .map((recipient) => ({
      recipient,
      orderKey: recipientExposureOrderKey({
        campaignId: input.campaignId,
        canonicalViewerId: input.canonicalViewerId,
        experimentVersion,
        canonicalRecipientId: recipient.canonicalRecipientId
      })
    }))
    .sort((left, right) => left.orderKey.localeCompare(right.orderKey))
    .map(({ recipient }) => recipient);
}

export function buildAllocationInputsV0(edges: readonly NominationEdgeV1[]): {
  inputs: AllocationInputV0[];
  excluded: Array<{ edgeId: string; reason: NominationValidityReasonV0 | string }>;
} {
  const inputs: AllocationInputV0[] = [];
  const excluded: Array<{ edgeId: string; reason: NominationValidityReasonV0 | string }> = [];
  const seenGivers = new Set<string>();

  for (const edge of [...edges].sort(compareChainOrder)) {
    if (edge.validity !== "VALID") {
      excluded.push({ edgeId: edge.id, reason: edge.invalidReason ?? "MALFORMED_NOMINATION" });
      continue;
    }
    const giver = edge.canonicalGiverKey.toLowerCase();
    if (seenGivers.has(giver)) {
      excluded.push({ edgeId: edge.id, reason: "SECOND_TAKE_FROM_CANONICAL_GIVER" });
      continue;
    }
    seenGivers.add(giver);
    inputs.push({
      edgeId: edge.id,
      canonicalGiverId: giver as Hex,
      canonicalRecipientId: edge.canonicalRecipientKey.toLowerCase() as Hex,
      supportUnits: 1
    });
  }

  return { inputs, excluded };
}

export function allocationInputHashV0(input: {
  campaignId: string;
  seatCount: number;
  inputs: readonly AllocationInputV0[];
}): Hex {
  return domainHash("TAKE_ALLOCATION_INPUT_V0", {
    campaignId: input.campaignId,
    seatCount: input.seatCount,
    strategy: { strategyId: "RAW_UNIQUE_SUPPORT", strategyVersion: "2" },
    inputs: [...input.inputs].sort((left, right) => left.edgeId.localeCompare(right.edgeId))
  });
}

export function allocateRawUniqueSupportV0(input: {
  campaignId: string;
  resourceQuantity: number;
  inputs: readonly AllocationInputV0[];
  excludedEdges?: ReadonlyArray<{ edgeId: string; reason: string }>;
  randomnessSeed: Hex;
}): AllocationArtifactV0 {
  if (!Number.isSafeInteger(input.resourceQuantity) || input.resourceQuantity <= 0) {
    throw new RangeError("resourceQuantity must be a positive safe integer");
  }
  const seenGivers = new Set<string>();
  const supporters = new Map<string, Set<string>>();
  for (const unit of input.inputs) {
    if (unit.supportUnits !== 1) throw new RangeError("Every V0 allocation input must be one support unit");
    const giver = unit.canonicalGiverId.toLowerCase();
    if (seenGivers.has(giver)) throw new Error("V0 allocation inputs must contain one unit per canonical giver");
    seenGivers.add(giver);
    const recipient = unit.canonicalRecipientId.toLowerCase();
    const giverSet = supporters.get(recipient) ?? new Set<string>();
    giverSet.add(giver);
    supporters.set(recipient, giverSet);
  }
  const inputSnapshotHash = allocationInputHashV0({
    campaignId: input.campaignId,
    seatCount: input.resourceQuantity,
    inputs: input.inputs
  });
  const ranked = [...supporters.entries()].map(([recipientKey, giverSet]) => ({
    recipientKey: recipientKey as Hex,
    uniqueSupport: giverSet.size,
    tieBreaker: domainHash("TAKE_ALLOCATION_TIE_V1", {
      seed: input.randomnessSeed,
      recipientKey
    })
  })).sort((left, right) =>
    right.uniqueSupport - left.uniqueSupport || left.tieBreaker.localeCompare(right.tieBreaker)
  );
  const results: AllocationArtifactV0["results"] = ranked.map((candidate, index) => ({
    ...candidate,
    selected: index < input.resourceQuantity,
    rank: index + 1,
    ...(index < input.resourceQuantity ? { selectionOrder: index + 1 } : {}),
    explanation: {
      strategyId: "RAW_UNIQUE_SUPPORT",
      strategyVersion: "2",
      uniqueSupport: candidate.uniqueSupport,
      tieBreaker: candidate.tieBreaker
    }
  }));
  const resultHash = domainHash("TAKE_ALLOCATION_RESULT_V0", {
    experimentVersion: TAKE_EXPERIMENT_VERSION,
    campaignId: input.campaignId,
    strategy: { strategyId: "RAW_UNIQUE_SUPPORT", strategyVersion: "2" },
    resourceQuantity: input.resourceQuantity,
    inputSnapshotHash,
    randomnessSeed: input.randomnessSeed,
    results
  });
  return {
    artifactVersion: "0",
    experimentVersion: TAKE_EXPERIMENT_VERSION,
    campaignId: input.campaignId,
    strategy: { strategyId: "RAW_UNIQUE_SUPPORT", strategyVersion: "2" },
    resourceQuantity: input.resourceQuantity,
    inputs: [...input.inputs],
    excludedEdges: [...(input.excludedEdges ?? [])],
    randomnessSeed: input.randomnessSeed,
    results,
    inputSnapshotHash,
    resultHash
  };
}
