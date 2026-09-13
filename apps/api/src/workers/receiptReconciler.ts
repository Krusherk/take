import { and, eq, inArray } from "drizzle-orm";
import { createMonadPublicClient, loadChainConfig } from "@take/chain";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import type { ApiEnv } from "../config/env.js";

export class ReceiptReconciler {
  constructor(
    private readonly db: Database,
    private readonly env: ApiEnv
  ) {}

  async runOnce(limit = 25) {
    const chainConfig = loadChainConfig({
      MONAD_NETWORK: this.env.MONAD_NETWORK,
      MONAD_TESTNET_RPC_URL: this.env.MONAD_TESTNET_RPC_URL,
      MONAD_MAINNET_RPC_URL: this.env.MONAD_MAINNET_RPC_URL,
      TAKE_CAMPAIGN_MANAGER_ADDRESS: this.env.TAKE_CAMPAIGN_MANAGER_ADDRESS
    });
    const client = createMonadPublicClient(chainConfig);

    const pending = await this.db
      .select()
      .from(schema.chainTransactions)
      .where(inArray(schema.chainTransactions.status, ["SUBMITTED", "CHAIN_CONFIRMED", "INDEXING_DELAYED"]))
      .limit(limit);

    let checked = 0;
    let confirmed = 0;
    let failed = 0;
    let stillPending = 0;

    for (const tx of pending) {
      checked += 1;
      const receipt = await client
        .getTransactionReceipt({ hash: tx.transactionHash as `0x${string}` })
        .catch(() => undefined);

      if (!receipt) {
        stillPending += 1;
        continue;
      }

      if (receipt.status === "reverted") {
        failed += 1;
        await this.markFailed(tx.transactionHash, receipt.blockNumber);
        continue;
      }

      const indexed = await this.isIndexed(tx.chainId, tx.transactionHash);
      if (indexed) {
        confirmed += 1;
        await this.markConfirmed(tx.transactionHash, receipt.blockNumber);
      } else {
        stillPending += 1;
        await this.markIndexingDelayed(tx.transactionHash, receipt.blockNumber);
      }
    }

    return { checked, confirmed, failed, stillPending };
  }

  private async isIndexed(chainId: number, transactionHash: string) {
    const [event] = await this.db
      .select()
      .from(schema.chainEvents)
      .where(
        and(
          eq(schema.chainEvents.chainId, chainId),
          eq(schema.chainEvents.transactionHash, transactionHash)
        )
      )
      .limit(1);

    return Boolean(event);
  }

  private async markIndexingDelayed(transactionHash: string, blockNumber: bigint) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.chainTransactions)
        .set({
          status: "INDEXING_DELAYED",
          blockNumber,
          confirmedAt: new Date()
        })
        .where(eq(schema.chainTransactions.transactionHash, transactionHash));

      await tx
        .update(schema.nominations)
        .set({
          status: "INDEXING_DELAYED",
          blockNumber,
          confirmedAt: new Date()
        })
        .where(eq(schema.nominations.transactionHash, transactionHash));
    });
  }

  private async markConfirmed(transactionHash: string, blockNumber: bigint) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.chainTransactions)
        .set({
          status: "CONFIRMED",
          blockNumber,
          confirmedAt: new Date()
        })
        .where(eq(schema.chainTransactions.transactionHash, transactionHash));

      await tx
        .update(schema.nominations)
        .set({
          status: "CONFIRMED",
          blockNumber,
          confirmedAt: new Date()
        })
        .where(eq(schema.nominations.transactionHash, transactionHash));
    });
  }

  private async markFailed(transactionHash: string, blockNumber: bigint) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.chainTransactions)
        .set({
          status: "FAILED",
          blockNumber,
          confirmedAt: new Date()
        })
        .where(eq(schema.chainTransactions.transactionHash, transactionHash));

      await tx
        .update(schema.nominations)
        .set({
          status: "FAILED",
          blockNumber,
          confirmedAt: new Date(),
          failureReason: "Transaction reverted"
        })
        .where(eq(schema.nominations.transactionHash, transactionHash));
    });
  }
}
