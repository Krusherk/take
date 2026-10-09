import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import { decodeFunctionData, keccak256, toHex, type Address, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, schema, type Database } from "@take/database";
import { takeCampaignManagerAbi } from "@take/chain";
import { loadApiEnv, type ApiEnv } from "../config/env.js";
import { AutoFinalizer, OnchainStatus } from "./autoFinalizer.js";
import { CampaignLifecycleService } from "./campaignLifecycle.js";
import { ServiceError } from "./errors.js";
import type { ServerWallet } from "./serverWallet.js";
import { cronRoutes } from "../routes/cron.js";

const envPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
const manager = "0x00000000000000000000000000000000000a11ce" as Address;
const serverAddress = "0x000000000000000000000000000000000000f1a1" as Address;
const otherOrganizer = "0x000000000000000000000000000000000000beef" as Address;
let database: ReturnType<typeof createDatabaseClient>;
let db: Database;
let env: ApiEnv;

beforeAll(() => {
  if (!process.env.DATABASE_URL) process.loadEnvFile(envPath);
  env = { ...loadApiEnv(process.env), TAKE_CAMPAIGN_MANAGER_ADDRESS: manager, MONAD_NETWORK: "testnet", AUTO_FINALIZE_ENABLED: true };
  database = createDatabaseClient(env.DATABASE_URL);
  db = database.db;
});
afterAll(async () => { await database.client.end(); });

/** Mocked Monad: tracks onchain status per campaign and every broadcast. */
function fakeChain(organizers: Map<bigint, Address>) {
  const status = new Map<bigint, number>();
  const broadcasts: Array<{ functionName: string; args: readonly unknown[]; hash: Hex }> = [];
  const client = {
    readContract: async ({ args }: { args: [bigint] }) => {
      const id = args[0];
      const tuple = Array(15).fill(0) as unknown[];
      tuple[0] = organizers.get(id) ?? otherOrganizer;
      tuple[8] = status.get(id) ?? OnchainStatus.Active;
      return tuple;
    },
    getTransaction: async () => ({})
  };
  let nonce = 0;
  const wallet = {
    address: serverAddress,
    client,
    sign: async (call: { to: Address; data: Hex; chainId: number }) => {
      const current = nonce++;
      return { hash: keccak256(toHex(`${call.data}:${current}`)), serialized: call.data, from: serverAddress, nonce: current };
    },
    broadcast: async (signed: { hash: Hex; serialized: Hex }) => {
      const decoded = decodeFunctionData({ abi: takeCampaignManagerAbi, data: signed.serialized });
      broadcasts.push({ functionName: decoded.functionName, args: decoded.args ?? [], hash: signed.hash });
      const id = (decoded.args ?? [])[0] as bigint;
      if (decoded.functionName === "closeCampaign") status.set(id, OnchainStatus.Closed);
      if (decoded.functionName === "finalizeAllocation") status.set(id, OnchainStatus.Finalized);
      return { status: "success" };
    }
  } as unknown as ServerWallet;
  return { client, wallet, status, broadcasts };
}

/** Real intent claiming; the receipt projection is simulated from the fake chain. */
class FakeLifecycle extends CampaignLifecycleService {
  override async reconcile(intentId: string) {
    const [intent] = await db.select().from(schema.campaignLifecycleIntents).where(eq(schema.campaignLifecycleIntents.id, intentId));
    if (intent?.transactionHash && intent.status === "SUBMITTED") {
      const next = intent.action === "CLOSE" ? "CLOSED" : intent.action === "FINALIZE" ? "FINALIZED" : "ACTIVE";
      await db.update(schema.campaigns).set({ status: next }).where(eq(schema.campaigns.id, intent.campaignId));
      await db.update(schema.campaignLifecycleIntents).set({ status: "COMPLETED" }).where(eq(schema.campaignLifecycleIntents.id, intentId));
    }
    const [view] = await db.select().from(schema.campaignLifecycleIntents).where(eq(schema.campaignLifecycleIntents.id, intentId));
    return { ...view!, onchainCampaignId: null, transaction: { to: view!.contractAddress, data: view!.expectedCalldata, value: "0x0", chainId: view!.chainId } } as never;
  }
}

function fakeAllocations(calls: string[], mode: "ok" | "drand" = "ok") {
  return {
    run: async (campaignId: string) => {
      calls.push(campaignId);
      if (mode === "drand") throw new ServiceError("DRAND_ROUND_NOT_AVAILABLE", "not yet", 409);
      const resultHash = keccak256(toHex(`result:${campaignId}`));
      await db.insert(schema.allocationRuns).values({
        campaignId, strategyId: "RAW_UNIQUE_SUPPORT", strategyVersion: "2", status: "COMPLETED",
        inputSnapshotHash: keccak256(toHex(`input:${campaignId}`)), resultHash, completedAt: new Date()
      });
      await db.update(schema.campaigns).set({ status: "ALLOCATING" }).where(eq(schema.campaigns.id, campaignId));
      return { run: { resultHash } } as never;
    }
  };
}

async function createCampaign(input: { onchainId: bigint; endOffsetMs: number; status?: "ACTIVE" | "CREATED" }) {
  const userId = randomUUID();
  const identityId = randomUUID();
  const organizationId = randomUUID();
  const id = randomUUID();
  await db.insert(schema.users).values({ id: userId, privyUserId: `did:privy:finalizer-${id}`, displayName: "Operator" });
  await db.insert(schema.takeIdentities).values({ id: identityId, userId, creationNonce: id.replaceAll("-", ""), protocolIdentityKey: keccak256(toHex(id)) });
  await db.insert(schema.organizations).values({ id: organizationId, name: `Finalizer ${id.slice(0, 8)}`, slug: `finalizer-${id}` });
  const end = new Date(Date.now() + input.endOffsetMs);
  await db.insert(schema.campaigns).values({
    id, organizationId, createdByIdentityId: identityId, status: input.status ?? "ACTIVE", title: `Auto ${id.slice(0, 6)}`,
    startTime: new Date(end.getTime() - 3_600_000), endTime: end, nominationLimit: 1,
    nominatorEligibilityMode: "MERKLE_ALLOWLIST", recipientEligibilityMode: "MERKLE_ALLOWLIST", nominationVisibilityMode: "PUBLIC",
    onchainCampaignId: input.onchainId, chainId: 10143, managerContractAddress: manager, onchainOperatorWalletAddress: serverAddress.toLowerCase()
  });
  return id;
}

const noIndexer = { runUntilCaughtUp: async () => ({ iterations: 0, scanned: 0, backfilled: 0, caughtUp: true, lastRun: undefined }) } as never;
const onchainId = () => BigInt(Math.floor(Math.random() * 1e12)) + 1_000_000n;

describe.sequential("auto-finalizer (mocked Monad)", () => {
  it("closes, allocates and finalizes a campaign it organizes, and a rerun sends nothing", async () => {
    const id = onchainId();
    const campaignId = await createCampaign({ onchainId: id, endOffsetMs: -60_000 });
    const chain = fakeChain(new Map([[id, serverAddress]]));
    const allocationCalls: string[] = [];
    const deps = { wallet: chain.wallet, client: chain.client as never, indexer: noIndexer, lifecycle: new FakeLifecycle(db, env), allocations: fakeAllocations(allocationCalls) };

    const first = await new AutoFinalizer(db, env, deps).run();
    const mine = first.steps.filter((item) => item.campaignId === campaignId);
    expect(mine.map((item) => [item.action, item.outcome])).toEqual([["CLOSE", "COMPLETED"], ["ALLOCATE", "COMPLETED"], ["FINALIZE", "COMPLETED"]]);
    expect(chain.broadcasts.map((item) => item.functionName)).toEqual(["closeCampaign", "finalizeAllocation"]);
    expect(chain.broadcasts[1]!.args).toEqual([id, keccak256(toHex(`result:${campaignId}`))]);
    expect(mine[2]!.transactionHash).toBe(chain.broadcasts[1]!.hash);

    const second = await new AutoFinalizer(db, env, deps).run();
    expect(second.steps.filter((item) => item.campaignId === campaignId)).toEqual([]);
    expect(chain.broadcasts).toHaveLength(2);
    expect(allocationCalls).toEqual([campaignId]);
  });

  it("closes and allocates but skips finalizing a campaign another wallet organizes", async () => {
    const id = onchainId();
    const campaignId = await createCampaign({ onchainId: id, endOffsetMs: -60_000 });
    const chain = fakeChain(new Map([[id, otherOrganizer]]));
    const deps = { wallet: chain.wallet, client: chain.client as never, indexer: noIndexer, lifecycle: new FakeLifecycle(db, env), allocations: fakeAllocations([]) };
    const report = await new AutoFinalizer(db, env, deps).run();
    const mine = report.steps.filter((item) => item.campaignId === campaignId);
    expect(mine.map((item) => [item.action, item.outcome])).toEqual([["CLOSE", "COMPLETED"], ["ALLOCATE", "COMPLETED"], ["SKIP", "SERVER_WALLET_NOT_ORGANIZER"]]);
    expect(chain.broadcasts.map((item) => item.functionName)).toEqual(["closeCampaign"]);
  });

  it("never broadcasts twice when two runs overlap", async () => {
    const id = onchainId();
    const campaignId = await createCampaign({ onchainId: id, endOffsetMs: -60_000 });
    const chain = fakeChain(new Map([[id, serverAddress]]));
    const make = () => new AutoFinalizer(db, env, { wallet: chain.wallet, client: chain.client as never, indexer: noIndexer, lifecycle: new FakeLifecycle(db, env), allocations: fakeAllocations([], "drand") });
    await Promise.all([make().run(), make().run()]);
    const closes = chain.broadcasts.filter((item) => item.functionName === "closeCampaign" && item.args[0] === id);
    expect(closes).toHaveLength(1);
    const [row] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
    expect(row!.status).toBe("CLOSED");
  });

  it("waits for the drand round and leaves campaigns that have not ended alone", async () => {
    const id = onchainId();
    const closedId = await createCampaign({ onchainId: id, endOffsetMs: -60_000 });
    const liveId = await createCampaign({ onchainId: onchainId(), endOffsetMs: 3_600_000 });
    const chain = fakeChain(new Map([[id, serverAddress]]));
    const report = await new AutoFinalizer(db, env, { wallet: chain.wallet, client: chain.client as never, indexer: noIndexer, lifecycle: new FakeLifecycle(db, env), allocations: fakeAllocations([], "drand") }).run();
    expect(report.steps.filter((item) => item.campaignId === closedId).map((item) => [item.action, item.outcome]))
      .toEqual([["CLOSE", "COMPLETED"], ["WAIT", "DRAND_ROUND_NOT_AVAILABLE"]]);
    expect(report.steps.filter((item) => item.campaignId === liveId)).toEqual([]);
  });

  it("does nothing onchain without a server wallet", async () => {
    const id = onchainId();
    const campaignId = await createCampaign({ onchainId: id, endOffsetMs: -60_000 });
    const chain = fakeChain(new Map());
    const report = await new AutoFinalizer(db, env, { wallet: null, client: chain.client as never, indexer: noIndexer, lifecycle: new FakeLifecycle(db, env), allocations: fakeAllocations([]) }).run();
    expect(report.steps.find((item) => item.campaignId === campaignId)).toMatchObject({ action: "SKIP", outcome: "NO_SERVER_WALLET" });
    expect(chain.broadcasts).toHaveLength(0);
  });

  it("rejects the cron route without the cron or internal token", async () => {
    const app = Fastify();
    app.decorate("env", { ...env, NODE_ENV: "production", CRON_SECRET: "cron-test-secret", INTERNAL_API_TOKEN: "internal-test-token", TAKE_CAMPAIGN_MANAGER_ADDRESS: undefined, FINALIZER_PRIVATE_KEY: undefined } as ApiEnv);
    app.decorate("db", db);
    await app.register(cronRoutes);
    expect((await app.inject({ method: "GET", url: "/internal/cron/finalize" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/internal/cron/finalize", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    const ok = await app.inject({ method: "GET", url: "/internal/cron/finalize", headers: { authorization: "Bearer cron-test-secret" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ serverWallet: null, steps: [] });
    expect((await app.inject({ method: "POST", url: "/internal/cron/finalize", headers: { authorization: "Bearer internal-test-token" } })).statusCode).toBe(200);
    await app.close();
  });
});
