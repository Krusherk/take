import { and, desc, eq, ilike, inArray, isNull, ne, not, or } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";

export interface PersonView {
  recipient:
    | { type: "take_identity"; takeIdentityId: string }
    | {
        type: "external_identity";
        externalIdentityId: string;
      };
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  joined: boolean;
}

export class SocialService {
  constructor(private readonly db: Database) {}

  async searchPeople(query: string, viewerIdentityId: string, limit = 12, includeSelf = false, includeDevFixtures = false): Promise<PersonView[]> {
    const normalized = query.trim();
    const pattern = `%${normalized}%`;
    const takeMatches = await this.db
      .select({
        takeIdentityId: schema.takeIdentities.id,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        username: schema.socialAccounts.username
      })
      .from(schema.takeIdentities)
      .innerJoin(schema.users, eq(schema.users.id, schema.takeIdentities.userId))
      .leftJoin(
        schema.socialAccounts,
        and(
          eq(schema.socialAccounts.takeIdentityId, schema.takeIdentities.id),
          eq(schema.socialAccounts.isActive, true)
        )
      )
      .where(
        and(
          includeSelf ? undefined : ne(schema.takeIdentities.id, viewerIdentityId),
          includeDevFixtures ? undefined : and(
            not(ilike(schema.users.privyUserId, "take-dev-eligibility-%")),
            not(ilike(schema.users.privyUserId, "did:privy:seed-%")),
            not(ilike(schema.users.privyUserId, "did:privy:mechanism-%")),
            not(ilike(schema.users.privyUserId, "did:privy:v0-%")),
            not(ilike(schema.users.privyUserId, "did:privy:test-%"))
          ),
          normalized
            ? or(
                ilike(schema.users.displayName, pattern),
                ilike(schema.socialAccounts.username, pattern),
                ilike(schema.socialAccounts.displayName, pattern)
              )
            : undefined
        )
      )
      .limit(limit);

    const remaining = Math.max(0, limit - takeMatches.length);
    const externalMatches = remaining
      ? await this.db
          .select()
          .from(schema.externalIdentities)
          .where(
            and(
              isNull(schema.externalIdentities.takeIdentityId),
              includeDevFixtures ? undefined : not(ilike(schema.externalIdentities.immutableProviderUserId, "x-seed-%")),
              normalized
                ? or(
                    ilike(schema.externalIdentities.displayName, pattern),
                    ilike(schema.externalIdentities.currentUsername, pattern)
                  )
                : undefined
            )
          )
          .limit(remaining)
      : [];

    return [
      ...takeMatches.map((person) => ({
        recipient: { type: "take_identity" as const, takeIdentityId: person.takeIdentityId },
        displayName: person.displayName ?? person.username ?? "TAKE member",
        username: person.username,
        avatarUrl: person.avatarUrl,
        joined: true
      })),
      ...externalMatches.map((person) => ({
        recipient: {
          type: "external_identity" as const,
          externalIdentityId: person.id
        },
        displayName: person.displayName ?? person.currentUsername ?? "TAKE recipient",
        username: person.currentUsername,
        avatarUrl: person.avatarUrl,
        joined: false
      }))
    ];
  }

  async getHistory(identityId: string) {
    const [given, linkedExternalIdentities] = await Promise.all([
      this.db
        .select({
          id: schema.nominations.id,
          campaignId: schema.nominations.campaignId,
          campaignTitle: schema.campaigns.title,
          recipientTakeIdentityId: schema.nominations.recipientTakeIdentityId,
          recipientExternalIdentityId: schema.nominations.recipientExternalIdentityId,
          transactionHash: schema.nominations.transactionHash,
          status: schema.nominations.status,
          createdAt: schema.nominations.createdAt,
          confirmedAt: schema.nominations.confirmedAt
        })
        .from(schema.nominations)
        .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.nominations.campaignId))
        .where(
          and(
            eq(schema.nominations.giverIdentityId, identityId),
            ne(schema.nominations.status, "FAILED")
          )
        )
        .orderBy(desc(schema.nominations.createdAt))
        .limit(40),
      this.db
        .select({ id: schema.externalIdentities.id })
        .from(schema.externalIdentities)
        .where(eq(schema.externalIdentities.takeIdentityId, identityId))
    ]);

    const externalIds = linkedExternalIdentities.map((item) => item.id);
    const received = await this.db
      .select({
        id: schema.nominations.id,
        campaignId: schema.nominations.campaignId,
        campaignTitle: schema.campaigns.title,
        giverIdentityId: schema.nominations.giverIdentityId,
        transactionHash: schema.nominations.transactionHash,
        status: schema.nominations.status,
        createdAt: schema.nominations.createdAt,
        confirmedAt: schema.nominations.confirmedAt
      })
      .from(schema.nominations)
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.nominations.campaignId))
      .where(
        and(
          externalIds.length
            ? or(
                eq(schema.nominations.recipientTakeIdentityId, identityId),
                inArray(schema.nominations.recipientExternalIdentityId, externalIds)
              )
            : eq(schema.nominations.recipientTakeIdentityId, identityId),
          ne(schema.nominations.status, "FAILED")
        )
      )
      .orderBy(desc(schema.nominations.createdAt))
      .limit(40);

    return {
      given: await Promise.all(
        given.map(async (item) => ({
          id: item.id,
          campaignId: item.campaignId,
          campaignTitle: item.campaignTitle,
          person: item.recipientTakeIdentityId
            ? await this.getTakePerson(item.recipientTakeIdentityId)
            : item.recipientExternalIdentityId
              ? await this.getExternalPerson(item.recipientExternalIdentityId)
              : null,
          transactionHash: item.transactionHash,
          status: item.status,
          createdAt: item.createdAt.toISOString(),
          confirmedAt: item.confirmedAt?.toISOString() ?? null
        }))
      ),
      received: await Promise.all(
        received.map(async (item) => ({
          id: item.id,
          campaignId: item.campaignId,
          campaignTitle: item.campaignTitle,
          person: await this.getTakePerson(item.giverIdentityId),
          transactionHash: item.transactionHash,
          status: item.status,
          createdAt: item.createdAt.toISOString(),
          confirmedAt: item.confirmedAt?.toISOString() ?? null
        }))
      )
    };
  }

  async getNominationStory(nominationId: string) {
    const [nomination] = await this.db
      .select({
        id: schema.nominations.id,
        campaignId: schema.nominations.campaignId,
        campaignTitle: schema.campaigns.title,
        campaignStatus: schema.campaigns.status,
        giverIdentityId: schema.nominations.giverIdentityId,
        recipientTakeIdentityId: schema.nominations.recipientTakeIdentityId,
        recipientExternalIdentityId: schema.nominations.recipientExternalIdentityId,
        status: schema.nominations.status,
        transactionHash: schema.nominations.transactionHash,
        createdAt: schema.nominations.createdAt
      })
      .from(schema.nominations)
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.nominations.campaignId))
      .where(eq(schema.nominations.id, nominationId))
      .limit(1);

    if (!nomination) return null;

    return {
      id: nomination.id,
      campaign: {
        id: nomination.campaignId,
        title: nomination.campaignTitle,
        status: nomination.campaignStatus
      },
      giver: await this.getTakePerson(nomination.giverIdentityId),
      recipient: nomination.recipientTakeIdentityId
        ? await this.getTakePerson(nomination.recipientTakeIdentityId)
        : nomination.recipientExternalIdentityId
          ? await this.getExternalPerson(nomination.recipientExternalIdentityId)
          : null,
      status: nomination.status,
      transactionHash: nomination.transactionHash,
      createdAt: nomination.createdAt.toISOString()
    };
  }

  private async getTakePerson(identityId: string) {
    const [person] = await this.db
      .select({
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        username: schema.socialAccounts.username
      })
      .from(schema.takeIdentities)
      .innerJoin(schema.users, eq(schema.users.id, schema.takeIdentities.userId))
      .leftJoin(schema.socialAccounts, eq(schema.socialAccounts.takeIdentityId, schema.takeIdentities.id))
      .where(eq(schema.takeIdentities.id, identityId))
      .limit(1);

    return person
      ? {
          displayName: person.displayName ?? person.username ?? "TAKE member",
          username: person.username,
          avatarUrl: person.avatarUrl,
          joined: true
        }
      : null;
  }

  private async getExternalPerson(externalIdentityId: string) {
    const [person] = await this.db
      .select()
      .from(schema.externalIdentities)
      .where(eq(schema.externalIdentities.id, externalIdentityId))
      .limit(1);

    return person
      ? {
          displayName: person.displayName ?? person.currentUsername ?? "TAKE recipient",
          username: person.currentUsername,
          avatarUrl: person.avatarUrl,
          joined: Boolean(person.takeIdentityId)
        }
      : null;
  }
}
