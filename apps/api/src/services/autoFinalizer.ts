import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { parseAbi, type Address, type Hex, type PublicClient } from "viem";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import { normalizeAddress } from "@take/shared";
import type { ApiEnv } from "../config/env.js";
import { AllocationService } from "./allocation.js";
import { CampaignLifecycleService } from "./campaignLifecycle.js";
import { CampaignSignupService } from "./signups.js";
import { ServiceError } from "./errors.js";
import { ServerWallet, ServerWalletUnfundedError } from "./serverWallet.js";
import { QuickNodeIndexer } from "../workers/quicknodeIndexer.js";

const campaignGetterAbi = parseAbi([
  "function campaigns(uint256) view returns (address organizer, bytes32 metadataHash, uint64 startTime, uint64 endTime, uint32 nominationLimit, uint8 nominatorEligibilityMode, uint8 recipientEligibilityMode, uint8 nominationVisibilityMode, uint8 status, bytes32 nominatorEligibilityRoot, bytes32 recipientEligibilityRoot, bytes32 rulesHash, bytes32 finalResultHash, bool cancellableAfterStart, bool hasNominations)"
]);

/** TakeCampaignManager.CampaignStatus */
export const OnchainStatus = { None: 0, Created: 1, Active: 2, Closed: 3, Finalized: 4, Cancelled: 5 } as const;

type CampaignRow = typeof schema.campaigns.$inferSelect;
type LifecycleAction = "ACTIVATE" | "CLOSE" | "FINALIZE" | "PUBLISH";

export type FinalizerStep = {
  campaignId: string;
  onchainCampaignId: string | null;
  title: string;
  action: "PUBLISH" | "ACTIVATE" | "CLOSE" | "ALLOCATE" | "FINALIZE" | "WAIT" | "SKIP" | "ERROR";
  outcome: string;
  transactionHash?: string;
  detail?: string;
};

export type FinalizerReport = {
  serverWallet: string | null;
  indexer: unknown;
  signups?: unknown;
  steps: FinalizerStep[];
  durationMs: number;
};

export type FinalizerDeps = {
  wallet?: ServerWallet | null;
  client?: PublicClient;
  indexer?: Pick<QuickNodeIndexer, "runUntilCaughtUp">;
  lifecycle?: CampaignLifecycleService;
  allocations?: Pick<AllocationService, "run">;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

const LIFECYCLE_PENDING = ["SUBMITTED", "CONFIRMING", "INDEXING"];
const LOST_BROADCAST_AFTER_MS = 5 * 60_000;
const DRAND_WAIT_LIMIT_MS = 20_000;

/**
 * Advances ended campaigns: close on Monad, run the locked allocation once the
 * committed drand round exists, and commit the result hash with the TAKE server
 * wallet when that wallet is the campaign organizer. Each step is idempotent:
 * lifecycle intents are unique per campaign/action and are claimed before any
 * broadcast, and allocation runs are deduplicated by their input/result hashes.
 */
export class AutoFinalizer {
  private readonly wallet: ServerWallet | null;
  private readonly lifecycle: CampaignLifecycleService;
  private readonly allocations: Pick<AllocationService, "run">;
  private readonly indexer: Pick<QuickNodeIndexer, "runUntilCaughtUp">;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly client: PublicClient | null;

  constructor(private readonly db: Database, private readonly env: ApiEnv, deps: FinalizerDeps = {}) {
    this.wallet = deps.wallet === undefined ? ServerWallet.fromEnv(env, deps.client) : deps.wallet;
    this.client = deps.client ?? this.wallet?.client ?? null;
    this.lifecycle = deps.lifecycle ?? new CampaignLifecycleService(db, env);
    this.allocations = deps.allocations ?? new AllocationService(db, env);
    this.indexer = deps.indexer ?? new QuickNodeIndexer(db, env);
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(options: { budgetMs?: number; indexerBudgetMs?: number } = {}): Promise<FinalizerReport> {
    const started = Date.now();
    const deadline = started + (options.budgetMs ?? 50_000);
    const steps: FinalizerStep[] = [];

    let indexer: unknown;
    try {
      indexer = await this.indexer.runUntilCaughtUp(100, options.indexerBudgetMs ?? 18_000);
    } catch (error) {
      indexer = { error: safeErrorCode(error) };
    }

    const manager = this.env.TAKE_CAMPAIGN_MANAGER_ADDRESS?.toLowerCase();
    if (!manager || !this.env.AUTO_FINALIZE_ENABLED) {
      return { serverWallet: this.wallet?.address ?? null, indexer, steps, durationMs: Date.now() - started };
    }
    // Sign-ups whose deadline passed (or that are mid-opening) lock and open first.
    let signups: unknown;
    try {
      signups = await new CampaignSignupService(this.db, this.env).runDue(this, this.now());
    } catch (error) {
      signups = { error: safeErrorCode(error) };
    }
    const campaigns = await this.db.select().from(schema.campaigns).where(and(
      eq(schema.campaigns.managerContractAddress, manager),
      isNotNull(schema.campaigns.onchainCampaignId),
      inArray(schema.campaigns.status, ["CREATED", "ACTIVE", "CLOSED", "ALLOCATING"])
    )).orderBy(schema.campaigns.endTime);

    for (const campaign of campaigns) {
      if (Date.now() > deadline - 8_000) {
        steps.push(step(campaign, "WAIT", "TIME_BUDGET_EXHAUSTED"));
        continue;
      }
      try {
        steps.push(...await this.advance(campaign, deadline));
      } catch (error) {
        steps.push(step(campaign, "ERROR", safeErrorCode(error)));
      }
    }
    return { serverWallet: this.wallet?.address ?? null, indexer, signups, steps, durationMs: Date.now() - started };
  }

  /** Publishes a launch-approved draft with the server wallet and opens nominations right away. */
  async publishAndOpen(campaignId: string, actorIdentityId: string): Promise<{ outcome: string; transactionHash?: string; detail?: string }> {
    let campaign = await this.reload(campaignId);
    let transactionHash: string | undefined;
    if (campaign.status === "DRAFT") {
      const published = await this.serverAction(campaign, "PUBLISH", actorIdentityId);
      if (published.action === "SKIP" || published.action === "ERROR") return { outcome: published.outcome, detail: published.detail };
      transactionHash = published.transactionHash;
      await this.catchUp();
      campaign = await this.reload(campaignId);
      if (campaign.status === "DRAFT") return { outcome: "WAITING_FOR_INDEXER", transactionHash };
    }
    if (campaign.status === "CREATED") {
      if (this.now().getTime() < campaign.startTime.getTime()) return { outcome: "SCHEDULED", transactionHash };
      const activated = await this.serverAction(campaign, "ACTIVATE", actorIdentityId);
      if (activated.action === "SKIP" || activated.action === "ERROR") return { outcome: activated.outcome, detail: activated.detail };
      transactionHash = activated.transactionHash;
      await this.catchUp();
      campaign = await this.reload(campaignId);
    }
    return { outcome: campaign.status, transactionHash };
  }

  private async catchUp() {
    await this.indexer.runUntilCaughtUp(50, 15_000).catch(() => null);
  }

  private async advance(initial: CampaignRow, deadline: number): Promise<FinalizerStep[]> {
    const steps: FinalizerStep[] = [];
    let campaign = initial;
    const now = this.now();
    const ended = now.getTime() >= campaign.endTime.getTime();
    const actor = campaign.launchApprovedByIdentityId ?? campaign.createdByIdentityId;
    const onchain = await this.readOnchain(campaign);
    const isOrganizer = Boolean(this.wallet && onchain
      && normalizeAddress(onchain.organizer) === normalizeAddress(this.wallet.address));

    // Server-organized campaigns open on time without an operator signature.
    if (campaign.status === "CREATED" && !ended && isOrganizer && onchain?.status === OnchainStatus.Created
      && now.getTime() >= campaign.startTime.getTime()) {
      steps.push(await this.serverAction(campaign, "ACTIVATE", actor));
      return steps;
    }
    if (!ended) return steps;

    if (campaign.status === "CREATED" || campaign.status === "ACTIVE") {
      if (onchain && (onchain.status === OnchainStatus.Created || onchain.status === OnchainStatus.Active)) {
        if (!this.wallet) return [step(campaign, "SKIP", "NO_SERVER_WALLET")];
        // After endTime the contract lets any wallet close a campaign.
        const closed = await this.serverAction(campaign, "CLOSE", actor);
        steps.push(closed);
      } else {
        const pending = await this.lifecycle.findIntentRecord(campaign.id, "CLOSE");
        if (pending && LIFECYCLE_PENDING.includes(pending.status)) await this.lifecycle.reconcile(pending.id);
        else steps.push(step(campaign, "WAIT", "WAITING_FOR_INDEXER", `onchain status ${onchain?.status ?? "unknown"}`));
      }
      campaign = await this.reload(campaign.id);
      if (campaign.status !== "CLOSED") return steps;
    }

    if (campaign.status === "CLOSED") {
      const waitMs = await this.drandWaitMs(campaign.id);
      if (waitMs > 0) {
        const remaining = deadline - Date.now() - 10_000;
        if (waitMs > DRAND_WAIT_LIMIT_MS || waitMs > remaining) {
          steps.push(step(campaign, "WAIT", "DRAND_ROUND_NOT_AVAILABLE",
            `available ${new Date(this.now().getTime() + waitMs).toISOString()}`));
          return steps;
        }
        await this.sleep(waitMs + 1_500);
      }
      try {
        const allocation = await this.allocations.run(campaign.id, actor, { system: true });
        steps.push(step(campaign, "ALLOCATE", "COMPLETED", `resultHash ${allocation.run.resultHash}`));
      } catch (error) {
        if (error instanceof ServiceError) {
          steps.push(step(campaign, error.code === "DRAND_ROUND_NOT_AVAILABLE" ? "WAIT" : "SKIP", error.code));
          return steps;
        }
        throw error;
      }
      campaign = await this.reload(campaign.id);
    }

    if (campaign.status === "ALLOCATING") {
      if (!this.wallet) return [...steps, step(campaign, "SKIP", "NO_SERVER_WALLET")];
      if (!isOrganizer) {
        steps.push(step(campaign, "SKIP", "SERVER_WALLET_NOT_ORGANIZER",
          `finalizeAllocation must be signed by ${onchain?.organizer ?? "the campaign organizer"}`));
        return steps;
      }
      if (onchain?.status === OnchainStatus.Finalized) {
        steps.push(step(campaign, "WAIT", "WAITING_FOR_INDEXER", "already finalized on Monad"));
        return steps;
      }
      const [run] = await this.db.select().from(schema.allocationRuns).where(and(
        eq(schema.allocationRuns.campaignId, campaign.id),
        eq(schema.allocationRuns.status, "COMPLETED"),
        isNotNull(schema.allocationRuns.resultHash)
      )).orderBy(desc(schema.allocationRuns.completedAt)).limit(1);
      if (!run) return [...steps, step(campaign, "SKIP", "NO_COMPLETED_ALLOCATION")];
      steps.push(await this.serverAction(campaign, "FINALIZE", actor, run.id));
    }
    return steps;
  }

  /** Signs one lifecycle action with the server wallet, or reconciles the one already sent. */
  async serverAction(campaign: CampaignRow, action: LifecycleAction, actorIdentityId: string, allocationRunId?: string): Promise<FinalizerStep> {
    const wallet = this.wallet;
    if (!wallet) return step(campaign, "SKIP", "NO_SERVER_WALLET");
    const label = action;
    const existing = await this.lifecycle.findIntentRecord(campaign.id, action);
    if (existing?.transactionHash && LIFECYCLE_PENDING.includes(existing.status)) {
      const view = await this.lifecycle.reconcile(existing.id);
      if (LIFECYCLE_PENDING.includes(view.status) && await this.isLost(existing.transactionHash as Hex, existing.submittedAt)) {
        await this.lifecycle.releaseLostSubmission(existing.id);
        return step(campaign, "WAIT", "SERVER_BROADCAST_LOST_RETRY_NEXT_RUN", undefined, existing.transactionHash);
      }
      return step(campaign, label, view.status, view.errorCode ?? undefined, existing.transactionHash);
    }
    if (existing && existing.status === "WAITING_FOR_WALLET" && existing.requiredFromAddress
      && normalizeAddress(existing.requiredFromAddress) !== normalizeAddress(wallet.address)
      && action !== "FINALIZE") {
      await this.lifecycle.discardUnsignedIntent(existing.id, "REPLACED_BY_SERVER_WALLET");
    }
    const intent = await this.lifecycle.prepare({
      campaignId: campaign.id,
      action,
      operatorIdentityId: actorIdentityId,
      operatorWalletAddress: wallet.address,
      allocationRunId
    });
    if (intent.transactionHash) {
      const view = await this.lifecycle.reconcile(intent.id);
      return step(campaign, label, view.status, view.errorCode ?? undefined, intent.transactionHash);
    }
    if (intent.requiredFromAddress && normalizeAddress(intent.requiredFromAddress) !== normalizeAddress(wallet.address)) {
      return step(campaign, "SKIP", "SERVER_WALLET_NOT_AUTHORIZED", `requires ${intent.requiredFromAddress}`);
    }
    let signed: Awaited<ReturnType<ServerWallet["sign"]>>;
    try {
      signed = await wallet.sign({
        to: intent.transaction.to as Address,
        data: intent.transaction.data as Hex,
        chainId: intent.transaction.chainId
      });
    } catch (error) {
      if (error instanceof ServerWalletUnfundedError) {
        return step(campaign, "SKIP", error.code, `fund ${error.address} with testnet MON`);
      }
      throw error;
    }
    const claimed = await this.lifecycle.claimForServerWallet({
      intentId: intent.id,
      transactionHash: signed.hash,
      fromAddress: signed.from,
      actorIdentityId
    });
    if (!claimed) return step(campaign, "WAIT", "INTENT_CLAIMED_BY_ANOTHER_RUN");
    const receipt = await wallet.broadcast(signed);
    const view = await this.lifecycle.reconcile(intent.id);
    const outcome = receipt?.status === "reverted" ? "REVERTED" : view.status;
    return step(campaign, label, outcome, view.errorCode ?? undefined, signed.hash);
  }

  private async isLost(hash: Hex, submittedAt: Date | null) {
    if (!this.client || !submittedAt) return false;
    if (Date.now() - submittedAt.getTime() < LOST_BROADCAST_AFTER_MS) return false;
    const found = await this.client.getTransaction({ hash }).then(() => true).catch(() => false);
    return !found;
  }

  private async drandWaitMs(campaignId: string) {
    const [campaign] = await this.db.select({ mechanismConfigId: schema.campaigns.mechanismConfigId })
      .from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
    if (!campaign?.mechanismConfigId) return 0;
    const [artifact] = await this.db.select({ notBefore: schema.randomnessArtifacts.notBefore, status: schema.randomnessArtifacts.status })
      .from(schema.randomnessArtifacts).where(and(
        eq(schema.randomnessArtifacts.campaignId, campaignId),
        eq(schema.randomnessArtifacts.mechanismConfigId, campaign.mechanismConfigId)
      )).limit(1);
    if (!artifact || artifact.status === "VERIFIED") return 0;
    return Math.max(0, artifact.notBefore.getTime() - this.now().getTime());
  }

  private async readOnchain(campaign: CampaignRow) {
    if (!this.client || !campaign.onchainCampaignId || !campaign.managerContractAddress) return null;
    const result = await this.client.readContract({
      address: campaign.managerContractAddress as Address,
      abi: campaignGetterAbi,
      functionName: "campaigns",
      args: [campaign.onchainCampaignId]
    });
    return { organizer: result[0], status: Number(result[8]) };
  }

  private async reload(id: string) {
    const [campaign] = await this.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1);
    if (!campaign) throw new ServiceError("NOT_FOUND", "Campaign not found", 404);
    return campaign;
  }
}

function step(campaign: CampaignRow, action: FinalizerStep["action"], outcome: string, detail?: string, transactionHash?: string): FinalizerStep {
  return {
    campaignId: campaign.id,
    onchainCampaignId: campaign.onchainCampaignId?.toString() ?? null,
    title: campaign.title,
    action,
    outcome,
    ...(transactionHash ? { transactionHash } : {}),
    ...(detail ? { detail } : {})
  };
}

/** Provider errors can embed credential-bearing RPC URLs; only expose a code. */
function safeErrorCode(error: unknown) {
  if (error instanceof ServiceError) return error.code;
  if (error && typeof error === "object" && "name" in error && typeof error.name === "string") return error.name;
  return "UnknownError";
}
