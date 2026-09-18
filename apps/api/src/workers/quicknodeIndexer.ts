import { and, asc, eq, gt, inArray, lte, or } from "drizzle-orm";
import type { Address, Hex, PublicClient } from "viem";
import {
  createMonadPublicClient,
  getTakeCampaignManagerLogs,
  loadChainConfig,
  takeCampaignManagerAbi
} from "@take/chain";
import { normalizeAddress } from "@take/shared";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import type { ApiEnv } from "../config/env.js";

type TakeLog = Awaited<ReturnType<typeof getTakeCampaignManagerLogs>>[number];
type DbExecutor = Pick<Database, "insert" | "update" | "select">;
type BlockMetadata = { hash: Hex; timestamp: Date };
type RunOnceResult =
  | {
      scanned: number;
      backfilled: number;
      fromBlock: string;
      toBlock: string;
      caughtUp: boolean;
      reorgRewind?: string;
    }
  | { skipped: string };

const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;

export class QuickNodeIndexer {
  constructor(
    private readonly db: Database,
    private readonly env: ApiEnv
  ) {}

  async runOnce(): Promise<RunOnceResult> {
    const chainConfig = loadChainConfig({
      MONAD_NETWORK: this.env.MONAD_NETWORK,
      MONAD_TESTNET_RPC_URL: this.env.MONAD_TESTNET_RPC_URL,
      MONAD_MAINNET_RPC_URL: this.env.MONAD_MAINNET_RPC_URL,
      TAKE_CAMPAIGN_MANAGER_ADDRESS: this.env.TAKE_CAMPAIGN_MANAGER_ADDRESS
    });
    if (!chainConfig.takeCampaignManagerAddress) {
      return { skipped: "TAKE_CAMPAIGN_MANAGER_ADDRESS not configured" };
    }

    const client = createMonadPublicClient(chainConfig);
    const latest = await client.getBlockNumber();
    const safeHead = latest > BigInt(this.env.CHAIN_INDEXER_CONFIRMATIONS)
      ? latest - BigInt(this.env.CHAIN_INDEXER_CONFIRMATIONS)
      : 0n;
    const contractAddress = normalizeAddress(chainConfig.takeCampaignManagerAddress) as Address;
    let cursor = await this.getOrCreateCursor(chainConfig.chainId, contractAddress);
    cursor = await this.hydrateLegacyCursor(client, cursor);
    const reorgRewind = await this.rewindIfReorganized(
      client,
      chainConfig.chainId,
      contractAddress,
      cursor
    );
    if (reorgRewind !== null) {
      cursor = await this.getOrCreateCursor(chainConfig.chainId, contractAddress);
    }
    const backfilled = await this.backfillUnfinalized(
      client,
      chainConfig.chainId,
      contractAddress,
      safeHead
    );
    const startBlock = BigInt(this.env.TAKE_CAMPAIGN_MANAGER_START_BLOCK);
    const fromBlock = cursor.lastFinalizedBlock > 0n
      ? cursor.lastFinalizedBlock + 1n
      : startBlock;

    if (fromBlock > safeHead) {
      return {
        scanned: 0,
        backfilled,
        fromBlock: fromBlock.toString(),
        toBlock: safeHead.toString(),
        caughtUp: true,
        ...(reorgRewind === null ? {} : { reorgRewind: reorgRewind.toString() })
      };
    }

    const toBlock = minBigInt(
      fromBlock + BigInt(this.env.CHAIN_INDEXER_MAX_BLOCK_RANGE) - 1n,
      safeHead
    );
    const logs = await getTakeCampaignManagerLogs(client, contractAddress, fromBlock, toBlock);
    const metadata = await loadBlockMetadata(client, logs.map((item) => item.log.blockNumber));
    const finalizedHead = await client.getBlock({ blockNumber: toBlock });
    if (!finalizedHead.hash) throw new Error("Finalized block did not include a hash");

    await this.persistRange(client, chainConfig.chainId, contractAddress, logs, metadata);
    await this.db
      .insert(schema.chainIndexerCursors)
      .values({
        chainId: chainConfig.chainId,
        contractAddress,
        lastScannedBlock: toBlock,
        lastFinalizedBlock: toBlock,
        lastFinalizedBlockHash: finalizedHead.hash,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: [schema.chainIndexerCursors.chainId, schema.chainIndexerCursors.contractAddress],
        set: {
          lastScannedBlock: toBlock,
          lastFinalizedBlock: toBlock,
          lastFinalizedBlockHash: finalizedHead.hash,
          updatedAt: new Date()
        }
      });

    return {
      scanned: logs.length,
      backfilled,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      caughtUp: toBlock >= safeHead,
      ...(reorgRewind === null ? {} : { reorgRewind: reorgRewind.toString() })
    };
  }

  async runUntilCaughtUp(maxIterations = 25) {
    const iterations = Math.max(1, Math.min(maxIterations, 100));
    const runs: RunOnceResult[] = [];
    let scanned = 0;
    let backfilled = 0;
    for (let index = 0; index < iterations; index += 1) {
      const result = await this.runOnce();
      runs.push(result);
      if ("skipped" in result) {
        return { iterations: runs.length, scanned, backfilled, caughtUp: false, lastRun: result };
      }
      scanned += result.scanned;
      backfilled += result.backfilled;
      if (result.caughtUp) {
        return { iterations: runs.length, scanned, backfilled, caughtUp: true, lastRun: result };
      }
    }
    return { iterations: runs.length, scanned, backfilled, caughtUp: false, lastRun: runs.at(-1) };
  }

  private async persistRange(
    client: PublicClient,
    chainId: number,
    contractAddress: Address,
    logs: TakeLog[],
    metadata: Map<string, BlockMetadata>
  ) {
    await this.db.transaction(async (tx) => {
      for (const item of logs) {
        const block = metadata.get(item.log.blockNumber.toString());
        if (!block) throw new Error(`Missing metadata for block ${item.log.blockNumber}`);
        const transactionIndex = item.log.transactionIndex == null
          ? await transactionIndexFor(client, item.log.transactionHash)
          : item.log.transactionIndex;
        const event = await persistLog(
          tx,
          chainId,
          contractAddress,
          item,
          block,
          transactionIndex
        );
        await applyKnownProjection(
          tx,
          client,
          chainId,
          contractAddress,
          item,
          event,
          block,
          transactionIndex
        );
      }
    });
  }

  private async backfillUnfinalized(
    client: PublicClient,
    chainId: number,
    contractAddress: Address,
    safeHead: bigint
  ) {
    const pending = await this.db
      .select({ blockNumber: schema.chainEvents.blockNumber })
      .from(schema.chainEvents)
      .where(
        and(
          eq(schema.chainEvents.chainId, chainId),
          eq(schema.chainEvents.contractAddress, contractAddress),
          eq(schema.chainEvents.finalityStatus, "UNCONFIRMED"),
          lte(schema.chainEvents.blockNumber, safeHead)
        )
      )
      .orderBy(asc(schema.chainEvents.blockNumber))
      .limit(100);
    const blocks = [...new Set(pending.map((row) => row.blockNumber.toString()))].map(BigInt);
    let count = 0;
    for (const blockNumber of blocks) {
      const logs = await getTakeCampaignManagerLogs(client, contractAddress, blockNumber, blockNumber);
      const metadata = await loadBlockMetadata(client, [blockNumber]);
      await this.persistRange(client, chainId, contractAddress, logs, metadata);
      count += logs.length;
    }
    return count;
  }

  private async hydrateLegacyCursor(
    client: PublicClient,
    cursor: typeof schema.chainIndexerCursors.$inferSelect
  ) {
    if (cursor.lastFinalizedBlock > 0n && cursor.lastFinalizedBlockHash) return cursor;
    if (cursor.lastScannedBlock <= 0n) return cursor;
    const block = await client.getBlock({ blockNumber: cursor.lastScannedBlock });
    if (!block.hash) return cursor;
    const [updated] = await this.db
      .update(schema.chainIndexerCursors)
      .set({
        lastFinalizedBlock: cursor.lastScannedBlock,
        lastFinalizedBlockHash: block.hash,
        updatedAt: new Date()
      })
      .where(eq(schema.chainIndexerCursors.id, cursor.id))
      .returning();
    return updated ?? cursor;
  }

  private async rewindIfReorganized(
    client: PublicClient,
    chainId: number,
    contractAddress: Address,
    cursor: typeof schema.chainIndexerCursors.$inferSelect
  ): Promise<bigint | null> {
    if (cursor.lastFinalizedBlock <= 0n || !cursor.lastFinalizedBlockHash) return null;
    const canonical = await client.getBlock({ blockNumber: cursor.lastFinalizedBlock });
    if (canonical.hash?.toLowerCase() === cursor.lastFinalizedBlockHash.toLowerCase()) return null;
    const configuredStart = BigInt(this.env.TAKE_CAMPAIGN_MANAGER_START_BLOCK);
    const lookback = BigInt(this.env.CHAIN_INDEXER_REORG_LOOKBACK);
    const rewindBlock = cursor.lastFinalizedBlock > lookback
      ? maxBigInt(configuredStart > 0n ? configuredStart - 1n : 0n, cursor.lastFinalizedBlock - lookback)
      : configuredStart > 0n ? configuredStart - 1n : 0n;
    const rewindHead = await client.getBlock({ blockNumber: rewindBlock });
    if (!rewindHead.hash) throw new Error("Reorg rewind block did not include a hash");

    await this.db.transaction(async (tx) => {
      const affectedEdges = await tx
        .select({ nominationId: schema.nominationEdges.nominationId })
        .from(schema.nominationEdges)
        .where(
          and(
            eq(schema.nominationEdges.chainId, chainId),
            eq(schema.nominationEdges.contractAddress, contractAddress),
            gt(schema.nominationEdges.blockNumber, rewindBlock),
            eq(schema.nominationEdges.finalityStatus, "FINALIZED")
          )
        );
      const nominationIds = affectedEdges.flatMap((edge) => edge.nominationId ? [edge.nominationId] : []);
      await tx
        .update(schema.chainEvents)
        .set({ finalityStatus: "ORPHANED", orphanedAt: new Date(), finalizedAt: null })
        .where(
          and(
            eq(schema.chainEvents.chainId, chainId),
            eq(schema.chainEvents.contractAddress, contractAddress),
            gt(schema.chainEvents.blockNumber, rewindBlock)
          )
        );
      await tx
        .update(schema.nominationEdges)
        .set({ finalityStatus: "ORPHANED" })
        .where(
          and(
            eq(schema.nominationEdges.chainId, chainId),
            eq(schema.nominationEdges.contractAddress, contractAddress),
            gt(schema.nominationEdges.blockNumber, rewindBlock)
          )
        );
      if (nominationIds.length > 0) {
        await tx
          .update(schema.nominations)
          .set({
            status: "INDEXING_DELAYED",
            blockNumber: null,
            logIndex: null,
            confirmedAt: null,
            indexedAt: null
          })
          .where(inArray(schema.nominations.id, nominationIds));
      }
      await tx
        .update(schema.chainIndexerCursors)
        .set({
          lastScannedBlock: rewindBlock,
          lastFinalizedBlock: rewindBlock,
          lastFinalizedBlockHash: rewindHead.hash,
          updatedAt: new Date()
        })
        .where(eq(schema.chainIndexerCursors.id, cursor.id));
    });
    return rewindBlock;
  }

  private async getOrCreateCursor(chainId: number, contractAddress: Address) {
    const [existing] = await this.db
      .select()
      .from(schema.chainIndexerCursors)
      .where(
        and(
          eq(schema.chainIndexerCursors.chainId, chainId),
          eq(schema.chainIndexerCursors.contractAddress, contractAddress)
        )
      )
      .limit(1);
    if (existing) return existing;
    const start = BigInt(this.env.TAKE_CAMPAIGN_MANAGER_START_BLOCK);
    const initial = start > 0n ? start - 1n : 0n;
    const [created] = await this.db
      .insert(schema.chainIndexerCursors)
      .values({
        chainId,
        contractAddress,
        lastScannedBlock: initial,
        lastFinalizedBlock: initial
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [raced] = await this.db
      .select()
      .from(schema.chainIndexerCursors)
      .where(
        and(
          eq(schema.chainIndexerCursors.chainId, chainId),
          eq(schema.chainIndexerCursors.contractAddress, contractAddress)
        )
      )
      .limit(1);
    if (!raced) throw new Error("Failed to initialize indexer cursor");
    return raced;
  }
}

async function persistLog(
  tx: DbExecutor,
  chainId: number,
  contractAddress: Address,
  item: TakeLog,
  block: BlockMetadata,
  transactionIndex: number
) {
  const values = {
    contractAddress,
    eventName: item.eventName,
    blockNumber: item.log.blockNumber,
    blockHash: block.hash,
    transactionIndex,
    blockTimestamp: block.timestamp,
    finalityStatus: "FINALIZED" as const,
    finalizedAt: new Date(),
    orphanedAt: null,
    payload: serializeArgs(item.log.args),
    indexedAt: new Date()
  };
  const [event] = await tx
    .insert(schema.chainEvents)
    .values({
      chainId,
      transactionHash: item.log.transactionHash,
      logIndex: item.log.logIndex,
      ...values
    })
    .onConflictDoUpdate({
      target: [schema.chainEvents.chainId, schema.chainEvents.transactionHash, schema.chainEvents.logIndex],
      set: values
    })
    .returning();
  if (!event) throw new Error("Failed to persist chain event");
  return event;
}

async function applyKnownProjection(
  tx: DbExecutor,
  client: PublicClient,
  chainId: number,
  contractAddress: Address,
  item: TakeLog,
  event: typeof schema.chainEvents.$inferSelect,
  block: BlockMetadata,
  transactionIndex: number
) {
  if (item.eventName === "CampaignCreated") {
    const args = item.log.args as { campaignId: bigint; organizer: Address; rulesHash: Hex };
    const [intent] = await tx
      .select()
      .from(schema.campaignLifecycleIntents)
      .where(and(
        eq(schema.campaignLifecycleIntents.chainId, chainId),
        eq(schema.campaignLifecycleIntents.transactionHash, item.log.transactionHash),
        eq(schema.campaignLifecycleIntents.action, "PUBLISH")
      ))
      .limit(1);
    if (!intent) return;
    if (
      intent.contractAddress.toLowerCase() !== contractAddress.toLowerCase()
      || intent.expectedRulesHash?.toLowerCase() !== args.rulesHash.toLowerCase()
      || intent.requiredFromAddress?.toLowerCase() !== args.organizer.toLowerCase()
    ) {
      await tx.update(schema.campaignLifecycleIntents).set({
        status: "FAILED",
        errorCode: "INDEXED_CAMPAIGN_CREATED_MISMATCH",
        errorMessage: "Indexed CampaignCreated event did not match the prepared locked campaign",
        updatedAt: new Date()
      }).where(eq(schema.campaignLifecycleIntents.id, intent.id));
      return;
    }
    await tx.update(schema.campaigns).set({
      onchainCampaignId: args.campaignId,
      chainId,
      managerContractAddress: contractAddress,
      onchainOrganizerAddress: args.organizer.toLowerCase(),
      onchainOperatorWalletAddress: args.organizer.toLowerCase(),
      status: "CREATED",
      updatedAt: new Date()
    }).where(eq(schema.campaigns.id, intent.campaignId));
    await tx.update(schema.campaignLifecycleIntents).set({
      status: "COMPLETED",
      eventLogIndex: item.log.logIndex,
      eventBlockNumber: item.log.blockNumber,
      emittedOnchainCampaignId: args.campaignId,
      emittedOrganizerAddress: args.organizer.toLowerCase(),
      confirmedAt: new Date(),
      indexedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(schema.campaignLifecycleIntents.id, intent.id));
  }
  if (item.eventName === "CampaignActivated") {
    const args = item.log.args as { campaignId: bigint };
    await updateCampaignStatus(tx, chainId, contractAddress, args.campaignId, "ACTIVE");
  }
  if (item.eventName === "TakeGiven") {
    await projectTakeGiven(tx, client, chainId, contractAddress, item, event, block, transactionIndex);
  }
  if (item.eventName === "CampaignClosed") {
    const args = item.log.args as { campaignId: bigint };
    await updateCampaignStatus(tx, chainId, contractAddress, args.campaignId, "CLOSED");
  }
  if (item.eventName === "CampaignFinalized") {
    const args = item.log.args as { campaignId: bigint; resultHash: Hex };
    await updateCampaignStatus(tx, chainId, contractAddress, args.campaignId, "FINALIZED", args.resultHash);
  }
  if (item.eventName === "CampaignCancelled") {
    const args = item.log.args as { campaignId: bigint };
    await updateCampaignStatus(tx, chainId, contractAddress, args.campaignId, "CANCELLED");
  }
}

async function projectTakeGiven(
  tx: DbExecutor,
  client: PublicClient,
  chainId: number,
  contractAddress: Address,
  item: TakeLog,
  event: typeof schema.chainEvents.$inferSelect,
  block: BlockMetadata,
  transactionIndex: number
) {
  if (item.eventName !== "TakeGiven") return;
  const args = item.log.args as {
    campaignId: bigint;
    giverIdentityKey: Hex;
    recipientIdentityKey: Hex;
  };
  const [campaign] = await tx
    .select()
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.chainId, chainId),
        eq(schema.campaigns.managerContractAddress, contractAddress),
        eq(schema.campaigns.onchainCampaignId, args.campaignId)
      )
    )
    .limit(1);
  if (!campaign) return;

  const experiment = campaign.experimentId
    ? await tx.select().from(schema.campaignExperiments)
        .where(eq(schema.campaignExperiments.id, campaign.experimentId)).limit(1)
        .then((rows) => rows[0])
    : undefined;

  const [giver, recipient, apiNomination] = await Promise.all([
    resolveIdentity(tx, client, contractAddress, args.giverIdentityKey, item.log.blockNumber),
    resolveIdentity(tx, client, contractAddress, args.recipientIdentityKey, item.log.blockNumber),
    tx.select().from(schema.nominations)
      .where(eq(schema.nominations.transactionHash, item.log.transactionHash)).limit(1)
      .then((rows) => rows[0])
  ]);
  let invalidReason: string | null = null;
  if (giver.canonicalKey.toLowerCase() === recipient.canonicalKey.toLowerCase()) {
    invalidReason = experiment ? "KNOWN_CANONICAL_SELF_NOMINATION" : "SELF_NOMINATION";
  }
  if (!invalidReason && campaign.mechanismConfigId) {
    invalidReason = await eligibilityInvalidReason(
      tx,
      campaign.mechanismConfigId,
      args.giverIdentityKey,
      giver.canonicalKey,
      args.recipientIdentityKey,
      recipient.canonicalKey
    );
  }
  if (!invalidReason && !campaign.experimentId) {
    const [reverse] = await tx
      .select({ id: schema.nominationEdges.id })
      .from(schema.nominationEdges)
      .where(
        and(
          eq(schema.nominationEdges.campaignId, campaign.id),
          eq(schema.nominationEdges.canonicalGiverKey, recipient.canonicalKey.toLowerCase()),
          eq(schema.nominationEdges.canonicalRecipientKey, giver.canonicalKey.toLowerCase()),
          eq(schema.nominationEdges.validity, "VALID"),
          eq(schema.nominationEdges.finalityStatus, "FINALIZED")
        )
      )
      .limit(1);
    if (reverse) invalidReason = "DIRECT_RECIPROCITY_REJECT_LATER_EDGE";
  }

  const edgeValues = {
    campaignId: campaign.id,
    chainEventId: event.id,
    nominationId: apiNomination?.id ?? null,
    experimentId: experiment?.id ?? null,
    nominatorSnapshotId: apiNomination?.nominatorSnapshotId ?? experiment?.giverSnapshotId ?? null,
    recipientSnapshotId: apiNomination?.recipientSnapshotId ?? experiment?.recipientSnapshotId ?? null,
    chainId,
    contractAddress,
    transactionHash: item.log.transactionHash,
    blockNumber: item.log.blockNumber,
    blockHash: block.hash,
    transactionIndex,
    logIndex: item.log.logIndex,
    blockTimestamp: block.timestamp,
    giverIdentityKey: args.giverIdentityKey.toLowerCase(),
    recipientIdentityKey: args.recipientIdentityKey.toLowerCase(),
    canonicalGiverKey: giver.canonicalKey.toLowerCase(),
    canonicalRecipientKey: recipient.canonicalKey.toLowerCase(),
    identityResolution: { giver: giver.metadata, recipient: recipient.metadata },
    validity: invalidReason ? "INVALID" as const : "VALID" as const,
    invalidReason,
    finalityStatus: "FINALIZED" as const,
    indexedAt: new Date()
  };
  await tx
    .insert(schema.nominationEdges)
    .values(edgeValues)
    .onConflictDoUpdate({
      target: [
        schema.nominationEdges.chainId,
        schema.nominationEdges.contractAddress,
        schema.nominationEdges.transactionHash,
        schema.nominationEdges.logIndex
      ],
      set: edgeValues
    });

  if (apiNomination) {
    const firstConfirmation = apiNomination.status !== "CONFIRMED";
    await tx
      .update(schema.nominations)
      .set({
        chainId,
        transactionHash: item.log.transactionHash,
        logIndex: item.log.logIndex,
        blockNumber: item.log.blockNumber,
        status: "CONFIRMED",
        failureReason: invalidReason,
        confirmedAt: block.timestamp,
        indexedAt: new Date()
      })
      .where(eq(schema.nominations.id, apiNomination.id));
    if (firstConfirmation && (apiNomination.recipientTakeIdentityId || apiNomination.recipientExternalIdentityId)) {
      await tx.insert(schema.notifications).values({
        recipientTakeIdentityId: apiNomination.recipientTakeIdentityId,
        recipientExternalIdentityId: apiNomination.recipientExternalIdentityId,
        type: "TAKE_RECEIVED",
        payload: {
          campaignId: campaign.id,
          nominationId: apiNomination.id,
          giverIdentityId: apiNomination.giverIdentityId,
          transactionHash: item.log.transactionHash,
          edgeValidity: invalidReason ? "INVALID" : "VALID",
          invalidReason
        }
      });
    }
  }
}

async function resolveIdentity(
  tx: DbExecutor,
  client: PublicClient,
  contractAddress: Address,
  rawKey: Hex,
  blockNumber: bigint
) {
  const mapped = await client.readContract({
    abi: takeCampaignManagerAbi,
    address: contractAddress,
    functionName: "canonicalIdentityKey",
    args: [rawKey],
    blockNumber
  }) as Hex;
  const canonicalKey = mapped === ZERO_BYTES32 ? rawKey : mapped;
  const [[takeIdentity], [externalIdentity]] = await Promise.all([
    tx.select({ id: schema.takeIdentities.id })
      .from(schema.takeIdentities)
      .where(eq(schema.takeIdentities.protocolIdentityKey, canonicalKey.toLowerCase()))
      .limit(1),
    tx.select({ id: schema.externalIdentities.id, takeIdentityId: schema.externalIdentities.takeIdentityId })
      .from(schema.externalIdentities)
      .where(eq(schema.externalIdentities.externalIdentityKey, rawKey.toLowerCase()))
      .limit(1)
  ]);
  return {
    canonicalKey,
    metadata: {
      rawKey: rawKey.toLowerCase(),
      canonicalKey: canonicalKey.toLowerCase(),
      canonicalSource: mapped === ZERO_BYTES32 ? "RAW_IDENTITY_KEY" : "ONCHAIN_ALIAS",
      takeIdentityId: takeIdentity?.id ?? externalIdentity?.takeIdentityId ?? null,
      externalIdentityId: externalIdentity?.id ?? null
    }
  };
}

async function eligibilityInvalidReason(
  tx: DbExecutor,
  mechanismConfigId: string,
  giverRawKey: Hex,
  giverCanonicalKey: Hex,
  recipientRawKey: Hex,
  recipientCanonicalKey: Hex
) {
  const snapshots = await tx
    .select()
    .from(schema.eligibilitySnapshots)
    .where(
      and(
        eq(schema.eligibilitySnapshots.mechanismConfigId, mechanismConfigId),
        eq(schema.eligibilitySnapshots.status, "LOCKED")
      )
    );
  const nominator = snapshots.find((snapshot) => snapshot.subject === "NOMINATOR");
  const recipient = snapshots.find((snapshot) => snapshot.subject === "RECIPIENT");
  if (!nominator || !recipient) return "ELIGIBILITY_SNAPSHOT_MISSING";
  if (!await isEligibleMember(tx, nominator.id, giverRawKey, giverCanonicalKey)) {
    return "INELIGIBLE_NOMINATOR";
  }
  if (
    recipient.mode !== "EXTERNAL_ALLOWED"
    && !await isEligibleMember(tx, recipient.id, recipientRawKey, recipientCanonicalKey)
  ) {
    return "INELIGIBLE_RECIPIENT";
  }
  return null;
}

async function isEligibleMember(
  tx: DbExecutor,
  snapshotId: string,
  rawKey: Hex,
  canonicalKey: Hex
) {
  const [member] = await tx
    .select({ id: schema.eligibilitySnapshotMembers.id })
    .from(schema.eligibilitySnapshotMembers)
    .where(
      and(
        eq(schema.eligibilitySnapshotMembers.snapshotId, snapshotId),
        eq(schema.eligibilitySnapshotMembers.eligible, true),
        or(
          eq(schema.eligibilitySnapshotMembers.subjectKey, rawKey.toLowerCase()),
          eq(schema.eligibilitySnapshotMembers.canonicalSubjectKey, canonicalKey.toLowerCase())
        )
      )
    )
    .limit(1);
  return Boolean(member);
}

async function updateCampaignStatus(
  tx: DbExecutor,
  chainId: number,
  contractAddress: Address,
  onchainCampaignId: bigint,
  status: "ACTIVE" | "CLOSED" | "FINALIZED" | "CANCELLED",
  finalResultHash?: Hex
) {
  await tx
    .update(schema.campaigns)
    .set({ status, finalResultHash, updatedAt: new Date() })
    .where(
      and(
        eq(schema.campaigns.chainId, chainId),
        eq(schema.campaigns.managerContractAddress, contractAddress),
        eq(schema.campaigns.onchainCampaignId, onchainCampaignId)
      )
    );
}

async function loadBlockMetadata(client: PublicClient, blockNumbers: bigint[]) {
  const unique = [...new Set(blockNumbers.map(String))].map(BigInt);
  const entries = await Promise.all(unique.map(async (blockNumber) => {
    const block = await client.getBlock({ blockNumber });
    if (!block.hash) throw new Error(`Block ${blockNumber} did not include a hash`);
    return [blockNumber.toString(), {
      hash: block.hash,
      timestamp: new Date(Number(block.timestamp) * 1_000)
    }] as const;
  }));
  return new Map(entries);
}

async function transactionIndexFor(client: PublicClient, transactionHash: Hex) {
  const receipt = await client.getTransactionReceipt({ hash: transactionHash });
  return receipt.transactionIndex;
}

function serializeArgs(args: unknown): Record<string, string> {
  return JSON.parse(
    JSON.stringify(args, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
  ) as Record<string, string>;
}

function minBigInt(left: bigint, right: bigint) {
  return left < right ? left : right;
}

function maxBigInt(left: bigint, right: bigint) {
  return left > right ? left : right;
}
