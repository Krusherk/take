import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import {
  buildSelectorEligibilityPreset,
  committedDrandRound,
  domainHash,
  DRAND_EVMNET_CHAIN_HASH,
  DRAND_EVMNET_GENESIS_TIME,
  DRAND_EVMNET_PERIOD_SECONDS,
  evaluateEligibility,
  evaluateSelectorEligibility,
  selectorEligibilityPolicyHash,
  selectorEligibilityPolicySchema,
  type EligibilityPolicyV1,
  type ReviewedRuleEvidence,
  type SelectorEligibilityAssessmentV1,
  type SelectorEligibilityPolicyV1
} from "@take/mechanism";
import type { ApiEnv } from "../config/env.js";
import { assertOrganizationRole } from "./authorization.js";
import { AllowlistService } from "./allowlist.js";
import { EvidenceService, type EvidenceSubject } from "./evidence.js";
import { notFound, ServiceError } from "./errors.js";
import { MechanismService } from "./mechanism.js";

type PolicyRecord = typeof schema.campaignEligibilityPolicies.$inferSelect;
type AssessmentRecord = typeof schema.selectorEligibilityAssessments.$inferSelect;
type SubmissionType = "ELIGIBILITY_APPEAL" | "NEWCOMER_APPLICATION" | "INTEGRITY_CLARIFICATION";
type ReviewDecision = "VERIFY_EVIDENCE" | "REJECT_EVIDENCE" | "REQUEST_MORE_INFO";

interface SubmissionEvidence {
  type: string;
  url: string;
  label?: string;
}

export class SelectorEligibilityService {
  private readonly evidence: EvidenceService;
  private readonly allowlists: AllowlistService;

  constructor(
    private readonly db: Database,
    private readonly env: ApiEnv
  ) {
    this.evidence = new EvidenceService(db, env);
    this.allowlists = new AllowlistService(db);
  }

  async prepareMechanism(input: {
    campaignId: string;
    actorIdentityId: string;
    recipientAllowlistId: string;
    selectorRecipientMode: "OVERLAPPING" | "DISJOINT_SELECTOR_RECIPIENT";
    operatorManaged?: boolean;
  }) {
    const campaign = await this.campaign(input.campaignId);
    if (!input.operatorManaged) await assertOrganizationRole(this.db, campaign.organizationId, input.actorIdentityId, ["OWNER", "ADMIN"]);
    this.assertCampaignMutable(campaign);
    const policyRecord = await this.currentPolicy(input.campaignId);
    if (!policyRecord?.finalAllowlistId || policyRecord.status !== "LOCKED") {
      throw new ServiceError("SELECTOR_ELIGIBILITY_NOT_LOCKED", "Lock the final selector roster first", 409);
    }
    const [recipientAllowlist] = await this.db.select().from(schema.identityAllowlists)
      .where(and(
        eq(schema.identityAllowlists.id, input.recipientAllowlistId),
        eq(schema.identityAllowlists.organizationId, campaign.organizationId)
      )).limit(1);
    if (!recipientAllowlist) notFound("Recipient roster not found");
    if (recipientAllowlist.status === "DRAFT") await this.allowlists.lock(recipientAllowlist.id, input.actorIdentityId, input.operatorManaged);
    const [resource] = await this.db.select().from(schema.campaignResources)
      .where(eq(schema.campaignResources.campaignId, campaign.id)).limit(1);
    if (!resource) notFound("Campaign resource not found");
    const managerAddress = this.env.TAKE_CAMPAIGN_MANAGER_ADDRESS ?? "0xc3a0178b31d8844455c49988736d51a2336056e5";
    const randomness = committedDrandRound(campaign.endTime.toISOString(), {
      genesis_time: DRAND_EVMNET_GENESIS_TIME,
      period: DRAND_EVMNET_PERIOD_SECONDS
    });
    const policy = selectorEligibilityPolicySchema.parse(policyRecord.canonicalPolicy);
    return new MechanismService(this.db).createDraft(campaign.id, input.actorIdentityId, {
      mechanismVersion: "TAKE_MECHANISM_V1",
      assuranceLevel: "LOW_ASSURANCE",
      campaignId: campaign.id,
      organizationId: campaign.organizationId,
      selectorRecipientMode: input.selectorRecipientMode,
      nominationLimit: 1,
      nominatorPolicy: {
        audience: "NOMINATOR",
        population: { type: "ORGANIZER_ALLOWLIST", allowlistId: policyRecord.finalAllowlistId },
        allOf: [{ id: "selector-eligibility-v1", version: 1, type: "MERKLE_ALLOWLIST", allowlistId: policyRecord.finalAllowlistId }]
      },
      recipientPolicy: {
        audience: "RECIPIENT",
        population: { type: "ORGANIZER_ALLOWLIST", allowlistId: recipientAllowlist.id },
        allOf: [{ id: "recipient-roster", version: 1, type: "MERKLE_ALLOWLIST", allowlistId: recipientAllowlist.id }]
      },
      reciprocityPolicy: "REJECT_LATER_EDGE",
      allocation: { strategyId: "RAW_UNIQUE_SUPPORT", strategyVersion: "2" },
      resourceQuantity: resource.quantity,
      cutoffAt: policy.cutoffAt,
      randomness: {
        source: "DRAND",
        network: "evmnet",
        chainHash: DRAND_EVMNET_CHAIN_HASH,
        round: randomness.round,
        notBefore: randomness.notBefore,
        allocationDelaySeconds: 600
      },
      evidenceVersion: "1",
      evaluatorVersion: "1",
      graphVersion: "1",
      contract: { chainId: 10143, managerAddress, managerVersion: "LEGACY_V1" }
    }, input.operatorManaged);
  }

  presets(input: { campaignId: string; candidateAllowlistId: string; cutoffAt: string; guildId?: string; requiredDiscordRoleId?: string }) {
    return (["MONAD_BUILDER", "COMMUNITY_CONTRIBUTOR", "CREATOR_SOCIAL"] as const).map((preset) =>
      buildSelectorEligibilityPreset({ ...input, preset })
    );
  }

  async createDevelopmentFixtures() {
    const definitions = [
      { key: "a", name: "Ari Strong", twitter: true, github: true, discord: true, walletMonths: 14, note: "Strong connected history" },
      { key: "b", name: "Bea Partial", twitter: true, github: false, discord: true, walletMonths: 3, note: "Partial history" },
      { key: "c", name: "Cam Newcomer", twitter: false, github: true, discord: false, walletMonths: 0, note: "Newcomer path" },
      { key: "d", name: "Devon Context", twitter: true, github: true, discord: true, walletMonths: 8, note: "Integrity clarification candidate" },
      { key: "e", name: "Emi No Data", twitter: false, github: false, discord: false, walletMonths: 0, note: "No established evidence" }
    ] as const;
    const result = [];
    for (const definition of definitions) {
      const privyUserId = `take-dev-eligibility-${definition.key}`;
      let [user] = await this.db.select().from(schema.users).where(eq(schema.users.privyUserId, privyUserId)).limit(1);
      if (!user) [user] = await this.db.insert(schema.users).values({ privyUserId, displayName: definition.name }).returning();
      if (!user) throw new Error("Failed to create development fixture user");
      let [identity] = await this.db.select().from(schema.takeIdentities).where(eq(schema.takeIdentities.userId, user.id)).limit(1);
      if (!identity) [identity] = await this.db.insert(schema.takeIdentities).values({
        userId: user.id,
        protocolIdentityKey: domainHash("TAKE_DEV_PROTOCOL_IDENTITY_V1", { fixture: definition.key }),
        creationNonce: `dev-fixture-${definition.key}`
      }).returning();
      if (!identity) throw new Error("Failed to create development fixture identity");
      const firstObservedAt = new Date(Date.now() - Math.max(1, definition.walletMonths) * 30 * 86_400_000);
      for (const provider of [definition.twitter ? "twitter" : null, definition.github ? "github" : null, definition.discord ? "discord" : null].filter(Boolean) as string[]) {
        await this.db.insert(schema.socialAccounts).values({
          takeIdentityId: identity.id,
          provider,
          providerUserId: provider === "discord" ? `${180000000000000000n + BigInt(definition.key.charCodeAt(0))}` : `take-dev-${provider}-${definition.key}`,
          username: `${definition.name.split(" ")[0]?.toLowerCase()}_${definition.key}`,
          displayName: definition.name,
          firstObservedAt,
          lastObservedAt: new Date()
        }).onConflictDoNothing();
      }
      if (definition.walletMonths > 0) {
        const suffix = definition.key.charCodeAt(0).toString(16).padStart(40, "0").slice(-40);
        await this.db.insert(schema.wallets).values({
          takeIdentityId: identity.id,
          address: `0x${suffix}`,
          walletType: "embedded",
          chainType: "ethereum",
          isPrimary: true,
          firstObservedAt,
          lastObservedAt: new Date(),
          verifiedAt: firstObservedAt
        }).onConflictDoNothing();
      }
      result.push({ takeIdentityId: identity.id, name: definition.name, note: definition.note });
    }
    return result;
  }

  async applyDevelopmentScenarios(campaignId: string, actorIdentityId: string) {
    const campaign = await this.campaign(campaignId);
    await assertOrganizationRole(this.db, campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    const policyRecord = await this.currentPolicy(campaignId);
    if (!policyRecord) notFound("Selector eligibility policy not found");
    this.assertPolicyMutable(policyRecord);
    const policy = selectorEligibilityPolicySchema.parse(policyRecord.canonicalPolicy);
    const reviewedRule = stackRules(policy).find((rule) => rule.source === "REVIEWED_SUBMISSION");
    if (!reviewedRule) throw new ServiceError("DEV_REVIEW_RULE_MISSING", "The selected preset has no reviewed evidence rule", 409);
    const people = await this.db.select({ identityId: schema.takeIdentities.id, privyUserId: schema.users.privyUserId })
      .from(schema.takeIdentities).innerJoin(schema.users, eq(schema.users.id, schema.takeIdentities.userId))
      .where(inArray(schema.users.privyUserId, ["take-dev-eligibility-a", "take-dev-eligibility-b", "take-dev-eligibility-c", "take-dev-eligibility-d", "take-dev-eligibility-e"]));
    for (const person of people) {
      const [assessment] = await this.db.select().from(schema.selectorEligibilityAssessments)
        .where(and(eq(schema.selectorEligibilityAssessments.policyId, policyRecord.id), eq(schema.selectorEligibilityAssessments.takeIdentityId, person.identityId))).limit(1);
      if (!assessment) continue;
      const isNewcomer = person.privyUserId === "take-dev-eligibility-c";
      const submissionType = isNewcomer ? "NEWCOMER_APPLICATION" : "ELIGIBILITY_APPEAL";
      const targetRuleId = isNewcomer ? undefined : reviewedRule.id;
      const existing = await this.db.select({ id: schema.selectorEvidenceSubmissions.id }).from(schema.selectorEvidenceSubmissions)
        .where(and(eq(schema.selectorEvidenceSubmissions.policyId, policyRecord.id), eq(schema.selectorEvidenceSubmissions.submittedByIdentityId, person.identityId), eq(schema.selectorEvidenceSubmissions.submissionType, submissionType))).limit(1);
      if (!existing.length) {
        const accepted = !["take-dev-eligibility-b", "take-dev-eligibility-e"].includes(person.privyUserId);
        const [reviewCase] = await this.db.insert(schema.reviewCases).values({ campaignId, eligibilityPolicyId: policyRecord.id, eligibilityAssessmentId: assessment.id, subjectIdentityId: person.identityId, caseType: submissionType, status: "RESOLVED", publicSummary: "Development-only declared evidence scenario.", restrictedSummary: "Local eligibility fixture", openedByIdentityId: person.identityId }).returning();
        if (!reviewCase) throw new Error("Failed to create development review case");
        const evidenceType = isNewcomer && policy.newcomerPath.enabled ? policy.newcomerPath.requiredEvidence[0] : reviewedRule.evidenceType;
        await this.db.insert(schema.selectorEvidenceSubmissions).values({ campaignId, policyId: policyRecord.id, assessmentId: assessment.id, reviewCaseId: reviewCase.id, submittedByIdentityId: person.identityId, submissionType, targetRuleId, evidenceType, explanation: "Development-only evidence used to exercise the recalculation flow.", links: [{ type: evidenceType, url: "https://example.test/dev-evidence" }], status: accepted ? "VERIFIED" : "REJECTED" });
      }
      if (person.privyUserId === "take-dev-eligibility-d") {
        for (const [index, evidenceFamily] of ["CAMPAIGN_HISTORY", "TIMING_CONTEXT"].entries()) {
          const observationHash = domainHash("TAKE_DEV_SELECTOR_INTEGRITY_V1", { policyId: policyRecord.id, identityId: person.identityId, evidenceFamily });
          await this.db.insert(schema.selectorIntegrityObservations).values({ campaignId, policyId: policyRecord.id, takeIdentityId: person.identityId, signalType: "DEV_CORROBORATED_PATTERN", evidenceFamily, strength: "MODERATE", publicExplanation: index === 0 ? "Repeated activity appears in the same incentive campaigns." : "Activity timing overlaps with that cluster.", provenance: { source: "DEVELOPMENT_FIXTURE" }, observedAt: new Date(), observationHash }).onConflictDoNothing();
        }
        const existingClarification = await this.db.select({ id: schema.selectorEvidenceSubmissions.id }).from(schema.selectorEvidenceSubmissions)
          .where(and(eq(schema.selectorEvidenceSubmissions.policyId, policyRecord.id), eq(schema.selectorEvidenceSubmissions.submittedByIdentityId, person.identityId), eq(schema.selectorEvidenceSubmissions.submissionType, "INTEGRITY_CLARIFICATION"))).limit(1);
        if (!existingClarification.length) {
          const [reviewCase] = await this.db.insert(schema.reviewCases).values({ campaignId, eligibilityPolicyId: policyRecord.id, eligibilityAssessmentId: assessment.id, subjectIdentityId: person.identityId, caseType: "INTEGRITY_CLARIFICATION", status: "OPEN", publicSummary: "Development-only integrity clarification.", restrictedSummary: "Shared project context may explain the observed pattern.", openedByIdentityId: person.identityId }).returning();
          if (!reviewCase) throw new Error("Failed to create development integrity review");
          await this.db.insert(schema.selectorEvidenceSubmissions).values({ campaignId, policyId: policyRecord.id, assessmentId: assessment.id, reviewCaseId: reviewCase.id, submittedByIdentityId: person.identityId, submissionType: "INTEGRITY_CLARIFICATION", evidenceType: "WALLET_CONTEXT", explanation: "These wallets belong to contributors using the same project treasury.", links: [], status: "PENDING" });
        }
      }
      await this.recalculateStored(assessment.id, policyRecord);
    }
    return this.listAssessments(campaignId, actorIdentityId);
  }

  async saveDraft(campaignId: string, actorIdentityId: string, input: unknown) {
    const policy = selectorEligibilityPolicySchema.parse(input);
    const campaign = await this.campaign(campaignId);
    await assertOrganizationRole(this.db, campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    this.assertCampaignMutable(campaign);
    if (policy.campaignId !== campaignId) {
      throw new ServiceError("ELIGIBILITY_POLICY_SCOPE_MISMATCH", "Policy campaign does not match the route", 400);
    }
    const [allowlist] = await this.db.select().from(schema.identityAllowlists)
      .where(and(
        eq(schema.identityAllowlists.id, policy.candidateAllowlistId),
        eq(schema.identityAllowlists.organizationId, campaign.organizationId)
      )).limit(1);
    if (!allowlist) notFound("Selector candidate roster not found");
    const [lockedPolicy] = await this.db.select({ id: schema.campaignEligibilityPolicies.id })
      .from(schema.campaignEligibilityPolicies)
      .where(and(
        eq(schema.campaignEligibilityPolicies.campaignId, campaignId),
        eq(schema.campaignEligibilityPolicies.status, "LOCKED")
      )).limit(1);
    if (lockedPolicy) throw new ServiceError("SELECTOR_ELIGIBILITY_LOCKED", "Selector eligibility is already locked", 409);

    const [aggregate] = await this.db.select({ revision: max(schema.campaignEligibilityPolicies.revision) })
      .from(schema.campaignEligibilityPolicies)
      .where(eq(schema.campaignEligibilityPolicies.campaignId, campaignId));
    const revision = Number(aggregate?.revision ?? 0) + 1;
    const policyHash = selectorEligibilityPolicyHash(policy);
    const [created] = await this.db.insert(schema.campaignEligibilityPolicies).values({
      campaignId,
      revision,
      candidateAllowlistId: policy.candidateAllowlistId,
      preset: policy.preset,
      canonicalPolicy: policy,
      policyHash,
      createdByIdentityId: actorIdentityId
    }).returning();
    if (!created) throw new Error("Failed to create selector eligibility policy");
    await this.db.insert(schema.auditLogs).values({
      actorIdentityId,
      organizationId: campaign.organizationId,
      campaignId,
      action: "SELECTOR_ELIGIBILITY_POLICY_CREATED",
      metadata: { policyId: created.id, revision, policyHash }
    });
    return this.policyView(created);
  }

  async get(campaignId: string, actorIdentityId?: string) {
    const campaign = await this.campaign(campaignId);
    const policy = await this.currentPolicy(campaignId);
    if (!policy) return null;
    const isManager = actorIdentityId
      ? await this.canManage(campaign.organizationId, actorIdentityId)
      : false;
    const [counts] = await this.db.select({
      total: schema.selectorEligibilityAssessments.id
    }).from(schema.selectorEligibilityAssessments)
      .where(eq(schema.selectorEligibilityAssessments.policyId, policy.id));
    const assessments = await this.db.select({ status: schema.selectorEligibilityAssessments.finalStatus })
      .from(schema.selectorEligibilityAssessments)
      .where(eq(schema.selectorEligibilityAssessments.policyId, policy.id));
    return {
      ...this.policyView(policy),
      counts: countStatuses(assessments.map((item) => item.status)),
      candidateCount: counts ? assessments.length : 0,
      ...(isManager ? { policy: selectorEligibilityPolicySchema.parse(policy.canonicalPolicy) } : {})
    };
  }

  async evaluate(campaignId: string, actorIdentityId: string) {
    const campaign = await this.campaign(campaignId);
    await assertOrganizationRole(this.db, campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    this.assertCampaignMutable(campaign);
    const policyRecord = await this.currentPolicy(campaignId);
    if (!policyRecord) notFound("Selector eligibility policy not found");
    if (policyRecord.status === "LOCKED") {
      throw new ServiceError("SELECTOR_ELIGIBILITY_LOCKED", "Locked selector eligibility cannot be reevaluated", 409);
    }
    const policy = selectorEligibilityPolicySchema.parse(policyRecord.canonicalPolicy);
    const [allowlist] = await this.db.select().from(schema.identityAllowlists)
      .where(eq(schema.identityAllowlists.id, policy.candidateAllowlistId)).limit(1);
    if (!allowlist) notFound("Selector candidate roster not found");
    if (allowlist.status === "DRAFT") {
      await this.allowlists.lock(allowlist.id, actorIdentityId);
    }

    const evidencePolicy = evidencePolicyFor(policy);
    const subjects = await this.evidence.resolveCandidates(evidencePolicy, campaign.organizationId, new Date(policy.cutoffAt));
    const unsupported = subjects.filter((subject) => !subject.takeIdentityId);
    if (unsupported.length > 0) {
      throw new ServiceError(
        "SELECTOR_TAKE_IDENTITY_REQUIRED",
        "Every selector candidate must have a TAKE identity before evaluation",
        409,
        { count: unsupported.length }
      );
    }

    await this.db.update(schema.campaignEligibilityPolicies)
      .set({ status: "EVALUATING", updatedAt: new Date() })
      .where(eq(schema.campaignEligibilityPolicies.id, policyRecord.id));

    for (const subject of subjects) {
      await this.evaluateSubject(campaign, policyRecord, policy, evidencePolicy, subject);
    }

    await this.db.update(schema.campaignEligibilityPolicies)
      .set({ status: "REVIEW", updatedAt: new Date() })
      .where(eq(schema.campaignEligibilityPolicies.id, policyRecord.id));
    return this.listAssessments(campaignId, actorIdentityId);
  }

  async listAssessments(campaignId: string, actorIdentityId: string) {
    const campaign = await this.campaign(campaignId);
    await assertOrganizationRole(this.db, campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    const policy = await this.currentPolicy(campaignId);
    if (!policy) return [];
    const rows = await this.db.select().from(schema.selectorEligibilityAssessments)
      .where(eq(schema.selectorEligibilityAssessments.policyId, policy.id))
      .orderBy(asc(schema.selectorEligibilityAssessments.finalStatus), desc(schema.selectorEligibilityAssessments.totalPoints));
    return Promise.all(rows.map((row) => this.assessmentView(row, true)));
  }

  async getMyAssessment(campaignId: string, takeIdentityId: string) {
    const policy = await this.currentPolicy(campaignId);
    if (!policy) return null;
    const [assessment] = await this.db.select().from(schema.selectorEligibilityAssessments)
      .where(and(
        eq(schema.selectorEligibilityAssessments.policyId, policy.id),
        eq(schema.selectorEligibilityAssessments.takeIdentityId, takeIdentityId)
      )).limit(1);
    if (!assessment) return {
      campaignId,
      policy: publicPolicy(selectorEligibilityPolicySchema.parse(policy.canonicalPolicy)),
      status: "NOT_ASSESSED"
    };
    const submissions = await this.db.select().from(schema.selectorEvidenceSubmissions)
      .where(eq(schema.selectorEvidenceSubmissions.assessmentId, assessment.id))
      .orderBy(desc(schema.selectorEvidenceSubmissions.createdAt));
    return {
      campaignId,
      policy: publicPolicy(selectorEligibilityPolicySchema.parse(policy.canonicalPolicy)),
      assessment: await this.assessmentView(assessment, false),
      submissions: submissions.map(publicSubmission),
      locked: policy.status === "LOCKED"
    };
  }

  async submit(input: {
    campaignId: string;
    actorIdentityId: string;
    submissionType: SubmissionType;
    targetRuleId?: string;
    explanation: string;
    evidence: SubmissionEvidence[];
  }) {
    const campaign = await this.campaign(input.campaignId);
    this.assertCampaignMutable(campaign);
    const policyRecord = await this.currentPolicy(input.campaignId);
    if (!policyRecord) notFound("Selector eligibility policy not found");
    this.assertPolicyMutable(policyRecord);
    const policy = selectorEligibilityPolicySchema.parse(policyRecord.canonicalPolicy);
    const [assessment] = await this.db.select().from(schema.selectorEligibilityAssessments)
      .where(and(
        eq(schema.selectorEligibilityAssessments.policyId, policyRecord.id),
        eq(schema.selectorEligibilityAssessments.takeIdentityId, input.actorIdentityId)
      )).limit(1);
    if (!assessment) throw new ServiceError("SELECTOR_NOT_ASSESSED", "You are not in this campaign's selector candidate roster", 403);
    const targetRule = input.targetRuleId ? stackRules(policy).find((rule) => rule.id === input.targetRuleId) : undefined;
    if (input.submissionType === "ELIGIBILITY_APPEAL") {
      if (!policy.allowAppeals) throw new ServiceError("APPEALS_DISABLED", "Eligibility appeals are not enabled", 409);
      if (!targetRule || targetRule.source !== "REVIEWED_SUBMISSION") {
        throw new ServiceError("INVALID_REVIEW_RULE", "Appeals must address a declared reviewed-evidence rule", 400);
      }
      if (!input.evidence.some((item) => item.type === targetRule.evidenceType)) {
        throw new ServiceError("REQUIRED_EVIDENCE_MISSING", `Evidence must include ${targetRule.evidenceType}`, 400);
      }
    }
    if (input.submissionType === "NEWCOMER_APPLICATION") {
      if (!policy.newcomerPath.enabled) throw new ServiceError("NEWCOMER_PATH_DISABLED", "This campaign has no newcomer path", 409);
      const supplied = new Set(input.evidence.map((item) => item.type));
      const missing = policy.newcomerPath.requiredEvidence.filter((type) => !supplied.has(type));
      if (missing.length) throw new ServiceError("REQUIRED_EVIDENCE_MISSING", "The newcomer application is incomplete", 400, { missing });
    }
    if (input.submissionType === "INTEGRITY_CLARIFICATION" && !["REVIEW_RECOMMENDED", "HIGH_CONFIDENCE_ISSUE"].includes(assessment.integrityStatus)) {
      throw new ServiceError("INTEGRITY_REVIEW_NOT_REQUIRED", "No integrity clarification is currently required", 409);
    }

    return this.db.transaction(async (tx) => {
      const [reviewCase] = await tx.insert(schema.reviewCases).values({
        campaignId: input.campaignId,
        eligibilityPolicyId: policyRecord.id,
        eligibilityAssessmentId: assessment.id,
        subjectIdentityId: input.actorIdentityId,
        caseType: input.submissionType,
        status: "OPEN",
        publicSummary: submissionSummary(input.submissionType),
        restrictedSummary: input.explanation,
        openedByIdentityId: input.actorIdentityId
      }).returning();
      if (!reviewCase) throw new Error("Failed to create eligibility review");
      const [submission] = await tx.insert(schema.selectorEvidenceSubmissions).values({
        campaignId: input.campaignId,
        policyId: policyRecord.id,
        assessmentId: assessment.id,
        reviewCaseId: reviewCase.id,
        submittedByIdentityId: input.actorIdentityId,
        submissionType: input.submissionType,
        targetRuleId: input.targetRuleId,
        evidenceType: input.evidence[0]?.type,
        explanation: input.explanation,
        links: input.evidence
      }).returning();
      await tx.insert(schema.reviewCaseEvents).values({
        reviewCaseId: reviewCase.id,
        sequence: 1,
        eventType: "EVIDENCE_SUBMITTED",
        actorIdentityId: input.actorIdentityId,
        payload: { submissionId: submission?.id, type: input.submissionType, targetRuleId: input.targetRuleId, evidence: input.evidence }
      });
      return submission ? publicSubmission(submission) : submission;
    });
  }

  async listReviews(campaignId: string, actorIdentityId: string) {
    const campaign = await this.campaign(campaignId);
    await assertOrganizationRole(this.db, campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    const policy = await this.currentPolicy(campaignId);
    if (!policy) return [];
    const cases = await this.db.select().from(schema.reviewCases)
      .where(eq(schema.reviewCases.eligibilityPolicyId, policy.id))
      .orderBy(desc(schema.reviewCases.createdAt));
    return Promise.all(cases.map((reviewCase) => this.reviewView(reviewCase)));
  }

  async decide(input: {
    campaignId: string;
    caseId: string;
    actorIdentityId: string;
    decision: ReviewDecision;
    reason: string;
  }) {
    const campaign = await this.campaign(input.campaignId);
    await assertOrganizationRole(this.db, campaign.organizationId, input.actorIdentityId, ["OWNER", "ADMIN"]);
    this.assertCampaignMutable(campaign);
    const [reviewCase] = await this.db.select().from(schema.reviewCases)
      .where(and(eq(schema.reviewCases.id, input.caseId), eq(schema.reviewCases.campaignId, input.campaignId))).limit(1);
    if (!reviewCase?.eligibilityPolicyId || !reviewCase.eligibilityAssessmentId) notFound("Eligibility review not found");
    const policyRecord = await this.policyById(reviewCase.eligibilityPolicyId);
    this.assertPolicyMutable(policyRecord);
    const [submission] = await this.db.select().from(schema.selectorEvidenceSubmissions)
      .where(eq(schema.selectorEvidenceSubmissions.reviewCaseId, reviewCase.id)).limit(1);
    if (!submission) notFound("Evidence submission not found");
    if (["VERIFIED", "REJECTED"].includes(submission.status)) {
      throw new ServiceError("REVIEW_ALREADY_RESOLVED", "This evidence review is already resolved", 409);
    }

    const status = input.decision === "VERIFY_EVIDENCE"
      ? "VERIFIED"
      : input.decision === "REJECT_EVIDENCE"
        ? "REJECTED"
        : "MORE_INFO_REQUESTED";
    const [decisionAggregate] = await this.db.select({ value: max(schema.reviewDecisions.revision) })
      .from(schema.reviewDecisions).where(eq(schema.reviewDecisions.reviewCaseId, reviewCase.id));
    const [eventAggregate] = await this.db.select({ value: max(schema.reviewCaseEvents.sequence) })
      .from(schema.reviewCaseEvents).where(eq(schema.reviewCaseEvents.reviewCaseId, reviewCase.id));
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.reviewDecisions).values({
        reviewCaseId: reviewCase.id,
        revision: Number(decisionAggregate?.value ?? 0) + 1,
        decision: input.decision,
        reasonCode: input.decision,
        publicExplanation: input.reason,
        restrictedEvidence: {},
        decidedByIdentityId: input.actorIdentityId
      });
      await tx.insert(schema.reviewCaseEvents).values({
        reviewCaseId: reviewCase.id,
        sequence: Number(eventAggregate?.value ?? 0) + 1,
        eventType: input.decision,
        actorIdentityId: input.actorIdentityId,
        payload: { submissionId: submission.id, reason: input.reason }
      });
      await tx.update(schema.selectorEvidenceSubmissions)
        .set({ status, updatedAt: new Date() })
        .where(eq(schema.selectorEvidenceSubmissions.id, submission.id));
      await tx.update(schema.reviewCases)
        .set({ status: "RESOLVED", updatedAt: new Date() })
        .where(eq(schema.reviewCases.id, reviewCase.id));
    });
    await this.recalculateStored(reviewCase.eligibilityAssessmentId, policyRecord);
    const [updatedCase] = await this.db.select().from(schema.reviewCases)
      .where(eq(schema.reviewCases.id, reviewCase.id)).limit(1);
    return this.reviewView(updatedCase ?? reviewCase);
  }

  async importIntegrityObservation(input: {
    campaignId: string;
    actorIdentityId: string;
    takeIdentityId: string;
    signalType: string;
    evidenceFamily: string;
    strength: "WEAK" | "MODERATE" | "STRONG";
    publicExplanation: string;
    restrictedEvidence?: Record<string, unknown>;
  }) {
    const campaign = await this.campaign(input.campaignId);
    await assertOrganizationRole(this.db, campaign.organizationId, input.actorIdentityId, ["OWNER", "ADMIN"]);
    this.assertCampaignMutable(campaign);
    const policy = await this.currentPolicy(input.campaignId);
    if (!policy) notFound("Selector eligibility policy not found");
    this.assertPolicyMutable(policy);
    const observedAt = new Date();
    const observationHash = domainHash("TAKE_SELECTOR_INTEGRITY_OBSERVATION_V1", {
      policyId: policy.id,
      takeIdentityId: input.takeIdentityId,
      signalType: input.signalType,
      evidenceFamily: input.evidenceFamily,
      strength: input.strength,
      observedAt: observedAt.toISOString(),
      provenance: "ORGANIZER_PILOT_IMPORT"
    });
    const [created] = await this.db.insert(schema.selectorIntegrityObservations).values({
      campaignId: input.campaignId,
      policyId: policy.id,
      takeIdentityId: input.takeIdentityId,
      signalType: input.signalType,
      evidenceFamily: input.evidenceFamily,
      strength: input.strength,
      publicExplanation: input.publicExplanation,
      restrictedEvidence: input.restrictedEvidence ?? {},
      provenance: { source: "ORGANIZER_PILOT_IMPORT", importedByIdentityId: input.actorIdentityId },
      observedAt,
      observationHash
    }).returning();
    const [assessment] = await this.db.select({ id: schema.selectorEligibilityAssessments.id })
      .from(schema.selectorEligibilityAssessments)
      .where(and(
        eq(schema.selectorEligibilityAssessments.policyId, policy.id),
        eq(schema.selectorEligibilityAssessments.takeIdentityId, input.takeIdentityId)
      )).limit(1);
    if (assessment) await this.recalculateStored(assessment.id, policy);
    return created;
  }

  async lock(campaignId: string, actorIdentityId: string, operatorManaged = false) {
    const campaign = await this.campaign(campaignId);
    if (!operatorManaged) await assertOrganizationRole(this.db, campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    this.assertCampaignMutable(campaign);
    const policy = await this.currentPolicy(campaignId);
    if (!policy) notFound("Selector eligibility policy not found");
    this.assertPolicyMutable(policy);
    if (policy.status !== "REVIEW") throw new ServiceError("ELIGIBILITY_NOT_EVALUATED", "Run selector evaluation before locking", 409);
    const unresolved = await this.db.select({ id: schema.reviewCases.id }).from(schema.reviewCases)
      .where(and(
        eq(schema.reviewCases.eligibilityPolicyId, policy.id),
        inArray(schema.reviewCases.status, ["OPEN", "UNDER_REVIEW", "APPEALED"])
      ));
    if (unresolved.length) throw new ServiceError("ELIGIBILITY_REVIEWS_UNRESOLVED", "Resolve every selector review before locking", 409, { count: unresolved.length });
    const assessments = await this.db.select().from(schema.selectorEligibilityAssessments)
      .where(eq(schema.selectorEligibilityAssessments.policyId, policy.id));
    if (!assessments.length) throw new ServiceError("ELIGIBILITY_NOT_EVALUATED", "No selector assessments exist", 409);
    if (assessments.some((item) => item.finalStatus === "NEEDS_REVIEW")) {
      throw new ServiceError("ELIGIBILITY_REVIEWS_UNRESOLVED", "Every needs-review assessment must be resolved", 409);
    }
    const eligible = assessments.filter((item) => item.finalStatus === "ELIGIBLE");
    if (!eligible.length) throw new ServiceError("FINAL_SELECTOR_ROSTER_EMPTY", "At least one selector must be eligible", 409);
    const identities = await this.db.select({ id: schema.takeIdentities.id, key: schema.takeIdentities.protocolIdentityKey })
      .from(schema.takeIdentities)
      .where(inArray(schema.takeIdentities.id, eligible.map((item) => item.takeIdentityId)));
    const now = new Date();
    const finalAllowlistId = randomUUID();
    const members = identities.map((identity) => ({
      subjectKey: identity.key.toLowerCase(),
      canonicalSubjectKey: identity.key.toLowerCase(),
      takeIdentityId: identity.id,
      externalIdentityId: null
    })).sort((left, right) => left.subjectKey.localeCompare(right.subjectKey));
    const artifact = { artifactVersion: "1", allowlistId: finalAllowlistId, organizationId: campaign.organizationId, members };
    const artifactHash = domainHash("TAKE_IDENTITY_ALLOWLIST_V1", artifact);

    await this.db.transaction(async (tx) => {
      await tx.insert(schema.identityAllowlists).values({
        id: finalAllowlistId,
        organizationId: campaign.organizationId,
        name: `${campaign.title} / final eligible selectors`,
        status: "LOCKED",
        artifactHash,
        createdByIdentityId: actorIdentityId,
        lockedByIdentityId: actorIdentityId,
        lockedAt: now
      });
      await tx.insert(schema.identityAllowlistMembers).values(members.map((member) => ({
        allowlistId: finalAllowlistId,
        subjectKey: member.subjectKey,
        takeIdentityId: member.takeIdentityId,
        source: "SELECTOR_ELIGIBILITY_V1",
        metadata: { policyId: policy.id, policyHash: policy.policyHash }
      })));
      await tx.update(schema.selectorEligibilityAssessments)
        .set({ lockedAt: now })
        .where(eq(schema.selectorEligibilityAssessments.policyId, policy.id));
      await tx.update(schema.campaignEligibilityPolicies).set({
        status: "LOCKED",
        finalAllowlistId,
        lockedByIdentityId: actorIdentityId,
        lockedAt: now,
        updatedAt: now
      }).where(eq(schema.campaignEligibilityPolicies.id, policy.id));
      await tx.insert(schema.auditLogs).values({
        actorIdentityId,
        organizationId: campaign.organizationId,
        campaignId,
        action: "SELECTOR_ELIGIBILITY_LOCKED",
        metadata: { policyId: policy.id, policyHash: policy.policyHash, finalAllowlistId, artifactHash, eligibleCount: eligible.length }
      });
    });
    return { policyId: policy.id, policyHash: policy.policyHash, finalAllowlistId, eligibleCount: eligible.length, artifactHash };
  }

  private async evaluateSubject(
    campaign: typeof schema.campaigns.$inferSelect,
    policyRecord: PolicyRecord,
    policy: SelectorEligibilityPolicyV1,
    evidencePolicy: EligibilityPolicyV1,
    subject: EvidenceSubject
  ) {
    if (!subject.takeIdentityId) return;
    const observations = await this.evidence.collectForSubject({
      campaignId: campaign.id,
      organizationId: campaign.organizationId,
      cutoffAt: new Date(policy.cutoffAt),
      policy: evidencePolicy,
      subject
    });
    const automatedEvaluations = evaluateEligibility({
      policy: evidencePolicy,
      subjectKey: subject.subjectKey,
      cutoffAt: policy.cutoffAt,
      observations
    }).evaluations;
    const assessment = await this.buildAssessment(policyRecord, policy, subject.takeIdentityId, automatedEvaluations);
    const assessmentHash = domainHash("TAKE_SELECTOR_ELIGIBILITY_ASSESSMENT_V1", assessment.artifact);
    await this.db.insert(schema.selectorEligibilityAssessments).values({
      campaignId: campaign.id,
      policyId: policyRecord.id,
      takeIdentityId: subject.takeIdentityId,
      automaticStatus: assessment.score.status,
      finalStatus: assessment.finalStatus,
      qualificationPath: assessment.score.qualificationPath,
      totalPoints: assessment.score.totalPoints,
      categoryScores: assessment.score.categories,
      missingRuleIds: assessment.score.missingRuleIds,
      integrityStatus: assessment.integrity.status,
      integrityReasons: assessment.integrity.reasons,
      assessmentArtifact: assessment.artifact,
      assessmentHash,
      evaluatedAt: new Date()
    }).onConflictDoUpdate({
      target: [schema.selectorEligibilityAssessments.policyId, schema.selectorEligibilityAssessments.takeIdentityId],
      set: {
        automaticStatus: assessment.score.status,
        finalStatus: assessment.finalStatus,
        qualificationPath: assessment.score.qualificationPath,
        totalPoints: assessment.score.totalPoints,
        categoryScores: assessment.score.categories,
        missingRuleIds: assessment.score.missingRuleIds,
        integrityStatus: assessment.integrity.status,
        integrityReasons: assessment.integrity.reasons,
        assessmentArtifact: assessment.artifact,
        assessmentHash,
        evaluatedAt: new Date()
      }
    });
  }

  private async buildAssessment(
    policyRecord: PolicyRecord,
    policy: SelectorEligibilityPolicyV1,
    takeIdentityId: string,
    automatedEvaluations: Parameters<typeof evaluateSelectorEligibility>[0]["automatedEvaluations"]
  ) {
    const reviewedEvidence = await this.reviewedEvidence(policyRecord.id, takeIdentityId);
    const alternativePathVerified = await this.alternativePathVerified(policyRecord.id, takeIdentityId);
    const score = evaluateSelectorEligibility({ policy, automatedEvaluations, reviewedEvidence, alternativePathVerified });
    const integrity = await this.integrity(policyRecord.id, takeIdentityId, policy.integrityScreeningEnabled);
    const finalStatus = combineStatus(score, integrity.status);
    const artifact = { version: "TAKE_SELECTOR_ASSESSMENT_ARTIFACT_V1", policyHash: policyRecord.policyHash, takeIdentityId, score, automatedEvaluations, integrity, finalStatus };
    return { score, integrity, finalStatus, artifact };
  }

  private async recalculateStored(assessmentId: string, policyRecord: PolicyRecord) {
    const [record] = await this.db.select().from(schema.selectorEligibilityAssessments)
      .where(eq(schema.selectorEligibilityAssessments.id, assessmentId)).limit(1);
    if (!record) notFound("Selector assessment not found");
    const stored = record.assessmentArtifact as { automatedEvaluations?: Parameters<typeof evaluateSelectorEligibility>[0]["automatedEvaluations"] };
    const policy = selectorEligibilityPolicySchema.parse(policyRecord.canonicalPolicy);
    const assessment = await this.buildAssessment(policyRecord, policy, record.takeIdentityId, stored.automatedEvaluations ?? []);
    await this.db.update(schema.selectorEligibilityAssessments).set({
      automaticStatus: assessment.score.status,
      finalStatus: assessment.finalStatus,
      qualificationPath: assessment.score.qualificationPath,
      totalPoints: assessment.score.totalPoints,
      categoryScores: assessment.score.categories,
      missingRuleIds: assessment.score.missingRuleIds,
      integrityStatus: assessment.integrity.status,
      integrityReasons: assessment.integrity.reasons,
      assessmentArtifact: assessment.artifact,
      assessmentHash: domainHash("TAKE_SELECTOR_ELIGIBILITY_ASSESSMENT_V1", assessment.artifact),
      evaluatedAt: new Date()
    }).where(eq(schema.selectorEligibilityAssessments.id, record.id));
  }

  private async reviewedEvidence(policyId: string, takeIdentityId: string): Promise<ReviewedRuleEvidence[]> {
    const rows = await this.db.select().from(schema.selectorEvidenceSubmissions)
      .where(and(
        eq(schema.selectorEvidenceSubmissions.policyId, policyId),
        eq(schema.selectorEvidenceSubmissions.submittedByIdentityId, takeIdentityId),
        eq(schema.selectorEvidenceSubmissions.submissionType, "ELIGIBILITY_APPEAL")
      )).orderBy(desc(schema.selectorEvidenceSubmissions.createdAt));
    const newestByRule = new Map<string, typeof rows[number]>();
    for (const row of rows) {
      if (row.targetRuleId && !newestByRule.has(row.targetRuleId)) newestByRule.set(row.targetRuleId, row);
    }
    return [...newestByRule.values()].map((row) => ({
      ruleId: row.targetRuleId!,
      status: row.status === "VERIFIED" ? "VERIFIED" : row.status === "REJECTED" ? "REJECTED" : "PENDING",
      evidenceIds: [row.id]
    }));
  }

  private async alternativePathVerified(policyId: string, takeIdentityId: string) {
    const [row] = await this.db.select({ id: schema.selectorEvidenceSubmissions.id })
      .from(schema.selectorEvidenceSubmissions)
      .where(and(
        eq(schema.selectorEvidenceSubmissions.policyId, policyId),
        eq(schema.selectorEvidenceSubmissions.submittedByIdentityId, takeIdentityId),
        eq(schema.selectorEvidenceSubmissions.submissionType, "NEWCOMER_APPLICATION"),
        eq(schema.selectorEvidenceSubmissions.status, "VERIFIED")
      )).limit(1);
    return Boolean(row);
  }

  private async integrity(policyId: string, takeIdentityId: string, enabled: boolean) {
    if (!enabled) return { status: "NO_DATA" as const, reasons: ["Integrity screening is not enabled for this campaign."] };
    const [observations, clarifications] = await Promise.all([
      this.db.select().from(schema.selectorIntegrityObservations)
        .where(and(eq(schema.selectorIntegrityObservations.policyId, policyId), eq(schema.selectorIntegrityObservations.takeIdentityId, takeIdentityId))),
      this.db.select().from(schema.selectorEvidenceSubmissions)
        .where(and(
          eq(schema.selectorEvidenceSubmissions.policyId, policyId),
          eq(schema.selectorEvidenceSubmissions.submittedByIdentityId, takeIdentityId),
          eq(schema.selectorEvidenceSubmissions.submissionType, "INTEGRITY_CLARIFICATION")
        )).orderBy(desc(schema.selectorEvidenceSubmissions.createdAt))
    ]);
    const latest = clarifications[0];
    if (latest?.status === "VERIFIED") return { status: "NO_MATERIAL_CONCERN" as const, reasons: ["The submitted context was verified by the campaign reviewer."] };
    if (latest?.status === "REJECTED") return { status: "HIGH_CONFIDENCE_ISSUE" as const, reasons: observations.map((item) => item.publicExplanation) };
    if (!observations.length) return { status: "NO_DATA" as const, reasons: ["No material integrity data is available."] };
    const families = new Set(observations.map((item) => item.evidenceFamily));
    const strength = observations.reduce((sum, item) => sum + (item.strength === "STRONG" ? 2 : item.strength === "MODERATE" ? 1 : 0), 0);
    if (families.size >= 3 && observations.filter((item) => item.strength === "STRONG").length >= 2) {
      return { status: "HIGH_CONFIDENCE_ISSUE" as const, reasons: observations.map((item) => item.publicExplanation) };
    }
    if (families.size >= 2 && strength >= 2) {
      return { status: "REVIEW_RECOMMENDED" as const, reasons: observations.map((item) => item.publicExplanation) };
    }
    return { status: "NO_MATERIAL_CONCERN" as const, reasons: ["No corroborated farming pattern was detected."] };
  }

  private async assessmentView(record: AssessmentRecord, restricted: boolean) {
    const [identity] = await this.db.select({
      id: schema.takeIdentities.id,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl
    }).from(schema.takeIdentities)
      .innerJoin(schema.users, eq(schema.users.id, schema.takeIdentities.userId))
      .where(eq(schema.takeIdentities.id, record.takeIdentityId)).limit(1);
    const [x] = await this.db.select({ username: schema.socialAccounts.username })
      .from(schema.socialAccounts)
      .where(and(eq(schema.socialAccounts.takeIdentityId, record.takeIdentityId), eq(schema.socialAccounts.provider, "twitter"), eq(schema.socialAccounts.isActive, true))).limit(1);
    return {
      id: record.id,
      person: { id: record.takeIdentityId, name: identity?.displayName ?? "TAKE member", handle: x?.username ? `@${x.username}` : null, avatarUrl: identity?.avatarUrl ?? null },
      status: record.finalStatus,
      automaticStatus: record.automaticStatus,
      qualificationPath: record.qualificationPath,
      totalPoints: record.totalPoints,
      categories: record.categoryScores,
      missingRuleIds: record.missingRuleIds,
      integrity: { status: record.integrityStatus, reasons: record.integrityReasons },
      evaluatedAt: record.evaluatedAt.toISOString(),
      locked: Boolean(record.lockedAt),
      ...(restricted ? { assessmentHash: record.assessmentHash } : {})
    };
  }

  private async reviewView(reviewCase: typeof schema.reviewCases.$inferSelect) {
    const [submission] = await this.db.select().from(schema.selectorEvidenceSubmissions)
      .where(eq(schema.selectorEvidenceSubmissions.reviewCaseId, reviewCase.id)).limit(1);
    const [assessment, events, decisions] = await Promise.all([
      reviewCase.eligibilityAssessmentId
        ? this.db.select().from(schema.selectorEligibilityAssessments).where(eq(schema.selectorEligibilityAssessments.id, reviewCase.eligibilityAssessmentId)).limit(1)
        : Promise.resolve([]),
      this.db.select().from(schema.reviewCaseEvents).where(eq(schema.reviewCaseEvents.reviewCaseId, reviewCase.id)).orderBy(asc(schema.reviewCaseEvents.sequence)),
      this.db.select().from(schema.reviewDecisions).where(eq(schema.reviewDecisions.reviewCaseId, reviewCase.id)).orderBy(asc(schema.reviewDecisions.revision))
    ]);
    return {
      id: reviewCase.id,
      type: reviewCase.caseType,
      status: reviewCase.status,
      summary: reviewCase.publicSummary,
      person: assessment[0] ? (await this.assessmentView(assessment[0], true)).person : null,
      assessment: assessment[0] ? await this.assessmentView(assessment[0], true) : null,
      submission: submission ? { ...publicSubmission(submission), explanation: submission.explanation, evidence: submission.links } : null,
      events,
      decisions
    };
  }

  private policyView(record: PolicyRecord) {
    return {
      id: record.id,
      campaignId: record.campaignId,
      revision: record.revision,
      status: record.status,
      preset: record.preset,
      policyHash: record.policyHash,
      candidateAllowlistId: record.candidateAllowlistId,
      finalAllowlistId: record.finalAllowlistId,
      createdAt: record.createdAt.toISOString(),
      lockedAt: record.lockedAt?.toISOString() ?? null
    };
  }

  private async currentPolicy(campaignId: string) {
    const [record] = await this.db.select().from(schema.campaignEligibilityPolicies)
      .where(eq(schema.campaignEligibilityPolicies.campaignId, campaignId))
      .orderBy(desc(schema.campaignEligibilityPolicies.revision)).limit(1);
    return record;
  }

  private async policyById(id: string) {
    const [record] = await this.db.select().from(schema.campaignEligibilityPolicies)
      .where(eq(schema.campaignEligibilityPolicies.id, id)).limit(1);
    if (!record) notFound("Selector eligibility policy not found");
    return record;
  }

  private async campaign(id: string) {
    const [campaign] = await this.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1);
    if (!campaign) notFound("Campaign not found");
    return campaign;
  }

  private assertCampaignMutable(campaign: typeof schema.campaigns.$inferSelect) {
    if (campaign.status !== "DRAFT" || campaign.mechanismConfigId) {
      throw new ServiceError("SELECTOR_ELIGIBILITY_LOCKED", "Selector eligibility cannot change after campaign lock", 409);
    }
  }

  private assertPolicyMutable(policy: PolicyRecord) {
    if (policy.status === "LOCKED") throw new ServiceError("SELECTOR_ELIGIBILITY_LOCKED", "Selector eligibility is locked", 409);
  }

  private async canManage(organizationId: string, takeIdentityId: string) {
    try {
      await assertOrganizationRole(this.db, organizationId, takeIdentityId, ["OWNER", "ADMIN"]);
      return true;
    } catch {
      return false;
    }
  }
}

function evidencePolicyFor(policy: SelectorEligibilityPolicyV1): EligibilityPolicyV1 {
  return {
    audience: "NOMINATOR",
    population: { type: "ORGANIZER_ALLOWLIST", allowlistId: policy.candidateAllowlistId },
    allOf: stackRules(policy).filter((rule) => rule.source === "AUTOMATED").map((rule) => rule.evidenceRule)
  };
}

function stackRules(policy: SelectorEligibilityPolicyV1) {
  return policy.categories.filter((category) => category.enabled).flatMap((category) => category.rules);
}

function combineStatus(score: SelectorEligibilityAssessmentV1, integrity: string) {
  if (integrity === "HIGH_CONFIDENCE_ISSUE") return "NOT_ELIGIBLE" as const;
  if (integrity === "REVIEW_RECOMMENDED") return "NEEDS_REVIEW" as const;
  return score.status;
}

function publicPolicy(policy: SelectorEligibilityPolicyV1) {
  return {
    version: policy.version,
    preset: policy.preset,
    cutoffAt: policy.cutoffAt,
    categories: policy.categories.filter((category) => category.enabled).map((category) => ({
      id: category.id,
      label: category.label,
      maximumPoints: category.maximumPoints,
      minimumPoints: category.minimumPoints ?? null,
      rules: category.rules.map((rule) => ({
        id: rule.id,
        label: rule.label,
        points: rule.points,
        source: rule.source,
        ...(rule.source === "REVIEWED_SUBMISSION" ? { evidenceType: rule.evidenceType, instructions: rule.instructions } : {})
      }))
    })),
    requiredTotalPoints: policy.requiredTotalPoints,
    minimumDistinctCategories: policy.minimumDistinctCategories,
    allowAppeals: policy.allowAppeals,
    integrityScreeningEnabled: policy.integrityScreeningEnabled,
    newcomerPath: policy.newcomerPath
  };
}

function countStatuses(statuses: string[]) {
  return {
    eligible: statuses.filter((status) => status === "ELIGIBLE").length,
    needsReview: statuses.filter((status) => status === "NEEDS_REVIEW").length,
    notEligible: statuses.filter((status) => status === "NOT_ELIGIBLE").length
  };
}

function publicSubmission(row: typeof schema.selectorEvidenceSubmissions.$inferSelect) {
  return { id: row.id, type: row.submissionType, targetRuleId: row.targetRuleId, status: row.status, createdAt: row.createdAt.toISOString() };
}

function submissionSummary(type: SubmissionType) {
  if (type === "NEWCOMER_APPLICATION") return "A selector submitted the campaign's declared alternative qualification path.";
  if (type === "INTEGRITY_CLARIFICATION") return "A selector supplied context for an integrity review.";
  return "A selector supplied evidence for a declared eligibility rule.";
}
