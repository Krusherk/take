import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { eligibilityAudienceSchema } from "@take/mechanism";
import { AllowlistService } from "../services/allowlist.js";
import { DiscordIntegrationService } from "../services/discordIntegration.js";
import { EligibilitySnapshotService } from "../services/eligibilitySnapshots.js";
import { MechanismService } from "../services/mechanism.js";
import { GraphService } from "../services/graph.js";
import { RandomnessService } from "../services/randomness.js";
import { ReviewService } from "../services/review.js";
import { OrganizationService } from "../services/organization.js";
import { ExperimentService } from "../services/experiment.js";

const uuid = z.string().uuid();
const allowlistMemberSchema = z.union([
  z.object({ takeIdentityId: uuid }).strict(),
  z.object({ externalIdentityId: uuid }).strict(),
  z.object({ subjectKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict()
]);

export const mechanismRoutes: FastifyPluginAsync = async (app) => {
  const mechanisms = new MechanismService(app.db);
  const snapshots = new EligibilitySnapshotService(app.db, app.env);
  const allowlists = new AllowlistService(app.db);
  const discord = new DiscordIntegrationService(app.db, app.env);
  const graph = new GraphService(app.db);
  const randomness = new RandomnessService(app.db, app.env);
  const reviews = new ReviewService(app.db);
  const organizations = new OrganizationService(app.db);
  const experiments = new ExperimentService(app.db);

  app.get("/organizations/mine", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return organizations.listForIdentity(request.takeIdentity.takeIdentityId);
  });

  app.get<{ Params: { id: string } }>("/campaigns/:id/mechanism", async (request) =>
    mechanisms.getMechanism(request.params.id)
  );

  app.get<{ Params: { id: string } }>("/campaigns/:id/audit-artifact", async (request) =>
    mechanisms.getAuditArtifact(request.params.id)
  );

  app.get<{ Params: { id: string } }>("/campaigns/:id/experiment-v0", async (request, reply) => {
    const experiment = await experiments.getPublic(request.params.id);
    return experiment ?? reply.code(404).send({ error: "EXPERIMENT_NOT_FOUND" });
  });

  app.put<{ Params: { id: string } }>("/campaigns/:id/experiment-v0", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return experiments.createDraft(request.params.id, request.takeIdentity.takeIdentityId, request.body);
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/experiment-v0/lock", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return experiments.lock(request.params.id, request.takeIdentity.takeIdentityId);
  });

  app.get<{ Params: { id: string }; Querystring: { query?: string } }>(
    "/campaigns/:id/recipients",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
      return experiments.listRecipients(
        request.params.id,
        request.takeIdentity.takeIdentityId,
        request.query.query ?? ""
      );
    }
  );

  app.post<{ Params: { id: string } }>(
    "/internal/campaigns/:id/experiment-observations",
    { preHandler: app.requireInternalAuth },
    async (request) => experiments.replaceInternalObservations(request.params.id, request.body)
  );

  app.get<{ Params: { id: string } }>("/campaigns/:id/eligibility/me", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return snapshots.getMyEligibility(request.params.id, request.takeIdentity.takeIdentityId);
  });

  app.get<{
    Params: { id: string };
    Querystring: { audience?: string };
  }>(
    "/campaigns/:id/eligibility/proof",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
      const query = z.object({
        audience: eligibilityAudienceSchema
      }).parse(request.query);
      return snapshots.getProof({
        campaignId: request.params.id,
        audience: query.audience,
        takeIdentityId: request.takeIdentity.takeIdentityId
      });
    }
  );

  app.put<{ Params: { id: string } }>("/campaigns/:id/mechanism-draft", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return mechanisms.createDraft(request.params.id, request.takeIdentity.takeIdentityId, request.body);
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/evidence-snapshots", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return reply.code(201).send(
      await snapshots.createForCurrentDraft(request.params.id, request.takeIdentity.takeIdentityId)
    );
  });

  app.get<{ Params: { id: string; snapshotId: string } }>(
    "/campaigns/:id/evidence-snapshots/:snapshotId",
    async (request, reply) => {
      if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
      return snapshots.getSnapshot(
        request.params.id,
        request.params.snapshotId,
        request.takeIdentity.takeIdentityId
      );
    }
  );

  app.post<{ Params: { id: string } }>("/campaigns/:id/mechanism/lock", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return mechanisms.lock(request.params.id, request.takeIdentity.takeIdentityId);
  });

  app.get<{ Params: { id: string } }>("/campaigns/:id/graph-snapshot", async (request) =>
    graph.publicLatest(request.params.id)
  );

  app.post<{ Params: { id: string } }>(
    "/internal/campaigns/:id/graph/analyze",
    { preHandler: app.requireInternalAuth },
    async (request) => graph.analyzeCampaign(request.params.id)
  );

  app.post<{ Params: { id: string } }>(
    "/internal/campaigns/:id/randomness/retrieve",
    { preHandler: app.requireInternalAuth },
    async (request) => randomness.retrieveForCampaign(request.params.id)
  );

  app.post<{ Params: { id: string } }>("/campaigns/:id/evidence-refresh-requests", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = z.object({
      audience: eligibilityAudienceSchema,
      reason: z.string().trim().min(1).max(2_000)
    }).parse(request.body);
    return reply.code(201).send(await reviews.requestEvidenceRefresh({
      campaignId: request.params.id,
      actorIdentityId: request.takeIdentity.takeIdentityId,
      audience: body.audience,
      reason: body.reason
    }));
  });

  app.get<{ Params: { id: string } }>("/campaigns/:id/review-cases", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return reviews.list(request.params.id, request.takeIdentity.takeIdentityId);
  });

  app.get<{ Params: { id: string; caseId: string } }>(
    "/campaigns/:id/review-cases/:caseId",
    async (request, reply) => {
      if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
      return reviews.detail(request.params.id, request.params.caseId, request.takeIdentity.takeIdentityId);
    }
  );

  app.post<{ Params: { id: string; caseId: string } }>(
    "/campaigns/:id/review-cases/:caseId/decisions",
    async (request, reply) => {
      if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
      const body = z.object({
        decision: z.enum(["CONFIRMED_MANIPULATION", "DISMISSED"]),
        reasonCode: z.string().trim().min(1).max(96),
        publicExplanation: z.string().trim().min(1).max(2_000),
        restrictedEvidence: z.record(z.string(), z.unknown()).optional()
      }).parse(request.body);
      return reply.code(201).send(await reviews.decide({
        campaignId: request.params.id,
        caseId: request.params.caseId,
        actorIdentityId: request.takeIdentity.takeIdentityId,
        ...body
      }));
    }
  );

  app.get<{ Params: { id: string } }>("/organizations/:id/identity-allowlists", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return allowlists.list(request.params.id, request.takeIdentity.takeIdentityId);
  });

  app.post<{ Params: { id: string } }>("/organizations/:id/identity-allowlists", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = z.object({ name: z.string().trim().min(1).max(160) }).parse(request.body);
    return reply.code(201).send(
      await allowlists.create(request.params.id, request.takeIdentity.takeIdentityId, body.name)
    );
  });

  app.post<{ Params: { id: string } }>("/identity-allowlists/:id/members", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = allowlistMemberSchema.parse(request.body);
    return reply.code(201).send(
      await allowlists.addMember(request.params.id, request.takeIdentity.takeIdentityId, body)
    );
  });

  app.post<{ Params: { id: string } }>("/identity-allowlists/:id/lock", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return allowlists.lock(request.params.id, request.takeIdentity.takeIdentityId);
  });

  app.get<{ Params: { id: string } }>("/organizations/:id/integrations/discord", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return discord.list(request.params.id, request.takeIdentity.takeIdentityId);
  });

  app.post<{ Params: { id: string } }>("/organizations/:id/integrations/discord/install", async (request, reply) => {
    if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const body = z.object({ guildId: z.string().regex(/^\d{1,20}$/).optional() }).parse(request.body ?? {});
    return body.guildId
      ? discord.confirmInstall(request.params.id, request.takeIdentity.takeIdentityId, body.guildId)
      : discord.beginInstall(request.params.id, request.takeIdentity.takeIdentityId);
  });

  app.get<{
    Querystring: { code?: string; state?: string; guild_id?: string; error?: string };
  }>("/integrations/discord/callback", async (request, reply) => {
    const query = z.object({
      code: z.string().min(1).optional(),
      state: z.string().min(1).optional(),
      guild_id: z.string().regex(/^\d{1,20}$/).optional(),
      error: z.string().optional()
    }).parse(request.query);
    if (query.error) {
      return reply.code(400).send({ error: "DISCORD_INSTALL_REJECTED", message: query.error });
    }
    if (!query.code || !query.state || !query.guild_id) {
      return reply.code(400).send({
        error: "DISCORD_INSTALL_CALLBACK_INVALID",
        message: "Discord did not return the required installation parameters"
      });
    }
    const integration = await discord.completeInstall(query.state, query.guild_id);
    const origin = app.env.WEB_ORIGIN ?? (app.env.NODE_ENV === "development" ? "http://localhost:5173" : undefined);
    if (!origin) return integration;
    const destination = new URL("/organize", origin);
    destination.searchParams.set("discord", "connected");
    destination.searchParams.set("guild", integration.guildId);
    return reply.redirect(destination.toString());
  });
};
