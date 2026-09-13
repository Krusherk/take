import { createPublicClient, http, type PublicClient } from "viem";
import { loadChainConfig, type ChainConfig } from "./config.js";

export function createMonadPublicClient(config: ChainConfig = loadChainConfig()): PublicClient {
  if (!config.rpcUrl) {
    throw new Error(`Missing RPC URL for Monad ${config.network}`);
  }

  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl)
  }) as PublicClient;
}

export async function checkRpcHealth(config: ChainConfig = loadChainConfig()) {
  const client = createMonadPublicClient(config);
  const blockNumber = await client.getBlockNumber();
  return {
    ok: true,
    chainId: config.chainId,
    blockNumber: blockNumber.toString()
  };
}
