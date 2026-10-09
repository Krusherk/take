import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, schema, type Database } from "@take/database";
import { loadApiEnv, type ApiEnv } from "../config/env.js";
import { OrganizerCampaignService } from "./organizerCampaign.js";
import { CampaignSignupService, type SignupOpener } from "./signups.js";
import { GasDripService } from "./gasDrip.js";
import { CampaignService } from "./campaign.js";
import type { ServerWallet } from "./serverWallet.js";

const envPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
let database: ReturnType<typeof createDatabaseClient>;
let db: Database;
let env: ApiEnv;

beforeAll(() => {
  if (!process.env.DATABASE_URL) process.loadEnvFile(envPath);
  env = { ...loadApiEnv(process.env), X_API_BEARER_TOKEN: undefined };
  database = createDatabaseClient(env.DATABASE_URL);
  db = database.db;
});
afterAll(async () => { await database.client.end(); });

async function person(name: string, options: { wallet?: boolean; handle?: string } = {}) {
  const userId = randomUUID();
  const identityId = randomUUID();
  const seed = randomUUID();
  await db.insert(schema.users).values({ id: userId, privyUserId: `did:privy:test-signup-${seed}`, displayName: name });
  await db.insert(schema.takeIdentities).values({
    id: identityId, userId, creationNonce: seed.replaceAll("-", ""), protocolIdentityKey: keccak256(toHex(seed)),
    createdAt: new Date(Date.now() - 86_400_000)
  });
  const address = `0x${seed.replaceAll("-", "").slice(0, 32)}00000000`.toLowerCase();
  if (options.wallet !== false) {
    await db.insert(schema.wallets).values({
      takeIdentityId: identityId, address, walletType: "privy", chainType: "ethereum", isPrimary: true,
      firstObservedAt: new Date(Date.now() - 3_600_000)
    });
  }
  if (options.handle) {
    await db.insert(schema.socialAccounts).values({ takeIdentityId: identityId, provider: "twitter", providerUserId: `x-${seed}`, username: options.handle, displayName: name });
  }
  return { takeIdentityId: identityId, primaryWalletAddress: options.wallet === false ? null : address, name };
}

async function organization(owner: string) {
  const id = randomUUID();
  await db.insert(schema.organizations).values({ id, name: `Signups ${id.slice(0, 6)}`, slug: `signups-${id}` });
  await db.insert(schema.organizationMembers).values({ organizationId: id, takeIdentityId: owner, role: "OWNER" });
  return id;
}

function recordingOpener() {
  const calls: string[] = [];
  const opener: SignupOpener = {
    async publishAndOpen(campaignId) {
      calls.push(campaignId);
      // Simulates the server wallet publish + activate being indexed.
      await db.update(schema.campaigns).set({ status: "ACTIVE", onchainCampaignId: BigInt(Math.floor(Math.random() * 1e9)) })
        .where(eq(schema.campaigns.id, campaignId));
      return { outcome: "ACTIVE", transactionHash: keccak256(toHex(campaignId)) };
    }
  };
  return { opener, calls };
}

describe.sequential("campaign sign-ups", () => {
  it("collects givers through the join link, locks the lists and opens with the server wallet", async () => {
    const operator = await person("Operator");
    const ada = await person("Ada", { handle: "ada" });
    const orgId = await organization(operator.takeIdentityId);
    const organizer = new OrganizerCampaignService(db, env);
    const signups = new CampaignSignupService(db, env);
    const actor = { takeIdentityId: operator.takeIdentityId, isOperator: true };

    const created = await organizer.create({
      organizationId: orgId, title: "Whitelist round", description: "Back the builders", resourceName: "WL spot", seatCount: 2,
      startTime: new Date(), endTime: new Date(Date.now() + 3 * 3_600_000),
      giverIdentityIds: [], recipientIdentityIds: [ada.takeIdentityId],
      signups: { deadline: null, recipientSelfJoin: true }
    }, actor);
    expect(created.stage).toBe("SIGNUPS");
    const code = (created as { joinCode: string }).joinCode;

    const view = await signups.joinView(code, null, "@ADA");
    expect(view.open).toBe(true);
    expect(view.for?.takeIdentityId).toBe(ada.takeIdentityId);
    expect(view.counts).toEqual({ givers: 0, recipients: 1 });

    const bo = await person("Bo");
    const cy = await person("Cy");
    const di = await person("Di", { wallet: false });
    const eve = await person("Eve");
    await signups.join(code, bo, { role: "GIVER" });
    const viaAda = await signups.join(code, cy, { role: "GIVER", forRef: "ada" });
    expect(viaAda.broughtBy?.takeIdentityId).toBe(ada.takeIdentityId);
    await signups.join(code, di, { role: "GIVER" });
    await signups.join(code, eve, { role: "RECIPIENT" });
    expect((await signups.join(code, bo, { role: "RECIPIENT" })).alreadyJoined).toBe(true);

    // Joiners can see the draft they joined; strangers cannot.
    const campaigns = new CampaignService(db);
    expect((await campaigns.getCampaignView(created.campaignId, bo.takeIdentityId))?.signups).toMatchObject({ joinedAs: "GIVER", open: true });
    expect((await campaigns.listCampaigns(bo.takeIdentityId)).some((item) => item.id === created.campaignId)).toBe(true);
    const outsider = await person("Outsider");
    expect((await campaigns.listCampaigns(outsider.takeIdentityId)).some((item) => item.id === created.campaignId)).toBe(false);

    let organizerView = await signups.organizerView(created.campaignId, actor);
    expect(organizerView.givers.map((item) => item.displayName)).toEqual(["Bo", "Cy", "Di"]);
    expect(organizerView.givers[1]!.broughtBy?.displayName).toBe("Ada");
    expect(organizerView.recipients.map((item) => item.displayName)).toEqual(["Ada", "Eve"]);

    // Removed people cannot rejoin.
    organizerView = await signups.removeMember(created.campaignId, actor, eve.takeIdentityId);
    expect(organizerView.recipients).toHaveLength(1);
    await expect(signups.join(code, eve, { role: "RECIPIENT" })).rejects.toMatchObject({ code: "SIGNUP_REMOVED" });

    // A non-member organizer cannot see the list.
    const stranger = await person("Stranger");
    await expect(signups.organizerView(created.campaignId, { takeIdentityId: stranger.takeIdentityId, isOperator: false })).rejects.toBeTruthy();

    const { opener, calls } = recordingOpener();
    const closed = await signups.requestClose(created.campaignId, actor, opener);
    expect(closed.result.outcome).toBe("OPEN");
    expect(calls).toEqual([created.campaignId]);
    expect(closed.status).toBe("CLOSED");
    const report = closed.closeReport as { skippedGivers: Array<{ name: string; reason: string }>; eligibleGivers: number; eligibleRecipients: number };
    expect(report.skippedGivers).toEqual([expect.objectContaining({ name: "Di", reason: "NO_WALLET" })]);
    expect(report.eligibleGivers).toBe(2);
    expect(report.eligibleRecipients).toBe(1);

    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, created.campaignId));
    expect(campaign!.launchApprovedAt).toBeTruthy();
    expect(campaign!.rulesHash).toBeTruthy();

    // Link is closed now; interest is stored.
    const after = await signups.joinView(code, stranger.takeIdentityId, null);
    expect(after.open).toBe(false);
    await expect(signups.join(code, stranger, { role: "GIVER" })).rejects.toMatchObject({ code: "SIGNUPS_CLOSED" });
    await signups.registerInterest(code, stranger);
    expect((await signups.joinView(code, stranger.takeIdentityId, null)).viewer?.interested).toBe(true);

    // Givers were notified exactly once.
    const notes = await db.select().from(schema.notifications).where(and(
      eq(schema.notifications.type, "NOMINATIONS_OPEN"),
      eq(schema.notifications.recipientTakeIdentityId, bo.takeIdentityId)
    ));
    expect(notes).toHaveLength(1);
    expect(await signups.notifyOpened(created.campaignId)).toBe(0);
  });

  it("fails cleanly when nobody joined, and a non-operator draft keeps its people", async () => {
    const operator = await person("Operator 2");
    const orgId = await organization(operator.takeIdentityId);
    const organizer = new OrganizerCampaignService(db, env);
    const signups = new CampaignSignupService(db, env);
    const created = await organizer.create({
      organizationId: orgId, title: "Empty", description: "Nobody comes", resourceName: "Seat", seatCount: 1,
      startTime: new Date(), endTime: new Date(Date.now() + 3_600_000), giverIdentityIds: [], recipientIdentityIds: [],
      signups: { deadline: new Date(Date.now() + 600_000), recipientSelfJoin: false }
    }, { takeIdentityId: operator.takeIdentityId, isOperator: true });
    const { opener, calls } = recordingOpener();
    await expect(signups.requestClose(created.campaignId, { takeIdentityId: operator.takeIdentityId, isOperator: true }, opener))
      .rejects.toMatchObject({ code: "ROSTER_REQUIRED" });
    expect(calls).toEqual([]);

    const owner = await person("Owner");
    const giver = await person("Giver");
    const recipient = await person("Recipient");
    const org2 = await organization(owner.takeIdentityId);
    const draft = await organizer.create({
      organizationId: org2, title: "Plain draft", description: "Saved by a non-operator", resourceName: "Seat", seatCount: 1,
      startTime: new Date(Date.now() + 600_000), endTime: new Date(Date.now() + 3_600_000),
      giverIdentityIds: [giver.takeIdentityId], recipientIdentityIds: [recipient.takeIdentityId]
    }, { takeIdentityId: owner.takeIdentityId, isOperator: false });
    expect(draft.stage).toBe("DRAFT");
    const view = await signups.organizerView(draft.campaignId, { takeIdentityId: owner.takeIdentityId, isOperator: false });
    expect(view.givers.map((item) => item.displayName)).toEqual(["Giver"]);
    expect(view.recipients.map((item) => item.displayName)).toEqual(["Recipient"]);
    expect(view.joinEnabled).toBe(false);
    expect(view.canOpen).toBe(false);
    await expect(signups.requestClose(draft.campaignId, { takeIdentityId: owner.takeIdentityId, isOperator: false }, opener))
      .rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
  });
});

describe.sequential("scheduled sign-up deadline", () => {
  it("the scheduled run opens operator-approved campaigns at their deadline, and only those", async () => {
    const operator = await person("Cron operator");
    const owner = await person("Cron owner");
    const orgId = await organization(operator.takeIdentityId);
    await db.insert(schema.organizationMembers).values({ organizationId: orgId, takeIdentityId: owner.takeIdentityId, role: "ADMIN" });
    const organizer = new OrganizerCampaignService(db, env);
    const signups = new CampaignSignupService(db, env);
    const base = {
      organizationId: orgId, description: "Cron", resourceName: "Seat", seatCount: 1,
      startTime: new Date(), endTime: new Date(Date.now() + 3_600_000), giverIdentityIds: [], recipientIdentityIds: [],
      signups: { deadline: new Date(Date.now() + 600_000), recipientSelfJoin: true }
    };
    const approved = await organizer.create({ ...base, title: "Approved" }, { takeIdentityId: operator.takeIdentityId, isOperator: true });
    const unapproved = await organizer.create({ ...base, title: "Unapproved" }, { takeIdentityId: owner.takeIdentityId, isOperator: false });
    for (const created of [approved, unapproved]) {
      const code = (created as { joinCode: string }).joinCode;
      await signups.join(code, await person("Giver"), { role: "GIVER" });
      await signups.join(code, await person("Recipient"), { role: "RECIPIENT" });
    }
    const { opener, calls } = recordingOpener();
    // Before the deadline nothing happens.
    expect((await signups.runDue(opener)).steps.filter((step) => [approved.campaignId, unapproved.campaignId].includes(step.campaignId))).toEqual([]);
    await db.update(schema.campaignSignups).set({ signupDeadline: new Date(Date.now() - 1_000) })
      .where(inArray(schema.campaignSignups.campaignId, [approved.campaignId, unapproved.campaignId]));
    const run = await signups.runDue(opener);
    expect(run.steps.filter((step) => step.campaignId === approved.campaignId)).toEqual([{ campaignId: approved.campaignId, outcome: "OPEN" }]);
    expect(run.steps.some((step) => step.campaignId === unapproved.campaignId)).toBe(false);
    expect(calls).toEqual([approved.campaignId]);
    expect((await signups.joinView((unapproved as { joinCode: string }).joinCode, null, null)).open).toBe(false);
  });
});

describe.sequential("gas drip", () => {
  function fakeWallet(balances: Map<string, bigint>) {
    const sent: Array<{ to: string; value: bigint }> = [];
    const wallet = {
      address: "0x000000000000000000000000000000000000d1d1" as Address,
      chainId: 10143,
      client: { getBalance: async ({ address }: { address: string }) => balances.get(address.toLowerCase()) ?? 0n },
      sign: async (call: { to: Address; value?: bigint }) => {
        sent.push({ to: call.to.toLowerCase(), value: call.value ?? 0n });
        return { hash: keccak256(toHex(`${call.to}:${sent.length}:${Math.random()}`)) as Hex, serialized: "0x" as Hex, from: "0x000000000000000000000000000000000000d1d1" as Address, nonce: sent.length };
      },
      broadcast: async () => ({ status: "success" })
    } as unknown as ServerWallet;
    return { wallet, sent };
  }

  it("sends once per giver, skips funded or ineligible wallets, and respects the daily cap", async () => {
    const operator = await person("Drip operator");
    const orgId = await organization(operator.takeIdentityId);
    const created = await new OrganizerCampaignService(db, env).create({
      organizationId: orgId, title: "Drip", description: "Gas", resourceName: "Seat", seatCount: 1,
      startTime: new Date(), endTime: new Date(Date.now() + 3_600_000), giverIdentityIds: [], recipientIdentityIds: [],
      signups: { deadline: null, recipientSelfJoin: false }
    }, { takeIdentityId: operator.takeIdentityId, isOperator: true });
    const code = (created as { joinCode: string }).joinCode;
    const signups = new CampaignSignupService(db, env);
    const giver = await person("Thirsty");
    const rich = await person("Rich");
    const outsider = await person("Outsider");
    await signups.join(code, giver, { role: "GIVER" });
    await signups.join(code, rich, { role: "GIVER" });

    const balances = new Map<string, bigint>([[rich.primaryWalletAddress!, 10n ** 18n]]);
    const { wallet, sent } = fakeWallet(balances);
    // Cap high enough for this test regardless of other rows in a shared database.
    const drips = new GasDripService(db, { ...env, GAS_DRIP_ENABLED: true, GAS_DRIP_DAILY_CAP_WEI: (10n ** 30n).toString() }, { wallet });

    const first = await drips.drip(giver);
    expect(first.outcome).toBe("SENT");
    expect(sent).toEqual([{ to: giver.primaryWalletAddress, value: BigInt(env.GAS_DRIP_AMOUNT_WEI) }]);
    expect((await drips.drip(giver)).outcome).toBe("ALREADY_SENT");
    expect((await drips.drip(rich)).outcome).toBe("NOT_NEEDED");
    expect((await drips.drip(outsider)).outcome).toBe("NOT_ELIGIBLE");
    expect(sent).toHaveLength(1);

    const capped = new GasDripService(db, { ...env, GAS_DRIP_ENABLED: true, GAS_DRIP_DAILY_CAP_WEI: "1" }, { wallet });
    const another = await person("Late");
    await signups.join(code, another, { role: "GIVER" });
    expect((await capped.drip(another)).outcome).toBe("DAILY_CAP_REACHED");
    expect(sent).toHaveLength(1);
  });
});
