import type { FastifyPluginAsync } from "fastify";
import { ReceiptReconciler } from "../workers/receiptReconciler.js";

export const reconciliationRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { limit?: number } }>(
    "/internal/reconciliation/run-once",
    { preHandler: app.requireInternalAuth },
    async (request) => {
      const reconciler = new ReceiptReconciler(app.db, app.env);
      return reconciler.runOnce(request.body?.limit);
    }
  );
};
