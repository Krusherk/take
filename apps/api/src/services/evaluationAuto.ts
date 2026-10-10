import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { schema, type Database } from "@take/database";
import type { ApiEnv } from "../config/env.js";
import { isMissingTable } from "./campaign.js";

export const MONAD_TESTNET_CHAIN_ID = 10143;
export const MONAD_MAINNET_CHAIN_ID = 143;
const erc721 = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

/** The RPC TAKE reads for a chain: Monad from the existing config, others from EVALUATION_RPC_URLS. */
export function evaluationRpcUrl(env: Pick<ApiEnv, "MONAD_TESTNET_RPC_URL" | "MONAD_MAINNET_RPC_URL" | "EVALUATION_RPC_URLS">, chainId: number) {
  if (chainId === MONAD_TESTNET_CHAIN_ID && env.MONAD_TESTNET_RPC_URL) return env.MONAD_TESTNET_RPC_URL;
  if (chainId === MONAD_MAINNET_CHAIN_ID && env.MONAD_MAINNET_RPC_URL) return env.MONAD_MAINNET_RPC_URL;
  for (const pair of (env.EVALUATION_RPC_URLS ?? "").split(",")) {
    const [id, url] = pair.split("=").map((part) => part?.trim());
    if (Number(id) === chainId && url?.startsWith("https://")) return url;
  }
  return null;
}

export function configuredEvaluationChains(env: Pick<ApiEnv, "MONAD_TESTNET_RPC_URL" | "MONAD_MAINNET_RPC_URL" | "EVALUATION_RPC_URLS">) {
  const ids = new Set<number>();
  if (env.MONAD_TESTNET_RPC_URL) ids.add(MONAD_TESTNET_CHAIN_ID);
  if (env.MONAD_MAINNET_RPC_URL) ids.add(MONAD_MAINNET_CHAIN_ID);
  for (const pair of (env.EVALUATION_RPC_URLS ?? "").split(",")) { const id = Number(pair.split("=")[0]); if (Number.isInteger(id) && id > 0) ids.add(id); }
  return [...ids];
}

type BalanceReader = (input: { rpcUrl: string; contract: Address; owner: Address }) => Promise<{ balance: bigint; blockNumber: bigint }>;

const readBalance: BalanceReader = async ({ rpcUrl, contract, owner }) => {
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 8_000, retryCount: 1 }) });
  const blockNumber = await client.getBlockNumber();
  const balance = await client.readContract({ address: contract, abi: erc721, functionName: "balanceOf", args: [owner], blockNumber });
  return { balance, blockNumber };
};

/**
 * The objective check after the TAKE: for NFT_HOLD plans that are due, read
 * balanceOf(recipient wallet) on the declared chain and record Yes/No with the
 * read as evidence. A team review already recorded is never overwritten; the team
 * can override an automatic result with a note.
 */
export class EvaluationAutoChecker {
  constructor(private readonly db: Database, private readonly env: ApiEnv, private readonly reader: BalanceReader = readBalance,
    private readonly now: () => Date = () => new Date()) {}

  async runDue(deadline = Date.now() + 15_000) {
    let due: Array<{ plan: typeof schema.campaignEvaluationPlans.$inferSelect; template: typeof schema.evaluationPlanTemplates.$inferSelect; campaign: typeof schema.campaigns.$inferSelect }>;
    try {
      due = await this.db.select({ plan: schema.campaignEvaluationPlans, template: schema.evaluationPlanTemplates, campaign: schema.campaigns })
        .from(schema.evaluationPlanTemplates)
        .innerJoin(schema.campaignEvaluationPlans, eq(schema.campaignEvaluationPlans.id, schema.evaluationPlanTemplates.planId))
        .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignEvaluationPlans.campaignId))
        .where(and(eq(schema.evaluationPlanTemplates.template, "NFT_HOLD"), isNull(schema.evaluationPlanTemplates.autoCheckedAt),
          eq(schema.campaigns.status, "FINALIZED"), lte(schema.campaignEvaluationPlans.evaluateAfter, this.now())))
        .orderBy(schema.campaignEvaluationPlans.evaluateAfter).limit(10);
    } catch (error) {
      if (isMissingTable(error)) return { checked: 0, skipped: "TEMPLATES_NOT_MIGRATED" };
      throw error;
    }
    const results: unknown[] = [];
    for (const row of due) {
      if (Date.now() > deadline) break;
      results.push(await this.checkPlan(row.plan, row.template, row.campaign));
    }
    return { checked: results.length, results };
  }

  private async recipients(campaign: typeof schema.campaigns.$inferSelect) {
    if (!campaign.finalResultHash) return [] as string[];
    const [run] = await this.db.select().from(schema.allocationRuns).where(and(eq(schema.allocationRuns.campaignId, campaign.id),
      eq(schema.allocationRuns.resultHash, campaign.finalResultHash), inArray(schema.allocationRuns.status, ["COMPLETED", "FINALIZED"]))).limit(1);
    if (!run) return [];
    const rows = await this.db.select({ key: schema.allocationResults.recipientKey, identityId: schema.allocationResults.recipientTakeIdentityId })
      .from(schema.allocationResults).where(and(eq(schema.allocationResults.allocationRunId, run.id), eq(schema.allocationResults.selected, true)));
    const keys: string[] = [];
    for (const row of rows) {
      if (row.key) keys.push(row.key.toLowerCase());
      else if (row.identityId) {
        const [identity] = await this.db.select({ key: schema.takeIdentities.protocolIdentityKey }).from(schema.takeIdentities).where(eq(schema.takeIdentities.id, row.identityId)).limit(1);
        if (identity) keys.push(identity.key.toLowerCase());
      }
    }
    return [...new Set(keys)];
  }

  async checkPlan(plan: typeof schema.campaignEvaluationPlans.$inferSelect, template: typeof schema.evaluationPlanTemplates.$inferSelect, campaign: typeof schema.campaigns.$inferSelect) {
    const params = template.params as { nftContract?: string; chainId?: number };
    const rpcUrl = params.chainId ? evaluationRpcUrl(this.env, params.chainId) : null;
    const checkedAt = this.now();
    const report: { checkedAt: string; chainId: number | null; contract: string | null; error?: string; recipients: Array<Record<string, unknown>> } =
      { checkedAt: checkedAt.toISOString(), chainId: params.chainId ?? null, contract: params.nftContract ?? null, recipients: [] };
    if (!rpcUrl || !params.nftContract || !/^0x[0-9a-fA-F]{40}$/.test(params.nftContract)) {
      report.error = !rpcUrl ? "NO_RPC_FOR_CHAIN" : "INVALID_CONTRACT";
    } else {
      for (const key of await this.recipients(campaign)) {
        const [identity] = await this.db.select({ id: schema.takeIdentities.id }).from(schema.takeIdentities).where(eq(schema.takeIdentities.protocolIdentityKey, key)).limit(1);
        const wallets = identity ? await this.db.select({ address: schema.wallets.address }).from(schema.wallets)
          .where(and(eq(schema.wallets.takeIdentityId, identity.id), eq(schema.wallets.isActive, true))) : [];
        let status: "POSITIVE" | "NEGATIVE" | "INCONCLUSIVE" = "INCONCLUSIVE";
        const reads: string[] = [];
        if (!wallets.length) reads.push("No wallet linked to this recipient.");
        let failed = false;
        for (const wallet of wallets) {
          try {
            const read = await this.reader({ rpcUrl, contract: params.nftContract as Address, owner: wallet.address as Address });
            reads.push(`balanceOf(${wallet.address}) = ${read.balance} at block ${read.blockNumber}`);
            if (read.balance > 0n) status = "POSITIVE";
          } catch { failed = true; reads.push(`balanceOf(${wallet.address}) could not be read`); }
        }
        if (status !== "POSITIVE" && wallets.length && !failed) status = "NEGATIVE";
        const note = `Automatic check · chain ${params.chainId} · contract ${params.nftContract} · ${reads.join("; ")} · ${checkedAt.toISOString()}. ${status === "POSITIVE" ? "Still holds the NFT." : status === "NEGATIVE" ? "No longer holds the NFT." : "Could not decide automatically."} The team can override this with a note.`;
        report.recipients.push({ recipientKey: key, status, reads });
        const [existing] = await this.db.select().from(schema.recipientEvaluations)
          .where(and(eq(schema.recipientEvaluations.planId, plan.id), eq(schema.recipientEvaluations.recipientKey, key))).limit(1);
        if (existing && existing.status !== "PENDING") continue; // a team review stands
        const values = { planId: plan.id, recipientKey: key, status, evidenceUrls: [] as string[], note: note.slice(0, 2_000), isPublic: true,
          evaluatorIdentityId: plan.createdByIdentityId, evaluatedAt: status === "INCONCLUSIVE" && failed ? null : checkedAt, updatedAt: checkedAt };
        await this.db.insert(schema.recipientEvaluations).values(values)
          .onConflictDoUpdate({ target: [schema.recipientEvaluations.planId, schema.recipientEvaluations.recipientKey], set: values });
      }
    }
    await this.db.update(schema.evaluationPlanTemplates).set({ autoCheckedAt: checkedAt, autoCheckReport: report })
      .where(eq(schema.evaluationPlanTemplates.planId, plan.id));
    return { planId: plan.id, campaignId: campaign.id, ...report };
  }
}
