import type { FastifyPluginAsync } from "fastify";
import {
  buildRegisterIdentityCall,
  createMonadPublicClient,
  loadChainConfig,
  takeCampaignManagerAbi
} from "@take/chain";
import type { Address, Hex } from "viem";

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me", async (request, reply) => {
    if (!request.takeIdentity) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Missing or invalid Privy access token."
      });
    }

    return app.identityService.getMe(request.takeIdentity.takeIdentityId);
  });

  app.post("/me/registration/prepare", async (request, reply) => {
    if (!request.takeIdentity) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
    if (!app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS) {
      return reply.code(503).send({ error: "CHAIN_NOT_CONFIGURED" });
    }
    if (!request.takeIdentity.primaryWalletAddress) {
      return reply.code(409).send({
        error: "WALLET_REQUIRED",
        message: "A connected EVM wallet is required to join TAKE."
      });
    }

    const chainConfig = loadChainConfig({
      MONAD_NETWORK: app.env.MONAD_NETWORK,
      MONAD_TESTNET_RPC_URL: app.env.MONAD_TESTNET_RPC_URL,
      MONAD_MAINNET_RPC_URL: app.env.MONAD_MAINNET_RPC_URL,
      TAKE_CAMPAIGN_MANAGER_ADDRESS: app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS
    });
    const client = createMonadPublicClient(chainConfig);
    const contractAddress = app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS as Address;
    const protocolIdentityKey = request.takeIdentity.protocolIdentityKey as Hex;
    const walletAddress = request.takeIdentity.primaryWalletAddress as Address;
    const [registered, walletAuthorized] = await Promise.all([
      client.readContract({
        address: contractAddress,
        abi: takeCampaignManagerAbi,
        functionName: "registeredProtocolIdentities",
        args: [protocolIdentityKey]
      }) as Promise<boolean>,
      client.readContract({
        address: contractAddress,
        abi: takeCampaignManagerAbi,
        functionName: "authorizedWallets",
        args: [protocolIdentityKey, walletAddress]
      }) as Promise<boolean>
    ]);

    return {
      registered,
      walletAuthorized,
      transaction:
        registered && walletAuthorized
          ? null
          : buildRegisterIdentityCall({
              contractAddress,
              chainId: chainConfig.chainId,
              protocolIdentityKey
            })
    };
  });
};
