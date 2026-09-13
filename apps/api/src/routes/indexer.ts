import type { FastifyPluginAsync } from "fastify";
import { QuickNodeIndexer } from "../workers/quicknodeIndexer.js";

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
      return indexer.runUntilCaughtUp(request.body?.maxIterations);
    }
  );
};
