import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { signalDomains } from "@take/shared";
import { SignalService } from "../services/signal.js";
import { assertOrganizationRole, assertTakeOperator, isTakeOperator } from "../services/authorization.js";
import { GraphService } from "../services/graph.js";
import { notFound } from "../services/errors.js";

const id = z.string().uuid();
const evidenceUrl = z.string().url().max(2_000).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Use an HTTPS evidence URL without embedded credentials.");

export const signalRoutes: FastifyPluginAsync = async (app) => {
  const signal = new SignalService(app.db);
  app.get("/me/signal", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    reply.header("Cache-Control", "private, no-store");
    return signal.history(request.takeIdentity.protocolIdentityKey);
  });
  // The campaign team: TAKE operators and the organizer (organization OWNER or ADMIN).
  // The same people who may lock the check may record what happened.
  async function isCampaignTeam(identity: Parameters<typeof isTakeOperator>[1], organizationId: string) {
    if (isTakeOperator(app.env, identity)) return true;
    if (!identity) return false;
    try { await assertOrganizationRole(app.db, organizationId, identity.takeIdentityId, ["OWNER", "ADMIN"]); return true; }
    catch { return false; }
  }
  app.get<{ Params: { id: string } }>("/campaigns/:id/after", async (request, reply) => {
    const campaignId = id.parse(request.params.id);
    const campaign = await signal.campaign(campaignId);
    const team = await isCampaignTeam(request.takeIdentity, campaign.organizationId);
    if (campaign.status === "DRAFT" && !team) notFound("Campaign not found");
    // The team sees its own private review notes; everyone else sees public ones only.
    if (team) reply.header("Cache-Control", "private, no-store");
    return signal.after(campaignId, team);
  });
  app.post<{ Params: { id: string } }>("/campaigns/:id/evaluation-plan", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const campaignId = id.parse(request.params.id);
    const campaign = await signal.campaign(campaignId);
    if (!isTakeOperator(app.env, request.takeIdentity)) await assertOrganizationRole(app.db, campaign.organizationId, request.takeIdentity.takeIdentityId, ["OWNER", "ADMIN"]);
    const input = z.object({ domain: z.enum(signalDomains), question: z.string().trim().min(5).max(500),
      criteria: z.string().trim().min(10).max(5_000), evaluateAfter: z.coerce.date(), evidenceExpected: z.boolean() }).strict().parse(request.body);
    return reply.code(201).send(await signal.lockPlan(campaignId, request.takeIdentity.takeIdentityId, input));
  });
  app.get("/operator/evaluations", async (request, reply) => {
    assertTakeOperator(app.env, request.takeIdentity);
    reply.header("Cache-Control", "private, no-store");
    return signal.queue();
  });
  app.post<{ Params: { id: string } }>("/operator/campaigns/:id/evaluations", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const campaignId = id.parse(request.params.id);
    const campaign = await signal.campaign(campaignId);
    // Team review: TAKE operators, or the campaign's organizer (OWNER/ADMIN).
    if (!isTakeOperator(app.env, request.takeIdentity)) await assertOrganizationRole(app.db, campaign.organizationId, request.takeIdentity.takeIdentityId, ["OWNER", "ADMIN"]);
    const input = z.object({ recipientKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((value) => value.toLowerCase()),
      status: z.enum(["PENDING", "POSITIVE", "NEGATIVE", "INCONCLUSIVE"]),
      evidenceUrls: z.array(evidenceUrl).max(5), note: z.string().trim().min(3).max(2_000), isPublic: z.boolean() }).strict().parse(request.body);
    return signal.recordEvaluation(campaignId, request.takeIdentity.takeIdentityId, input);
  });
  app.get<{ Params: { id: string } }>("/operator/campaigns/:id/integrity-observations", async (request, reply) => {
    assertTakeOperator(app.env, request.takeIdentity);
    reply.header("Cache-Control", "private, no-store");
    const snapshot = await new GraphService(app.db).latest(id.parse(request.params.id));
    // Read existing observations only: no re-analysis or allocation mutation.
    return { snapshot: snapshot ? { id: snapshot.id, edgeCutoffBlock: snapshot.edgeCutoffBlock, signals: snapshot.signals } : null };
  });
};
