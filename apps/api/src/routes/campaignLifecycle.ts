import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { assertTakeOperator } from "../services/authorization.js";
import { CampaignLifecycleService } from "../services/campaignLifecycle.js";
import { AutoFinalizer } from "../services/autoFinalizer.js";
import { ServerWallet } from "../services/serverWallet.js";
import { ServiceError, notFound } from "../services/errors.js";
import { eq } from "drizzle-orm";
import { schema } from "@take/database";

const actionSchema = z.enum(["PUBLISH", "ACTIVATE", "CLOSE", "FINALIZE"]);

export const campaignLifecycleRoutes: FastifyPluginAsync = async (app) => {
  const lifecycle = new CampaignLifecycleService(app.db, app.env);

  app.post<{ Params: { id: string } }>("/operator/campaigns/:id/approve-launch", async (request) => {
    const operator = assertTakeOperator(app.env, request.takeIdentity);
    return lifecycle.approveLaunch(request.params.id, operator.takeIdentityId);
  });

  app.post<{ Params: { id: string; action: string } }>(
    "/operator/campaigns/:id/lifecycle/:action/prepare",
    async (request) => {
      const operator = assertTakeOperator(app.env, request.takeIdentity);
      const action = actionSchema.parse(request.params.action.toUpperCase());
      const body = z.object({ allocationRunId: z.string().uuid().optional() }).parse(request.body ?? {});
      return lifecycle.prepare({
        campaignId: request.params.id,
        action,
        operatorIdentityId: operator.takeIdentityId,
        operatorWalletAddress: operator.primaryWalletAddress,
        allocationRunId: body.allocationRunId
      });
    }
  );

  app.post<{ Params: { id: string; intentId: string } }>(
    "/operator/campaigns/:id/lifecycle-intents/:intentId/submit",
    async (request) => {
      const operator = assertTakeOperator(app.env, request.takeIdentity);
      const body = z.object({
        transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
        fromAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/)
      }).parse(request.body);
      return lifecycle.submit({
        campaignId: request.params.id,
        intentId: request.params.intentId,
        operatorIdentityId: operator.takeIdentityId,
        transactionHash: body.transactionHash as `0x${string}`,
        fromAddress: body.fromAddress
      });
    }
  );

  // The TAKE server wallet can publish and open a campaign, which makes it the
  // onchain organizer, so the scheduled finalizer can commit its result later.
  app.get("/operator/server-wallet", async (request) => {
    assertTakeOperator(app.env, request.takeIdentity);
    const wallet = ServerWallet.fromEnv(app.env);
    if (!wallet) return { configured: false, address: null, balanceWei: null };
    const balanceWei = await wallet.balance().then(String).catch(() => null);
    return { configured: true, address: wallet.address, balanceWei };
  });

  app.post<{ Params: { id: string; action: string } }>(
    "/operator/campaigns/:id/lifecycle/:action/server-sign",
    async (request) => {
      const operator = assertTakeOperator(app.env, request.takeIdentity);
      const action = z.enum(["PUBLISH", "ACTIVATE"]).parse(request.params.action.toUpperCase());
      if (!app.env.FINALIZER_PRIVATE_KEY) {
        throw new ServiceError("SERVER_WALLET_NOT_CONFIGURED", "The TAKE server wallet is not configured", 503);
      }
      const [campaign] = await app.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, request.params.id)).limit(1);
      if (!campaign) notFound("Campaign not found");
      const result = await new AutoFinalizer(app.db, app.env).serverAction(campaign, action, operator.takeIdentityId);
      if (result.action === "SKIP" || result.action === "ERROR") {
        throw new ServiceError(result.outcome, result.detail ?? "The server wallet could not sign this action", 409);
      }
      return result;
    }
  );

  app.get<{ Params: { id: string } }>("/operator/campaigns/:id/lifecycle-intents", async (request) => {
    assertTakeOperator(app.env, request.takeIdentity);
    return lifecycle.getCampaignIntents(request.params.id);
  });
};
