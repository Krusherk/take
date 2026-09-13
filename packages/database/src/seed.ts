import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { AllocationRunStatus, CampaignStatus, externalIdentityKey, protocolIdentityKey } from "@take/shared";
import { createDatabaseClient } from "./client.js";
import {
  allocationResults,
  allocationRuns,
  auditLogs,
  campaignResources,
  campaigns,
  externalIdentities,
  nominations,
  organizationMembers,
  organizations,
  takeIdentities,
  users,
  wallets
} from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

function hashHex(label: string, bytes = 32): `0x${string}` {
  return `0x${createHash("sha256").update(label).digest("hex").slice(0, bytes * 2)}`;
}

function uuid(label: string): string {
  const hex = createHash("sha256").update(label).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function address(label: string): `0x${string}` {
  return `0x${createHash("sha256").update(label).digest("hex").slice(0, 40)}`;
}

const { db, client } = createDatabaseClient(databaseUrl);

try {
  const now = new Date("2026-09-03T12:00:00.000Z");
  const orgId = uuid("org:take-labs");
  const userIds = Array.from({ length: 50 }, (_, i) => uuid(`user:${i}`));
  const identityIds = Array.from({ length: 50 }, (_, i) => uuid(`identity:${i}`));
  const organizerIdentityIds = [identityIds[0]!, identityIds[1]!];
  const campaignIds = [uuid("campaign:upcoming"), uuid("campaign:active"), uuid("campaign:closed")];

  await db.insert(organizations).values({
    id: orgId,
    name: "TAKE Labs",
    slug: "take-labs",
    createdAt: now
  }).onConflictDoNothing();

  for (let i = 0; i < 50; i += 1) {
    const id = userIds[i]!;
    const identityId = identityIds[i]!;
    const creationNonce = hashHex(`nonce:${identityId}`).slice(2, 34);

    await db.insert(users).values({
      id,
      privyUserId: `did:privy:seed-user-${i}`,
      displayName: i < 2 ? `Organizer ${i + 1}` : `Seed User ${i + 1}`,
      avatarUrl: `https://example.com/avatars/user-${i}.png`,
      createdAt: now,
      updatedAt: now
    }).onConflictDoNothing();

    await db.insert(takeIdentities).values({
      id: identityId,
      userId: id,
      creationNonce,
      protocolIdentityKey: protocolIdentityKey(identityId, creationNonce),
      createdAt: now
    }).onConflictDoNothing();

    await db.insert(wallets).values({
      id: uuid(`wallet:${i}`),
      takeIdentityId: identityId,
      address: address(`wallet:${i}`).toLowerCase(),
      walletType: i % 3 === 0 ? "embedded" : "external",
      isPrimary: true,
      verifiedAt: now,
      createdAt: now
    }).onConflictDoNothing();
  }

  for (let i = 0; i < 2; i += 1) {
    await db.insert(organizationMembers).values({
      id: uuid(`org-member:${i}`),
      organizationId: orgId,
      takeIdentityId: identityIds[i]!,
      role: i === 0 ? "OWNER" : "ADMIN",
      createdAt: now
    }).onConflictDoNothing();
  }

  for (let i = 0; i < 100; i += 1) {
    const providerUserId = `x-seed-${i}`;
    const isSarah = i === 0;
    await db.insert(externalIdentities).values({
      id: uuid(`external:twitter:${i}`),
      provider: "twitter",
      immutableProviderUserId: providerUserId,
      externalIdentityKey: externalIdentityKey("twitter", providerUserId),
      currentUsername: isSarah ? "sarah" : `external_${i}`,
      displayName: isSarah ? "Sarah Chen" : `External Person ${i + 1}`,
      avatarUrl: null,
      firstObservedAt: now,
      lastObservedAt: now
    }).onConflictDoUpdate({
      target: [externalIdentities.provider, externalIdentities.immutableProviderUserId],
      set: {
        currentUsername: isSarah ? "sarah" : `external_${i}`,
        displayName: isSarah ? "Sarah Chen" : `External Person ${i + 1}`,
        avatarUrl: null,
        lastObservedAt: now
      }
    });
  }

  const campaignSeeds = [
    {
      id: campaignIds[0]!,
      status: CampaignStatus.CREATED,
      title: "Builder Residency 01",
      description: "A focused week for independent builders shaping thoughtful social tools.",
      onchainCampaignId: null,
      startTime: new Date("2026-09-10T12:00:00.000Z"),
      endTime: new Date("2026-09-17T12:00:00.000Z")
    },
    {
      id: campaignIds[1]!,
      status: CampaignStatus.ACTIVE,
      title: "Monad Creator Allocation",
      description: "One hundred places for creators moving culture, selected by the people who know their work.",
      onchainCampaignId: 1n,
      startTime: new Date("2026-09-01T12:00:00.000Z"),
      endTime: new Date("2026-09-10T12:00:00.000Z")
    },
    {
      id: campaignIds[2]!,
      status: CampaignStatus.CLOSED,
      title: "Open Internet Microgrants",
      description: "Small grants for useful, public-minded work across the open internet.",
      onchainCampaignId: null,
      startTime: new Date("2026-08-01T12:00:00.000Z"),
      endTime: new Date("2026-08-10T12:00:00.000Z")
    }
  ];

  await db
    .update(campaigns)
    .set({ onchainCampaignId: null })
    .where(inArray(campaigns.id, campaignIds));

  for (let i = 0; i < campaignSeeds.length; i += 1) {
    const campaign = campaignSeeds[i]!;
    await db.insert(campaigns).values({
      id: campaign.id,
      organizationId: orgId,
      createdByIdentityId: organizerIdentityIds[i % 2]!,
      onchainCampaignId: campaign.onchainCampaignId,
      chainId: 10143,
      status: campaign.status,
      title: campaign.title,
      description: campaign.description,
      metadataHash: hashHex(`metadata:${campaign.id}`),
      rulesHash: hashHex(`rules:${campaign.id}`),
      startTime: campaign.startTime,
      endTime: campaign.endTime,
      nominationLimit: 1,
      nominatorEligibilityMode: "OPEN_REGISTERED",
      recipientEligibilityMode: "EXTERNAL_ALLOWED",
      nominationVisibilityMode: "PUBLIC",
      createdAt: now,
      updatedAt: now
    }).onConflictDoUpdate({
      target: campaigns.id,
      set: {
        onchainCampaignId: campaign.onchainCampaignId,
        chainId: campaign.onchainCampaignId ? 10143 : null,
        status: campaign.status,
        title: campaign.title,
        description: campaign.description,
        startTime: campaign.startTime,
        endTime: campaign.endTime,
        updatedAt: now
      }
    });

    await db.insert(campaignResources).values({
      id: uuid(`resource:${campaign.id}`),
      campaignId: campaign.id,
      type: i === 2 ? "grant" : "whitelist",
      name: i === 2 ? "Microgrant" : i === 1 ? "Creator Place" : "Residency Place",
      description: i === 1 ? "Access to the first Monad creator cohort." : "Manual fulfillment metadata for v0.",
      quantity: i === 2 ? 5 : i === 1 ? 100 : 24,
      escrowStatus: "NONE"
    }).onConflictDoUpdate({
      target: campaignResources.id,
      set: {
        type: i === 2 ? "grant" : "access",
        name: i === 2 ? "Microgrant" : i === 1 ? "Creator Place" : "Residency Place",
        description: i === 1 ? "Access to the first Monad creator cohort." : "Manual fulfillment metadata for v0.",
        quantity: i === 2 ? 5 : i === 1 ? 100 : 24
      }
    });
  }

  for (let i = 0; i < 220; i += 1) {
    const campaignId = i < 120 ? campaignIds[1]! : campaignIds[2]!;
    const giverIndex = i % 50;
    const recipientExternalIndex =
      i < 10 ? (i + 1) % 10
        : i < 25 ? 20
          : i < 40 ? 30 + (i % 5)
            : (i * 7) % 100;
    const txHash = hashHex(`tx:${campaignId}:${i}`);

    await db.insert(nominations).values({
      id: uuid(`nomination:${campaignId}:${i}`),
      campaignId,
      giverIdentityId: identityIds[giverIndex]!,
      recipientExternalIdentityId: uuid(`external:twitter:${recipientExternalIndex}`),
      idempotencyKey: uuid(`idempotency:${campaignId}:${i}`),
      chainId: 10143,
      transactionHash: txHash,
      logIndex: i,
      blockNumber: BigInt(1000 + i),
      status: "CONFIRMED",
      source: "seed",
      createdAt: now,
      submittedAt: now,
      confirmedAt: now,
      indexedAt: now
    }).onConflictDoNothing();
  }

  const runId = uuid("allocation-run:closed:raw-unique-support");
  await db.insert(allocationRuns).values({
    id: runId,
    campaignId: campaignIds[2]!,
    strategyId: "RAW_UNIQUE_SUPPORT",
    strategyVersion: "1",
    configuration: { selectedCount: 5 },
    inputSnapshotHash: hashHex("snapshot:closed:raw-unique-support"),
    status: AllocationRunStatus.COMPLETED,
    resultHash: hashHex("result:closed:raw-unique-support"),
    createdByIdentityId: identityIds[0]!,
    startedAt: now,
    completedAt: now
  }).onConflictDoNothing();

  for (let i = 0; i < 5; i += 1) {
    await db.insert(allocationResults).values({
      id: uuid(`allocation-result:${i}`),
      allocationRunId: runId,
      recipientExternalIdentityId: uuid(`external:twitter:${20 + i}`),
      score: 10 - i,
      selected: true,
      explanation: { strategy: "RAW_UNIQUE_SUPPORT", fixture: "top seed recipients" }
    }).onConflictDoNothing();
  }

  await db.insert(auditLogs).values({
    id: uuid("audit:seed"),
    actorIdentityId: identityIds[0]!,
    organizationId: orgId,
    action: "SEED_DATA_CREATED",
    metadata: {
      users: 50,
      externalIdentities: 100,
      campaigns: 3,
      nominations: 220,
      fixturePatterns: [
        "reciprocal pair",
        "5-person nomination ring",
        "popular recipient",
        "dense honest community",
        "independent support",
        "suspicious common-funder cluster"
      ]
    },
    createdAt: now
  }).onConflictDoNothing();

  console.log("Seed data inserted");
} finally {
  await client.end();
}
