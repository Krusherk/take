import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@take/database";
import { evaluationTemplates, signalDomains } from "@take/shared";
import { configuredEvaluationChains } from "../services/evaluationAuto.js";
import { SignalService } from "../services/signal.js";
import { assertOrganizationRole, assertTakeOperator, isTakeOperator } from "../services/authorization.js";
import { GraphService } from "../services/graph.js";
import { ServiceError, notFound } from "../services/errors.js";

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
  // Public, non-transferable backer score for an X handle or wallet address.
  app.get<{ Params: { ref: string } }>("/signal/:ref", async (request, reply) => {
    const ref = z.string().trim().min(1).max(128).parse(request.params.ref).replace(/^@/, "");
    const [row] = /^0x[0-9a-fA-F]{40}$/.test(ref)
      ? await app.db.select({ key: schema.takeIdentities.protocolIdentityKey }).from(schema.wallets)
          .innerJoin(schema.takeIdentities, eq(schema.takeIdentities.id, schema.wallets.takeIdentityId))
          .where(eq(sql`lower(${schema.wallets.address})`, ref.toLowerCase())).limit(1)
      : await app.db.select({ key: schema.takeIdentities.protocolIdentityKey }).from(schema.socialAccounts)
          .innerJoin(schema.takeIdentities, eq(schema.takeIdentities.id, schema.socialAccounts.takeIdentityId))
          .where(and(eq(sql`lower(${schema.socialAccounts.username})`, ref.toLowerCase()), eq(schema.socialAccounts.isActive, true))).limit(1);
    if (!row) notFound("No TAKE account for that handle or wallet");
    reply.header("Cache-Control", "public, max-age=60");
    return signal.backerScore(row.key);
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
      criteria: z.string().trim().min(10).max(5_000), evaluateAfter: z.coerce.date(), evidenceExpected: z.boolean(),
      template: z.object({ type: z.enum(evaluationTemplates), params: z.object({
        pieces: z.number().int().min(1).max(1_000).optional(),
        nftContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => value.toLowerCase()).optional(),
        chainId: z.number().int().positive().optional(),
        holdDays: z.number().int().min(1).max(3_650).optional()
      }).strict() }).strict().optional() }).strict().parse(request.body);
    if (input.template?.type === "NFT_HOLD") {
      const { nftContract, chainId } = input.template.params;
      if (!nftContract || !chainId) throw new ServiceError("NFT_CHECK_INCOMPLETE", "Give the NFT contract address and its chain.", 400);
      if (!configuredEvaluationChains(app.env).includes(chainId)) throw new ServiceError("NFT_CHAIN_UNAVAILABLE", "TAKE has no RPC for that chain yet. Pick a listed chain.", 400);
    }
    return reply.code(201).send(await signal.lockPlan(campaignId, request.takeIdentity.takeIdentityId, input));
  });
  // Chains TAKE can read for the automatic NFT check.
  app.get("/evaluation-chains", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=300");
    return { chainIds: configuredEvaluationChains(app.env) };
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
