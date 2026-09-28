import type { FastifyPluginAsync } from "fastify";
import { checkRpcHealth, loadChainConfig } from "@take/chain";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@take/database";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    const dbStartedAt = Date.now();
    await app.db.execute(sql`select 1`);
    const databaseLatencyMs = Date.now() - dbStartedAt;

    const chainConfig = loadChainConfig({
      MONAD_NETWORK: app.env.MONAD_NETWORK,
      MONAD_TESTNET_RPC_URL: app.env.MONAD_TESTNET_RPC_URL,
      MONAD_MAINNET_RPC_URL: app.env.MONAD_MAINNET_RPC_URL,
      TAKE_CAMPAIGN_MANAGER_ADDRESS: app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS
    });
    const rpc =
      chainConfig.rpcUrl && app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS
        ? await checkRpcHealth(chainConfig).catch(() => ({
            ok: false,
            // Provider errors can contain the credential-bearing RPC URL.
            error: "Monad RPC health check failed"
          }))
        : { ok: false, skipped: "Monad RPC URL or contract address not configured" };

    const [cursor] = app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS
      ? await app.db.select().from(schema.chainIndexerCursors).where(and(
          eq(schema.chainIndexerCursors.chainId, chainConfig.chainId),
          eq(schema.chainIndexerCursors.contractAddress, app.env.TAKE_CAMPAIGN_MANAGER_ADDRESS.toLowerCase())
        )).limit(1) : [];
    const head = "blockNumber" in rpc ? BigInt(rpc.blockNumber) : null;
    const lag = head !== null && cursor
      ? (head > cursor.lastFinalizedBlock ? head - cursor.lastFinalizedBlock : 0n) : null;
    const fresh = lag !== null && lag <= BigInt(app.env.CHAIN_INDEXER_CONFIRMATIONS + app.env.CHAIN_INDEXER_MAX_BLOCK_RANGE)
      && Boolean(cursor && Date.now() - cursor.updatedAt.getTime() < 120_000);
    return {
      ok: true,
      api: { ok: true },
      database: { ok: true, latencyMs: databaseLatencyMs },
      monad: rpc,
      indexer: {
        ok: fresh,
        mode: "bounded_rpc_with_receipt_fast_path",
        chainHead: head?.toString() ?? null,
        cursor: cursor?.lastFinalizedBlock.toString() ?? null,
        lagBlocks: lag?.toString() ?? null,
        lastSuccessfulSync: cursor?.updatedAt.toISOString() ?? null,
        fresh,
        confirmations: app.env.CHAIN_INDEXER_CONFIRMATIONS,
        maxBlockRange: app.env.CHAIN_INDEXER_MAX_BLOCK_RANGE
      }
    };
  });
};
