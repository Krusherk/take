import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import {
  buildMerkleSet,
  campaignMechanismConfigV1Schema,
  domainHash,
  eligibilitySnapshotHash,
  evaluateEligibility,
  type EligibilityAudience,
  type EligibilityPolicyV1,
  type EvidenceObservationV1,
  type SubjectEligibilityEvaluationV1
} from "@take/mechanism";
import type { ApiEnv } from "../config/env.js";
import { assertOrganizationRole } from "./authorization.js";
import { EvidenceService, type EvidenceSubject } from "./evidence.js";
import { notFound, ServiceError } from "./errors.js";

interface EvaluatedSubject {
  subject: EvidenceSubject;
  evaluation: SubjectEligibilityEvaluationV1;
  observations: EvidenceObservationV1[];
}

export class EligibilitySnapshotService {
  private readonly evidence: EvidenceService;

  constructor(
    private readonly db: Database,
    env: ApiEnv
  ) {
    this.evidence = new EvidenceService(db, env);
    this.concurrency = env.EVIDENCE_COLLECTION_CONCURRENCY;
  }

  private readonly concurrency: number;

  async createForCurrentDraft(campaignId: string, actorIdentityId: string) {
    const [campaign] = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) notFound("Campaign not found");
    await assertOrganizationRole(this.db, campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    if (campaign.status !== "DRAFT") {
      throw new ServiceError("CAMPAIGN_NOT_DRAFT", "Eligibility snapshots can only be built for draft campaigns", 409);
    }
    const [configRecord] = await this.db
      .select()
      .from(schema.campaignMechanismConfigs)
      .where(
        and(
          eq(schema.campaignMechanismConfigs.campaignId, campaignId),
          eq(schema.campaignMechanismConfigs.status, "DRAFT")
        )
      )
      .orderBy(desc(schema.campaignMechanismConfigs.revision))
      .limit(1);
    if (!configRecord) notFound("No draft mechanism revision exists");
    const config = campaignMechanismConfigV1Schema.parse(configRecord.canonicalConfig);

    const nominator = await this.buildSnapshot({
      campaignId,
      organizationId: campaign.organizationId,
      mechanismConfigId: configRecord.id,
      mode: contractMode(config.nominatorPolicy),
      policy: config.nominatorPolicy,
      cutoffAt: new Date(config.cutoffAt)
    });
    const recipient = await this.buildSnapshot({
      campaignId,
      organizationId: campaign.organizationId,
      mechanismConfigId: configRecord.id,
      mode: contractMode(config.recipientPolicy),
      policy: config.recipientPolicy,
      cutoffAt: new Date(config.cutoffAt)
    });

    await this.db.insert(schema.auditLogs).values({
      actorIdentityId,
      organizationId: campaign.organizationId,
      campaignId,
      action: "ELIGIBILITY_SNAPSHOTS_BUILT",
      metadata: {
        mechanismConfigId: configRecord.id,
        nominatorSnapshotId: nominator.id,
        recipientSnapshotId: recipient.id
      }
    });
    return { nominator, recipient };
  }

  async getSnapshot(campaignId: string, snapshotId: string, actorIdentityId: string) {
    const [snapshot] = await this.db
      .select({
        snapshot: schema.eligibilitySnapshots,
        organizationId: schema.campaigns.organizationId
      })
      .from(schema.eligibilitySnapshots)
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.eligibilitySnapshots.campaignId))
      .where(
        and(
          eq(schema.eligibilitySnapshots.id, snapshotId),
          eq(schema.eligibilitySnapshots.campaignId, campaignId)
        )
      )
      .limit(1);
    if (!snapshot) notFound("Eligibility snapshot not found");
    await assertOrganizationRole(this.db, snapshot.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);

    const evaluations = await this.db
      .select({
        subjectKey: schema.eligibilitySnapshotMembers.subjectKey,
        canonicalSubjectKey: schema.eligibilitySnapshotMembers.canonicalSubjectKey,
        decision: schema.eligibilityEvaluations.decision,
        ruleId: schema.eligibilityEvaluations.ruleId,
        ruleType: schema.eligibilityEvaluations.ruleType,
        reasonCode: schema.eligibilityEvaluations.reasonCode,
        publicExplanation: schema.eligibilityEvaluations.publicExplanation,
        evidenceObservationIds: schema.eligibilityEvaluations.evidenceObservationIds
      })
      .from(schema.eligibilityEvaluations)
      .innerJoin(
        schema.eligibilitySnapshotMembers,
        eq(schema.eligibilitySnapshotMembers.id, schema.eligibilityEvaluations.memberId)
      )
      .where(eq(schema.eligibilityEvaluations.snapshotId, snapshotId));

    return {
      ...snapshotSummary(snapshot.snapshot),
      providerErrors: snapshot.snapshot.data,
      artifact: snapshot.snapshot.canonicalArtifact,
      evaluations
    };
  }

  async getMyEligibility(campaignId: string, takeIdentityId: string) {
    const [campaign] = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) notFound("Campaign not found");
    if (!campaign.mechanismConfigId) {
      return {
        campaignId,
        mechanismVersion: "LEGACY_V1",
        status: "LEGACY_UNCHECKED",
        warning: "This legacy campaign has no locked evidence snapshot.",
        nominator: null,
        recipient: null
      };
    }
    const [identity] = await this.db
      .select({ key: schema.takeIdentities.protocolIdentityKey })
      .from(schema.takeIdentities)
      .where(eq(schema.takeIdentities.id, takeIdentityId))
      .limit(1);
    if (!identity) notFound("TAKE identity not found");
    const snapshots = await this.latestSnapshots(campaign.mechanismConfigId);

    return {
      campaignId,
      mechanismVersion: "TAKE_MECHANISM_V1",
      status: snapshots.every((snapshot) => snapshot.status === "LOCKED") ? "ELIGIBILITY_LOCKED" : "CHECKING_ELIGIBILITY",
      nominator: await this.subjectOutcome(snapshots.find((item) => item.subject === "NOMINATOR"), takeIdentityId, identity.key),
      recipient: await this.subjectOutcome(snapshots.find((item) => item.subject === "RECIPIENT"), takeIdentityId, identity.key)
    };
  }

  async getProof(input: {
    campaignId: string;
    audience: EligibilityAudience;
    takeIdentityId: string;
    externalIdentityId?: string;
  }) {
    const [campaign] = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, input.campaignId))
      .limit(1);
    if (!campaign) notFound("Campaign not found");
    if (!campaign.mechanismConfigId) {
      throw new ServiceError("LEGACY_CAMPAIGN", "Legacy campaigns do not have mechanism proofs", 409);
    }
    const snapshots = await this.latestSnapshots(campaign.mechanismConfigId);
    const snapshot = snapshots.find((item) => item.subject === input.audience);
    if (!snapshot || snapshot.status !== "LOCKED") {
      throw new ServiceError("ELIGIBILITY_NOT_LOCKED", "Eligibility is not locked for this audience", 409);
    }
    if (snapshot.mode === "EXTERNAL_ALLOWED") {
      return { audience: input.audience, status: "OPEN_EXTERNAL", root: null, leaf: null, proof: [] };
    }

    const [identity] = await this.db
      .select({ key: schema.takeIdentities.protocolIdentityKey })
      .from(schema.takeIdentities)
      .where(eq(schema.takeIdentities.id, input.takeIdentityId))
      .limit(1);
    if (!identity) notFound("TAKE identity not found");
    const identityCondition = input.externalIdentityId && input.audience === "RECIPIENT"
      ? eq(schema.eligibilitySnapshotMembers.externalIdentityId, input.externalIdentityId)
      : or(
          eq(schema.eligibilitySnapshotMembers.takeIdentityId, input.takeIdentityId),
          eq(schema.eligibilitySnapshotMembers.canonicalSubjectKey, identity.key)
        );
    const [member] = await this.db
      .select()
      .from(schema.eligibilitySnapshotMembers)
      .where(
        and(
          eq(schema.eligibilitySnapshotMembers.snapshotId, snapshot.id),
          identityCondition
        )
      )
      .limit(1);
    if (!member || !member.eligible) {
      throw new ServiceError("NOT_ELIGIBLE", "This identity is not eligible for the requested proof", 403);
    }
    return {
      audience: input.audience,
      status: "ELIGIBLE",
      root: snapshot.root,
      leaf: member.merkleLeaf,
      proof: member.merkleProof
    };
  }

  private async buildSnapshot(input: {
    campaignId: string;
    organizationId: string;
    mechanismConfigId: string;
    mode: "OPEN_REGISTERED" | "MERKLE_ALLOWLIST" | "ORGANIZER_APPROVED" | "EXTERNAL_ALLOWED";
    policy: EligibilityPolicyV1;
    cutoffAt: Date;
  }) {
    const id = randomUUID();
    const pendingHash = domainHash("TAKE_ELIGIBILITY_SNAPSHOT_PENDING_V1", { id });
    await this.db.insert(schema.eligibilitySnapshots).values({
      id,
      campaignId: input.campaignId,
      mechanismConfigId: input.mechanismConfigId,
      subject: input.policy.audience,
      mode: input.mode,
      status: "EVALUATING",
      snapshotHash: pendingHash,
      policyHash: domainHash("TAKE_ELIGIBILITY_POLICY_V1", input.policy),
      cutoffAt: input.cutoffAt,
      data: {}
    });

    try {
      const candidates = await this.evidence.resolveCandidates(input.policy, input.organizationId, input.cutoffAt);
      const evaluated = input.policy.population.type === "OPEN_EXTERNAL"
        ? []
        : await mapLimit(candidates, this.concurrency, async (subject): Promise<EvaluatedSubject> => {
            const observations = await this.evidence.collectForSubject({ ...input, subject });
            return {
              subject,
              observations,
              evaluation: evaluateEligibility({
                policy: input.policy,
                subjectKey: subject.subjectKey,
                cutoffAt: input.cutoffAt.toISOString(),
                observations
              })
            };
          });
      const eligibleKeys = evaluated
        .filter((item) => item.evaluation.eligible)
        .map((item) => item.subject.subjectKey);
      const merkle = input.policy.population.type === "OPEN_EXTERNAL" ? null : buildMerkleSet(eligibleKeys);
      const unknownCount = evaluated.filter((item) => item.evaluation.decision === "UNKNOWN").length;
      const policyHash = domainHash("TAKE_ELIGIBILITY_POLICY_V1", input.policy);
      const artifact = {
        artifactVersion: "1",
        campaignId: input.campaignId,
        mechanismConfigId: input.mechanismConfigId,
        audience: input.policy.audience,
        policy: input.policy,
        policyHash,
        cutoffAt: input.cutoffAt.toISOString(),
        openPopulation: input.policy.population.type === "OPEN_EXTERNAL",
        candidates: evaluated.map((item) => ({
          subjectKey: item.subject.subjectKey,
          canonicalSubjectKey: item.subject.canonicalSubjectKey,
          decision: item.evaluation.decision,
          evaluations: item.evaluation.evaluations.map((evaluation) => ({
            ruleId: evaluation.ruleId,
            ruleType: evaluation.ruleType,
            decision: evaluation.decision,
            reasonCode: evaluation.reasonCode,
            evidenceHashes: evaluation.evidenceObservationIds.map((observationId) =>
              item.observations.find((observation) => observation.id === observationId)?.evidenceHash
            ).filter(Boolean)
          }))
        })),
        eligibleKeys: [...eligibleKeys].sort(),
        root: merkle?.root ?? null,
        evaluatorVersion: "1"
      };
      const snapshotHash = eligibilitySnapshotHash(artifact);
      const providerErrors = errorSummary(evaluated);
      const status = unknownCount > 0 ? "FAILED" as const : "READY" as const;

      const snapshot = await this.db.transaction(async (tx) => {
        for (const [ordinal, item] of evaluated
          .slice()
          .sort((left, right) => left.subject.subjectKey.localeCompare(right.subject.subjectKey))
          .entries()) {
          const [member] = await tx
            .insert(schema.eligibilitySnapshotMembers)
            .values({
              snapshotId: id,
              subjectKey: item.subject.subjectKey,
              canonicalSubjectKey: item.subject.canonicalSubjectKey,
              takeIdentityId: item.subject.takeIdentityId,
              externalIdentityId: item.subject.externalIdentityId,
              decision: item.evaluation.decision,
              eligible: item.evaluation.eligible,
              ordinal,
              merkleLeaf: item.evaluation.eligible ? item.subject.subjectKey : null,
              merkleProof: item.evaluation.eligible ? (merkle?.proofs.get(item.subject.subjectKey) ?? []) : []
            })
            .returning();
          if (!member) throw new Error("Failed to store eligibility member");
          if (item.evaluation.evaluations.length > 0) {
            await tx.insert(schema.eligibilityEvaluations).values(
              item.evaluation.evaluations.map((evaluation) => ({
                snapshotId: id,
                memberId: member.id,
                ruleId: evaluation.ruleId,
                ruleType: evaluation.ruleType,
                ruleVersion: evaluation.ruleVersion,
                decision: evaluation.decision,
                reasonCode: evaluation.reasonCode,
                evidenceObservationIds: evaluation.evidenceObservationIds,
                publicExplanation: evaluation.publicExplanation,
                internalDetails: evaluation.internalDetails,
                evaluatorVersion: item.evaluation.evaluatorVersion
              }))
            );
          }
        }

        const [updated] = await tx
          .update(schema.eligibilitySnapshots)
          .set({
            status,
            root: merkle?.root ?? null,
            snapshotHash,
            policyHash,
            canonicalArtifact: artifact,
            candidateCount: candidates.length,
            eligibleCount: eligibleKeys.length,
            data: { unknownCount, providerErrors }
          })
          .where(eq(schema.eligibilitySnapshots.id, id))
          .returning();
        if (!updated) throw new Error("Failed to finalize eligibility snapshot");
        return updated;
      });
      return snapshotSummary(snapshot);
    } catch (error) {
      await this.db
        .update(schema.eligibilitySnapshots)
        .set({ status: "FAILED", data: { error: error instanceof ServiceError ? error.code : "SNAPSHOT_BUILD_FAILED" } })
        .where(eq(schema.eligibilitySnapshots.id, id));
      throw error;
    }
  }

  private async latestSnapshots(mechanismConfigId: string) {
    const rows = await this.db
      .select()
      .from(schema.eligibilitySnapshots)
      .where(eq(schema.eligibilitySnapshots.mechanismConfigId, mechanismConfigId))
      .orderBy(desc(schema.eligibilitySnapshots.createdAt));
    const seen = new Set<string>();
    return rows.filter((row) => {
      if (seen.has(row.subject)) return false;
      seen.add(row.subject);
      return true;
    });
  }

  private async subjectOutcome(
    snapshot: typeof schema.eligibilitySnapshots.$inferSelect | undefined,
    takeIdentityId: string,
    canonicalSubjectKey: string
  ) {
    if (!snapshot) return { status: "EVIDENCE_UNAVAILABLE", reasons: ["Eligibility snapshot is missing."] };
    const [member] = await this.db
      .select()
      .from(schema.eligibilitySnapshotMembers)
      .where(
        and(
          eq(schema.eligibilitySnapshotMembers.snapshotId, snapshot.id),
          or(
            eq(schema.eligibilitySnapshotMembers.takeIdentityId, takeIdentityId),
            eq(schema.eligibilitySnapshotMembers.canonicalSubjectKey, canonicalSubjectKey)
          )
        )
      )
      .limit(1);
    if (!member) {
      return snapshot.mode === "EXTERNAL_ALLOWED"
        ? { status: "OPEN_EXTERNAL", reasons: [] }
        : { status: "NOT_ELIGIBLE", reasons: ["This identity was not in the locked candidate population."] };
    }
    const evaluations = await this.db
      .select({
        decision: schema.eligibilityEvaluations.decision,
        reasonCode: schema.eligibilityEvaluations.reasonCode,
        explanation: schema.eligibilityEvaluations.publicExplanation
      })
      .from(schema.eligibilityEvaluations)
      .where(eq(schema.eligibilityEvaluations.memberId, member.id));
    return {
      status: member.decision === "PASS"
        ? "ELIGIBLE"
        : member.decision === "UNKNOWN"
          ? "EVIDENCE_UNAVAILABLE"
          : "NOT_ELIGIBLE",
      reasons: evaluations.filter((item) => item.decision !== "PASS"),
      locked: snapshot.status === "LOCKED"
    };
  }
}

function contractMode(policy: EligibilityPolicyV1) {
  return policy.population.type === "OPEN_EXTERNAL" ? "EXTERNAL_ALLOWED" as const : "MERKLE_ALLOWLIST" as const;
}

function snapshotSummary(snapshot: typeof schema.eligibilitySnapshots.$inferSelect) {
  return {
    id: snapshot.id,
    campaignId: snapshot.campaignId,
    mechanismConfigId: snapshot.mechanismConfigId,
    audience: snapshot.subject,
    mode: snapshot.mode,
    status: snapshot.status,
    root: snapshot.root,
    snapshotHash: snapshot.snapshotHash,
    policyHash: snapshot.policyHash,
    candidateCount: snapshot.candidateCount,
    eligibleCount: snapshot.eligibleCount,
    cutoffAt: snapshot.cutoffAt?.toISOString() ?? null,
    createdAt: snapshot.createdAt.toISOString(),
    lockedAt: snapshot.lockedAt?.toISOString() ?? null
  };
}

function errorSummary(evaluated: readonly EvaluatedSubject[]) {
  const counts = new Map<string, number>();
  for (const item of evaluated) {
    for (const evaluation of item.evaluation.evaluations) {
      if (evaluation.decision !== "UNKNOWN") continue;
      counts.set(evaluation.reasonCode, (counts.get(evaluation.reasonCode) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => ({ code, count }));
}

async function mapLimit<T, R>(
  values: readonly T[],
  concurrency: number,
  transform: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await transform(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
