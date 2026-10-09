import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { AutoFinalizer, safeErrorCode, type FinalizerReport } from "../services/autoFinalizer.js";

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

  // Schedulers send POSTs with whatever body and content type they like (cron-job.org
  // sends form-encoded or empty bodies). The job takes no input, so accept any body
  // rather than failing in the content-type parser before authorization runs.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 64 * 1024 }, (_request, _body, done) => done(null, undefined));

  const handler = async (): Promise<FinalizerReport & { ok: boolean }> => {
    let report: FinalizerReport;
    try {
      report = await new AutoFinalizer(app.db, app.env).run();
    } catch (error) {
      // Once authorized, the job always answers 200 with what went wrong, so the
      // scheduler keeps calling and the body says why.
      app.log.error({ code: safeErrorCode(error) }, "TAKE auto-finalizer run failed");
      return { ok: false, serverWallet: null, indexer: null, steps: [], errors: [{ stage: "run", code: safeErrorCode(error) }], durationMs: 0 };
    }
    for (const item of report.steps) {
      if (item.action !== "WAIT" || item.transactionHash) {
        app.log.info({ campaignId: item.campaignId, onchainCampaignId: item.onchainCampaignId, action: item.action,
          outcome: item.outcome, transactionHash: item.transactionHash }, "TAKE auto-finalizer step");
      }
    }
    const errors = [...(report.errors ?? [])];
    for (const [stage, value] of [["indexer", report.indexer], ["signups", report.signups]] as const) {
      if (value && typeof value === "object" && "error" in value) errors.push({ stage, code: String((value as { error: unknown }).error) });
    }
    return { ...report, ok: errors.length === 0 && !report.steps.some((item) => item.action === "ERROR"), errors };
  };

  app.get("/internal/cron/finalize", { preHandler: authorize }, handler);
  app.post("/internal/cron/finalize", { preHandler: authorize }, handler);
};

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
