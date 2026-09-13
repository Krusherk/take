import type { Address, PublicClient } from "viem";
import { takeCampaignManagerEvents } from "./takeCampaignManagerAbi.js";

export async function getTakeCampaignManagerLogs(
  client: PublicClient,
  address: Address,
  fromBlock: bigint,
  toBlock: bigint
) {
  const entries = await Promise.all(
    Object.entries(takeCampaignManagerEvents).map(async ([eventName, event]) => {
      const logs = await client.getLogs({
        address,
        event,
        fromBlock,
        toBlock
      });
      return logs.map((log) => ({ eventName, log }));
    })
  );

  return entries.flat().sort((a, b) => {
    if (a.log.blockNumber === b.log.blockNumber) {
      return Number(a.log.logIndex - b.log.logIndex);
    }
    return a.log.blockNumber < b.log.blockNumber ? -1 : 1;
  });
}
