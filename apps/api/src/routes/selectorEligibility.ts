import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { selectorEligibilityPolicySchema } from "@take/mechanism";
import { SelectorEligibilityService } from "../services/selectorEligibility.js";
import { assertTakeOperator } from "../services/authorization.js";

const uuid = z.string().uuid();
const evidenceSchema = z.object({
  type: z.enum(["GITHUB_OR_PROJECT", "PORTFOLIO", "COMMUNITY_CONTRIBUTION", "WALLET_CONTEXT", "SOCIAL_CONTEXT", "OTHER_URL"]),
  url: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Evidence URL must use HTTP or HTTPS"),
  label: z.string().trim().min(1).max(120).optional()
});

export const selectorEligibilityRoutes: FastifyPluginAsync = async (app) => {
  const eligibility = new SelectorEligibilityService(app.db, app.env);

  if (app.env.NODE_ENV === "development" && app.env.ENABLE_DEV_FIXTURES) {
    app.post("/dev/selector-eligibility/fixtures", async (request, reply) => {
      if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
      return reply.code(201).send(await eligibility.createDevelopmentFixtures());
    });
    app.post<{ Params: { id: string } }>("/dev/campaigns/:id/selector-eligibility/scenarios", async (request, reply) => {
      if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
      return eligibility.applyDevelopmentScenarios(request.params.id, request.takeIdentity.takeIdentityId);
    });
  }

  app.get<{
    Params: { id: string };
    Querystring: { candidateAllowlistId?: string; cutoffAt?: string; guildId?: string; requiredDiscordRoleId?: string };
  }>("/campaigns/:id/selector-eligibility/presets", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const query = z.object({
      candidateAllowlistId: uuid,
      cutoffAt: z.string().datetime({ offset: true }),
      guildId: z.string().regex(/^\d{1,20}$/).optional(),
      requiredDiscordRoleId: z.string().regex(/^\d{1,20}$/).optional()
    }).parse(request.query);
    return eligibility.presets({ campaignId: request.params.id, ...query });
  });

  app.get<{ Params: { id: string } }>("/campaigns/:id/selector-eligibility", async (request) =>
    eligibility.get(request.params.id, request.takeIdentity?.takeIdentityId)
  );

  app.put<{ Params: { id: string } }>("/campaigns/:id/selector-eligibility", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const policy = selectorEligibilityPolicySchema.parse(request.body);
    return eligibility.saveDraft(request.params.id, request.takeIdentity.takeIdentityId, policy);
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/selector-eligibility/evaluate", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return eligibility.evaluate(request.params.id, request.takeIdentity.takeIdentityId);
  });

  app.get<{ Params: { id: string } }>("/campaigns/:id/selector-eligibility/assessments", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return eligibility.listAssessments(request.params.id, request.takeIdentity.takeIdentityId);
  });

  app.get<{ Params: { id: string } }>("/campaigns/:id/selector-eligibility/me", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return eligibility.getMyAssessment(request.params.id, request.takeIdentity.takeIdentityId);
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/selector-eligibility/submissions", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = z.object({
      submissionType: z.enum(["ELIGIBILITY_APPEAL", "NEWCOMER_APPLICATION", "INTEGRITY_CLARIFICATION"]),
      targetRuleId: z.string().trim().min(1).max(96).optional(),
      explanation: z.string().trim().min(1).max(2_000),
      evidence: z.array(evidenceSchema).max(8).default([])
    }).parse(request.body);
    return reply.code(201).send(await eligibility.submit({
      campaignId: request.params.id,
      actorIdentityId: request.takeIdentity.takeIdentityId,
      ...body
    }));
  });

  app.get<{ Params: { id: string } }>("/campaigns/:id/selector-eligibility/reviews", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return eligibility.listReviews(request.params.id, request.takeIdentity.takeIdentityId);
  });

  app.post<{ Params: { id: string; caseId: string } }>(
    "/campaigns/:id/selector-eligibility/reviews/:caseId/decision",
    async (request, reply) => {
      if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
      const body = z.object({
        decision: z.enum(["VERIFY_EVIDENCE", "REJECT_EVIDENCE", "REQUEST_MORE_INFO"]),
        reason: z.string().trim().min(1).max(1_000)
      }).parse(request.body);
      return eligibility.decide({
        campaignId: request.params.id,
        caseId: request.params.caseId,
        actorIdentityId: request.takeIdentity.takeIdentityId,
        ...body
      });
    }
  );

  app.post<{ Params: { id: string } }>("/campaigns/:id/selector-eligibility/integrity-observations", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = z.object({
      takeIdentityId: uuid,
      signalType: z.string().trim().min(1).max(96),
      evidenceFamily: z.string().trim().min(1).max(64),
      strength: z.enum(["WEAK", "MODERATE", "STRONG"]),
      publicExplanation: z.string().trim().min(1).max(1_000),
      restrictedEvidence: z.record(z.string(), z.unknown()).optional()
    }).parse(request.body);
    return reply.code(201).send(await eligibility.importIntegrityObservation({
      campaignId: request.params.id,
      actorIdentityId: request.takeIdentity.takeIdentityId,
      ...body
    }));
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/selector-eligibility/lock", async (request, reply) => {
    const operator = assertTakeOperator(app.env, request.takeIdentity);
    return eligibility.lock(request.params.id, operator.takeIdentityId, true);
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/selector-eligibility/prepare-mechanism", async (request, reply) => {
    const operator = assertTakeOperator(app.env, request.takeIdentity);
    const body = z.object({
      recipientAllowlistId: uuid,
      selectorRecipientMode: z.enum(["OVERLAPPING", "DISJOINT_SELECTOR_RECIPIENT"])
    }).parse(request.body);
    return eligibility.prepareMechanism({
      campaignId: request.params.id,
      actorIdentityId: operator.takeIdentityId,
      operatorManaged: true,
      ...body
    });
  });
};
