import { z } from "zod";
import { domainHash } from "./canonical.js";
import { eligibilityRuleSchema, type RuleEvaluationV1 } from "./types.js";

export const TAKE_SELECTOR_ELIGIBILITY_VERSION = "TAKE_SELECTOR_ELIGIBILITY_V1" as const;

export const eligibilityCategoryIdSchema = z.enum(["COMMUNITY", "ONCHAIN", "SOCIAL", "BUILDER"]);
export type EligibilityCategoryId = z.infer<typeof eligibilityCategoryIdSchema>;

export const reviewedEvidenceTypeSchema = z.enum([
  "GITHUB_OR_PROJECT",
  "PORTFOLIO",
  "COMMUNITY_CONTRIBUTION",
  "WALLET_CONTEXT",
  "SOCIAL_CONTEXT",
  "OTHER_URL"
]);
export type ReviewedEvidenceType = z.infer<typeof reviewedEvidenceTypeSchema>;

const stackRuleBase = {
  id: z.string().min(1).max(96),
  label: z.string().min(1).max(160),
  points: z.number().int().positive().max(100)
} as const;

export const eligibilityStackRuleSchema = z.discriminatedUnion("source", [
  z.object({
    ...stackRuleBase,
    source: z.literal("AUTOMATED"),
    evidenceRule: eligibilityRuleSchema
  }),
  z.object({
    ...stackRuleBase,
    source: z.literal("REVIEWED_SUBMISSION"),
    evidenceType: reviewedEvidenceTypeSchema,
    instructions: z.string().min(1).max(1_000)
  })
]).superRefine((rule, context) => {
  if (rule.source === "AUTOMATED" && rule.id !== rule.evidenceRule.id) {
    context.addIssue({ code: "custom", path: ["evidenceRule", "id"], message: "Stack and evidence rule IDs must match" });
  }
});
export type EligibilityStackRule = z.infer<typeof eligibilityStackRuleSchema>;

export const eligibilityCategorySchema = z.object({
  id: eligibilityCategoryIdSchema,
  label: z.string().min(1).max(96),
  enabled: z.boolean(),
  maximumPoints: z.number().int().positive().max(100),
  minimumPoints: z.number().int().nonnegative().max(100).optional(),
  rules: z.array(eligibilityStackRuleSchema).min(1).max(16)
}).superRefine((category, context) => {
  if ((category.minimumPoints ?? 0) > category.maximumPoints) {
    context.addIssue({ code: "custom", path: ["minimumPoints"], message: "Category minimum cannot exceed its cap" });
  }
  const ids = new Set(category.rules.map((rule) => rule.id));
  if (ids.size !== category.rules.length) {
    context.addIssue({ code: "custom", path: ["rules"], message: "Rule IDs must be unique within a category" });
  }
});

const newcomerPathSchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(1_000),
    requiredEvidence: z.array(reviewedEvidenceTypeSchema).min(1).max(8)
  })
]);

export const selectorEligibilityPolicySchema = z.object({
  version: z.literal(TAKE_SELECTOR_ELIGIBILITY_VERSION),
  campaignId: z.string().uuid(),
  candidateAllowlistId: z.string().uuid(),
  preset: z.enum(["MONAD_BUILDER", "COMMUNITY_CONTRIBUTOR", "CREATOR_SOCIAL", "CUSTOM"]),
  cutoffAt: z.string().datetime({ offset: true }),
  categories: z.array(eligibilityCategorySchema).min(1).max(4),
  requiredTotalPoints: z.number().int().positive().max(400),
  minimumDistinctCategories: z.number().int().positive().max(4),
  allowAppeals: z.boolean(),
  integrityScreeningEnabled: z.boolean(),
  newcomerPath: newcomerPathSchema
}).superRefine((policy, context) => {
  const enabled = policy.categories.filter((category) => category.enabled);
  const maxTotal = enabled.reduce((sum, category) => sum + category.maximumPoints, 0);
  if (policy.requiredTotalPoints > maxTotal) {
    context.addIssue({ code: "custom", path: ["requiredTotalPoints"], message: "Threshold exceeds enabled category caps" });
  }
  if (policy.minimumDistinctCategories > enabled.length) {
    context.addIssue({ code: "custom", path: ["minimumDistinctCategories"], message: "Minimum categories exceeds enabled categories" });
  }
  const ids = enabled.flatMap((category) => category.rules.map((rule) => rule.id));
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["categories"], message: "Rule IDs must be unique across the policy" });
  }
});
export type SelectorEligibilityPolicyV1 = z.infer<typeof selectorEligibilityPolicySchema>;

export type EligibilityLineStatus = "VERIFIED" | "NOT_VERIFIED" | "NO_DATA" | "PENDING_REVIEW";

export interface ReviewedRuleEvidence {
  ruleId: string;
  status: "VERIFIED" | "REJECTED" | "PENDING";
  evidenceIds: string[];
}

export interface EligibilityRuleScore {
  ruleId: string;
  label: string;
  status: EligibilityLineStatus;
  pointsAwarded: number;
  pointsAvailable: number;
  explanation: string;
  evidenceIds: string[];
}

export interface EligibilityCategoryScore {
  categoryId: EligibilityCategoryId;
  label: string;
  earnedPoints: number;
  maximumPoints: number;
  minimumPoints: number | null;
  qualifiesAsDistinctCategory: boolean;
  rules: EligibilityRuleScore[];
}

export interface SelectorEligibilityAssessmentV1 {
  version: typeof TAKE_SELECTOR_ELIGIBILITY_VERSION;
  status: "ELIGIBLE" | "NEEDS_REVIEW" | "NOT_ELIGIBLE";
  qualificationPath: "AUTOMATIC" | "ALTERNATIVE" | null;
  totalPoints: number;
  requiredTotalPoints: number;
  qualifyingCategoryCount: number;
  minimumDistinctCategories: number;
  categories: EligibilityCategoryScore[];
  missingRuleIds: string[];
}

export function selectorEligibilityPolicyHash(policy: SelectorEligibilityPolicyV1) {
  return domainHash("TAKE_SELECTOR_ELIGIBILITY_POLICY_V1", policy);
}

export function evaluateSelectorEligibility(input: {
  policy: SelectorEligibilityPolicyV1;
  automatedEvaluations: readonly RuleEvaluationV1[];
  reviewedEvidence: readonly ReviewedRuleEvidence[];
  alternativePathVerified?: boolean;
}): SelectorEligibilityAssessmentV1 {
  const automated = new Map(input.automatedEvaluations.map((evaluation) => [evaluation.ruleId, evaluation]));
  const reviewed = new Map(input.reviewedEvidence.map((evidence) => [evidence.ruleId, evidence]));
  const categories = input.policy.categories.filter((category) => category.enabled).map((category): EligibilityCategoryScore => {
    const rules = category.rules.map((rule): EligibilityRuleScore => {
      if (rule.source === "AUTOMATED") {
        const evaluation = automated.get(rule.id);
        if (!evaluation || evaluation.decision === "UNKNOWN") {
          return {
            ruleId: rule.id,
            label: rule.label,
            status: "NO_DATA",
            pointsAwarded: 0,
            pointsAvailable: rule.points,
            explanation: evaluation?.publicExplanation ?? "No verified evidence is available.",
            evidenceIds: evaluation?.evidenceObservationIds ?? []
          };
        }
        const passed = evaluation.decision === "PASS";
        return {
          ruleId: rule.id,
          label: rule.label,
          status: passed ? "VERIFIED" : "NOT_VERIFIED",
          pointsAwarded: passed ? rule.points : 0,
          pointsAvailable: rule.points,
          explanation: evaluation.publicExplanation,
          evidenceIds: evaluation.evidenceObservationIds
        };
      }
      const evidence = reviewed.get(rule.id);
      if (!evidence || evidence.status === "PENDING") {
        return {
          ruleId: rule.id,
          label: rule.label,
          status: evidence ? "PENDING_REVIEW" : "NO_DATA",
          pointsAwarded: 0,
          pointsAvailable: rule.points,
          explanation: evidence ? "Submitted evidence is awaiting review." : rule.instructions,
          evidenceIds: evidence?.evidenceIds ?? []
        };
      }
      const passed = evidence.status === "VERIFIED";
      return {
        ruleId: rule.id,
        label: rule.label,
        status: passed ? "VERIFIED" : "NOT_VERIFIED",
        pointsAwarded: passed ? rule.points : 0,
        pointsAvailable: rule.points,
        explanation: passed ? "Submitted evidence was verified." : "Submitted evidence was not verified.",
        evidenceIds: evidence.evidenceIds
      };
    });
    const earnedPoints = Math.min(category.maximumPoints, rules.reduce((sum, rule) => sum + rule.pointsAwarded, 0));
    const minimumPoints = category.minimumPoints ?? null;
    return {
      categoryId: category.id,
      label: category.label,
      earnedPoints,
      maximumPoints: category.maximumPoints,
      minimumPoints,
      qualifiesAsDistinctCategory: minimumPoints === null ? earnedPoints > 0 : earnedPoints >= minimumPoints,
      rules
    };
  });
  const totalPoints = categories.reduce((sum, category) => sum + category.earnedPoints, 0);
  const qualifyingCategoryCount = categories.filter((category) => category.qualifiesAsDistinctCategory).length;
  const categoryMinimumsPass = categories.every((category) => category.minimumPoints === null || category.earnedPoints >= category.minimumPoints);
  const automatic = totalPoints >= input.policy.requiredTotalPoints
    && qualifyingCategoryCount >= input.policy.minimumDistinctCategories
    && categoryMinimumsPass;
  const alternative = Boolean(input.alternativePathVerified && input.policy.newcomerPath.enabled);
  const missingRuleIds = categories.flatMap((category) => category.rules)
    .filter((rule) => rule.status === "NO_DATA" || rule.status === "PENDING_REVIEW")
    .map((rule) => rule.ruleId);
  const reviewableMissing = categories.flatMap((category) => category.rules)
    .some((scoredRule) => scoredRule.status === "NO_DATA" && stackRule(input.policy, scoredRule.ruleId)?.source === "REVIEWED_SUBMISSION");
  const needsReview = !automatic && !alternative && (
    categories.some((category) => category.rules.some((rule) => rule.status === "PENDING_REVIEW"))
    || (input.policy.allowAppeals && reviewableMissing)
  );
  return {
    version: TAKE_SELECTOR_ELIGIBILITY_VERSION,
    status: automatic || alternative ? "ELIGIBLE" : needsReview ? "NEEDS_REVIEW" : "NOT_ELIGIBLE",
    qualificationPath: automatic ? "AUTOMATIC" : alternative ? "ALTERNATIVE" : null,
    totalPoints,
    requiredTotalPoints: input.policy.requiredTotalPoints,
    qualifyingCategoryCount,
    minimumDistinctCategories: input.policy.minimumDistinctCategories,
    categories,
    missingRuleIds
  };
}

function stackRule(policy: SelectorEligibilityPolicyV1, ruleId: string) {
  return policy.categories.flatMap((category) => category.rules).find((rule) => rule.id === ruleId);
}
