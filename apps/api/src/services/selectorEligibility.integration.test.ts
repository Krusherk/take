import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDatabaseClient, schema, type Database } from "@take/database";
import { domainHash, type SelectorEligibilityPolicyV1 } from "@take/mechanism";
import { protocolIdentityKey } from "@take/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadApiEnv } from "../config/env.js";
import { SelectorEligibilityService } from "./selectorEligibility.js";

const envPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
const rollback = new Error("ROLLBACK_SELECTOR_ELIGIBILITY_FIXTURE");
let database: ReturnType<typeof createDatabaseClient>;

beforeAll(() => {
  if (!process.env.DATABASE_URL) process.loadEnvFile(envPath);
  database = createDatabaseClient(loadApiEnv(process.env).DATABASE_URL);
});

afterAll(async () => { await database.client.end(); });

describe.sequential("selector eligibility V1", () => {
  it("recalculates from verified declared evidence and freezes ordinary mutation after lock", async () => {
    await withRollback(async (db) => {
      const env = loadApiEnv(process.env);
      const service = new SelectorEligibilityService(db, env);
      const fixture = await createFixture(db);
      await service.saveDraft(fixture.campaignId, fixture.ownerIdentityId, policy(fixture));

      const assessed = await service.evaluate(fixture.campaignId, fixture.ownerIdentityId);
      expect(assessed).toHaveLength(1);
      expect(assessed[0]).toMatchObject({ status: "NEEDS_REVIEW", totalPoints: 40 });

      await service.submit({
        campaignId: fixture.campaignId,
        actorIdentityId: fixture.selectorIdentityId,
        submissionType: "ELIGIBILITY_APPEAL",
        targetRuleId: "builder-project",
        explanation: "This repository contains the campaign-relevant project.",
        evidence: [{ type: "GITHUB_OR_PROJECT", url: "https://github.com/example/take-builder" }]
      });
      const [review] = await service.listReviews(fixture.campaignId, fixture.ownerIdentityId);
      expect(review).toBeDefined();
      await service.decide({
        campaignId: fixture.campaignId,
        caseId: review!.id,
        actorIdentityId: fixture.ownerIdentityId,
        decision: "VERIFY_EVIDENCE",
        reason: "The declared project evidence was verified."
      });
      const [recalculated] = await service.listAssessments(fixture.campaignId, fixture.ownerIdentityId);
      expect(recalculated).toMatchObject({ status: "ELIGIBLE", totalPoints: 100, qualificationPath: "AUTOMATIC" });

      const locked = await service.lock(fixture.campaignId, fixture.ownerIdentityId);
      expect(locked).toMatchObject({ eligibleCount: 1 });
      await expect(service.evaluate(fixture.campaignId, fixture.ownerIdentityId))
        .rejects.toMatchObject({ code: "SELECTOR_ELIGIBILITY_LOCKED", statusCode: 409 });
      await expect(service.submit({
        campaignId: fixture.campaignId,
        actorIdentityId: fixture.selectorIdentityId,
        submissionType: "ELIGIBILITY_APPEAL",
        targetRuleId: "builder-project",
        explanation: "Late evidence",
        evidence: [{ type: "GITHUB_OR_PROJECT", url: "https://github.com/example/late" }]
      })).rejects.toMatchObject({ code: "SELECTOR_ELIGIBILITY_LOCKED", statusCode: 409 });
    });
  }, 30_000);
});

function policy(fixture: Fixture): SelectorEligibilityPolicyV1 {
  return {
    version: "TAKE_SELECTOR_ELIGIBILITY_V1",
    campaignId: fixture.campaignId,
    candidateAllowlistId: fixture.allowlistId,
    preset: "CUSTOM",
    cutoffAt: fixture.cutoffAt.toISOString(),
    categories: [
      { id: "ONCHAIN", label: "Monad / onchain history", enabled: true, maximumPoints: 40, rules: [{ id: "wallet-connected", label: "Wallet connected", points: 40, source: "AUTOMATED", evidenceRule: { id: "wallet-connected", version: 1, type: "WALLET_CONNECTED", chainType: "ethereum" } }] },
      { id: "BUILDER", label: "Builder history", enabled: true, maximumPoints: 60, rules: [{ id: "builder-project", label: "Relevant project verified", points: 60, source: "REVIEWED_SUBMISSION", evidenceType: "GITHUB_OR_PROJECT", instructions: "Share a repository or deployed project." }] }
    ],
    requiredTotalPoints: 100,
    minimumDistinctCategories: 2,
    allowAppeals: true,
    integrityScreeningEnabled: false,
    newcomerPath: { enabled: false }
  };
}

interface Fixture { campaignId: string; organizationId: string; ownerIdentityId: string; selectorIdentityId: string; allowlistId: string; cutoffAt: Date }

async function createFixture(db: Database): Promise<Fixture> {
  const suffix = randomUUID();
  const organizationId = randomUUID();
  const campaignId = randomUUID();
  const allowlistId = randomUUID();
  const cutoffAt = new Date(Date.now() + 60_000);
  const owner = await person(db, `owner-${suffix}`, "Eligibility owner");
  const selector = await person(db, `selector-${suffix}`, "Eligibility selector");
  await db.insert(schema.wallets).values({ takeIdentityId: selector.identityId, address: `0x${suffix.replaceAll("-", "").padEnd(40, "0").slice(0, 40)}`, walletType: "embedded", chainType: "ethereum", isPrimary: true, verifiedAt: new Date() });
  await db.insert(schema.organizations).values({ id: organizationId, name: "Eligibility test", slug: `eligibility-${suffix}` });
  await db.insert(schema.organizationMembers).values({ organizationId, takeIdentityId: owner.identityId, role: "OWNER" });
  await db.insert(schema.campaigns).values({ id: campaignId, organizationId, createdByIdentityId: owner.identityId, status: "DRAFT", title: "Selector eligibility", startTime: new Date(Date.now() + 3_600_000), endTime: new Date(Date.now() + 90_000_000), nominationLimit: 1, nominatorEligibilityMode: "MERKLE_ALLOWLIST", recipientEligibilityMode: "MERKLE_ALLOWLIST", nominationVisibilityMode: "PUBLIC" });
  await db.insert(schema.identityAllowlists).values({ id: allowlistId, organizationId, name: "Candidates", createdByIdentityId: owner.identityId });
  await db.insert(schema.identityAllowlistMembers).values({ allowlistId, subjectKey: selector.key, takeIdentityId: selector.identityId });
  return { campaignId, organizationId, ownerIdentityId: owner.identityId, selectorIdentityId: selector.identityId, allowlistId, cutoffAt };
}

async function person(db: Database, privyUserId: string, displayName: string) {
  const userId = randomUUID(); const identityId = randomUUID(); const nonce = randomUUID().replaceAll("-", "").slice(0, 32); const key = protocolIdentityKey(identityId, nonce);
  await db.insert(schema.users).values({ id: userId, privyUserId, displayName });
  await db.insert(schema.takeIdentities).values({ id: identityId, userId, creationNonce: nonce, protocolIdentityKey: key });
  return { identityId, key };
}

async function withRollback(work: (db: Database) => Promise<void>) {
  try { await database.db.transaction(async (tx) => { await work(tx as unknown as Database); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
}
