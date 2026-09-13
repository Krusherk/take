import { domainHash } from "./canonical.js";
import type { Hex } from "viem";

export const DRAND_EVMNET_CHAIN_HASH = "04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3";
export const DRAND_EVMNET_PUBLIC_KEY = "07e1d1d335df83fa98462005690372c643340060d205306a9aa8106b6bd0b3820557ec32c2ad488e4d4f6008f89a346f18492092ccc0d594610de2732c8b808f0095685ae3a85ba243747b1b2f426049010f6b73a0cf1d389351d5aaaa1047f6297d3a4f9749b33eb2d904c9d9ebf17224150ddd7abd7567a9bec6c74480ee0b";
export const DRAND_EVMNET_PERIOD_SECONDS = 3;
export const DRAND_EVMNET_GENESIS_TIME = 1_727_521_075;
export const DEFAULT_ALLOCATION_DELAY_SECONDS = 600;

export interface DrandChainInfo {
  hash: string;
  public_key: string;
  period: number;
  genesis_time: number;
  groupHash?: string;
  schemeID?: string;
}

export interface DrandBeacon {
  round: number;
  randomness: string;
  signature: string;
  previous_signature?: string;
}

export function drandRoundAtOrAfter(timestampSeconds: number, chain: Pick<DrandChainInfo, "genesis_time" | "period">): number {
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds < chain.genesis_time) {
    throw new RangeError("timestamp must be a safe integer at or after drand genesis");
  }
  if (!Number.isSafeInteger(chain.period) || chain.period <= 0) {
    throw new RangeError("drand period must be a positive safe integer");
  }
  return Math.ceil((timestampSeconds - chain.genesis_time) / chain.period) + 1;
}

export function committedDrandRound(endTime: string, chain: Pick<DrandChainInfo, "genesis_time" | "period">): {
  notBefore: string;
  round: number;
} {
  const endTimeMs = new Date(endTime).getTime();
  if (!Number.isFinite(endTimeMs)) throw new TypeError("Invalid campaign end time");
  const notBeforeMs = endTimeMs + DEFAULT_ALLOCATION_DELAY_SECONDS * 1_000;
  return {
    notBefore: new Date(notBeforeMs).toISOString(),
    round: drandRoundAtOrAfter(Math.ceil(notBeforeMs / 1_000), chain)
  };
}

export function deriveAllocationSeed(input: {
  chainId: number;
  managerAddress: string;
  onchainCampaignId: string;
  rulesHash: string;
  inputSnapshotHash: string;
  drandChainHash: string;
  drandRound: number;
  randomness: string;
}): Hex {
  return domainHash("TAKE_ALLOCATION_SEED_V1", {
    ...input,
    managerAddress: input.managerAddress.toLowerCase(),
    drandChainHash: input.drandChainHash.toLowerCase(),
    randomness: input.randomness.toLowerCase()
  });
}
