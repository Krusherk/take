import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { User as PrivyUser } from "@privy-io/node";
import { createDatabaseClient, schema } from "@take/database";
import { externalIdentityKey } from "@take/shared";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdentityService, identityPresentation, observedSocialAccounts } from "./identity.js";

const envPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
let database: ReturnType<typeof createDatabaseClient>;
let identityService: IdentityService;

beforeAll(() => {
  if (!process.env.DATABASE_URL) process.loadEnvFile(envPath);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for identity integration tests");
  database = createDatabaseClient(process.env.DATABASE_URL);
  identityService = new IdentityService(database.db);
});

afterAll(async () => {
  await database.client.end();
});

describe("Privy identity normalization", () => {
  it("uses Twitter as the primary social presentation and profile image", () => {
    const user = privyUser({
      did: "did:privy:presentation",
      accounts: [twitter("twitter-101", "takeperson", "Take Person", "https://pbs.twimg.com/profile.jpg")],
    });

    expect(identityPresentation(user.linked_accounts)).toEqual({
      displayName: "Take Person",
      username: "takeperson",
      avatarUrl: "https://pbs.twimg.com/profile.jpg",
    });
  });

  it("falls back through Farcaster, GitHub, Discord, then email without inventing a handle", () => {
    const emailOnly = privyUser({
      did: "did:privy:email-only",
      accounts: [{ type: "email", address: "member@example.com", verified_at: nowSeconds() }],
    });
    expect(identityPresentation(emailOnly.linked_accounts)).toEqual({
      displayName: "member",
      username: null,
      avatarUrl: null,
    });
  });

  it("rejects non-web profile image schemes before they reach the frontend", () => {
    const user = privyUser({
      did: "did:privy:unsafe-avatar",
      accounts: [twitter("twitter-unsafe", "safehandle", "Safe Name", "javascript:alert(1)")],
    });

    expect(identityPresentation(user.linked_accounts).avatarUrl).toBeNull();
    expect(observedSocialAccounts(user.linked_accounts)[0]?.avatarUrl).toBeNull();
  });

  it("normalizes every supported social account by immutable provider identifier", () => {
    const accounts = observedSocialAccounts([
      twitter("twitter-202", "xname", "X Name", "https://pbs.twimg.com/x.jpg"),
      discord("discord-202", "discordname"),
      github("github-202", "gitname", "Git Name"),
      farcaster(202, "fcname", "FC Name", "https://i.imgur.com/fc.png"),
    ] as PrivyUser["linked_accounts"]);

    expect(accounts.map(({ provider, providerUserId }) => ({ provider, providerUserId }))).toEqual([
      { provider: "twitter", providerUserId: "twitter-202" },
      { provider: "discord", providerUserId: "discord-202" },
      { provider: "github", providerUserId: "github-202" },
      { provider: "farcaster", providerUserId: "202" },
    ]);
  });
});

describe.sequential("IdentityService reconciliation", () => {
  it("creates one TAKE identity on first login and reuses it on return", async () => {
    await withFixture(async ({ did, subject }) => {
      const user = privyUser({ did, accounts: [twitter(subject, "firstlogin", "First Login", null)] });
      const [first, second] = await Promise.all([
        identityService.resolvePrivyUser(user),
        identityService.resolvePrivyUser(user),
      ]);

      expect(second.userId).toBe(first.userId);
      expect(second.takeIdentityId).toBe(first.takeIdentityId);

      const users = await database.db.select().from(schema.users).where(eq(schema.users.privyUserId, did));
      const identities = await database.db.select().from(schema.takeIdentities).where(eq(schema.takeIdentities.userId, first.userId));
      expect(users).toHaveLength(1);
      expect(identities).toHaveLength(1);
    });
  });

  it("updates a Twitter username and avatar without creating another social identity", async () => {
    await withFixture(async ({ did, subject }) => {
      const initial = await identityService.resolvePrivyUser(privyUser({
        did,
        accounts: [twitter(subject, "before-name", "Before Name", "https://pbs.twimg.com/before.jpg")],
      }));
      await identityService.resolvePrivyUser(privyUser({
        did,
        accounts: [twitter(subject, "after-name", "After Name", "https://pbs.twimg.com/after.jpg")],
      }));

      const rows = await database.db.select().from(schema.socialAccounts).where(and(
        eq(schema.socialAccounts.provider, "twitter"),
        eq(schema.socialAccounts.providerUserId, subject),
      ));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        takeIdentityId: initial.takeIdentityId,
        username: "after-name",
        displayName: "After Name",
        avatarUrl: "https://pbs.twimg.com/after.jpg",
        isActive: true,
      });
    });
  });

  it("attaches Discord, GitHub, Farcaster, and multiple wallets to the same TAKE identity", async () => {
    await withFixture(async ({ did, subject }) => {
      const resolved = await identityService.resolvePrivyUser(privyUser({
        did,
        accounts: [
          twitter(subject, "social-owner", "Social Owner", "https://pbs.twimg.com/social.jpg"),
          discord(`${subject}-discord`, "discord-owner"),
          github(`${subject}-github`, "github-owner", "GitHub Owner"),
          farcaster(918273, "farcaster-owner", "Farcaster Owner", "https://i.imgur.com/farcaster.png"),
          wallet("0x1111111111111111111111111111111111111111", "privy"),
          wallet("0x2222222222222222222222222222222222222222", "metamask"),
        ],
      }));

      const socials = await database.db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.takeIdentityId, resolved.takeIdentityId));
      const wallets = await database.db.select().from(schema.wallets).where(eq(schema.wallets.takeIdentityId, resolved.takeIdentityId));
      const me = await identityService.getMe(resolved.takeIdentityId);

      expect(new Set(socials.map((account) => account.provider))).toEqual(new Set(["twitter", "discord", "github", "farcaster"]));
      expect(wallets).toHaveLength(2);
      expect(wallets.filter((item) => item.isPrimary)).toHaveLength(1);
      expect(me.socials.discord.connected).toBe(true);
      expect(me.socials.github.connected).toBe(true);
      expect(me.socials.farcaster.connected).toBe(true);
      expect(me.wallets).toHaveLength(2);
    });
  });

  it("keeps unlinked social history while marking the connection inactive", async () => {
    await withFixture(async ({ did, subject }) => {
      const resolved = await identityService.resolvePrivyUser(privyUser({
        did,
        accounts: [twitter(subject, "unlink-owner", "Unlink Owner", null), discord(`${subject}-discord`, "discord-owner")],
      }));
      await identityService.resolvePrivyUser(privyUser({
        did,
        accounts: [twitter(subject, "unlink-owner", "Unlink Owner", null)],
      }));

      const [row] = await database.db.select().from(schema.socialAccounts).where(and(
        eq(schema.socialAccounts.takeIdentityId, resolved.takeIdentityId),
        eq(schema.socialAccounts.provider, "discord"),
      ));
      expect(row?.isActive).toBe(false);
      expect((await identityService.getMe(resolved.takeIdentityId)).socials.discord.connected).toBe(false);
    });
  });

  it("reconciles a pre-existing external nominee without replacing its nomination", async () => {
    await withFixture(async ({ suffix, did, subject, trackCampaign, trackOrganization }) => {
      const giver = await identityService.resolvePrivyUser(privyUser({
        did: `${did}:giver`,
        accounts: [twitter(`${subject}-giver`, "giver", "Giver", null)],
      }));
      const [external] = await database.db.insert(schema.externalIdentities).values({
        provider: "twitter",
        immutableProviderUserId: subject,
        externalIdentityKey: externalIdentityKey("twitter", subject),
        currentUsername: "future-member",
        displayName: "Future Member",
      }).returning();
      const [organization] = await database.db.insert(schema.organizations).values({
        name: `Identity Test ${suffix}`,
        slug: `identity-test-${suffix}`,
      }).returning();
      if (!external || !organization) throw new Error("Failed to create identity test fixtures");
      trackOrganization(organization.id);

      const [campaign] = await database.db.insert(schema.campaigns).values({
        organizationId: organization.id,
        createdByIdentityId: giver.takeIdentityId,
        status: "ACTIVE",
        title: `Identity Test ${suffix}`,
        description: "Identity reconciliation fixture",
        startTime: new Date(Date.now() - 60_000),
        endTime: new Date(Date.now() + 60_000),
        nominationLimit: 1,
        nominatorEligibilityMode: "OPEN_REGISTERED",
        recipientEligibilityMode: "EXTERNAL_ALLOWED",
        nominationVisibilityMode: "PUBLIC",
      }).returning();
      if (!campaign) throw new Error("Failed to create campaign fixture");
      trackCampaign(campaign.id);

      const [nomination] = await database.db.insert(schema.nominations).values({
        campaignId: campaign.id,
        giverIdentityId: giver.takeIdentityId,
        recipientExternalIdentityId: external.id,
        idempotencyKey: randomUUID(),
        status: "CONFIRMED",
        confirmedAt: new Date(),
      }).returning();
      if (!nomination) throw new Error("Failed to create nomination fixture");

      const recipient = await identityService.resolvePrivyUser(privyUser({
        did,
        accounts: [twitter(subject, "joined-name", "Joined Name", "https://pbs.twimg.com/joined.jpg")],
      }));
      const [sameExternal] = await database.db.select().from(schema.externalIdentities).where(eq(schema.externalIdentities.id, external.id));
      const [sameNomination] = await database.db.select().from(schema.nominations).where(eq(schema.nominations.id, nomination.id));
      const me = await identityService.getMe(recipient.takeIdentityId);

      expect(sameExternal).toMatchObject({ id: external.id, takeIdentityId: recipient.takeIdentityId, currentUsername: "joined-name" });
      expect(sameNomination?.recipientExternalIdentityId).toBe(external.id);
      expect(me.takes.received).toBe(1);
    }, { extraDids: (did) => [`${did}:giver`], extraSubjects: (subject) => [`${subject}-giver`] });
  });

  it("returns a frontend-ready /me model without provider secrets or Discord email", async () => {
    await withFixture(async ({ did, subject }) => {
      const resolved = await identityService.resolvePrivyUser(privyUser({
        did,
        accounts: [
          { ...twitter(subject, "safe-user", "Safe User", "https://pbs.twimg.com/safe.jpg"), access_token: "never-return-this" },
          { ...discord(`${subject}-discord`, "safe-discord"), email: "private@example.com" },
        ],
      }));
      const me = await identityService.getMe(resolved.takeIdentityId);
      const serialized = JSON.stringify(me);

      expect(me.user).toMatchObject({ displayName: "Safe User", username: "safe-user", avatarUrl: "https://pbs.twimg.com/safe.jpg" });
      expect(serialized).not.toContain("never-return-this");
      expect(serialized).not.toContain("private@example.com");
      expect(serialized).not.toContain("access_token");
    });
  });
});

async function withFixture(
  run: (fixture: {
    suffix: string;
    did: string;
    subject: string;
    trackCampaign: (id: string) => void;
    trackOrganization: (id: string) => void;
  }) => Promise<void>,
  extras?: {
    extraDids?: (did: string) => string[];
    extraSubjects?: (subject: string) => string[];
  },
) {
  const suffix = randomUUID().replaceAll("-", "");
  const did = `did:privy:test-${suffix}`;
  const subject = `twitter-${suffix}`;
  const dids = [did, ...(extras?.extraDids?.(did) ?? [])];
  const subjects = [subject, `${subject}-discord`, `${subject}-github`, ...(extras?.extraSubjects?.(subject) ?? [])];
  const campaignIds: string[] = [];
  const organizationIds: string[] = [];

  try {
    await run({
      suffix,
      did,
      subject,
      trackCampaign: (id) => campaignIds.push(id),
      trackOrganization: (id) => organizationIds.push(id),
    });
  } finally {
    if (campaignIds.length) await database.db.delete(schema.campaigns).where(inArray(schema.campaigns.id, campaignIds));
    if (organizationIds.length) await database.db.delete(schema.organizations).where(inArray(schema.organizations.id, organizationIds));
    const fixtureUsers = await database.db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.privyUserId, dids));
    const fixtureUserIds = fixtureUsers.map((item) => item.id);
    if (fixtureUserIds.length) {
      const fixtureIdentities = await database.db.select({ id: schema.takeIdentities.id }).from(schema.takeIdentities).where(inArray(schema.takeIdentities.userId, fixtureUserIds));
      const fixtureIdentityIds = fixtureIdentities.map((item) => item.id);
      if (fixtureIdentityIds.length) {
        await database.db.delete(schema.externalIdentities).where(inArray(schema.externalIdentities.takeIdentityId, fixtureIdentityIds));
      }
    }
    await database.db.delete(schema.users).where(inArray(schema.users.privyUserId, dids));
    await database.db.delete(schema.externalIdentities).where(and(
      eq(schema.externalIdentities.provider, "twitter"),
      inArray(schema.externalIdentities.immutableProviderUserId, subjects),
    ));
  }
}

function privyUser({ did, accounts }: { did: string; accounts: object[] }): PrivyUser {
  return {
    id: did,
    created_at: nowSeconds(),
    linked_accounts: accounts,
    has_accepted_terms: true,
    is_guest: false,
  } as unknown as PrivyUser;
}

function twitter(subject: string, username: string, name: string, profilePictureUrl: string | null) {
  return {
    type: "twitter_oauth",
    subject,
    username,
    name,
    profile_picture_url: profilePictureUrl,
    verified_at: nowSeconds(),
  };
}

function discord(subject: string, username: string) {
  return { type: "discord_oauth", subject, username, email: null, verified_at: nowSeconds() };
}

function github(subject: string, username: string, name: string) {
  return { type: "github_oauth", subject, username, name, email: null, verified_at: nowSeconds() };
}

function farcaster(fid: number, username: string, displayName: string, profilePictureUrl: string) {
  return {
    type: "farcaster",
    fid,
    username,
    display_name: displayName,
    profile_picture_url: profilePictureUrl,
    profile_picture: profilePictureUrl,
    verified_at: nowSeconds(),
  };
}

function wallet(address: string, walletClient: string) {
  return {
    type: "wallet",
    id: `wallet-${address}`,
    address,
    chain_type: "ethereum",
    wallet_client: walletClient,
    verified_at: nowSeconds(),
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
