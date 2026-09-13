import { and, asc, desc, eq, max } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import { assertOrganizationRole } from "./authorization.js";
import { notFound, ServiceError } from "./errors.js";

export class ReviewService {
  constructor(private readonly db: Database) {}

  async list(campaignId: string, actorIdentityId: string) {
    const campaign = await this.campaign(campaignId);
    await assertOrganizationRole(this.db, campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    this.assertExperimentInformationVisible(campaign);
    return this.db
      .select()
      .from(schema.reviewCases)
      .where(eq(schema.reviewCases.campaignId, campaignId))
      .orderBy(desc(schema.reviewCases.createdAt));
  }

  async detail(campaignId: string, caseId: string, actorIdentityId: string) {
    const campaign = await this.campaign(campaignId);
    await assertOrganizationRole(this.db, campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    this.assertExperimentInformationVisible(campaign);
    const [reviewCase] = await this.db
      .select()
      .from(schema.reviewCases)
      .where(
        and(
          eq(schema.reviewCases.id, caseId),
          eq(schema.reviewCases.campaignId, campaignId)
        )
      )
      .limit(1);
    if (!reviewCase) notFound("Review case not found");
    const [events, decisions, signal] = await Promise.all([
      this.db.select().from(schema.reviewCaseEvents)
        .where(eq(schema.reviewCaseEvents.reviewCaseId, caseId))
        .orderBy(asc(schema.reviewCaseEvents.sequence)),
      this.db.select().from(schema.reviewDecisions)
        .where(eq(schema.reviewDecisions.reviewCaseId, caseId))
        .orderBy(asc(schema.reviewDecisions.revision)),
      reviewCase.graphSignalId
        ? this.db.select().from(schema.graphSignalObservations)
            .where(eq(schema.graphSignalObservations.id, reviewCase.graphSignalId)).limit(1)
        : Promise.resolve([])
    ]);
    return { reviewCase, events, decisions, graphSignal: signal[0] ?? null };
  }

  async decide(input: {
    campaignId: string;
    caseId: string;
    actorIdentityId: string;
    decision: "CONFIRMED_MANIPULATION" | "DISMISSED";
    reasonCode: string;
    publicExplanation: string;
    restrictedEvidence?: Record<string, unknown>;
  }) {
    const campaign = await this.campaign(input.campaignId);
    await assertOrganizationRole(this.db, campaign.organizationId, input.actorIdentityId, ["OWNER", "ADMIN"]);
    this.assertExperimentInformationVisible(campaign);
    const [reviewCase] = await this.db
      .select()
      .from(schema.reviewCases)
      .where(
        and(
          eq(schema.reviewCases.id, input.caseId),
          eq(schema.reviewCases.campaignId, input.campaignId)
        )
      )
      .limit(1);
    if (!reviewCase) notFound("Review case not found");
    if (reviewCase.status === "CLOSED") {
      throw new ServiceError("REVIEW_CASE_CLOSED", "A closed review case cannot receive another decision", 409);
    }

    return this.db.transaction(async (tx) => {
      const [decisionAggregate] = await tx
        .select({ value: max(schema.reviewDecisions.revision) })
        .from(schema.reviewDecisions)
        .where(eq(schema.reviewDecisions.reviewCaseId, input.caseId));
      const [eventAggregate] = await tx
        .select({ value: max(schema.reviewCaseEvents.sequence) })
        .from(schema.reviewCaseEvents)
        .where(eq(schema.reviewCaseEvents.reviewCaseId, input.caseId));
      const revision = Number(decisionAggregate?.value ?? 0) + 1;
      const sequence = Number(eventAggregate?.value ?? 0) + 1;
      const [decision] = await tx
        .insert(schema.reviewDecisions)
        .values({
          reviewCaseId: input.caseId,
          revision,
          decision: input.decision,
          reasonCode: input.reasonCode,
          publicExplanation: input.publicExplanation,
          restrictedEvidence: input.restrictedEvidence ?? {},
          decidedByIdentityId: input.actorIdentityId
        })
        .returning();
      await tx.insert(schema.reviewCaseEvents).values({
        reviewCaseId: input.caseId,
        sequence,
        eventType: "DECISION_RECORDED",
        actorIdentityId: input.actorIdentityId,
          payload: {
            decisionRevision: revision,
            decision: input.decision,
            allocationEffect: campaign.experimentId
              ? "NONE_IN_EXPERIMENT_V0"
              : "NONE_IN_MECHANISM_V1"
          }
      });
      await tx
        .update(schema.reviewCases)
        .set({ status: "RESOLVED", updatedAt: new Date() })
        .where(eq(schema.reviewCases.id, input.caseId));
      if (reviewCase.graphSignalId) {
        await tx
          .update(schema.graphSignalObservations)
          .set({ status: input.decision })
          .where(eq(schema.graphSignalObservations.id, reviewCase.graphSignalId));
      }
      return decision;
    });
  }

  async requestEvidenceRefresh(input: {
    campaignId: string;
    actorIdentityId: string;
    audience: "NOMINATOR" | "RECIPIENT";
    reason: string;
  }) {
    const campaign = await this.campaign(input.campaignId);
    if (campaign.mechanismConfigId) {
      throw new ServiceError(
        "ELIGIBILITY_ALREADY_LOCKED",
        "Evidence refresh requests must be made before eligibility is locked",
        409
      );
    }
    const [created] = await this.db
      .insert(schema.reviewCases)
      .values({
        campaignId: input.campaignId,
        caseType: "EVIDENCE_REFRESH_REQUEST",
        status: "OPEN",
        publicSummary: "A participant requested a factual eligibility evidence refresh.",
        restrictedSummary: input.reason,
        openedByIdentityId: input.actorIdentityId
      })
      .returning();
    if (!created) throw new Error("Failed to create evidence refresh request");
    await this.db.insert(schema.reviewCaseEvents).values({
      reviewCaseId: created.id,
      sequence: 1,
      eventType: "EVIDENCE_REFRESH_REQUESTED",
      actorIdentityId: input.actorIdentityId,
      payload: { audience: input.audience, reason: input.reason }
    });
    return created;
  }

  private async campaign(id: string) {
    const [campaign] = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .limit(1);
    if (!campaign) notFound("Campaign not found");
    return campaign;
  }

  private assertExperimentInformationVisible(campaign: typeof schema.campaigns.$inferSelect) {
    if (
      campaign.experimentId
      && !["CLOSED", "ALLOCATING", "FINALIZED"].includes(campaign.status)
    ) {
      throw new ServiceError(
        "EXPERIMENT_INFORMATION_HIDDEN",
        "Behavioral observations remain hidden until the V0 campaign closes",
        409
      );
    }
  }
}
