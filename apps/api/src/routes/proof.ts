import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, isNotNull, notInArray, or } from "drizzle-orm";
import { schema } from "@take/database";
import { SignalService } from "../services/signal.js";

export type ProofCampaign = {
  id: string;
  title: string;
  organizationName: string | null;
  resource: string;
  spots: number;
  eligibleGivers: number | null;
  givers: number;
  recipientsNominated: number;
  participationRate: number | null;
  winners: Array<{ name: string; supporters: number; check: string | null }>;
  resultHash: string | null;
  resultTransactionHash: string | null;
  finalizedAt: string | null;
  teamCheck: { question: string; evaluateAfter: string; positive: number; negative: number; inconclusive: number; pending: number } | null;
};

/** Finished campaigns, for the landing page's "Campaigns run on TAKE". Public facts only. */
export const proofRoutes: FastifyPluginAsync = async (app) => {
  const signal = new SignalService(app.db);
  app.get("/proof/campaigns", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=60");
    reply.header("Vercel-CDN-Cache-Control", "max-age=60, stale-while-revalidate=600");
    const finished = await app.db.select({ campaign: schema.campaigns, organizationName: schema.organizations.name })
      .from(schema.campaigns).innerJoin(schema.organizations, eq(schema.organizations.id, schema.campaigns.organizationId))
      .where(and(eq(schema.campaigns.status, "FINALIZED"), isNotNull(schema.campaigns.finalResultHash),
        // Sandbox campaigns (open eligibility, no locked mechanism) are for trying TAKE and don't count.
        or(isNotNull(schema.campaigns.mechanismConfigId), notInArray(schema.campaigns.nominatorEligibilityMode, ["OPEN_REGISTERED", "EXTERNAL_ALLOWED"]))))
      .orderBy(desc(schema.campaigns.endTime)).limit(6);
    const campaigns: ProofCampaign[] = [];
    for (const { campaign, organizationName } of finished) {
      const after = await signal.after(campaign.id);
      const [snapshot] = await app.db.select({ eligible: schema.eligibilitySnapshots.eligibleCount }).from(schema.eligibilitySnapshots)
        .where(and(eq(schema.eligibilitySnapshots.campaignId, campaign.id), eq(schema.eligibilitySnapshots.subject, "NOMINATOR"), isNotNull(schema.eligibilitySnapshots.lockedAt)))
        .orderBy(desc(schema.eligibilitySnapshots.lockedAt)).limit(1);
      const [finalize] = await app.db.select({ hash: schema.campaignLifecycleIntents.transactionHash, at: schema.campaignLifecycleIntents.updatedAt })
        .from(schema.campaignLifecycleIntents)
        .where(and(eq(schema.campaignLifecycleIntents.campaignId, campaign.id), eq(schema.campaignLifecycleIntents.action, "FINALIZE"), isNotNull(schema.campaignLifecycleIntents.transactionHash)))
        .orderBy(desc(schema.campaignLifecycleIntents.updatedAt)).limit(1);
      const givers = new Set(after.recommendations.map((item) => item.giver.key)).size;
      const eligible = snapshot?.eligible ?? null;
      const outcomes = after.recipients.map((recipient) => recipient.evaluation?.status ?? "PENDING");
      campaigns.push({
        id: campaign.id,
        title: campaign.title,
        organizationName,
        resource: after.resource,
        spots: after.seats,
        eligibleGivers: eligible,
        givers,
        recipientsNominated: new Set(after.recommendations.map((item) => item.recipient.key)).size,
        participationRate: eligible ? Math.min(1, givers / eligible) : null,
        winners: after.recipients.map((recipient) => ({ name: recipient.person.name, supporters: recipient.supporters,
          check: recipient.evaluation && recipient.evaluation.status !== "PENDING" ? recipient.evaluation.status : null })),
        resultHash: campaign.finalResultHash,
        resultTransactionHash: finalize?.hash ?? null,
        finalizedAt: finalize?.at?.toISOString() ?? null,
        teamCheck: after.plan ? { question: after.plan.question, evaluateAfter: after.plan.evaluateAfter,
          positive: outcomes.filter((s) => s === "POSITIVE").length, negative: outcomes.filter((s) => s === "NEGATIVE").length,
          inconclusive: outcomes.filter((s) => s === "INCONCLUSIVE").length, pending: outcomes.filter((s) => s === "PENDING").length } : null
      });
    }
    return { campaigns };
  });
};
