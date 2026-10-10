import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@take/database";
import type { EvaluationTemplate, EvaluationTemplateParams, EvaluationTemplateType, CampaignAfter, EvaluationPlan, RecipientEvaluation, SignalCounts, SignalDomain, SignalHistory, SignalPerson, SignalRecommendation } from "@take/shared";
import { ServiceError, notFound } from "./errors.js";
import { isMissingTable } from "./campaign.js";

type PlanRow = typeof schema.campaignEvaluationPlans.$inferSelect;
type EvaluationRow = typeof schema.recipientEvaluations.$inferSelect;
type PlanInput = { domain: SignalDomain; question: string; criteria: string; evaluateAfter: Date; evidenceExpected: boolean;
  template?: { type: EvaluationTemplateType; params: EvaluationTemplateParams } };
type OutcomeInput = { recipientKey: string; status: "PENDING" | "POSITIVE" | "NEGATIVE" | "INCONCLUSIVE"; evidenceUrls: string[]; note: string; isPublic: boolean };

export class SignalService {
  constructor(private readonly db: Database) {}

  async campaign(id: string) {
    const [campaign] = await this.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1);
    if (!campaign) notFound("Campaign not found");
    return campaign;
  }

  async plan(id: string): Promise<EvaluationPlan | null> {
    const [plan] = await this.db.select().from(schema.campaignEvaluationPlans).where(eq(schema.campaignEvaluationPlans.campaignId, id)).limit(1);
    return plan ? { ...planView(plan), template: await this.template(plan.id) } : null;
  }

  /** The plan's opportunity template; null without one (or before the migration is applied). */
  async template(planId: string): Promise<EvaluationTemplate | null> {
    try {
      const [row] = await this.db.select().from(schema.evaluationPlanTemplates).where(eq(schema.evaluationPlanTemplates.planId, planId)).limit(1);
      return row ? { type: row.template as EvaluationTemplateType, params: row.params as EvaluationTemplateParams,
        autoCheckedAt: row.autoCheckedAt?.toISOString() ?? null, autoCheckReport: row.autoCheckReport ?? null } : null;
    } catch (error) {
      if (isMissingTable(error)) return null;
      throw error;
    }
  }

  private async templatesAvailable() {
    try { await this.db.select({ id: schema.evaluationPlanTemplates.planId }).from(schema.evaluationPlanTemplates).limit(1); return true; }
    catch (error) { if (isMissingTable(error)) return false; throw error; }
  }

  private async opportunity(campaignId: string) {
    const resources = await this.db.select().from(schema.campaignResources)
      .where(eq(schema.campaignResources.campaignId, campaignId)).orderBy(schema.campaignResources.id);
    return { resource: resources.map((resource) => resource.name).join(", "),
      seats: resources.reduce((total, resource) => total + resource.quantity, 0) };
  }

  async lockPlan(campaignId: string, actorId: string, { template, ...input }: PlanInput) {
    const withTemplate = Boolean(template) && await this.templatesAvailable();
    if (template && template.type !== "CUSTOM" && !withTemplate) {
      throw new ServiceError("EVALUATION_TEMPLATES_UNAVAILABLE", "Opportunity templates are not switched on yet on this TAKE server. Use Custom.", 503);
    }
    return this.db.transaction(async (tx) => {
      const [campaign] = await tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).for("update");
      if (!campaign) notFound("Campaign not found");
      if (campaign.status !== "DRAFT" || campaign.startTime <= new Date()) {
        throw new ServiceError("EVALUATION_PLAN_TOO_LATE", "Set the evaluation plan before publication and before the campaign starts.", 409);
      }
      const [intent] = await tx.select({ id: schema.campaignLifecycleIntents.id }).from(schema.campaignLifecycleIntents)
        .where(and(eq(schema.campaignLifecycleIntents.campaignId, campaignId), eq(schema.campaignLifecycleIntents.action, "PUBLISH"))).limit(1);
      if (intent) throw new ServiceError("PUBLICATION_ALREADY_PREPARED", "Evaluation criteria must be locked before preparing publication.", 409);
      if (input.evaluateAfter < campaign.endTime) throw new ServiceError("EVALUATION_DATE_INVALID", "Evaluate after the campaign's scheduled end.", 400);
      const [existing] = await tx.select().from(schema.campaignEvaluationPlans).where(eq(schema.campaignEvaluationPlans.campaignId, campaignId));
      if (existing) throw new ServiceError("EVALUATION_PLAN_LOCKED", "This campaign already has locked evaluation criteria.", 409);
      const [plan] = await tx.insert(schema.campaignEvaluationPlans).values({
        ...input, campaignId, createdByIdentityId: actorId, lockedAt: new Date()
      }).returning();
      if (template && withTemplate) {
        await tx.insert(schema.evaluationPlanTemplates).values({ planId: plan!.id, template: template.type, params: template.params as Record<string, unknown> });
        return { ...planView(plan!), template: { type: template.type, params: template.params, autoCheckedAt: null, autoCheckReport: null } };
      }
      return { ...planView(plan!), template: null };
    });
  }

  private async person(key: string): Promise<SignalPerson> {
    const [person] = await this.db.select({ name: schema.users.displayName, avatarUrl: schema.users.avatarUrl })
      .from(schema.takeIdentities).innerJoin(schema.users, eq(schema.users.id, schema.takeIdentities.userId))
      .where(eq(schema.takeIdentities.protocolIdentityKey, key)).limit(1);
    if (person) return { key, name: person.name ?? "TAKE member", avatarUrl: person.avatarUrl };
    const [external] = await this.db.select().from(schema.externalIdentities)
      .where(eq(schema.externalIdentities.externalIdentityKey, key)).limit(1);
    return { key, name: external?.displayName ?? (external?.currentUsername ? `@${external.currentUsername}` : "Unlinked identity"), avatarUrl: external?.avatarUrl ?? null };
  }

  private async evaluation(row: EvaluationRow | undefined, operator = false): Promise<RecipientEvaluation | null> {
    if (!row) return null;
    const [evaluator] = await this.db.select().from(schema.takeIdentities).where(eq(schema.takeIdentities.id, row.evaluatorIdentityId)).limit(1);
    return {
      status: row.status as RecipientEvaluation["status"],
      evidenceUrls: operator || row.isPublic ? row.evidenceUrls : [],
      note: operator || row.isPublic ? row.note : null,
      isPublic: row.isPublic,
      evaluatedAt: row.evaluatedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      evaluator: evaluator ? await this.person(evaluator.protocolIdentityKey) : { key: "", name: "TAKE operator", avatarUrl: null }
    };
  }

  private async committedRecipients(campaign: typeof schema.campaigns.$inferSelect) {
    if (campaign.status !== "FINALIZED" || !campaign.finalResultHash) return { committed: false, keys: [] as string[] };
    const [run] = await this.db.select().from(schema.allocationRuns).where(and(
      eq(schema.allocationRuns.campaignId, campaign.id), eq(schema.allocationRuns.resultHash, campaign.finalResultHash),
      inArray(schema.allocationRuns.status, ["COMPLETED", "FINALIZED"])
    )).orderBy(desc(schema.allocationRuns.completedAt)).limit(1);
    if (!run) return { committed: false, keys: [] as string[] };
    const results = await this.db.select().from(schema.allocationResults).where(and(
      eq(schema.allocationResults.allocationRunId, run.id), eq(schema.allocationResults.selected, true)
    ));
    const keys: string[] = [];
    for (const result of results) {
      if (result.recipientKey) { keys.push(result.recipientKey.toLowerCase()); continue; }
      const [identity] = result.recipientTakeIdentityId
        ? await this.db.select({ key: schema.takeIdentities.protocolIdentityKey }).from(schema.takeIdentities).where(eq(schema.takeIdentities.id, result.recipientTakeIdentityId)).limit(1)
        : result.recipientExternalIdentityId
          ? await this.db.select({ key: schema.externalIdentities.externalIdentityKey }).from(schema.externalIdentities).where(eq(schema.externalIdentities.id, result.recipientExternalIdentityId)).limit(1) : [];
      if (identity) keys.push(identity.key.toLowerCase());
    }
    return { committed: true, keys: [...new Set(keys)] };
  }

  async recordEvaluation(campaignId: string, actorId: string, input: OutcomeInput) {
    return this.db.transaction(async (tx) => {
      await tx.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).for("update");
      const service = new SignalService(tx as unknown as Database);
      const campaign = await service.campaign(campaignId);
      const plan = await service.plan(campaignId);
      if (!plan?.lockedAt) throw new ServiceError("EVALUATION_PLAN_REQUIRED", "A predefined, locked evaluation plan is required.", 409);
      if (campaign.status !== "FINALIZED" || new Date(plan.evaluateAfter) > new Date()) {
        throw new ServiceError("EVALUATION_NOT_DUE", "Evaluate only after finalization and the declared evaluation date.", 409);
      }
      const selected = await service.committedRecipients(campaign);
      if (!selected.committed || !selected.keys.includes(input.recipientKey)) {
        throw new ServiceError("RECIPIENT_NOT_ALLOCATED", "Choose a recipient of the finalized opportunity.", 400);
      }
      if (plan.evidenceExpected && input.status !== "PENDING" && !input.evidenceUrls.length) {
        throw new ServiceError("EVIDENCE_REQUIRED", "This plan requires an evidence URL for an outcome.", 400);
      }
      const values = { ...input, planId: plan.id, evaluatorIdentityId: actorId,
        evaluatedAt: input.status === "PENDING" ? null : new Date(), updatedAt: new Date() };
      const [row] = await tx.insert(schema.recipientEvaluations).values(values).onConflictDoUpdate({
        target: [schema.recipientEvaluations.planId, schema.recipientEvaluations.recipientKey], set: values
      }).returning();
      return service.evaluation(row, true);
    });
  }

  async history(giverKey: string): Promise<SignalHistory> {
    const rows = await this.db.select({ edge: schema.nominationEdges, campaign: schema.campaigns, plan: schema.campaignEvaluationPlans, outcome: schema.recipientEvaluations })
      .from(schema.nominationEdges)
      .innerJoin(schema.chainEvents, eq(schema.chainEvents.id, schema.nominationEdges.chainEventId))
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.nominationEdges.campaignId))
      .leftJoin(schema.campaignEvaluationPlans, eq(schema.campaignEvaluationPlans.campaignId, schema.campaigns.id))
      .leftJoin(schema.recipientEvaluations, and(eq(schema.recipientEvaluations.planId, schema.campaignEvaluationPlans.id), eq(schema.recipientEvaluations.recipientKey, schema.nominationEdges.canonicalRecipientKey)))
      .where(and(eq(schema.nominationEdges.canonicalGiverKey, giverKey.toLowerCase()),
        eq(schema.nominationEdges.validity, "VALID"), eq(schema.nominationEdges.finalityStatus, "FINALIZED"),
        eq(schema.chainEvents.finalityStatus, "FINALIZED")))
      .orderBy(desc(schema.nominationEdges.blockTimestamp), desc(schema.nominationEdges.logIndex));
    const giver = await this.person(giverKey);
    const people = new Map<string, SignalPerson>();
    const allocations = new Map<string, Awaited<ReturnType<SignalService["committedRecipients"]>>>();
    const opportunities = new Map<string, Awaited<ReturnType<SignalService["opportunity"]>>>();
    const history: SignalRecommendation[] = [];
    for (const row of rows) {
      const key = row.edge.canonicalRecipientKey;
      if (!people.has(key)) people.set(key, await this.person(key));
      if (!allocations.has(row.campaign.id)) allocations.set(row.campaign.id, await this.committedRecipients(row.campaign));
      if (!opportunities.has(row.campaign.id)) opportunities.set(row.campaign.id, await this.opportunity(row.campaign.id));
      const allocation = allocations.get(row.campaign.id)!;
      const received = allocation.committed ? allocation.keys.includes(key) : null;
      const evaluation = received ? await this.evaluation(row.outcome ?? undefined) : null;
      const state = received === false ? "NOT_SELECTED" : !row.plan ? "NOT_PLANNED" : evaluation?.status ?? "PENDING";
      history.push({ id: row.edge.id, giver, recipient: people.get(key)!,
        campaign: { id: row.campaign.id, title: row.campaign.title, resource: opportunities.get(row.campaign.id)!.resource, status: row.campaign.status },
        givenAt: row.edge.blockTimestamp.toISOString(), domain: row.plan?.domain as SignalDomain ?? null,
        plan: row.plan ? planView(row.plan) : null, evaluation, state, receivedOpportunity: received });
    }
    const domains = [...new Set(history.flatMap((item) => item.domain ? [item.domain] : []))];
    return { counts: counts(history), domains: domains.map((domain) => ({ domain, counts: counts(history.filter((item) => item.domain === domain)) })), history };
  }

  async after(campaignId: string, operator = false): Promise<CampaignAfter> {
    const campaign = await this.campaign(campaignId);
    const plan = await this.plan(campaignId);
    const base = { campaignId, title: campaign.title, status: campaign.status, ...await this.opportunity(campaignId), plan };
    // No public nomination counts or identities while a campaign is live.
    if (campaign.status !== "FINALIZED") return { ...base, allocationCommitted: false, recipients: [], recommendations: [] };
    const allocation = await this.committedRecipients(campaign);
    const edges = await this.db.select({ edge: schema.nominationEdges }).from(schema.nominationEdges)
      .innerJoin(schema.chainEvents, eq(schema.chainEvents.id, schema.nominationEdges.chainEventId))
      .where(and(eq(schema.nominationEdges.campaignId, campaignId), eq(schema.nominationEdges.validity, "VALID"),
        eq(schema.nominationEdges.finalityStatus, "FINALIZED"), eq(schema.chainEvents.finalityStatus, "FINALIZED")))
      .orderBy(desc(schema.nominationEdges.blockTimestamp));
    const outcomes = plan ? await this.db.select().from(schema.recipientEvaluations).where(eq(schema.recipientEvaluations.planId, plan.id)) : [];
    const people = new Map<string, SignalPerson>();
    for (const key of new Set([...allocation.keys, ...edges.flatMap(({ edge }) => [edge.canonicalGiverKey, edge.canonicalRecipientKey])])) people.set(key, await this.person(key));
    return { ...base, allocationCommitted: allocation.committed,
      recipients: await Promise.all(allocation.keys.map(async (key) => ({ person: people.get(key)!,
        supporters: new Set(edges.filter(({ edge }) => edge.canonicalRecipientKey === key).map(({ edge }) => edge.canonicalGiverKey)).size,
        evaluation: await this.evaluation(outcomes.find((outcome) => outcome.recipientKey === key), operator) }))),
      recommendations: edges.map(({ edge }) => ({ id: edge.id, giver: people.get(edge.canonicalGiverKey)!, recipient: people.get(edge.canonicalRecipientKey)!, givenAt: edge.blockTimestamp.toISOString() })) };
  }

  async queue() {
    const plans = await this.db.select({ campaignId: schema.campaigns.id }).from(schema.campaignEvaluationPlans)
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignEvaluationPlans.campaignId))
      .where(eq(schema.campaigns.status, "FINALIZED")).orderBy(schema.campaignEvaluationPlans.evaluateAfter);
    return Promise.all(plans.map((plan) => this.after(plan.campaignId, true)));
  }
}

function planView(row: PlanRow): EvaluationPlan {
  return { id: row.id, campaignId: row.campaignId, domain: row.domain as SignalDomain, question: row.question,
    criteria: row.criteria, evaluateAfter: row.evaluateAfter.toISOString(), evidenceExpected: row.evidenceExpected,
    createdAt: row.createdAt.toISOString(), lockedAt: row.lockedAt?.toISOString() ?? null };
}
function counts(history: SignalRecommendation[]): SignalCounts {
  const total = (state: SignalRecommendation["state"]) => history.filter((item) => item.state === state).length;
  return { recommendations: history.length, evaluated: total("POSITIVE") + total("NEGATIVE") + total("INCONCLUSIVE"),
    positive: total("POSITIVE"), negative: total("NEGATIVE"), inconclusive: total("INCONCLUSIVE"),
    pending: total("PENDING"), notPlanned: total("NOT_PLANNED"), notSelected: total("NOT_SELECTED") };
}
