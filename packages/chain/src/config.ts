import { z } from "zod";
import { monadMainnet, monadTestnet } from "./chains.js";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional()
);
const optionalAddress = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional()
);

export const chainEnvSchema = z.object({
  MONAD_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  MONAD_TESTNET_RPC_URL: optionalUrl,
  MONAD_MAINNET_RPC_URL: optionalUrl,
  TAKE_CAMPAIGN_MANAGER_ADDRESS: optionalAddress
});

export type ChainConfig = ReturnType<typeof loadChainConfig>;

export function loadChainConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = chainEnvSchema.parse(env);
  const chain = parsed.MONAD_NETWORK === "mainnet" ? monadMainnet : monadTestnet;
  const rpcUrl =
    parsed.MONAD_NETWORK === "mainnet"
      ? parsed.MONAD_MAINNET_RPC_URL
      : parsed.MONAD_TESTNET_RPC_URL;

  return {
    network: parsed.MONAD_NETWORK,
    chain,
    chainId: chain.id,
    rpcUrl,
    takeCampaignManagerAddress: parsed.TAKE_CAMPAIGN_MANAGER_ADDRESS
  };
}
