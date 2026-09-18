import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { assertTakeOperator } from "../services/authorization.js";
import { CampaignLifecycleService } from "../services/campaignLifecycle.js";

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

  app.get<{ Params: { id: string } }>("/operator/campaigns/:id/lifecycle-intents", async (request) => {
    assertTakeOperator(app.env, request.takeIdentity);
    return lifecycle.getCampaignIntents(request.params.id);
  });
};
