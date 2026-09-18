import type { FastifyPluginAsync } from "fastify";
import { createCampaignSchema, prepareNominationSchema, submitNominationTransactionSchema } from "@take/shared";
import { CampaignService } from "../services/campaign.js";
import { NominationService } from "../services/nomination.js";
import { AllocationService } from "../services/allocation.js";
import { createMonadPublicClient, loadChainConfig } from "@take/chain";
import { assertTakeOperator, isTakeOperator } from "../services/authorization.js";

export const campaignRoutes: FastifyPluginAsync = async (app) => {
  const campaigns = new CampaignService(app.db);
  const nominations = new NominationService(app.db, app.env);
  const allocations = new AllocationService(app.db, app.env);

  app.get("/campaigns", async (request) =>
    campaigns.listCampaigns(
      request.takeIdentity?.takeIdentityId,
      app.env.NODE_ENV === "development" && app.env.ENABLE_DEV_FIXTURES
    )
  );

  app.get<{ Params: { id: string } }>("/campaigns/:id", async (request, reply) => {
    const campaign = await campaigns.getCampaignView(
      request.params.id,
      request.takeIdentity?.takeIdentityId,
      app.env.NODE_ENV === "development" && app.env.ENABLE_DEV_FIXTURES
    );
    if (!campaign) {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
    if (
      campaign.status === "DRAFT"
      && (
        !request.takeIdentity
        || (!isTakeOperator(app.env, request.takeIdentity)
          && !(await campaigns.canManageCampaign(request.params.id, request.takeIdentity.takeIdentityId)))
      )
    ) {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
    return campaign;
  });

  app.get<{ Params: { id: string } }>("/campaigns/:id/results", async (request, reply) => {
    const results = await allocations.getLatestResults(request.params.id);
    if (!results) {
      return reply.code(404).send({ error: "RESULTS_NOT_FOUND" });
    }
    return results;
  });

  app.post("/campaigns", async (request, reply) => {
    const operator = assertTakeOperator(app.env, request.takeIdentity);
    const input = createCampaignSchema.parse(request.body);
    const campaign = await campaigns.createDraft(input, operator.takeIdentityId);
    return reply.code(201).send(campaign);
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/publish/prepare", async (request, reply) => {
    const operator = assertTakeOperator(app.env, request.takeIdentity);
    if (!app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS) {
      return reply.code(503).send({ error: "CHAIN_NOT_CONFIGURED" });
    }
    const prepared = await campaigns.preparePublish(
      request.params.id,
      operator.takeIdentityId,
      app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS,
      app.env.MONAD_NETWORK === "mainnet" ? 143 : 10143
    );
    return reply.send(prepared);
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/close/prepare", async (request, reply) => {
    const operator = assertTakeOperator(app.env, request.takeIdentity);
    if (!app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS) {
      return reply.code(503).send({ error: "CHAIN_NOT_CONFIGURED" });
    }
    const prepared = await campaigns.prepareClose(
      request.params.id,
      operator.takeIdentityId,
      app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS,
      app.env.MONAD_NETWORK === "mainnet" ? 143 : 10143
    );
    return reply.send(prepared);
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/activate/prepare", async (request, reply) => {
    const operator = assertTakeOperator(app.env, request.takeIdentity);
    if (!app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS) return reply.code(503).send({ error: "CHAIN_NOT_CONFIGURED" });
    return campaigns.prepareActivate(
      request.params.id,
      operator.takeIdentityId,
      app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS,
      app.env.MONAD_NETWORK === "mainnet" ? 143 : 10143
    );
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/nominations/prepare", async (request, reply) => {
    if (!request.takeIdentity) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
    if (!app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS) {
      return reply.code(503).send({ error: "CHAIN_NOT_CONFIGURED" });
    }
    const input = prepareNominationSchema.parse(request.body);
    const prepared = await nominations.prepare(
      request.params.id,
      request.takeIdentity.takeIdentityId,
      request.takeIdentity.protocolIdentityKey,
      app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS,
      app.env.MONAD_NETWORK === "mainnet" ? 143 : 10143,
      input
    );
    return reply.code(201).send(prepared);
  });

  app.post<{ Params: { id: string; nominationId: string } }>(
    "/campaigns/:id/nominations/:nominationId/submit",
    async (request, reply) => {
      if (!request.takeIdentity) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }
      if (!app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS) {
        return reply.code(503).send({ error: "CHAIN_NOT_CONFIGURED" });
      }
      const input = submitNominationTransactionSchema.parse(request.body);
      const chainConfig = loadChainConfig({
        MONAD_NETWORK: app.env.MONAD_NETWORK,
        MONAD_TESTNET_RPC_URL: app.env.MONAD_TESTNET_RPC_URL,
        MONAD_MAINNET_RPC_URL: app.env.MONAD_MAINNET_RPC_URL,
        TAKE_CAMPAIGN_MANAGER_ADDRESS: app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS
      });
      const publicClient = createMonadPublicClient(chainConfig);
      const nomination = await nominations.recordSubmitted({
        campaignId: request.params.id,
        nominationId: request.params.nominationId,
        actorIdentityId: request.takeIdentity.takeIdentityId,
        transaction: input,
        chainId: chainConfig.chain.id,
        contractAddress: app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS,
        publicClient
      });
      const receipt = await publicClient
        .getTransactionReceipt({ hash: input.transactionHash as `0x${string}` })
        .catch(() => undefined);

      if (receipt?.status === "success") {
        return reply.send(await nominations.markChainConfirmed(nomination.id, receipt.blockNumber));
      }
      return reply.send(nomination);
    }
  );

  app.get<{ Params: { id: string; nominationId: string } }>(
    "/campaigns/:id/nominations/:nominationId",
    async (request, reply) => {
      if (!request.takeIdentity) return reply.code(401).send({ error: "UNAUTHORIZED" });
      return nominations.getStatus(
        request.params.id,
        request.params.nominationId,
        request.takeIdentity.takeIdentityId
      );
    }
  );

  app.post<{ Params: { id: string } }>(
    "/campaigns/:id/allocation-runs",
    async (request, reply) => {
      const operator = assertTakeOperator(app.env, request.takeIdentity);
      const run = await allocations.run(
        request.params.id,
        operator.takeIdentityId
      );
      return reply.code(201).send(run);
    }
  );

  app.post<{ Params: { id: string; runId: string } }>(
    "/campaigns/:id/allocation-runs/:runId/finalize/prepare",
    async (request, reply) => {
      const operator = assertTakeOperator(app.env, request.takeIdentity);
      return allocations.prepareFinalize(
        request.params.id,
        request.params.runId,
        operator.takeIdentityId
      );
    }
  );
};
