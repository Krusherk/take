import type { FastifyPluginAsync } from "fastify";
import { checkRpcHealth, loadChainConfig } from "@take/chain";
import { sql } from "drizzle-orm";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    const dbStartedAt = Date.now();
    await app.db.execute(sql`select 1`);

    const chainConfig = loadChainConfig({
      MONAD_NETWORK: app.env.MONAD_NETWORK,
      MONAD_TESTNET_RPC_URL: app.env.MONAD_TESTNET_RPC_URL,
      MONAD_MAINNET_RPC_URL: app.env.MONAD_MAINNET_RPC_URL,
      TAKE_CAMPAIGN_MANAGER_ADDRESS: app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS
    });
    const rpc =
      chainConfig.rpcUrl && app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS
        ? await checkRpcHealth(chainConfig).catch((error: unknown) => ({
            ok: false,
            error: error instanceof Error ? error.message : "unknown rpc error"
          }))
        : { ok: false, skipped: "Monad RPC URL or contract address not configured" };

    return {
      ok: true,
      api: { ok: true },
      database: { ok: true, latencyMs: Date.now() - dbStartedAt },
      monad: rpc,
      indexer: {
        ok: true,
        mode: "quicknode_rpc",
        confirmations: app.env.CHAIN_INDEXER_CONFIRMATIONS,
        maxBlockRange: app.env.CHAIN_INDEXER_MAX_BLOCK_RANGE
      }
    };
  });
};
