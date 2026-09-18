import type { FastifyPluginAsync } from "fastify";
import { SocialService } from "../services/social.js";

export const socialRoutes: FastifyPluginAsync = async (app) => {
  const social = new SocialService(app.db);

  app.get<{ Querystring: { query?: string; limit?: string; includeSelf?: string } }>("/people", async (request, reply) => {
    if (!request.takeIdentity) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const limit = Math.max(1, Math.min(Number(request.query.limit ?? 12), 100));
    return {
      people: await social.searchPeople(
        request.query.query ?? "",
        request.takeIdentity.takeIdentityId,
        Number.isFinite(limit) ? limit : 12,
        request.query.includeSelf === "true",
        app.env.NODE_ENV === "development" && app.env.ENABLE_DEV_FIXTURES
      )
    };
  });

  app.get("/me/history", async (request, reply) => {
    if (!request.takeIdentity) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    return social.getHistory(request.takeIdentity.takeIdentityId);
  });

  app.get<{ Params: { id: string } }>("/nominations/:id/story", async (request, reply) => {
    const story = await social.getNominationStory(request.params.id);
    if (!story) {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
    return story;
  });
};
