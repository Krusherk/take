import { z } from "zod";

export const TAKE_MECHANISM_VERSION = "TAKE_MECHANISM_V1" as const;
export const TAKE_EVIDENCE_VERSION = "1" as const;
export const TAKE_ELIGIBILITY_EVALUATOR_VERSION = "1" as const;
export const TAKE_GRAPH_VERSION = "1" as const;

export const selectorRecipientModeSchema = z.enum([
  "OVERLAPPING",
  "DISJOINT_SELECTOR_RECIPIENT"
]);
export type SelectorRecipientMode = z.infer<typeof selectorRecipientModeSchema>;

export const eligibilityAudienceSchema = z.enum(["NOMINATOR", "RECIPIENT"]);
export type EligibilityAudience = z.infer<typeof eligibilityAudienceSchema>;

export const candidatePopulationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("TAKE_IDENTITIES_AS_OF_CUTOFF") }),
  z.object({
    type: z.literal("KNOWN_EXTERNAL_IDENTITIES_AS_OF_CUTOFF"),
    providers: z.array(z.enum(["twitter", "discord", "github"])).min(1)
  }),
  z.object({
    type: z.literal("ORGANIZER_ALLOWLIST"),
    allowlistId: z.string().uuid()
  }),
  z.object({
    type: z.literal("OPEN_EXTERNAL"),
    providers: z.array(z.enum(["twitter", "discord", "github"])).min(1)
  })
]);
export type CandidatePopulation = z.infer<typeof candidatePopulationSchema>;

const ruleBase = {
  id: z.string().min(1).max(96),
  version: z.literal(1)
} as const;

export const eligibilityRuleSchema = z.discriminatedUnion("type", [
  z.object({ ...ruleBase, type: z.literal("TAKE_ACCOUNT_REQUIRED") }),
  z.object({ ...ruleBase, type: z.literal("X_CONNECTED") }),
  z.object({
    ...ruleBase,
    type: z.literal("X_ACCOUNT_CREATED_BEFORE"),
    before: z.string().datetime({ offset: true })
  }),
  z.object({
    ...ruleBase,
    type: z.literal("X_ACCOUNT_MIN_AGE"),
    minimumDays: z.number().int().nonnegative().max(36_500)
  }),
  z.object({ ...ruleBase, type: z.literal("DISCORD_CONNECTED") }),
  z.object({
    ...ruleBase,
    type: z.literal("DISCORD_ACCOUNT_CREATED_BEFORE"),
    before: z.string().datetime({ offset: true })
  }),
  z.object({
    ...ruleBase,
    type: z.literal("DISCORD_ACCOUNT_MIN_AGE"),
    minimumDays: z.number().int().nonnegative().max(36_500)
  }),
  z.object({
    ...ruleBase,
    type: z.literal("DISCORD_GUILD_MEMBER"),
    guildId: z.string().regex(/^\d{1,20}$/)
  }),
  z.object({
    ...ruleBase,
    type: z.literal("DISCORD_GUILD_JOINED_BEFORE"),
    guildId: z.string().regex(/^\d{1,20}$/),
    before: z.string().datetime({ offset: true })
  }),
  z.object({
    ...ruleBase,
    type: z.literal("DISCORD_ROLE_REQUIRED"),
    guildId: z.string().regex(/^\d{1,20}$/),
    roleIds: z.array(z.string().regex(/^\d{1,20}$/)).min(1),
    match: z.enum(["ANY", "ALL"]).default("ANY")
  }),
  z.object({
    ...ruleBase,
    type: z.literal("WALLET_CONNECTED"),
    chainType: z.string().min(1).max(32).optional()
  }),
  z.object({
    ...ruleBase,
    type: z.literal("WALLET_FIRST_SEEN_BEFORE"),
    before: z.string().datetime({ offset: true }),
    source: z.enum(["TAKE_OBSERVED", "CHAIN_HISTORY"])
  }),
  z.object({
    ...ruleBase,
    type: z.literal("WALLET_MIN_ACTIVE_MONTHS"),
    minimumMonths: z.number().int().positive().max(1_200),
    windowMonths: z.number().int().positive().max(1_200),
    source: z.literal("CHAIN_HISTORY")
  }),
  z.object({ ...ruleBase, type: z.literal("GITHUB_CONNECTED") }),
  z.object({
    ...ruleBase,
    type: z.literal("PROOF_OF_HUMAN_REQUIRED"),
    provider: z.string().min(1).max(64),
    action: z.string().min(1).max(191)
  }),
  z.object({
    ...ruleBase,
    type: z.literal("EXTERNAL_RECIPIENT_ALLOWED"),
    providers: z.array(z.enum(["twitter", "discord", "github"])).min(1)
  }),
  z.object({ ...ruleBase, type: z.literal("TAKE_MEMBER_RECIPIENT_REQUIRED") }),
  z.object({
    ...ruleBase,
    type: z.literal("MERKLE_ALLOWLIST"),
    allowlistId: z.string().uuid()
  })
]);
export type EligibilityRuleV1 = z.infer<typeof eligibilityRuleSchema>;

export const eligibilityPolicySchema = z.object({
  audience: eligibilityAudienceSchema,
  population: candidatePopulationSchema,
  allOf: z.array(eligibilityRuleSchema).max(32)
});
export type EligibilityPolicyV1 = z.infer<typeof eligibilityPolicySchema>;

export const allocationStrategySchema = z.discriminatedUnion("strategyId", [
  z.object({ strategyId: z.literal("RAW_TOP_K"), strategyVersion: z.literal("1") }),
  z.object({ strategyId: z.literal("RAW_UNIQUE_SUPPORT"), strategyVersion: z.literal("2") }),
  z.object({
    strategyId: z.literal("THRESHOLD_UNIFORM_LOTTERY"),
    strategyVersion: z.literal("1"),
    minimumSupport: z.number().int().positive()
  }),
  z.object({
    strategyId: z.literal("LINEAR_PPS_WITHOUT_REPLACEMENT"),
    strategyVersion: z.literal("1")
  })
]);
export type AllocationStrategyConfig = z.infer<typeof allocationStrategySchema>;

export const randomnessCommitmentSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("DRAND"),
    network: z.literal("evmnet"),
    chainHash: z.literal("04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3"),
    round: z.number().int().positive(),
    notBefore: z.string().datetime({ offset: true }),
    allocationDelaySeconds: z.literal(600)
  }),
  z.object({ source: z.literal("NONE") })
]);
export type RandomnessCommitment = z.infer<typeof randomnessCommitmentSchema>;

export const campaignMechanismConfigV1Schema = z.object({
  mechanismVersion: z.literal(TAKE_MECHANISM_VERSION),
  assuranceLevel: z.enum(["LOW_ASSURANCE", "PROTECTED"]),
  campaignId: z.string().uuid(),
  organizationId: z.string().uuid(),
  selectorRecipientMode: selectorRecipientModeSchema,
  nominationLimit: z.literal(1),
  nominatorPolicy: eligibilityPolicySchema,
  recipientPolicy: eligibilityPolicySchema,
  reciprocityPolicy: z.literal("REJECT_LATER_EDGE"),
  allocation: allocationStrategySchema,
  resourceQuantity: z.number().int().positive(),
  cutoffAt: z.string().datetime({ offset: true }),
  randomness: randomnessCommitmentSchema,
  evidenceVersion: z.literal(TAKE_EVIDENCE_VERSION),
  evaluatorVersion: z.literal(TAKE_ELIGIBILITY_EVALUATOR_VERSION),
  graphVersion: z.literal(TAKE_GRAPH_VERSION),
  contract: z.object({
    chainId: z.number().int().positive(),
    managerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    managerVersion: z.enum(["LEGACY_V1", "V2"])
  })
}).superRefine((config, context) => {
  if (config.nominatorPolicy.audience !== "NOMINATOR") {
    context.addIssue({ code: "custom", path: ["nominatorPolicy", "audience"], message: "Expected NOMINATOR policy" });
  }
  if (config.recipientPolicy.audience !== "RECIPIENT") {
    context.addIssue({ code: "custom", path: ["recipientPolicy", "audience"], message: "Expected RECIPIENT policy" });
  }
  if (config.assuranceLevel === "PROTECTED") {
    if (config.contract.managerVersion !== "V2") {
      context.addIssue({
        code: "custom",
        path: ["contract", "managerVersion"],
        message: "Protected campaigns require the hardened V2 manager"
      });
    }
    if (config.selectorRecipientMode !== "DISJOINT_SELECTOR_RECIPIENT") {
      context.addIssue({
        code: "custom",
        path: ["selectorRecipientMode"],
        message: "Protected campaigns require disjoint nominators and recipients"
      });
    }
    if (config.nominatorPolicy.population.type === "OPEN_EXTERNAL" || config.recipientPolicy.population.type === "OPEN_EXTERNAL") {
      context.addIssue({
        code: "custom",
        path: ["recipientPolicy", "population"],
        message: "Protected campaigns require closed candidate populations"
      });
    }
    if (config.allocation.strategyId !== "RAW_UNIQUE_SUPPORT" || config.allocation.strategyVersion !== "2") {
      context.addIssue({
        code: "custom",
        path: ["allocation"],
        message: "Protected V1 campaigns use RAW_UNIQUE_SUPPORT@2"
      });
    }
    if (config.randomness.source !== "DRAND") {
      context.addIssue({
        code: "custom",
        path: ["randomness"],
        message: "Protected campaigns require committed drand randomness"
      });
    }
  }
});
export type CampaignMechanismConfigV1 = z.infer<typeof campaignMechanismConfigV1Schema>;

export const evidenceSourceSchema = z.enum([
  "TAKE_DATABASE",
  "PRIVY",
  "X_API",
  "DISCORD_API",
  "DISCORD_SNOWFLAKE",
  "MONAD_RPC",
  "ORGANIZER_ALLOWLIST",
  "PROOF_OF_HUMAN"
]);
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

export const evidenceFactSchema = z.enum([
  "TAKE_ACCOUNT",
  "SOCIAL_ACCOUNT",
  "DISCORD_GUILD_MEMBER",
  "WALLET",
  "PROOF_OF_HUMAN",
  "ALLOWLIST_MEMBERSHIP",
  "EXTERNAL_IDENTITY"
]);
export type EvidenceFact = z.infer<typeof evidenceFactSchema>;

export interface EvidenceObservationV1 {
  id: string;
  version: "1";
  subjectKey: `0x${string}`;
  source: EvidenceSource;
  fact: EvidenceFact;
  status: "OBSERVED" | "UNAVAILABLE";
  scope?: Record<string, string>;
  value: unknown;
  providerObservedAt?: string;
  observedAt: string;
  collectedAt: string;
  evidenceHash: `0x${string}`;
  errorCode?: string;
}

export type EligibilityDecision = "PASS" | "FAIL" | "UNKNOWN";

export interface RuleEvaluationV1 {
  ruleId: string;
  ruleType: EligibilityRuleV1["type"];
  ruleVersion: 1;
  decision: EligibilityDecision;
  reasonCode: string;
  evidenceObservationIds: string[];
  publicExplanation: string;
  internalDetails?: Record<string, unknown>;
}

export interface SubjectEligibilityEvaluationV1 {
  subjectKey: `0x${string}`;
  audience: EligibilityAudience;
  decision: EligibilityDecision;
  eligible: boolean;
  evaluations: RuleEvaluationV1[];
  evaluatorVersion: "1";
}

export interface NominationEdgeV1 {
  id: string;
  campaignId: string;
  chainId: number;
  contractAddress: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: string;
  transactionIndex: number;
  logIndex: number;
  blockTimestamp: string;
  giverIdentityKey: `0x${string}`;
  recipientIdentityKey: `0x${string}`;
  canonicalGiverKey: `0x${string}`;
  canonicalRecipientKey: `0x${string}`;
  validity: "VALID" | "INVALID";
  invalidReason?: string;
}

export type GraphSignalType =
  | "DIRECT_RECIPROCITY"
  | "SHORT_CYCLE"
  | "REPEATED_CYCLE"
  | "RECIPROCITY_RATE"
  | "REPEATED_GIVER_SET"
  | "REPEATED_RECIPIENT_SET"
  | "HIGH_CO_NOMINATION_OVERLAP"
  | "TEMPORAL_BURST"
  | "SYNCHRONIZED_NOMINATION_TIMING"
  | "NEW_ACCOUNT_CLUSTER"
  | "NEW_DISCORD_MEMBER_CLUSTER"
  | "REPEATED_CROSS_CAMPAIGN_COALITION"
  | "COMMON_FUNDER"
  | "SHARED_FUNDING_ANCESTRY"
  | "WALLET_SEQUENCE_SIMILARITY";

export interface GraphSignalV1 {
  id: string;
  signalType: GraphSignalType;
  algorithmVersion: "1";
  status: "AUTO_CLEARED" | "NEEDS_REVIEW" | "NOT_RUN";
  subjectKeys: `0x${string}`[];
  edgeIds: string[];
  strength?: number;
  evidence: Record<string, unknown>;
  limitation?: string;
}

export interface AllocationCandidateResultV1 {
  recipientKey: `0x${string}`;
  uniqueSupport: number;
  selected: boolean;
  rank: number;
  selectionOrder?: number;
  tieBreaker?: `0x${string}`;
  explanation: Record<string, unknown>;
}

export interface AllocationArtifactV1 {
  artifactVersion: "1";
  campaignId: string;
  strategy: AllocationStrategyConfig;
  resourceQuantity: number;
  inputEdgeIds: string[];
  excludedEdges: Array<{ edgeId: string; reason: string }>;
  randomnessSeed: `0x${string}`;
  results: AllocationCandidateResultV1[];
  inputSnapshotHash: `0x${string}`;
  resultHash: `0x${string}`;
}
