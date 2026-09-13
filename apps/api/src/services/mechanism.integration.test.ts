import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDatabaseClient, schema, type Database } from "@take/database";
import {
  committedDrandRound,
  domainHash,
  DRAND_EVMNET_GENESIS_TIME,
  DRAND_EVMNET_PERIOD_SECONDS,
  TAKE_MECHANISM_VERSION,
  type CampaignMechanismConfigV1,
} from "@take/mechanism";
import { protocolIdentityKey } from "@take/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadApiEnv } from "../config/env.js";
import { EligibilitySnapshotService } from "./eligibilitySnapshots.js";
import { MechanismService } from "./mechanism.js";

const envPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
const legacyManager = "0xc3A0178B31D8844455c49988736d51A2336056e5";
let database: ReturnType<typeof createDatabaseClient>;

beforeAll(() => {
  if (!process.env.DATABASE_URL) process.loadEnvFile(envPath);
  const env = loadApiEnv(process.env);
  database = createDatabaseClient(env.DATABASE_URL);
});

afterAll(async () => {
  await database.client.end();
});

describe.sequential("Mechanism V1 lifecycle", () => {
  it("builds, locks, and publicly commits an evidence-backed low-assurance mechanism", async () => {
    await withRollback(async (db) => {
      const env = loadApiEnv(process.env);
      const mechanisms = new MechanismService(db);
      const snapshots = new EligibilitySnapshotService(db, env);
      const fixture = await createFixture(db);
      const config = lowAssuranceConfig(fixture);
      const draft = await mechanisms.createDraft(fixture.campaignId, fixture.identityId, config);
      expect(draft).toMatchObject({ revision: 1, status: "DRAFT" });

      const built = await snapshots.createForCurrentDraft(fixture.campaignId, fixture.identityId);
      expect(built.nominator.status).toBe("READY");
      expect(built.recipient.status).toBe("READY");
      expect(built.nominator.candidateCount).toBeGreaterThan(0);
      expect(built.nominator.eligibleCount).toBe(built.nominator.candidateCount);

      const locked = await mechanisms.lock(fixture.campaignId, fixture.identityId);
      expect(locked.config.status).toBe("LOCKED");
      expect(locked.campaign.nominatorEligibilityRoot).toMatch(/^0x[0-9a-f]{64}$/);
      expect(locked.campaign.recipientEligibilityRoot).toMatch(/^0x[0-9a-f]{64}$/);
      expect(locked.campaign.rulesHash).toMatch(/^0x[0-9a-f]{64}$/);

      const audit = await mechanisms.getAuditArtifact(fixture.campaignId);
      const serialized = JSON.stringify(audit);
      expect(audit.mechanism).toMatchObject({ status: "LOCKED" });
      expect(audit.eligibilitySnapshots).toHaveLength(2);
      expect(serialized).not.toContain("canonicalArtifact");
      expect(serialized).not.toContain("evidenceObservationIds");

      await expect(mechanisms.createDraft(fixture.campaignId, fixture.identityId, config))
        .rejects.toMatchObject({ code: "MECHANISM_ALREADY_LOCKED", statusCode: 409 });
    });
  }, 30_000);

  it("hard-gates structurally valid protected configs until V2 is separately approved", async () => {
    await withRollback(async (db) => {
      const mechanisms = new MechanismService(db);
      const fixture = await createFixture(db);
      const randomness = committedDrandRound(fixture.endTime.toISOString(), {
        genesis_time: DRAND_EVMNET_GENESIS_TIME,
        period: DRAND_EVMNET_PERIOD_SECONDS,
      });
      const config: CampaignMechanismConfigV1 = {
        ...lowAssuranceConfig(fixture),
        assuranceLevel: "PROTECTED",
        selectorRecipientMode: "DISJOINT_SELECTOR_RECIPIENT",
        recipientPolicy: {
          audience: "RECIPIENT",
          population: { type: "ORGANIZER_ALLOWLIST", allowlistId: randomUUID() },
          allOf: [],
        },
        randomness: {
          source: "DRAND",
          network: "evmnet",
          chainHash: "04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3",
          round: randomness.round,
          notBefore: randomness.notBefore,
          allocationDelaySeconds: 600,
        },
        contract: {
          chainId: 10143,
          managerAddress: "0x1111111111111111111111111111111111111111",
          managerVersion: "V2",
        },
      };

      await expect(mechanisms.createDraft(fixture.campaignId, fixture.identityId, config))
        .rejects.toMatchObject({ code: "PROTECTED_CAMPAIGNS_NOT_ENABLED", statusCode: 409 });
    });
  });
});

function lowAssuranceConfig(fixture: Fixture): CampaignMechanismConfigV1 {
  return {
    mechanismVersion: TAKE_MECHANISM_VERSION,
    assuranceLevel: "LOW_ASSURANCE",
    campaignId: fixture.campaignId,
    organizationId: fixture.organizationId,
    selectorRecipientMode: "OVERLAPPING",
    nominationLimit: 1,
    nominatorPolicy: {
      audience: "NOMINATOR",
      population: { type: "ORGANIZER_ALLOWLIST", allowlistId: fixture.allowlistId },
      allOf: [{ id: "take-member", version: 1, type: "TAKE_ACCOUNT_REQUIRED" }],
    },
    recipientPolicy: {
      audience: "RECIPIENT",
      population: { type: "ORGANIZER_ALLOWLIST", allowlistId: fixture.allowlistId },
      allOf: [{ id: "take-recipient", version: 1, type: "TAKE_MEMBER_RECIPIENT_REQUIRED" }],
    },
    reciprocityPolicy: "REJECT_LATER_EDGE",
    allocation: { strategyId: "RAW_UNIQUE_SUPPORT", strategyVersion: "2" },
    resourceQuantity: 2,
    cutoffAt: fixture.cutoffAt.toISOString(),
    randomness: { source: "NONE" },
    evidenceVersion: "1",
    evaluatorVersion: "1",
    graphVersion: "1",
    contract: {
      chainId: 10143,
      managerAddress: legacyManager,
      managerVersion: "LEGACY_V1",
    },
  };
}

interface Fixture {
  userId: string;
  identityId: string;
  organizationId: string;
  campaignId: string;
  allowlistId: string;
  cutoffAt: Date;
  endTime: Date;
}

async function createFixture(db: Database): Promise<Fixture> {
  const suffix = randomUUID();
  const userId = randomUUID();
  const identityId = randomUUID();
  const organizationId = randomUUID();
  const campaignId = randomUUID();
  const allowlistId = randomUUID();
  const cutoffAt = new Date(Date.now() + 1_000);
  const startTime = new Date(cutoffAt.getTime() + 60_000);
  const endTime = new Date(startTime.getTime() + 86_400_000);
  const nonce = suffix.replaceAll("-", "").slice(0, 32);

  await db.insert(schema.users).values({
    id: userId,
    privyUserId: `did:privy:mechanism-${suffix}`,
    displayName: "Mechanism Test Owner",
  });
  await db.insert(schema.takeIdentities).values({
    id: identityId,
    userId,
    creationNonce: nonce,
    protocolIdentityKey: protocolIdentityKey(identityId, nonce),
  });
  await db.insert(schema.organizations).values({
    id: organizationId,
    name: `Mechanism Test ${suffix.slice(0, 8)}`,
    slug: `mechanism-test-${suffix}`,
  });
  await db.insert(schema.organizationMembers).values({
    organizationId,
    takeIdentityId: identityId,
    role: "OWNER",
  });
  await db.insert(schema.campaigns).values({
    id: campaignId,
    organizationId,
    createdByIdentityId: identityId,
    status: "DRAFT",
    title: "Mechanism Test Campaign",
    description: "Evidence-backed mechanism integration fixture.",
    startTime,
    endTime,
    nominationLimit: 1,
    nominatorEligibilityMode: "MERKLE_ALLOWLIST",
    recipientEligibilityMode: "MERKLE_ALLOWLIST",
    nominationVisibilityMode: "PUBLIC",
  });
  await db.insert(schema.campaignResources).values({
    campaignId,
    type: "access",
    name: "Test places",
    quantity: 2,
  });

  await db.insert(schema.identityAllowlists).values({
    id: allowlistId,
    organizationId,
    name: "Mechanism test roster",
    status: "LOCKED",
    artifactHash: domainHash("TAKE_TEST_ALLOWLIST", { allowlistId, identityId }),
    createdByIdentityId: identityId,
    lockedByIdentityId: identityId,
    lockedAt: new Date()
  });
  await db.insert(schema.identityAllowlistMembers).values({
    allowlistId,
    subjectKey: protocolIdentityKey(identityId, nonce),
    takeIdentityId: identityId
  });

  return { userId, identityId, organizationId, campaignId, allowlistId, cutoffAt, endTime };
}

const rollback = new Error("ROLLBACK_MECHANISM_INTEGRATION_FIXTURE");

async function withRollback(work: (db: Database) => Promise<void>) {
  try {
    await database.db.transaction(async (transaction) => {
      await work(transaction as unknown as Database);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
