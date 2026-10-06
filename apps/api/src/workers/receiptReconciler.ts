import { and, eq, inArray } from "drizzle-orm";
import { createMonadPublicClient, loadChainConfig } from "@take/chain";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import type { ApiEnv } from "../config/env.js";
import { QuickNodeIndexer } from "./quicknodeIndexer.js";
import type { Hex } from "viem";

export class ReceiptReconciler {
  constructor(
    private readonly db: Database,
    private readonly env: ApiEnv
  ) {}

  async runOnce(limit = 25, transactionHash?: string) {
    const deadline = Date.now() + 30_000;
    const chainConfig = loadChainConfig({
      MONAD_NETWORK: this.env.MONAD_NETWORK,
      MONAD_TESTNET_RPC_URL: this.env.MONAD_TESTNET_RPC_URL,
      MONAD_MAINNET_RPC_URL: this.env.MONAD_MAINNET_RPC_URL,
      TAKE_CAMPAIGN_MANAGER_ADDRESS: this.env.TAKE_CAMPAIGN_MANAGER_ADDRESS
    });
    const client = createMonadPublicClient(chainConfig, { timeout: 15_000, retryCount: 0 });

    const pending = await this.db
      .select()
      .from(schema.chainTransactions)
      .where(transactionHash ? eq(schema.chainTransactions.transactionHash, transactionHash)
        : inArray(schema.chainTransactions.status, ["SUBMITTED", "CHAIN_CONFIRMED", "INDEXING_DELAYED"]))
      .limit(Math.max(1, Math.min(limit, 25)));

    let checked = 0;
    let confirmed = 0;
    let failed = 0;
    let stillPending = 0;

    for (const tx of pending) {
      if (Date.now() >= deadline) break;
      // Lifecycle intents have their own exact calldata/event reconciliation.
      if (tx.lifecycleIntentId || tx.chainId !== chainConfig.chainId) continue;
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

      const [nomination] = await this.db.select({
        nomination: schema.nominations,
        campaign: schema.campaigns,
        giverKey: schema.takeIdentities.protocolIdentityKey
      }).from(schema.nominations)
        .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.nominations.campaignId))
        .innerJoin(schema.takeIdentities, eq(schema.takeIdentities.id, schema.nominations.giverIdentityId))
        .where(eq(schema.nominations.transactionHash, tx.transactionHash)).limit(1);
      if (nomination?.campaign.onchainCampaignId && nomination.campaign.experimentId) {
        // Legacy non-experiment campaigns have an order-dependent reciprocity
        // rule and continue through sequential indexing. RAW@2 experiments do not.
        const n = nomination.nomination;
        const [recipient] = n.recipientTakeIdentityId
          ? await this.db.select({ key: schema.takeIdentities.protocolIdentityKey }).from(schema.takeIdentities)
              .where(eq(schema.takeIdentities.id, n.recipientTakeIdentityId)).limit(1)
          : n.recipientExternalIdentityId
            ? await this.db.select({ key: schema.externalIdentities.externalIdentityKey }).from(schema.externalIdentities)
                .where(eq(schema.externalIdentities.id, n.recipientExternalIdentityId)).limit(1) : [];
        if (recipient) await new QuickNodeIndexer(this.db, this.env).reconcileReceipt(tx.transactionHash as Hex, {
          eventName: "TakeGiven",
          args: {
            campaignId: nomination.campaign.onchainCampaignId.toString(),
            giverIdentityKey: nomination.giverKey,
            recipientIdentityKey: recipient.key
          }
        });
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
          eq(schema.chainEvents.transactionHash, transactionHash),
          eq(schema.chainEvents.contractAddress, this.env.TAKE_CAMPAIGN_MANAGER_ADDRESS!.toLowerCase()),
          eq(schema.chainEvents.eventName, "TakeGiven"),
          eq(schema.chainEvents.finalityStatus, "FINALIZED")
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
