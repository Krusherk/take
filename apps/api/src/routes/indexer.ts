import type { FastifyPluginAsync } from "fastify";
import { QuickNodeIndexer } from "../workers/quicknodeIndexer.js";
import { z } from "zod";

export const indexerRoutes: FastifyPluginAsync = async (app) => {
  app.post("/internal/indexer/run-once", { preHandler: app.requireInternalAuth }, async () => {
    const indexer = new QuickNodeIndexer(app.db, app.env);
    return indexer.runOnce();
  });

  app.post<{ Body: { maxIterations?: number } }>(
    "/internal/indexer/catch-up",
    { preHandler: app.requireInternalAuth },
    async (request) => {
      const indexer = new QuickNodeIndexer(app.db, app.env);
      const input = z.object({ maxIterations: z.number().int().min(1).max(100).optional() }).parse(request.body ?? {});
      return indexer.runUntilCaughtUp(input.maxIterations, 35_000);
    }
  );
};
