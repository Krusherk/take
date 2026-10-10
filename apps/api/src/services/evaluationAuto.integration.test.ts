import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { keccak256, toHex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, schema, type Database } from "@take/database";
import { loadApiEnv, type ApiEnv } from "../config/env.js";
import { EvaluationAutoChecker } from "./evaluationAuto.js";
import { OrganizerCampaignService } from "./organizerCampaign.js";
import { SignalService } from "./signal.js";

const envPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
let database: ReturnType<typeof createDatabaseClient>;
let db: Database;
let env: ApiEnv;

beforeAll(() => {
  if (!process.env.DATABASE_URL) process.loadEnvFile(envPath);
  env = { ...loadApiEnv(process.env), MONAD_TESTNET_RPC_URL: "https://rpc.example/monad", X_API_BEARER_TOKEN: undefined };
  database = createDatabaseClient(env.DATABASE_URL);
  db = database.db;
});
afterAll(async () => { await database.client.end(); });

async function person(name: string) {
  const userId = randomUUID(); const identityId = randomUUID(); const seed = randomUUID();
  await db.insert(schema.users).values({ id: userId, privyUserId: `did:privy:test-eval-${seed}`, displayName: name });
  const key = keccak256(toHex(seed));
  await db.insert(schema.takeIdentities).values({ id: identityId, userId, creationNonce: seed.replaceAll("-", ""), protocolIdentityKey: key });
  const address = `0x${seed.replaceAll("-", "").slice(0, 32)}00000000`.toLowerCase();
  await db.insert(schema.wallets).values({ takeIdentityId: identityId, address, walletType: "privy", chainType: "ethereum", isPrimary: true });
  return { takeIdentityId: identityId, key: key.toLowerCase(), address };
}

describe.sequential("objective check after the TAKE", () => {
  it("reads balanceOf for each recipient on the check date and records Yes/No, keeping team reviews", async () => {
    const owner = await person("Owner");
    const orgId = randomUUID();
    await db.insert(schema.organizations).values({ id: orgId, name: `Eval ${orgId.slice(0, 6)}`, slug: `eval-${orgId}` });
    await db.insert(schema.organizationMembers).values({ organizationId: orgId, takeIdentityId: owner.takeIdentityId, role: "OWNER" });
    const holder = await person("Holder");
    const dumper = await person("Dumper");
    const created = await new OrganizerCampaignService(db, env).create({
      organizationId: orgId, title: "NFT whitelist", description: "Free mint", resourceName: "WL spot", seatCount: 2,
      startTime: new Date(Date.now() + 3_600_000), endTime: new Date(Date.now() + 3 * 3_600_000),
      giverIdentityIds: [], recipientIdentityIds: [holder.takeIdentityId, dumper.takeIdentityId],
      signups: { deadline: null, recipientSelfJoin: false }
    }, { takeIdentityId: owner.takeIdentityId, isOperator: true });

    const signal = new SignalService(db);
    const contract = "0x00000000000000000000000000000000000000aa";
    const plan = await signal.lockPlan(created.campaignId, owner.takeIdentityId, {
      domain: "ACCESS", question: "Did they still hold the NFT 30 days after mint?", criteria: "Objective balanceOf read on the check date.",
      evaluateAfter: new Date(Date.now() + 4 * 3_600_000), evidenceExpected: false,
      template: { type: "NFT_HOLD", params: { nftContract: contract, chainId: 10143, holdDays: 30 } }
    });
    expect(plan.template).toMatchObject({ type: "NFT_HOLD", params: { chainId: 10143 } });
    expect((await signal.plan(created.campaignId))?.template?.type).toBe("NFT_HOLD");

    // Finalize with both recipients selected; the checker's clock is past the check date.
    const resultHash = keccak256(toHex(created.campaignId));
    await db.update(schema.campaigns).set({ status: "FINALIZED", finalResultHash: resultHash }).where(eq(schema.campaigns.id, created.campaignId));
    const [run] = await db.insert(schema.allocationRuns).values({
      campaignId: created.campaignId, strategyId: "unique-support", strategyVersion: "1", inputSnapshotHash: resultHash, resultHash, status: "COMPLETED"
    }).returning();
    await db.insert(schema.allocationResults).values([
      { allocationRunId: run!.id, recipientTakeIdentityId: holder.takeIdentityId, score: 2, selected: true },
      { allocationRunId: run!.id, recipientTakeIdentityId: dumper.takeIdentityId, score: 1, selected: true }
    ]);

    const reads: string[] = [];
    const checker = new EvaluationAutoChecker(db, env, async ({ owner: wallet, contract: read, rpcUrl }) => {
      reads.push(`${rpcUrl}:${read}:${wallet}`);
      return { balance: wallet.toLowerCase() === holder.address ? 1n : 0n, blockNumber: 123n };
    }, () => new Date(Date.now() + 5 * 3_600_000));
    // Before the check date nothing is read.
    expect((await new EvaluationAutoChecker(db, env, async () => { throw new Error("read too early"); }).runDue()).results ?? [])
      .not.toContainEqual(expect.objectContaining({ planId: plan.id }));
    // Other suites share this database: run until this plan has been checked.
    let ours = false;
    for (let attempt = 0; attempt < 10 && !ours; attempt += 1) {
      const result = await checker.runDue();
      ours = (result.results ?? []).some((item) => (item as { planId: string }).planId === plan.id);
      if (!result.checked) break;
    }
    expect(ours).toBe(true);
    expect(reads).toContain(`https://rpc.example/monad:${contract}:${holder.address}`);

    const rows = await db.select().from(schema.recipientEvaluations).where(eq(schema.recipientEvaluations.planId, plan.id));
    const byKey = new Map(rows.map((row) => [row.recipientKey, row]));
    expect(byKey.get(holder.key)?.status).toBe("POSITIVE");
    expect(byKey.get(dumper.key)?.status).toBe("NEGATIVE");
    expect(byKey.get(dumper.key)?.note).toContain(`balanceOf(${dumper.address}) = 0 at block 123`);

    // The team overrides one; a later run never overwrites it, and the plan isn't re-read.
    await db.update(schema.recipientEvaluations).set({ status: "INCONCLUSIVE", note: "Transferred to a cold wallet, confirmed." })
      .where(and(eq(schema.recipientEvaluations.planId, plan.id), eq(schema.recipientEvaluations.recipientKey, dumper.key)));
    const again = await checker.runDue();
    // Locked template parameters cannot be rewritten.
    await expect(db.update(schema.evaluationPlanTemplates).set({ params: { nftContract: "0x00000000000000000000000000000000000000bb", chainId: 10143 } })
      .where(eq(schema.evaluationPlanTemplates.planId, plan.id))).rejects.toBeTruthy();
    expect((again.results ?? []).some((item) => (item as { planId: string }).planId === plan.id)).toBe(false);
    const after = await signal.after(created.campaignId, true);
    expect(after.recipients.find((item) => item.person.key === dumper.key)?.evaluation?.status).toBe("INCONCLUSIVE");
  });
});
