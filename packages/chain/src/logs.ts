import type { Address, PublicClient } from "viem";
import { takeCampaignManagerEvents } from "./takeCampaignManagerAbi.js";

export async function getTakeCampaignManagerLogs(
  client: PublicClient,
  address: Address,
  fromBlock: bigint,
  toBlock: bigint
) {
  // One topic-OR request preserves the full event set and range ordering while
  // avoiding a separate RPC round trip for every manager event signature.
  const logs = await client.getLogs({
    address,
    events: Object.values(takeCampaignManagerEvents),
    fromBlock,
    toBlock
  });

  return logs.map((log) => ({ eventName: log.eventName, log })).sort((a, b) => {
    if (a.log.blockNumber === b.log.blockNumber) {
      return Number(a.log.logIndex - b.log.logIndex);
    }
    return a.log.blockNumber < b.log.blockNumber ? -1 : 1;
  });
}
