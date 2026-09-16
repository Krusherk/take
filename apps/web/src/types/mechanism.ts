export interface TakeOrganizationMembership {
  id: string;
  name: string;
  slug: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  joinedAt: string;
}

export interface MechanismSnapshotSummary {
  id: string;
  audience: "NOMINATOR" | "RECIPIENT";
  status: "EVALUATING" | "READY" | "LOCKED" | "FAILED";
  root: string | null;
  snapshotHash: string;
  candidateCount: number;
  eligibleCount: number;
  cutoffAt: string | null;
  lockedAt: string | null;
}

export interface CampaignMechanismView {
  campaignId: string;
  manager: { address: string | null; version: "LEGACY_V1" | "V2" };
  mechanismVersion: string;
  assuranceLevel: "LOW_ASSURANCE" | "PROTECTED";
  warning: string | null;
  config: Record<string, unknown> | null;
  configHash: string | null;
  status: string;
  lockedAt?: string | null;
  snapshots?: MechanismSnapshotSummary[];
}

export interface SnapshotDetail extends MechanismSnapshotSummary {
  providerErrors?: {
    unknownCount?: number;
    providerErrors?: Array<{ code: string; count: number }>;
  };
}

export interface DiscordIntegrationView {
  configured: boolean;
  integrations: Array<{
    id: string;
    organizationId: string;
    guildId: string;
    guildName: string;
    status: string;
    installedAt: string | null;
    lastHealthCheckAt: string | null;
    lastErrorCode: string | null;
  }>;
}

export interface DiscordGuildRolesView {
  guildId: string;
  roles: Array<{ id: string; name: string }>;
}

export type EligibilityPreset = "MONAD_BUILDER" | "COMMUNITY_CONTRIBUTOR" | "CREATOR_SOCIAL" | "CUSTOM";
export type EligibilityStatus = "ELIGIBLE" | "NEEDS_REVIEW" | "NOT_ELIGIBLE";
export type IntegrityStatus = "NO_DATA" | "NO_MATERIAL_CONCERN" | "REVIEW_RECOMMENDED" | "HIGH_CONFIDENCE_ISSUE";

export interface EligibilityStackRule {
  id: string;
  label: string;
  points: number;
  source: "AUTOMATED" | "REVIEWED_SUBMISSION";
  evidenceType?: "GITHUB_OR_PROJECT" | "PORTFOLIO" | "COMMUNITY_CONTRIBUTION" | "WALLET_CONTEXT" | "SOCIAL_CONTEXT" | "OTHER_URL";
  instructions?: string;
  evidenceRule?: Record<string, unknown>;
}

export interface EligibilityCategoryPolicy {
  id: "COMMUNITY" | "ONCHAIN" | "SOCIAL" | "BUILDER";
  label: string;
  enabled: boolean;
  maximumPoints: number;
  minimumPoints?: number;
  rules: EligibilityStackRule[];
}

export interface SelectorEligibilityPolicy {
  version: "TAKE_SELECTOR_ELIGIBILITY_V1";
  campaignId: string;
  candidateAllowlistId: string;
  preset: EligibilityPreset;
  cutoffAt: string;
  categories: EligibilityCategoryPolicy[];
  requiredTotalPoints: number;
  minimumDistinctCategories: number;
  allowAppeals: boolean;
  integrityScreeningEnabled: boolean;
  newcomerPath: { enabled: false } | {
    enabled: true;
    title: string;
    description: string;
    requiredEvidence: EligibilityStackRule["evidenceType"][];
  };
}

export interface EligibilityRuleScore {
  ruleId: string;
  label: string;
  status: "VERIFIED" | "NOT_VERIFIED" | "NO_DATA" | "PENDING_REVIEW";
  pointsAwarded: number;
  pointsAvailable: number;
  explanation: string;
  evidenceIds: string[];
}

export interface EligibilityCategoryScore {
  categoryId: EligibilityCategoryPolicy["id"];
  label: string;
  earnedPoints: number;
  maximumPoints: number;
  minimumPoints: number | null;
  qualifiesAsDistinctCategory: boolean;
  rules: EligibilityRuleScore[];
}

export interface SelectorAssessment {
  id: string;
  person: { id: string; name: string; handle: string | null; avatarUrl: string | null };
  status: EligibilityStatus;
  automaticStatus: EligibilityStatus;
  qualificationPath: "AUTOMATIC" | "ALTERNATIVE" | null;
  totalPoints: number;
  categories: EligibilityCategoryScore[];
  missingRuleIds: string[];
  integrity: { status: IntegrityStatus; reasons: string[] };
  evaluatedAt: string;
  locked: boolean;
}

export interface SelectorEligibilityView {
  id: string;
  campaignId: string;
  revision: number;
  status: "DRAFT" | "EVALUATING" | "REVIEW" | "LOCKED";
  preset: EligibilityPreset;
  policyHash: string;
  candidateAllowlistId: string;
  finalAllowlistId: string | null;
  lockedAt: string | null;
  counts: { eligible: number; needsReview: number; notEligible: number };
  candidateCount: number;
  policy?: SelectorEligibilityPolicy;
}

export interface EligibilityReview {
  id: string;
  type: "ELIGIBILITY_APPEAL" | "NEWCOMER_APPLICATION" | "INTEGRITY_CLARIFICATION";
  status: string;
  summary: string;
  person: SelectorAssessment["person"] | null;
  assessment: SelectorAssessment | null;
  submission: null | {
    id: string;
    type: string;
    targetRuleId: string | null;
    status: string;
    explanation: string;
    evidence: Array<{ type: string; url: string; label?: string }>;
  };
}

export interface IdentityAllowlistView {
  id: string;
  name: string;
  status: "DRAFT" | "LOCKED";
  members: Array<{ id: string; takeIdentityId: string | null; externalIdentityId: string | null }>;
}
