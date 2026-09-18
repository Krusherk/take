import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CampaignRequestService } from "../services/campaignRequests.js";
import { assertTakeOperator, isTakeOperator } from "../services/authorization.js";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@take/database";
import { ExperimentService } from "../services/experiment.js";

const requestInput = z.object({
  organizationId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(5_000),
  resourceName: z.string().trim().min(1).max(160),
  resourceDescription: z.string().trim().max(2_000).optional(),
  seatCount: z.number().int().positive().max(10_000),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  selectorMode: z.enum(["DISJOINT", "OVERLAPPING"]).default("DISJOINT"),
  eligibilityDescription: z.string().trim().max(2_000).optional()
});

export const operatorRoutes: FastifyPluginAsync = async (app) => {
  const requests = new CampaignRequestService(app.db);
  const experiments = new ExperimentService(app.db);

  app.get("/operator/me", async (request) => ({ operator: isTakeOperator(app.env, request.takeIdentity) }));

  app.get("/campaign-requests/mine", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return requests.listMine(request.takeIdentity.takeIdentityId);
  });
  app.post("/campaign-requests", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return reply.code(201).send(await requests.createDraft(requestInput.parse(request.body), request.takeIdentity.takeIdentityId));
  });
  app.patch<{ Params: { id: string } }>("/campaign-requests/:id", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return requests.updateDraft(request.params.id, requestInput.parse(request.body), request.takeIdentity.takeIdentityId);
  });
  app.post<{ Params: { id: string } }>("/campaign-requests/:id/submit", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return requests.submit(request.params.id, request.takeIdentity.takeIdentityId);
  });

  app.get("/operator/campaign-requests", async (request) => {
    assertTakeOperator(app.env, request.takeIdentity);
    return requests.listOperator();
  });
  app.get<{ Params: { id: string } }>("/operator/campaigns/:id/rosters", async (request) => {
    assertTakeOperator(app.env, request.takeIdentity);
    const [campaign] = await app.db.select({ organizationId: schema.campaigns.organizationId })
      .from(schema.campaigns).where(eq(schema.campaigns.id, request.params.id)).limit(1);
    if (!campaign) return [];
    const allowlists = await app.db.select().from(schema.identityAllowlists)
      .where(eq(schema.identityAllowlists.organizationId, campaign.organizationId));
    return Promise.all(allowlists.map(async (allowlist) => ({
      id: allowlist.id,
      name: allowlist.name,
      status: allowlist.status,
      members: await app.db.select({ id: schema.identityAllowlistMembers.id })
        .from(schema.identityAllowlistMembers)
        .where(eq(schema.identityAllowlistMembers.allowlistId, allowlist.id))
    })));
  });
  app.post<{ Params: { id: string } }>("/operator/campaign-requests/:id/provision", async (request) => {
    const operator = assertTakeOperator(app.env, request.takeIdentity);
    return requests.provision(request.params.id, operator.takeIdentityId);
  });
  app.post<{ Params: { id: string } }>("/operator/campaign-requests/:id/request-changes", async (request) => {
    assertTakeOperator(app.env, request.takeIdentity);
    const body = z.object({ note: z.string().trim().min(1).max(2_000) }).parse(request.body);
    return requests.requestChanges(request.params.id, body.note);
  });
  app.post<{ Params: { id: string } }>("/operator/campaign-requests/:id/reject", async (request) => {
    assertTakeOperator(app.env, request.takeIdentity);
    const body = z.object({ note: z.string().trim().min(1).max(2_000) }).parse(request.body);
    return requests.reject(request.params.id, body.note);
  });

  app.get<{ Params: { id: string } }>("/operator/campaigns/:id/recipient-context", async (request) => {
    assertTakeOperator(app.env, request.takeIdentity);
    const [snapshot] = await app.db.select().from(schema.eligibilitySnapshots).where(and(
      eq(schema.eligibilitySnapshots.campaignId, request.params.id),
      eq(schema.eligibilitySnapshots.subject, "RECIPIENT")
    )).orderBy(desc(schema.eligibilitySnapshots.createdAt)).limit(1);
    if (!snapshot) return { snapshotId: null, recipients: [] };
    const members = await app.db.select().from(schema.eligibilitySnapshotMembers).where(and(
      eq(schema.eligibilitySnapshotMembers.snapshotId, snapshot.id),
      eq(schema.eligibilitySnapshotMembers.eligible, true)
    ));
    const recipients = await Promise.all(members.map(async (member) => {
      if (member.takeIdentityId) {
        const [person] = await app.db.select({ displayName: schema.users.displayName })
          .from(schema.takeIdentities)
          .innerJoin(schema.users, eq(schema.users.id, schema.takeIdentities.userId))
          .where(eq(schema.takeIdentities.id, member.takeIdentityId)).limit(1);
        return { canonicalRecipientKey: member.canonicalSubjectKey, displayName: person?.displayName ?? "TAKE member" };
      }
      const [external] = member.externalIdentityId
        ? await app.db.select({ displayName: schema.externalIdentities.displayName, username: schema.externalIdentities.currentUsername })
            .from(schema.externalIdentities).where(eq(schema.externalIdentities.id, member.externalIdentityId)).limit(1)
        : [];
      return { canonicalRecipientKey: member.canonicalSubjectKey, displayName: external?.displayName ?? external?.username ?? "External recipient" };
    }));
    return { snapshotId: snapshot.id, status: snapshot.status, recipients };
  });

  app.get<{ Params: { id: string } }>("/operator/campaigns/:id/allocation-runs/latest", async (request) => {
    assertTakeOperator(app.env, request.takeIdentity);
    const [run] = await app.db.select({
      id: schema.allocationRuns.id,
      status: schema.allocationRuns.status,
      resultHash: schema.allocationRuns.resultHash,
      completedAt: schema.allocationRuns.completedAt
    }).from(schema.allocationRuns)
      .where(eq(schema.allocationRuns.campaignId, request.params.id))
      .orderBy(desc(schema.allocationRuns.startedAt))
      .limit(1);
    return run ? {
      id: run.id,
      status: run.status,
      resultHash: run.resultHash,
      completedAt: run.completedAt?.toISOString() ?? null
    } : null;
  });

  app.post<{ Params: { id: string } }>("/operator/campaigns/:id/experiment-v0", async (request) => {
    const operator = assertTakeOperator(app.env, request.takeIdentity);
    return experiments.createDraft(request.params.id, operator.takeIdentityId, request.body, true);
  });
};
