import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { AutoFinalizer } from "../services/autoFinalizer.js";

/**
 * Scheduled job: keep the indexer fresh, then close / allocate / finalize ended
 * campaigns. Accepts Vercel Cron (GET, "Authorization: Bearer $CRON_SECRET") or
 * the internal API token (GitHub Actions or manual runs).
 */
export const cronRoutes: FastifyPluginAsync = async (app) => {
  const authorize = async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization ?? "";
    const supplied = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim()
      : (typeof request.headers["x-internal-token"] === "string" ? request.headers["x-internal-token"] : "");
    const accepted = [app.env.CRON_SECRET, app.env.INTERNAL_API_TOKEN].filter((value): value is string => Boolean(value));
    if (!accepted.length && app.env.NODE_ENV !== "production") return;
    if (!supplied || !accepted.some((token) => constantTimeEqual(supplied, token))) {
      return reply.code(401).send({ error: "Unauthorized", message: "Cron or internal API token is required" });
    }
  };

  const handler = async () => {
    const report = await new AutoFinalizer(app.db, app.env).run();
    for (const item of report.steps) {
      if (item.action !== "WAIT" || item.transactionHash) {
        app.log.info({ campaignId: item.campaignId, onchainCampaignId: item.onchainCampaignId, action: item.action,
          outcome: item.outcome, transactionHash: item.transactionHash }, "TAKE auto-finalizer step");
      }
    }
    return report;
  };

  app.get("/internal/cron/finalize", { preHandler: authorize }, handler);
  app.post("/internal/cron/finalize", { preHandler: authorize }, handler);
};

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
