import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { signalCallValues, signalDomains } from "@take/shared";
import { SignalService } from "../services/signal.js";
import { SignalCallService } from "../services/signalCalls.js";
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
  const calls = new SignalCallService(app.db);
  app.get("/me/signal", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    reply.header("Cache-Control", "private, no-store");
    return signal.history(request.takeIdentity.protocolIdentityKey);
  });
  app.get("/me/signal/calls", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    reply.header("Cache-Control", "private, no-store");
    return calls.mine(request.takeIdentity.protocolIdentityKey);
  });
  app.post<{ Params: { id: string } }>("/campaigns/:id/calls", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const input = z.object({
      recipientKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((value) => value.toLowerCase()),
      call: z.enum(signalCallValues)
    }).strict().parse(request.body);
    return calls.make(id.parse(request.params.id), request.takeIdentity.protocolIdentityKey, input);
  });
  app.get<{ Params: { id: string } }>("/campaigns/:id/after", async (request) => {
    const campaignId = id.parse(request.params.id);
    const campaign = await signal.campaign(campaignId);
    if (campaign.status === "DRAFT" && !isTakeOperator(app.env, request.takeIdentity)) {
      if (!request.takeIdentity) notFound("Campaign not found");
      await assertOrganizationRole(app.db, campaign.organizationId, request.takeIdentity.takeIdentityId, ["OWNER", "ADMIN"]);
    }
    return signal.after(campaignId);
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
  app.post<{ Params: { id: string } }>("/operator/campaigns/:id/evaluations", async (request) => {
    const actor = assertTakeOperator(app.env, request.takeIdentity);
    const input = z.object({ recipientKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((value) => value.toLowerCase()),
      status: z.enum(["PENDING", "POSITIVE", "NEGATIVE", "INCONCLUSIVE"]),
      evidenceUrls: z.array(evidenceUrl).max(5), note: z.string().trim().min(3).max(2_000), isPublic: z.boolean() }).strict().parse(request.body);
    return signal.recordEvaluation(id.parse(request.params.id), actor.takeIdentityId, input);
  });
  app.get<{ Params: { id: string } }>("/operator/campaigns/:id/integrity-observations", async (request, reply) => {
    assertTakeOperator(app.env, request.takeIdentity);
    reply.header("Cache-Control", "private, no-store");
    const snapshot = await new GraphService(app.db).latest(id.parse(request.params.id));
    // Read existing observations only: no re-analysis or allocation mutation.
    return { snapshot: snapshot ? { id: snapshot.id, edgeCutoffBlock: snapshot.edgeCutoffBlock, signals: snapshot.signals } : null };
  });
};
