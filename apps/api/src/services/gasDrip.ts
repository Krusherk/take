import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Address } from "viem";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import type { ApiEnv } from "../config/env.js";
import { ServerWallet, ServerWalletUnfundedError } from "./serverWallet.js";

export type GasDripOutcome =
  | "SENT"
  | "ALREADY_SENT"
  | "PENDING"
  | "NOT_NEEDED"
  | "NOT_ELIGIBLE"
  | "NO_WALLET"
  | "DAILY_CAP_REACHED"
  | "UNAVAILABLE"
  | "FAILED";

export type GasDripResult = {
  outcome: GasDripOutcome;
  amountWei?: string;
  transactionHash?: string;
  balanceWei?: string;
};

type Deps = { wallet?: ServerWallet | null; now?: () => Date };

const PENDING_STALE_MS = 2 * 60_000;
const LOCK_KEY = 0x74616b65; // "take"

/**
 * One small MON transfer from the TAKE server wallet so a new giver can pay
 * gas for registerIdentity + giveTake. At most once per TAKE identity, only
 * for givers of a campaign that is collecting sign-ups or open, and under a
 * rolling 24h cap across everyone.
 */
export class GasDripService {
  private readonly wallet: ServerWallet | null;
  private readonly now: () => Date;

  constructor(private readonly db: Database, private readonly env: ApiEnv, deps: Deps = {}) {
    this.wallet = deps.wallet === undefined ? ServerWallet.fromEnv(env) : deps.wallet;
    this.now = deps.now ?? (() => new Date());
  }

  async drip(identity: { takeIdentityId: string; primaryWalletAddress?: string | null }): Promise<GasDripResult> {
    if (!this.env.GAS_DRIP_ENABLED || !this.wallet) return { outcome: "UNAVAILABLE" };
    const address = identity.primaryWalletAddress?.toLowerCase();
    if (!address || !/^0x[0-9a-f]{40}$/.test(address)) return { outcome: "NO_WALLET" };

    const [existing] = await this.db.select().from(schema.gasDrips)
      .where(eq(schema.gasDrips.takeIdentityId, identity.takeIdentityId)).limit(1);
    if (existing?.status === "SENT") {
      return { outcome: "ALREADY_SENT", amountWei: existing.amountWei, ...(existing.transactionHash ? { transactionHash: existing.transactionHash } : {}) };
    }
    if (existing?.status === "PENDING" && (existing.transactionHash || this.now().getTime() - existing.createdAt.getTime() < PENDING_STALE_MS)) {
      return { outcome: "PENDING", ...(existing.transactionHash ? { transactionHash: existing.transactionHash } : {}) };
    }

    const campaignId = await this.eligibleCampaign(identity.takeIdentityId);
    if (!campaignId) return { outcome: "NOT_ELIGIBLE" };

    const balance = await this.wallet.client.getBalance({ address: address as Address });
    if (balance >= BigInt(this.env.GAS_DRIP_MIN_BALANCE_WEI)) return { outcome: "NOT_NEEDED", balanceWei: balance.toString() };

    const amount = BigInt(this.env.GAS_DRIP_AMOUNT_WEI);
    const reserved = await this.reserve(identity.takeIdentityId, address, amount, campaignId);
    if (reserved !== "RESERVED") return { outcome: reserved };

    try {
      const signed = await this.wallet.sign({ to: address as Address, data: "0x", chainId: this.wallet.chainId, value: amount });
      await this.db.update(schema.gasDrips).set({ transactionHash: signed.hash })
        .where(eq(schema.gasDrips.takeIdentityId, identity.takeIdentityId));
      const receipt = await this.wallet.broadcast(signed);
      if (receipt?.status === "reverted") throw new Error("GAS_DRIP_REVERTED");
      await this.db.update(schema.gasDrips).set({ status: "SENT", sentAt: this.now(), error: null })
        .where(eq(schema.gasDrips.takeIdentityId, identity.takeIdentityId));
      return { outcome: "SENT", amountWei: amount.toString(), transactionHash: signed.hash };
    } catch (error) {
      const code = error instanceof ServerWalletUnfundedError ? error.code : error instanceof Error && error.message === "GAS_DRIP_REVERTED" ? "REVERTED" : "BROADCAST_FAILED";
      await this.db.update(schema.gasDrips).set({ status: "FAILED", error: code })
        .where(eq(schema.gasDrips.takeIdentityId, identity.takeIdentityId));
      return { outcome: code === "SERVER_WALLET_UNFUNDED" ? "UNAVAILABLE" : "FAILED" };
    }
  }

  /** Serialized under an advisory lock so the daily cap and once-per-identity hold under concurrency. */
  private async reserve(takeIdentityId: string, address: string, amount: bigint, campaignId: string)
    : Promise<"RESERVED" | "PENDING" | "ALREADY_SENT" | "DAILY_CAP_REACHED"> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
      const [row] = await tx.select().from(schema.gasDrips).where(eq(schema.gasDrips.takeIdentityId, takeIdentityId)).limit(1);
      if (row?.status === "SENT") return "ALREADY_SENT" as const;
      if (row?.status === "PENDING" && (row.transactionHash || this.now().getTime() - row.createdAt.getTime() < PENDING_STALE_MS)) return "PENDING" as const;
      const since = new Date(this.now().getTime() - 24 * 60 * 60_000);
      const [spent] = await tx.select({ total: sql<string>`coalesce(sum(${schema.gasDrips.amountWei}), 0)::text` })
        .from(schema.gasDrips)
        .where(and(inArray(schema.gasDrips.status, ["SENT", "PENDING"]), gte(schema.gasDrips.createdAt, since)));
      if (BigInt(spent?.total ?? "0") + amount > BigInt(this.env.GAS_DRIP_DAILY_CAP_WEI)) return "DAILY_CAP_REACHED" as const;
      const values = {
        walletAddress: address,
        amountWei: amount.toString(),
        campaignId,
        status: "PENDING",
        transactionHash: null,
        error: null,
        createdAt: this.now(),
        sentAt: null
      };
      if (row) await tx.update(schema.gasDrips).set(values).where(eq(schema.gasDrips.takeIdentityId, takeIdentityId));
      else await tx.insert(schema.gasDrips).values({ takeIdentityId, ...values });
      return "RESERVED" as const;
    });
  }

  /** A giver on a campaign still collecting sign-ups, or an eligible giver of an open campaign. */
  private async eligibleCampaign(takeIdentityId: string): Promise<string | null> {
    const [signup] = await this.db.select({ campaignId: schema.campaignSignups.campaignId })
      .from(schema.identityAllowlistMembers)
      .innerJoin(schema.campaignSignups, eq(schema.campaignSignups.giverAllowlistId, schema.identityAllowlistMembers.allowlistId))
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignSignups.campaignId))
      .where(and(
        eq(schema.identityAllowlistMembers.takeIdentityId, takeIdentityId),
        inArray(schema.campaigns.status, ["DRAFT", "CREATED", "ACTIVE"])
      )).limit(1);
    if (signup) return signup.campaignId;
    const [giver] = await this.db.select({ campaignId: schema.eligibilitySnapshots.campaignId })
      .from(schema.eligibilitySnapshotMembers)
      .innerJoin(schema.eligibilitySnapshots, eq(schema.eligibilitySnapshots.id, schema.eligibilitySnapshotMembers.snapshotId))
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.eligibilitySnapshots.campaignId))
      .where(and(
        eq(schema.eligibilitySnapshotMembers.takeIdentityId, takeIdentityId),
        eq(schema.eligibilitySnapshotMembers.eligible, true),
        eq(schema.eligibilitySnapshots.subject, "NOMINATOR"),
        inArray(schema.campaigns.status, ["CREATED", "ACTIVE"])
      )).limit(1);
    return giver?.campaignId ?? null;
  }
}
