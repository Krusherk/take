import { randomUUID } from "node:crypto";
import type { User as PrivyUser, LinkedAccount } from "@privy-io/node";
import { and, count, eq, inArray, or } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import { externalIdentityKey, normalizeAddress, protocolIdentityKey, type IdentityProvider } from "@take/shared";

type TwitterAccount = Extract<LinkedAccount, { type: "twitter_oauth" }>;
type DiscordAccount = Extract<LinkedAccount, { type: "discord_oauth" }>;
type GithubAccount = Extract<LinkedAccount, { type: "github_oauth" }>;
type FarcasterAccount = Extract<LinkedAccount, { type: "farcaster" }>;
type EmailAccount = Extract<LinkedAccount, { type: "email" }>;
type EthereumWalletAccount = Extract<LinkedAccount, { type: "wallet"; chain_type: "ethereum" }>;

const recordedNominationStatuses = ["CHAIN_CONFIRMED", "INDEXING_DELAYED", "CONFIRMED"] as const;

interface ObservedSocialAccount {
  provider: IdentityProvider;
  providerUserId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface IdentityPresentation {
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
}

export interface ResolvedTakeIdentity {
  userId: string;
  privyUserId: string;
  takeIdentityId: string;
  protocolIdentityKey: string;
  primaryWalletAddress?: string;
}

export interface TakeMeResponse {
  user: {
    id: string;
    takeIdentityId: string;
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
    bio: null;
    joinedAt: string;
  };
  socials: {
    twitter: {
      connected: boolean;
      subject?: string;
      username?: string;
      name?: string;
      profilePictureUrl?: string;
    };
    discord: {
      connected: boolean;
      subject?: string;
      username?: string;
    };
    farcaster: {
      connected: boolean;
      fid?: number;
      username?: string;
      displayName?: string;
      pfp?: string;
    };
    github: {
      connected: boolean;
      subject?: string;
      username?: string;
      name?: string;
    };
  };
  wallets: Array<{
    address: string;
    chainType: string;
    type: string;
    embedded: boolean;
    primary: boolean;
  }>;
  takes: {
    given: number;
    received: number;
  };
}

export class IdentityService {
  constructor(private readonly db: Database) {}

  async resolvePrivyUser(privyUser: PrivyUser): Promise<ResolvedTakeIdentity> {
    const socialAccounts = observedSocialAccounts(privyUser.linked_accounts);
    const wallets = ethereumWallets(privyUser.linked_accounts);
    const presentation = identityPresentation(privyUser.linked_accounts);
    const now = new Date();

    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({
          privyUserId: privyUser.id,
          displayName: presentation.displayName,
          avatarUrl: presentation.avatarUrl
        })
        .onConflictDoUpdate({
          target: schema.users.privyUserId,
          set: {
            displayName: presentation.displayName,
            avatarUrl: presentation.avatarUrl,
            updatedAt: now
          }
        })
        .returning();

      if (!user) {
        throw new Error("Failed to upsert TAKE user");
      }

      let [identity] = await tx
        .select()
        .from(schema.takeIdentities)
        .where(eq(schema.takeIdentities.userId, user.id))
        .limit(1);

      if (!identity) {
        const identityId = randomUUID();
        const creationNonce = randomUUID().replaceAll("-", "");
        const [created] = await tx
          .insert(schema.takeIdentities)
          .values({
            id: identityId,
            userId: user.id,
            creationNonce,
            protocolIdentityKey: protocolIdentityKey(identityId, creationNonce)
          })
          .onConflictDoNothing({ target: schema.takeIdentities.userId })
          .returning();
        identity = created;

        // Parallel first authenticated requests can race here. The unique user
        // constraint selects the one identity that won without duplicating it.
        if (!identity) {
          [identity] = await tx
            .select()
            .from(schema.takeIdentities)
            .where(eq(schema.takeIdentities.userId, user.id))
            .limit(1);
        }
      }

      if (!identity) {
        throw new Error("Failed to resolve TAKE identity");
      }

      // Removed providers stay in the historical table but no longer appear as connected.
      await tx
        .update(schema.socialAccounts)
        .set({ isActive: false, lastObservedAt: now })
        .where(eq(schema.socialAccounts.takeIdentityId, identity.id));

      for (const account of socialAccounts) {
        await tx
          .insert(schema.socialAccounts)
          .values({
            takeIdentityId: identity.id,
            provider: account.provider,
            providerUserId: account.providerUserId,
            username: account.username,
            displayName: account.displayName,
            avatarUrl: account.avatarUrl,
            isActive: true,
            lastObservedAt: now
          })
          .onConflictDoUpdate({
            target: [schema.socialAccounts.provider, schema.socialAccounts.providerUserId],
            set: {
              takeIdentityId: identity.id,
              username: account.username,
              displayName: account.displayName,
              avatarUrl: account.avatarUrl,
              isActive: true,
              lastObservedAt: now
            }
          });

        await tx
          .insert(schema.externalIdentities)
          .values({
            provider: account.provider,
            immutableProviderUserId: account.providerUserId,
            externalIdentityKey: externalIdentityKey(account.provider, account.providerUserId),
            takeIdentityId: identity.id,
            currentUsername: account.username,
            displayName: account.displayName,
            avatarUrl: account.avatarUrl,
            lastObservedAt: now
          })
          .onConflictDoUpdate({
            target: [schema.externalIdentities.provider, schema.externalIdentities.immutableProviderUserId],
            set: {
              takeIdentityId: identity.id,
              currentUsername: account.username,
              displayName: account.displayName,
              avatarUrl: account.avatarUrl,
              lastObservedAt: now
            }
          });
      }

      const walletAddresses = wallets.map((wallet) => normalizeAddress(wallet.address));

      await tx
        .update(schema.wallets)
        .set({ isPrimary: false, isActive: false, lastObservedAt: now })
        .where(eq(schema.wallets.takeIdentityId, identity.id));

      for (const [index, wallet] of wallets.entries()) {
        await tx
          .insert(schema.wallets)
          .values({
            takeIdentityId: identity.id,
            privyWalletId: "id" in wallet && typeof wallet.id === "string" ? wallet.id : undefined,
            address: normalizeAddress(wallet.address),
            walletType: wallet.wallet_client === "privy" ? "embedded" : "external",
            chainType: "ethereum",
            isPrimary: index === 0,
            isActive: true,
            lastObservedAt: now,
            verifiedAt: new Date(wallet.verified_at * 1000)
          })
          .onConflictDoUpdate({
            target: schema.wallets.address,
            set: {
              takeIdentityId: identity.id,
              privyWalletId: "id" in wallet && typeof wallet.id === "string" ? wallet.id : undefined,
              walletType: wallet.wallet_client === "privy" ? "embedded" : "external",
              chainType: "ethereum",
              isPrimary: index === 0,
              isActive: true,
              lastObservedAt: now,
              verifiedAt: new Date(wallet.verified_at * 1000)
            }
          });
      }

      return {
        userId: user.id,
        privyUserId: user.privyUserId,
        takeIdentityId: identity.id,
        protocolIdentityKey: identity.protocolIdentityKey,
        primaryWalletAddress: walletAddresses[0]
      };
    });
  }

  async getMe(takeIdentityId: string): Promise<TakeMeResponse> {
    const [identity] = await this.db
      .select({
        id: schema.takeIdentities.id,
        createdAt: schema.takeIdentities.createdAt,
        userId: schema.users.id,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl
      })
      .from(schema.takeIdentities)
      .innerJoin(schema.users, eq(schema.users.id, schema.takeIdentities.userId))
      .where(eq(schema.takeIdentities.id, takeIdentityId))
      .limit(1);

    if (!identity) {
      throw new Error("TAKE identity not found");
    }

    const [socialAccounts, wallets, externalIdentities] = await Promise.all([
      this.db
        .select()
        .from(schema.socialAccounts)
        .where(
          and(
            eq(schema.socialAccounts.takeIdentityId, takeIdentityId),
            eq(schema.socialAccounts.isActive, true)
          )
        ),
      this.db
        .select()
        .from(schema.wallets)
        .where(
          and(
            eq(schema.wallets.takeIdentityId, takeIdentityId),
            eq(schema.wallets.isActive, true)
          )
        ),
      this.db
        .select({ id: schema.externalIdentities.id })
        .from(schema.externalIdentities)
        .where(eq(schema.externalIdentities.takeIdentityId, takeIdentityId))
    ]);

    const externalIds = externalIdentities.map((item) => item.id);
    const receivedRecipient = externalIds.length
      ? or(
          eq(schema.nominations.recipientTakeIdentityId, takeIdentityId),
          inArray(schema.nominations.recipientExternalIdentityId, externalIds)
        )
      : eq(schema.nominations.recipientTakeIdentityId, takeIdentityId);

    const [[given], [received]] = await Promise.all([
      this.db
        .select({ value: count(schema.nominations.id) })
        .from(schema.nominations)
        .where(
          and(
            eq(schema.nominations.giverIdentityId, takeIdentityId),
            inArray(schema.nominations.status, recordedNominationStatuses)
          )
        ),
      this.db
        .select({ value: count(schema.nominations.id) })
        .from(schema.nominations)
        .where(
          and(
            receivedRecipient,
            inArray(schema.nominations.status, recordedNominationStatuses)
          )
        )
    ]);

    const socialByProvider = new Map(socialAccounts.map((account) => [account.provider, account]));
    const twitter = socialByProvider.get("twitter");
    const discord = socialByProvider.get("discord");
    const farcaster = socialByProvider.get("farcaster");
    const github = socialByProvider.get("github");
    const username = twitter?.username ?? farcaster?.username ?? github?.username ?? discord?.username ?? null;

    return {
      user: {
        id: identity.userId,
        takeIdentityId: identity.id,
        displayName: identity.displayName,
        username,
        avatarUrl: identity.avatarUrl,
        bio: null,
        joinedAt: identity.createdAt.toISOString()
      },
      socials: {
        twitter: twitter
          ? compact({
              connected: true,
              subject: twitter.providerUserId,
              username: twitter.username ?? undefined,
              name: twitter.displayName ?? undefined,
              profilePictureUrl: twitter.avatarUrl ?? undefined
            })
          : { connected: false },
        discord: discord
          ? compact({
              connected: true,
              subject: discord.providerUserId,
              username: discord.username ?? undefined
            })
          : { connected: false },
        farcaster: farcaster
          ? compact({
              connected: true,
              fid: Number(farcaster.providerUserId),
              username: farcaster.username ?? undefined,
              displayName: farcaster.displayName ?? undefined,
              pfp: farcaster.avatarUrl ?? undefined
            })
          : { connected: false },
        github: github
          ? compact({
              connected: true,
              subject: github.providerUserId,
              username: github.username ?? undefined,
              name: github.displayName ?? undefined
            })
          : { connected: false }
      },
      wallets: wallets
        .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary))
        .map((wallet) => ({
          address: wallet.address,
          chainType: wallet.chainType,
          type: wallet.walletType,
          embedded: wallet.walletType === "embedded",
          primary: wallet.isPrimary
        })),
      takes: {
        given: given?.value ?? 0,
        received: received?.value ?? 0
      }
    };
  }
}

export function observedSocialAccounts(accounts: LinkedAccount[]): ObservedSocialAccount[] {
  return accounts.flatMap((account): ObservedSocialAccount[] => {
    if (account.type === "twitter_oauth") {
      return [{
        provider: "twitter",
        providerUserId: account.subject,
        username: clean(account.username),
        displayName: clean(account.name),
        avatarUrl: safeAvatarUrl(account.profile_picture_url)
      }];
    }
    if (account.type === "discord_oauth") {
      return [{
        provider: "discord",
        providerUserId: account.subject,
        username: clean(account.username),
        displayName: clean(account.username),
        avatarUrl: null
      }];
    }
    if (account.type === "github_oauth") {
      return [{
        provider: "github",
        providerUserId: account.subject,
        username: clean(account.username),
        displayName: clean(account.name) ?? clean(account.username),
        avatarUrl: null
      }];
    }
    if (account.type === "farcaster") {
      return [{
        provider: "farcaster",
        providerUserId: String(account.fid),
        username: clean(account.username),
        displayName: clean(account.display_name) ?? clean(account.username),
        avatarUrl: safeAvatarUrl(account.profile_picture_url) ?? safeAvatarUrl(account.profile_picture)
      }];
    }
    return [];
  });
}

export function identityPresentation(accounts: LinkedAccount[]): IdentityPresentation {
  const twitter = findAccount<TwitterAccount>(accounts, "twitter_oauth");
  const farcaster = findAccount<FarcasterAccount>(accounts, "farcaster");
  const github = findAccount<GithubAccount>(accounts, "github_oauth");
  const discord = findAccount<DiscordAccount>(accounts, "discord_oauth");
  const email = findAccount<EmailAccount>(accounts, "email");

  return {
    displayName:
      clean(twitter?.name) ??
      clean(twitter?.username) ??
      clean(farcaster?.display_name) ??
      clean(farcaster?.username) ??
      clean(github?.name) ??
      clean(github?.username) ??
      clean(discord?.username) ??
      emailPrefix(email),
    username:
      clean(twitter?.username) ??
      clean(farcaster?.username) ??
      clean(github?.username) ??
      clean(discord?.username),
    avatarUrl:
      safeAvatarUrl(twitter?.profile_picture_url) ??
      safeAvatarUrl(farcaster?.profile_picture_url) ??
      safeAvatarUrl(farcaster?.profile_picture)
  };
}

function ethereumWallets(accounts: LinkedAccount[]): EthereumWalletAccount[] {
  return accounts.filter(
    (account): account is EthereumWalletAccount =>
      account.type === "wallet" && account.chain_type === "ethereum"
  );
}

function findAccount<T extends LinkedAccount>(accounts: LinkedAccount[], type: T["type"]): T | undefined {
  return accounts.find((account): account is T => account.type === type);
}

function emailPrefix(account: EmailAccount | undefined): string | null {
  const address = clean(account?.address);
  return address ? clean(address.split("@")[0]) : null;
}

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function safeAvatarUrl(value: string | null | undefined): string | null {
  const normalized = clean(value);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? normalized : null;
  } catch {
    return null;
  }
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
