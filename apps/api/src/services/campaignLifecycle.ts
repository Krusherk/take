import { and, eq } from "drizzle-orm";
import { decodeEventLog, type Address, type Hex } from "viem";
import { createMonadPublicClient, loadChainConfig, takeCampaignManagerAbi, buildFinalizeAllocationCall } from "@take/chain";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import type { ApiEnv } from "../config/env.js";
import { normalizeAddress } from "@take/shared";
import { CampaignService } from "./campaign.js";
import { ServiceError, notFound } from "./errors.js";

type LifecycleAction = "PUBLISH" | "ACTIVATE" | "CLOSE" | "FINALIZE";

export class CampaignLifecycleService {
  private readonly campaigns: CampaignService;

  constructor(private readonly db: Database, private readonly env: ApiEnv) {
    this.campaigns = new CampaignService(db);
  }

  async approveLaunch(campaignId: string, operatorIdentityId: string) {
    const campaign = await this.requireCampaign(campaignId);
    if (campaign.status !== "DRAFT") {
      throw new ServiceError("CAMPAIGN_NOT_DRAFT", "Only an offchain draft can be approved for launch", 409);
    }
    const [mechanism] = await this.db.select().from(schema.campaignMechanismConfigs).where(and(
      eq(schema.campaignMechanismConfigs.id, campaign.mechanismConfigId ?? "00000000-0000-0000-0000-000000000000"),
      eq(schema.campaignMechanismConfigs.status, "LOCKED")
    )).limit(1);
    if (!mechanism || !campaign.rulesHash) {
      throw new ServiceError("LOCKED_ARTIFACTS_REQUIRED", "Lock eligibility and campaign mechanism artifacts before launch approval", 409);
    }
    if (campaign.experimentId) {
      const [experiment] = await this.db.select({ status: schema.campaignExperiments.status })
        .from(schema.campaignExperiments).where(eq(schema.campaignExperiments.id, campaign.experimentId)).limit(1);
      if (experiment?.status !== "LOCKED") {
        throw new ServiceError("EXPERIMENT_NOT_LOCKED", "Lock the experiment protocol before launch approval", 409);
      }
    }
    const [updated] = await this.db.update(schema.campaigns).set({
      launchApprovedByIdentityId: operatorIdentityId,
      launchApprovedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(schema.campaigns.id, campaignId)).returning();
    return serializeCampaignAuthority(updated!);
  }

  async prepare(input: {
    campaignId: string;
    action: LifecycleAction;
    operatorIdentityId: string;
    operatorWalletAddress?: string;
    allocationRunId?: string;
  }) {
    const existing = await this.findIntent(input.campaignId, input.action);
    if (existing && existing.status !== "FAILED") return this.intentView(existing);

    const campaign = await this.requireCampaign(input.campaignId);
    const manager = this.env.TAKE_CAMPAIGN_MANAGER_ADDRESS;
    if (!manager) throw new ServiceError("CHAIN_NOT_CONFIGURED", "Monad campaign manager is not configured", 503);
    const chainId = this.env.MONAD_NETWORK === "mainnet" ? 143 : 10143;
    let prepared: { transaction: { to: Address; data: Hex; value: "0x0"; chainId: number } };
    let requiredFromAddress: string | null = null;
    let expectedRulesHash: string | null = null;
    let eventName: string;

    if (input.action === "PUBLISH") {
      if (!campaign.launchApprovedAt) throw new ServiceError("LAUNCH_NOT_APPROVED", "A TAKE operator must approve launch before publication", 409);
      if (!input.operatorWalletAddress) throw new ServiceError("OPERATOR_WALLET_REQUIRED", "The designated operator wallet is required", 409);
      prepared = await this.campaigns.preparePublish(input.campaignId, input.operatorIdentityId, manager, chainId, true);
      requiredFromAddress = normalizeAddress(input.operatorWalletAddress);
      expectedRulesHash = campaign.rulesHash;
      eventName = "CampaignCreated";
    } else if (input.action === "ACTIVATE") {
      prepared = await this.campaigns.prepareActivate(input.campaignId, input.operatorIdentityId, manager, chainId, true);
      eventName = "CampaignActivated";
    } else if (input.action === "CLOSE") {
      prepared = await this.campaigns.prepareClose(input.campaignId, input.operatorIdentityId, manager, chainId, true);
      if (new Date() < campaign.endTime) requiredFromAddress = campaign.onchainOperatorWalletAddress;
      eventName = "CampaignClosed";
    } else {
      if (!input.allocationRunId) throw new ServiceError("ALLOCATION_RUN_REQUIRED", "Choose the completed allocation run to finalize", 400);
      const [run] = await this.db.select().from(schema.allocationRuns).where(and(
        eq(schema.allocationRuns.id, input.allocationRunId),
        eq(schema.allocationRuns.campaignId, input.campaignId)
      )).limit(1);
      if (!run || run.status !== "COMPLETED" || !run.resultHash || !campaign.onchainCampaignId) {
        throw new ServiceError("ALLOCATION_NOT_READY", "A completed allocation artifact is required before finalization", 409);
      }
      prepared = { transaction: buildFinalizeAllocationCall({
        contractAddress: (campaign.managerContractAddress ?? manager) as Address,
        chainId: campaign.chainId ?? chainId,
        campaignId: campaign.onchainCampaignId,
        resultHash: run.resultHash as Hex
      }) };
      requiredFromAddress = campaign.onchainOperatorWalletAddress;
      eventName = "CampaignFinalized";
    }
    if ((input.action === "CLOSE" || input.action === "FINALIZE") && !requiredFromAddress && input.action === "FINALIZE") {
      throw new ServiceError("CAMPAIGN_AUTHORITY_UNKNOWN", "The original campaign authority wallet has not been recorded", 409);
    }

    const intentValues = {
      campaignId: input.campaignId,
      action: input.action,
      status: "WAITING_FOR_WALLET",
      chainId: prepared.transaction.chainId,
      contractAddress: prepared.transaction.to.toLowerCase(),
      requiredFromAddress: requiredFromAddress?.toLowerCase() ?? null,
      expectedCalldata: prepared.transaction.data,
      expectedRulesHash,
      eventName,
      createdByIdentityId: input.operatorIdentityId,
      transactionHash: null,
      submittedAt: null,
      confirmedAt: null,
      indexedAt: null,
      eventLogIndex: null,
      eventBlockNumber: null,
      emittedOnchainCampaignId: null,
      emittedOrganizerAddress: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date()
    } as const;
    const [intent] = existing
      ? await this.db.update(schema.campaignLifecycleIntents).set(intentValues)
          .where(and(eq(schema.campaignLifecycleIntents.id, existing.id), eq(schema.campaignLifecycleIntents.status, "FAILED"))).returning()
      : await this.db.insert(schema.campaignLifecycleIntents).values(intentValues).onConflictDoNothing({
          target: [schema.campaignLifecycleIntents.campaignId, schema.campaignLifecycleIntents.action]
        }).returning();
    const record = intent ?? await this.findIntent(input.campaignId, input.action);
    if (!record) throw new Error("Failed to persist campaign lifecycle intent");
    return this.intentView(record);
  }

  async submit(input: {
    campaignId: string;
    intentId: string;
    operatorIdentityId: string;
    transactionHash: Hex;
    fromAddress: string;
  }) {
    const intent = await this.requireIntent(input.campaignId, input.intentId);
    if (intent.transactionHash) {
      if (intent.transactionHash.toLowerCase() !== input.transactionHash.toLowerCase()) {
        throw new ServiceError("LIFECYCLE_ALREADY_SUBMITTED", "This lifecycle action already has a submitted transaction", 409);
      }
      return this.reconcileIntent(intent.id);
    }
    const chain = this.chain();
    const transaction = await chain.client.getTransaction({ hash: input.transactionHash });
    const from = normalizeAddress(transaction.from);
    if (from !== normalizeAddress(input.fromAddress)) {
      throw new ServiceError("TRANSACTION_SENDER_MISMATCH", "The submitted wallet does not match the Monad transaction sender", 409);
    }
    if (intent.requiredFromAddress && from !== normalizeAddress(intent.requiredFromAddress)) {
      throw new ServiceError("CAMPAIGN_AUTHORITY_MISMATCH", `Use the campaign authority wallet ${intent.requiredFromAddress}`, 409);
    }
    if (!transaction.to || normalizeAddress(transaction.to) !== normalizeAddress(intent.contractAddress)) {
      throw new ServiceError("TRANSACTION_DESTINATION_MISMATCH", "Lifecycle transaction was not sent to the configured TAKE manager", 409);
    }
    if (transaction.input.toLowerCase() !== intent.expectedCalldata.toLowerCase()) {
      throw new ServiceError("TRANSACTION_CALLDATA_MISMATCH", "Lifecycle transaction does not match the prepared locked campaign action", 409);
    }
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.update(schema.campaignLifecycleIntents).set({
        transactionHash: input.transactionHash.toLowerCase(),
        status: "SUBMITTED",
        submittedAt: now,
        updatedAt: now
      }).where(eq(schema.campaignLifecycleIntents.id, intent.id));
      await tx.insert(schema.chainTransactions).values({
        chainId: intent.chainId,
        transactionHash: input.transactionHash.toLowerCase(),
        campaignId: input.campaignId,
        lifecycleIntentId: intent.id,
        action: intent.action,
        submittedByIdentityId: input.operatorIdentityId,
        fromAddress: from,
        toAddress: intent.contractAddress,
        status: "SUBMITTED"
      }).onConflictDoNothing({ target: schema.chainTransactions.transactionHash });
    });
    return this.reconcileIntent(intent.id);
  }

  async getCampaignIntents(campaignId: string) {
    const records = await this.db.select().from(schema.campaignLifecycleIntents)
      .where(eq(schema.campaignLifecycleIntents.campaignId, campaignId));
    return Promise.all(records.map(async (record) => this.intentView(
      ["SUBMITTED", "CONFIRMING", "INDEXING"].includes(record.status)
        ? await this.reconcileIntentRecord(record)
        : record
    )));
  }

  async reconcilePending(limit = 25) {
    const records = await this.db.select().from(schema.campaignLifecycleIntents)
      .where(and(
        // This SQL expression keeps the lifecycle worker independent of nomination reconciliation.
        eq(schema.campaignLifecycleIntents.chainId, this.chain().config.chain.id)
      )).limit(limit);
    let checked = 0;
    for (const record of records.filter((item) => ["SUBMITTED", "CONFIRMING", "INDEXING"].includes(item.status))) {
      checked += 1;
      await this.reconcileIntentRecord(record);
    }
    return { checked };
  }

  private async reconcileIntent(intentId: string) {
    const [intent] = await this.db.select().from(schema.campaignLifecycleIntents)
      .where(eq(schema.campaignLifecycleIntents.id, intentId)).limit(1);
    if (!intent) notFound("Lifecycle intent not found");
    return this.intentView(await this.reconcileIntentRecord(intent));
  }

  private async reconcileIntentRecord(intent: typeof schema.campaignLifecycleIntents.$inferSelect) {
    if (!intent.transactionHash || intent.status === "COMPLETED" || intent.status === "FAILED") return intent;
    const chain = this.chain();
    const hash = intent.transactionHash as Hex;
    const [transaction, receipt] = await Promise.all([
      chain.client.getTransaction({ hash }).catch(() => undefined),
      chain.client.getTransactionReceipt({ hash }).catch(() => undefined)
    ]);
    if (!transaction || !receipt) return intent;
    if (receipt.status === "reverted") return this.fail(intent.id, "TRANSACTION_REVERTED", "The Monad transaction reverted");
    try {
      this.assertTransaction(intent, transaction);
      const decoded = receipt.logs.flatMap((log) => {
        if (log.address.toLowerCase() !== intent.contractAddress.toLowerCase()) return [];
        try {
          const event = decodeEventLog({ abi: takeCampaignManagerAbi, data: log.data, topics: log.topics });
          return event.eventName === intent.eventName ? [{ event, log }] : [];
        } catch { return []; }
      });
      if (decoded.length !== 1) throw new ServiceError("EXPECTED_EVENT_MISSING", `Expected exactly one ${intent.eventName} event in the submitted receipt`, 409);
      const matched = decoded[0];
      if (!matched) throw new ServiceError("EXPECTED_EVENT_MISSING", `Expected ${intent.eventName} event was not decoded`, 409);
      const { event, log } = matched;
      const campaign = await this.requireCampaign(intent.campaignId);
      const args = event.args as unknown as Record<string, unknown>;
      const emittedCampaignId = BigInt(args.campaignId as bigint);
      if (intent.action === "PUBLISH") {
        const organizer = normalizeAddress(String(args.organizer));
        const rulesHash = String(args.rulesHash).toLowerCase();
        if (!intent.requiredFromAddress || organizer !== normalizeAddress(intent.requiredFromAddress)) {
          throw new ServiceError("EMITTED_ORGANIZER_MISMATCH", "CampaignCreated organizer does not match the designated authority wallet", 409);
        }
        if (!intent.expectedRulesHash || rulesHash !== intent.expectedRulesHash.toLowerCase()) {
          throw new ServiceError("EMITTED_RULES_MISMATCH", "CampaignCreated rulesHash does not match the locked offchain campaign", 409);
        }
        await this.db.update(schema.campaigns).set({
          onchainCampaignId: emittedCampaignId,
          chainId: intent.chainId,
          managerContractAddress: intent.contractAddress,
          onchainOrganizerAddress: organizer,
          onchainOperatorWalletAddress: organizer,
          status: "CREATED",
          updatedAt: new Date()
        }).where(eq(schema.campaigns.id, campaign.id));
      } else if (!campaign.onchainCampaignId || emittedCampaignId !== campaign.onchainCampaignId) {
        throw new ServiceError("EMITTED_CAMPAIGN_MISMATCH", "Lifecycle event belongs to another onchain campaign", 409);
      }
      const [indexed] = await this.db.select({ id: schema.chainEvents.id })
        .from(schema.chainEvents).where(and(
          eq(schema.chainEvents.chainId, intent.chainId),
          eq(schema.chainEvents.transactionHash, intent.transactionHash),
          eq(schema.chainEvents.logIndex, Number(log.logIndex)),
          eq(schema.chainEvents.finalityStatus, "FINALIZED")
        )).limit(1);
      const now = new Date();
      const [updated] = await this.db.update(schema.campaignLifecycleIntents).set({
        status: indexed ? "COMPLETED" : "INDEXING",
        eventLogIndex: Number(log.logIndex),
        eventBlockNumber: receipt.blockNumber,
        emittedOnchainCampaignId: emittedCampaignId,
        emittedOrganizerAddress: intent.action === "PUBLISH" ? String(args.organizer).toLowerCase() : intent.emittedOrganizerAddress,
        confirmedAt: now,
        indexedAt: indexed ? now : null,
        updatedAt: now
      }).where(eq(schema.campaignLifecycleIntents.id, intent.id)).returning();
      await this.db.update(schema.chainTransactions).set({
        status: indexed ? "CONFIRMED" : "INDEXING_DELAYED",
        blockNumber: receipt.blockNumber,
        confirmedAt: now
      }).where(eq(schema.chainTransactions.transactionHash, intent.transactionHash));
      return updated!;
    } catch (error) {
      const code = error instanceof ServiceError ? error.code : "LIFECYCLE_RECONCILIATION_FAILED";
      const message = error instanceof Error ? error.message : "Lifecycle reconciliation failed";
      return this.fail(intent.id, code, message);
    }
  }

  private assertTransaction(intent: typeof schema.campaignLifecycleIntents.$inferSelect, transaction: { from: Address; to: Address | null; input: Hex }) {
    if (!transaction.to || normalizeAddress(transaction.to) !== normalizeAddress(intent.contractAddress)) {
      throw new ServiceError("TRANSACTION_DESTINATION_MISMATCH", "Transaction destination does not match the TAKE manager", 409);
    }
    if (transaction.input.toLowerCase() !== intent.expectedCalldata.toLowerCase()) {
      throw new ServiceError("TRANSACTION_CALLDATA_MISMATCH", "Transaction calldata does not match the prepared action", 409);
    }
    if (intent.requiredFromAddress && normalizeAddress(transaction.from) !== normalizeAddress(intent.requiredFromAddress)) {
      throw new ServiceError("CAMPAIGN_AUTHORITY_MISMATCH", "Transaction sender is not the required campaign authority wallet", 409);
    }
  }

  private async fail(id: string, code: string, message: string) {
    const [updated] = await this.db.update(schema.campaignLifecycleIntents).set({
      status: "FAILED", errorCode: code, errorMessage: message, updatedAt: new Date()
    }).where(eq(schema.campaignLifecycleIntents.id, id)).returning();
    return updated!;
  }

  private chain() {
    const config = loadChainConfig({
      MONAD_NETWORK: this.env.MONAD_NETWORK,
      MONAD_TESTNET_RPC_URL: this.env.MONAD_TESTNET_RPC_URL,
      MONAD_MAINNET_RPC_URL: this.env.MONAD_MAINNET_RPC_URL,
      TAKE_CAMPAIGN_MANAGER_ADDRESS: this.env.TAKE_CAMPAIGN_MANAGER_ADDRESS
    });
    return { config, client: createMonadPublicClient(config) };
  }

  private async requireCampaign(id: string) {
    const campaign = await this.campaigns.getCampaign(id);
    if (!campaign) notFound("Campaign not found");
    return campaign;
  }

  private async findIntent(campaignId: string, action: LifecycleAction) {
    const [record] = await this.db.select().from(schema.campaignLifecycleIntents).where(and(
      eq(schema.campaignLifecycleIntents.campaignId, campaignId),
      eq(schema.campaignLifecycleIntents.action, action)
    )).limit(1);
    return record;
  }

  private async requireIntent(campaignId: string, id: string) {
    const [record] = await this.db.select().from(schema.campaignLifecycleIntents).where(and(
      eq(schema.campaignLifecycleIntents.id, id),
      eq(schema.campaignLifecycleIntents.campaignId, campaignId)
    )).limit(1);
    if (!record) notFound("Lifecycle intent not found");
    return record;
  }

  private intentView(record: typeof schema.campaignLifecycleIntents.$inferSelect) {
    return {
      id: record.id,
      campaignId: record.campaignId,
      action: record.action,
      status: record.status,
      requiredFromAddress: record.requiredFromAddress,
      transactionHash: record.transactionHash,
      onchainCampaignId: record.emittedOnchainCampaignId?.toString() ?? null,
      errorCode: record.errorCode,
      errorMessage: record.errorMessage,
      transaction: {
        to: record.contractAddress,
        data: record.expectedCalldata,
        value: "0x0",
        chainId: record.chainId
      }
    };
  }
}

function serializeCampaignAuthority(record: typeof schema.campaigns.$inferSelect) {
  return {
    campaignId: record.id,
    launchApprovedAt: record.launchApprovedAt?.toISOString() ?? null,
    onchainOperatorWalletAddress: record.onchainOperatorWalletAddress
  };
}
