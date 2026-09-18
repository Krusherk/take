import { and, eq, inArray, isNull } from "drizzle-orm";
import { createDatabaseClient } from "./client.js";
import * as schema from "./schema.js";

const sourceUrl = process.env.DATABASE_URL;
const targetUrl = process.env.DATABASE_MIGRATION_URL;
const apply = process.argv.includes("--apply");
const expectedMigrations = Array.from({ length: 13 }, (_, index) => `${String(index).padStart(4, "0")}_`);

if (!sourceUrl) throw new Error("DATABASE_URL is required as the source database");
if (!targetUrl) throw new Error("DATABASE_MIGRATION_URL is required as the target database");
if (sourceUrl === targetUrl) throw new Error("Source and target database URLs must differ");

const sourceHost = new URL(sourceUrl).hostname;
const targetHost = new URL(targetUrl).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(sourceHost)) {
  throw new Error("Pilot data migration source must be the local checkpoint database");
}
if (["localhost", "127.0.0.1", "::1"].includes(targetHost)) {
  throw new Error("Pilot data migration target must not be local PostgreSQL");
}

const source = createDatabaseClient(sourceUrl);
const target = createDatabaseClient(targetUrl);

try {
  const appliedMigrations = await target.client<{ id: string }[]>`
    select id from schema_migrations order by id
  `;
  if (
    appliedMigrations.length !== expectedMigrations.length
    || expectedMigrations.some((prefix, index) => !appliedMigrations[index]?.id.startsWith(prefix))
  ) {
    throw new Error("Target must have exactly the committed migrations 0000 through 0012 applied");
  }

  const [targetCounts] = await target.client<{
    users: number;
    organizations: number;
    campaigns: number;
    chainEvents: number;
    cursors: number;
  }[]>`
    select
      (select count(*)::int from users) as users,
      (select count(*)::int from organizations) as organizations,
      (select count(*)::int from campaigns) as campaigns,
      (select count(*)::int from chain_events) as "chainEvents",
      (select count(*)::int from chain_indexer_cursors) as cursors
  `;
  if (!targetCounts || Object.values(targetCounts).some((count) => count !== 0)) {
    throw new Error("Target TAKE tables must be empty before the pilot data migration");
  }

  const allUsers = await source.db.select().from(schema.users);
  const users = allUsers.filter((user) => !isFixturePrivyUserId(user.privyUserId));
  const userIds = users.map((user) => user.id);
  if (users.length !== 2) {
    throw new Error(`Expected exactly two approved real users; found ${users.length}`);
  }

  const identities = await source.db.select().from(schema.takeIdentities)
    .where(inArray(schema.takeIdentities.userId, userIds));
  const identityIds = identities.map((identity) => identity.id);
  const protocolKeys = new Set(identities.map((identity) => identity.protocolIdentityKey.toLowerCase()));
  if (identities.length !== users.length) {
    throw new Error("Every approved real user must have exactly one TAKE identity");
  }

  const [socialAccounts, wallets, externalIdentities, memberships] = await Promise.all([
    source.db.select().from(schema.socialAccounts)
      .where(inArray(schema.socialAccounts.takeIdentityId, identityIds)),
    source.db.select().from(schema.wallets)
      .where(inArray(schema.wallets.takeIdentityId, identityIds)),
    source.db.select().from(schema.externalIdentities)
      .where(inArray(schema.externalIdentities.takeIdentityId, identityIds)),
    source.db.select().from(schema.organizationMembers)
      .where(inArray(schema.organizationMembers.takeIdentityId, identityIds))
  ]);
  const organizationIds = [...new Set(memberships.map((membership) => membership.organizationId))];
  const organizations = organizationIds.length
    ? await source.db.select().from(schema.organizations)
        .where(inArray(schema.organizations.id, organizationIds))
    : [];
  const auditLogs = organizationIds.length
    ? await source.db.select().from(schema.auditLogs).where(and(
        inArray(schema.auditLogs.actorIdentityId, identityIds),
        inArray(schema.auditLogs.organizationId, organizationIds),
        isNull(schema.auditLogs.campaignId)
      ))
    : [];
  const identityEvents = (await source.db.select().from(schema.chainEvents)
    .where(eq(schema.chainEvents.eventName, "IdentityRegistered")))
    .filter((event) => {
      const payload = event.payload as { protocolIdentityKey?: unknown };
      return typeof payload.protocolIdentityKey === "string"
        && protocolKeys.has(payload.protocolIdentityKey.toLowerCase());
    });
  const cursors = await source.db.select().from(schema.chainIndexerCursors);

  const summary = {
    users: users.length,
    identities: identities.length,
    socialAccounts: socialAccounts.length,
    wallets: wallets.length,
    externalIdentities: externalIdentities.length,
    organizations: organizations.length,
    memberships: memberships.length,
    campaignIndependentAuditLogs: auditLogs.length,
    realIdentityRegistrationEvents: identityEvents.length,
    indexerCursors: cursors.length,
    campaigns: 0,
    campaignRequests: 0,
    nominations: 0
  };
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", summary }, null, 2));
  if (!apply) {
    console.log("Dry run only. Re-run with --apply after reviewing the summary.");
  } else {
    await target.db.transaction(async (tx) => {
      await tx.insert(schema.users).values(users);
      await tx.insert(schema.takeIdentities).values(identities);
      if (socialAccounts.length) await tx.insert(schema.socialAccounts).values(socialAccounts);
      if (wallets.length) await tx.insert(schema.wallets).values(wallets);
      if (externalIdentities.length) await tx.insert(schema.externalIdentities).values(externalIdentities);
      if (organizations.length) await tx.insert(schema.organizations).values(organizations);
      if (memberships.length) await tx.insert(schema.organizationMembers).values(memberships);
      if (identityEvents.length) await tx.insert(schema.chainEvents).values(identityEvents);
      if (cursors.length) await tx.insert(schema.chainIndexerCursors).values(cursors);
      if (auditLogs.length) await tx.insert(schema.auditLogs).values(auditLogs);
    });

    const [verification] = await target.client<{
      users: number;
      fixtureUsers: number;
      campaigns: number;
      requests: number;
      identities: number;
      organizations: number;
      cursors: number;
    }[]>`
      select
        (select count(*)::int from users) as users,
        (select count(*)::int from users where privy_user_id like 'did:privy:seed-%'
          or privy_user_id like 'take-dev-eligibility-%'
          or privy_user_id like 'did:privy:mechanism-%'
          or privy_user_id like 'did:privy:v0-%'
          or privy_user_id like 'did:privy:test-%') as "fixtureUsers",
        (select count(*)::int from campaigns) as campaigns,
        (select count(*)::int from campaign_requests) as requests,
        (select count(*)::int from take_identities) as identities,
        (select count(*)::int from organizations) as organizations,
        (select count(*)::int from chain_indexer_cursors) as cursors
    `;
    if (
      !verification
      || verification.users !== users.length
      || verification.fixtureUsers !== 0
      || verification.campaigns !== 0
      || verification.requests !== 0
      || verification.identities !== identities.length
      || verification.organizations !== organizations.length
      || verification.cursors !== cursors.length
    ) {
      throw new Error("Pilot data verification failed after transfer");
    }
    console.log(JSON.stringify({ migrated: true, verification }, null, 2));
  }
} finally {
  await Promise.all([source.client.end(), target.client.end()]);
}

function isFixturePrivyUserId(privyUserId: string) {
  return [
    "did:privy:seed-",
    "take-dev-eligibility-",
    "did:privy:mechanism-",
    "did:privy:v0-",
    "did:privy:test-"
  ].some((prefix) => privyUserId.toLowerCase().startsWith(prefix));
}
