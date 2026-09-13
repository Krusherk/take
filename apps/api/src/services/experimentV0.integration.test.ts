import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabaseClient, schema, type Database } from "@take/database";
import {
  allocateRawUniqueSupportV0,
  campaignExperimentProtocolV0Schema,
  domainHash,
  TAKE_MECHANISM_VERSION,
  type AllocationInputV0,
  type CampaignMechanismConfigV1
} from "@take/mechanism";
import { protocolIdentityKey } from "@take/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadApiEnv } from "../config/env.js";
import { AllocationService } from "./allocation.js";
import { CampaignService } from "./campaign.js";
import { EligibilitySnapshotService } from "./eligibilitySnapshots.js";
import { ExperimentService } from "./experiment.js";
import { GraphService } from "./graph.js";
import { MechanismService } from "./mechanism.js";
import { NominationService } from "./nomination.js";
import { ReviewService } from "./review.js";

const envPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
const legacyManager = "0xc3a0178b31d8844455c49988736d51a2336056e5";
const rollback = new Error("ROLLBACK_EXPERIMENT_V0_DRY_RUN");
let database: ReturnType<typeof createDatabaseClient>;

beforeAll(() => {
  if (!process.env.DATABASE_URL) process.loadEnvFile(envPath);
  const env = loadApiEnv(process.env);
  database = createDatabaseClient(env.DATABASE_URL);
});

afterAll(async () => {
  await database.client.end();
});

describe.sequential("TAKE experiment V0 hard milestone", () => {
  it("runs the 10-selector campaign and replays the result exactly", async () => {
    await withRollback(async (db) => {
      const env = loadApiEnv(process.env);
      const fixture = await createDryRunFixture(db);
      const mechanisms = new MechanismService(db);
      const snapshots = new EligibilitySnapshotService(db, env);
      const experiments = new ExperimentService(db);
      const nominations = new NominationService(db, env);
      const graph = new GraphService(db);
      const reviews = new ReviewService(db);
      const campaigns = new CampaignService(db);
      const allocations = new AllocationService(db, env);

      await mechanisms.createDraft(fixture.campaignId, fixture.people.A.id, fixture.config);
      const built = await snapshots.createForCurrentDraft(fixture.campaignId, fixture.people.A.id);
      expect(built.nominator).toMatchObject({ status: "READY", eligibleCount: 10 });
      expect(built.recipient).toMatchObject({ status: "READY", eligibleCount: 6 });

      const popularityObservations = fixture.recipientLabels.map((label, index) => ({
        canonicalRecipientKey: fixture.people[label].key,
        value: index % 4,
        observedAt: fixture.cutoffAt.toISOString(),
        provenance: { source: "organizer-pre-campaign-roster", scaleVersion: "V0_0_3" }
      }));
      await expect(experiments.createDraft(fixture.campaignId, fixture.people.A.id, {
        variant: "OVERLAPPING",
        giverSnapshotId: built.nominator.id,
        recipientSnapshotId: built.recipient.id,
        popularityProxy: "ORGANIZER_FAMILIARITY",
        popularityObservations: popularityObservations.slice(0, -1)
      })).rejects.toMatchObject({ code: "POPULARITY_OBSERVATIONS_INCOMPLETE" });
      const draft = await experiments.createDraft(fixture.campaignId, fixture.people.A.id, {
        variant: "OVERLAPPING",
        giverSnapshotId: built.nominator.id,
        recipientSnapshotId: built.recipient.id,
        popularityProxy: "ORGANIZER_FAMILIARITY",
        popularityObservations
      });
      expect(draft.protocol.popularity.affectsMechanism).toBe(false);
      await mechanisms.lock(fixture.campaignId, fixture.people.A.id);
      const locked = await experiments.lock(fixture.campaignId, fixture.people.A.id);
      expect(locked).toMatchObject({ status: "LOCKED", variant: "OVERLAPPING" });
      await expect(experiments.replaceInternalObservations(fixture.campaignId, {
        popularityObservations
      })).rejects.toMatchObject({ code: "EXPERIMENT_ALREADY_LOCKED" });
      expect(campaignExperimentProtocolV0Schema.parse(locked.protocol).nomination)
        .toEqual({ takesPerEligibleCanonicalGiver: 1, recipientPopulation: "ROSTERED" });

      await db.update(schema.campaigns).set({
        status: "ACTIVE",
        onchainCampaignId: 991n,
        chainId: 10143,
        managerContractAddress: legacyManager
      }).where(eq(schema.campaigns.id, fixture.campaignId));

      const exposureA = await experiments.listRecipients(fixture.campaignId, fixture.people.A.id);
      const exposureARepeat = await experiments.listRecipients(fixture.campaignId, fixture.people.A.id);
      const exposureB = await experiments.listRecipients(fixture.campaignId, fixture.people.B.id);
      const searchExposure = await experiments.listRecipients(fixture.campaignId, fixture.people.A.id, "R");
      expect(recipientIds(exposureA)).toEqual(recipientIds(exposureARepeat));
      expect(recipientIds(exposureA)).not.toEqual(recipientIds(exposureB));
      expect(searchExposure.recipients.map((recipient) => recipient.displayName).sort()).toEqual(["R1", "R2"]);
      const loggedExposures = await db.select().from(schema.recipientDiscoveryExposures)
        .where(eq(schema.recipientDiscoveryExposures.campaignId, fixture.campaignId));
      expect(loggedExposures).toHaveLength(4);
      expect(loggedExposures.every((exposure) => Array.isArray(exposure.orderedRecipientKeys))).toBe(true);

      await expect(prepare("A", "A")).rejects.toMatchObject({
        code: "KNOWN_CANONICAL_SELF_NOMINATION"
      });

      const accepted: Array<{ giver: Label; recipient: Label; nominationId: string }> = [];
      for (const [giver, recipient] of fixture.acceptedGraph) {
        const prepared = await prepare(giver, recipient);
        accepted.push({ giver, recipient, nominationId: prepared.nomination.id });
      }
      await expect(prepare("S6", "R2")).rejects.toMatchObject({
        code: "SECOND_TAKE_FROM_CANONICAL_GIVER"
      });

      const attempts = await db.select().from(schema.nominationAttempts)
        .where(eq(schema.nominationAttempts.campaignId, fixture.campaignId));
      expect(attempts.filter((item) => item.accepted)).toHaveLength(10);
      expect(attempts.filter((item) => !item.accepted).map((item) => item.reasonCode).sort()).toEqual([
        "KNOWN_CANONICAL_SELF_NOMINATION",
        "SECOND_TAKE_FROM_CANONICAL_GIVER"
      ]);

      await projectFinalizedEdges(db, fixture, accepted);
      const activeView = await campaigns.getCampaignView(fixture.campaignId, fixture.people.A.id);
      expect(activeView?.participantCount).toBeNull();
      expect(activeView?.experiment).toMatchObject({ activeNominationDataHidden: true });

      const graphSnapshot = await graph.analyzeCampaign(fixture.campaignId);
      const reciprocity = graphSnapshot.signals.filter((signal) => signal.signalType === "DIRECT_RECIPROCITY");
      const cycles = graphSnapshot.signals.filter((signal) => signal.signalType === "SHORT_CYCLE");
      expect(reciprocity).toHaveLength(1);
      expect(cycles.length).toBeGreaterThanOrEqual(1);
      const storedEdges = await db.select().from(schema.nominationEdges)
        .where(eq(schema.nominationEdges.campaignId, fixture.campaignId));
      expect(storedEdges.every((edge) => edge.validity === "VALID")).toBe(true);
      await expect(graph.publicLatest(fixture.campaignId)).resolves.toMatchObject({
        status: "HIDDEN_UNTIL_CAMPAIGN_CLOSE",
        signalCounts: null
      });
      await expect(mechanisms.getAuditArtifact(fixture.campaignId)).resolves.toMatchObject({
        graph: { status: "HIDDEN_UNTIL_CAMPAIGN_CLOSE", signalCounts: null }
      });
      await expect(reviews.list(fixture.campaignId, fixture.people.A.id)).rejects.toMatchObject({
        code: "EXPERIMENT_INFORMATION_HIDDEN"
      });

      await db.update(schema.campaigns).set({ status: "CLOSED" })
        .where(eq(schema.campaigns.id, fixture.campaignId));
      await expect(graph.publicLatest(fixture.campaignId)).resolves.toMatchObject({
        campaignId: fixture.campaignId
      });
      expect((await reviews.list(fixture.campaignId, fixture.people.A.id)).length).toBeGreaterThan(0);
      const allocation = await allocations.run(fixture.campaignId, fixture.people.A.id);
      const selectedKeys = allocation.results.filter((result) => result.selected)
        .map((result) => result.recipientKey).sort();
      expect(selectedKeys).toEqual([
        fixture.people.R1.key,
        fixture.people.A.key,
        fixture.people.B.key
      ].sort());
      const finalization = await allocations.prepareFinalize(
        fixture.campaignId,
        allocation.run.id,
        fixture.people.A.id
      );
      expect(finalization).toMatchObject({
        allocationRunId: allocation.run.id,
        inputSnapshotHash: allocation.run.inputSnapshotHash,
        resultHash: allocation.run.resultHash,
        transaction: {
          to: legacyManager,
          chainId: 10143
        }
      });

      const [storedRun] = await db.select().from(schema.allocationRuns)
        .where(eq(schema.allocationRuns.id, allocation.run.id)).limit(1);
      if (!storedRun?.randomnessSeed || !isRecord(storedRun.inputArtifact)) {
        throw new Error("Dry-run allocation artifact is incomplete");
      }
      const replayInputs = storedRun.inputArtifact.allocationInputs as AllocationInputV0[];
      const replay = allocateRawUniqueSupportV0({
        campaignId: fixture.campaignId,
        resourceQuantity: 3,
        inputs: replayInputs,
        excludedEdges: storedRun.inputArtifact.objectiveExclusions as Array<{ edgeId: string; reason: string }>,
        randomnessSeed: storedRun.randomnessSeed as `0x${string}`
      });
      expect(replay.inputSnapshotHash).toBe(storedRun.inputSnapshotHash);
      expect(replay.resultHash).toBe(storedRun.resultHash);
      expect(storedRun.inputArtifact).not.toHaveProperty("popularityObservations");
      expect(storedRun.inputArtifact).not.toHaveProperty("graphSignals");

      async function prepare(giver: Label, recipient: Label) {
        return nominations.prepare(
          fixture.campaignId,
          fixture.people[giver].id,
          fixture.people[giver].key,
          legacyManager,
          10143,
          {
            idempotencyKey: randomUUID(),
            recipient: { type: "take_identity", takeIdentityId: fixture.people[recipient].id }
          }
        );
      }
    });
  }, 45_000);
});

type Label = "A" | "B" | "C" | "D" | "R1" | "R2" | "S6" | "S7" | "S8" | "S9" | "S10";
type PersonFixture = { id: string; userId: string; key: `0x${string}` };

async function createDryRunFixture(db: Database) {
  const suffix = randomUUID();
  const labels: Label[] = ["A", "B", "C", "D", "R1", "R2", "S6", "S7", "S8", "S9", "S10"];
  const people = {} as Record<Label, PersonFixture>;
  for (const label of labels) {
    const userId = randomUUID();
    const id = randomUUID();
    const nonce = randomUUID().replaceAll("-", "").slice(0, 32);
    const key = protocolIdentityKey(id, nonce);
    await db.insert(schema.users).values({
      id: userId,
      privyUserId: `did:privy:v0-${label}-${suffix}`,
      displayName: label
    });
    await db.insert(schema.takeIdentities).values({ id, userId, creationNonce: nonce, protocolIdentityKey: key });
    people[label] = { id, userId, key };
  }

  const organizationId = randomUUID();
  const campaignId = randomUUID();
  const giverAllowlistId = randomUUID();
  const recipientAllowlistId = randomUUID();
  const cutoffAt = new Date(Date.now() - 7_200_000);
  const startTime = new Date(Date.now() - 3_600_000);
  const endTime = new Date(Date.now() + 3_600_000);
  await db.insert(schema.organizations).values({
    id: organizationId,
    name: `V0 dry run ${suffix.slice(0, 8)}`,
    slug: `v0-dry-run-${suffix}`
  });
  await db.insert(schema.organizationMembers).values({
    organizationId,
    takeIdentityId: people.A.id,
    role: "OWNER"
  });
  await db.insert(schema.campaigns).values({
    id: campaignId,
    organizationId,
    createdByIdentityId: people.A.id,
    status: "DRAFT",
    title: "V0 ten-selector dry run",
    startTime,
    endTime,
    nominationLimit: 1,
    nominatorEligibilityMode: "MERKLE_ALLOWLIST",
    recipientEligibilityMode: "MERKLE_ALLOWLIST",
    nominationVisibilityMode: "PUBLIC"
  });
  await db.insert(schema.campaignResources).values({
    campaignId,
    type: "access",
    name: "Pilot places",
    quantity: 3
  });
  await db.insert(schema.identityAllowlists).values([
    {
      id: giverAllowlistId,
      organizationId,
      name: "V0 selectors",
      status: "LOCKED",
      artifactHash: domainHash("TAKE_TEST_ALLOWLIST", { giverAllowlistId }),
      createdByIdentityId: people.A.id,
      lockedByIdentityId: people.A.id,
      lockedAt: new Date()
    },
    {
      id: recipientAllowlistId,
      organizationId,
      name: "V0 recipients",
      status: "LOCKED",
      artifactHash: domainHash("TAKE_TEST_ALLOWLIST", { recipientAllowlistId }),
      createdByIdentityId: people.A.id,
      lockedByIdentityId: people.A.id,
      lockedAt: new Date()
    }
  ]);
  const selectorLabels: Label[] = ["A", "B", "C", "D", "R2", "S6", "S7", "S8", "S9", "S10"];
  const recipientLabels: Label[] = ["A", "B", "C", "D", "R1", "R2"];
  await db.insert(schema.identityAllowlistMembers).values(selectorLabels.map((label) => ({
    allowlistId: giverAllowlistId,
    subjectKey: people[label].key,
    takeIdentityId: people[label].id
  })));
  await db.insert(schema.identityAllowlistMembers).values(recipientLabels.map((label) => ({
    allowlistId: recipientAllowlistId,
    subjectKey: people[label].key,
    takeIdentityId: people[label].id
  })));

  const config: CampaignMechanismConfigV1 = {
    mechanismVersion: TAKE_MECHANISM_VERSION,
    assuranceLevel: "LOW_ASSURANCE",
    campaignId,
    organizationId,
    selectorRecipientMode: "OVERLAPPING",
    nominationLimit: 1,
    nominatorPolicy: {
      audience: "NOMINATOR",
      population: { type: "ORGANIZER_ALLOWLIST", allowlistId: giverAllowlistId },
      allOf: [{ id: "selector-roster", version: 1, type: "MERKLE_ALLOWLIST", allowlistId: giverAllowlistId }]
    },
    recipientPolicy: {
      audience: "RECIPIENT",
      population: { type: "ORGANIZER_ALLOWLIST", allowlistId: recipientAllowlistId },
      allOf: [{ id: "recipient-roster", version: 1, type: "MERKLE_ALLOWLIST", allowlistId: recipientAllowlistId }]
    },
    reciprocityPolicy: "REJECT_LATER_EDGE",
    allocation: { strategyId: "RAW_UNIQUE_SUPPORT", strategyVersion: "2" },
    resourceQuantity: 3,
    cutoffAt: cutoffAt.toISOString(),
    randomness: { source: "NONE" },
    evidenceVersion: "1",
    evaluatorVersion: "1",
    graphVersion: "1",
    contract: { chainId: 10143, managerAddress: legacyManager, managerVersion: "LEGACY_V1" }
  };
  const acceptedGraph: Array<[Label, Label]> = [
    ["A", "B"],
    ["B", "A"],
    ["C", "D"],
    ["D", "R2"],
    ["R2", "C"],
    ["S6", "R1"],
    ["S7", "R1"],
    ["S8", "R1"],
    ["S9", "A"],
    ["S10", "B"]
  ];
  return { campaignId, organizationId, cutoffAt, people, config, acceptedGraph, recipientLabels };
}

async function projectFinalizedEdges(
  db: Database,
  fixture: Awaited<ReturnType<typeof createDryRunFixture>>,
  accepted: Array<{ giver: Label; recipient: Label; nominationId: string }>
) {
  for (const [index, item] of accepted.entries()) {
    const transactionHash = domainHash("TAKE_V0_DRY_RUN_TX", { campaignId: fixture.campaignId, index });
    const blockHash = domainHash("TAKE_V0_DRY_RUN_BLOCK", { campaignId: fixture.campaignId, index });
    const [event] = await db.insert(schema.chainEvents).values({
      chainId: 10143,
      contractAddress: legacyManager,
      eventName: "TakeGiven",
      transactionHash,
      logIndex: 0,
      blockNumber: BigInt(index + 1),
      blockHash,
      transactionIndex: 0,
      blockTimestamp: new Date(Date.now() + index * 1_000),
      finalityStatus: "FINALIZED",
      finalizedAt: new Date(),
      payload: {}
    }).returning();
    if (!event) throw new Error("Failed to create dry-run chain event");
    const [nomination] = await db.select().from(schema.nominations)
      .where(eq(schema.nominations.id, item.nominationId)).limit(1);
    if (!nomination) throw new Error("Dry-run nomination missing");
    await db.insert(schema.nominationEdges).values({
      campaignId: fixture.campaignId,
      chainEventId: event.id,
      nominationId: nomination.id,
      experimentId: nomination.experimentId,
      nominatorSnapshotId: nomination.nominatorSnapshotId,
      recipientSnapshotId: nomination.recipientSnapshotId,
      chainId: 10143,
      contractAddress: legacyManager,
      transactionHash,
      blockNumber: BigInt(index + 1),
      blockHash,
      transactionIndex: 0,
      logIndex: 0,
      blockTimestamp: new Date(Date.now() + index * 1_000),
      giverIdentityKey: fixture.people[item.giver].key,
      recipientIdentityKey: fixture.people[item.recipient].key,
      canonicalGiverKey: fixture.people[item.giver].key,
      canonicalRecipientKey: fixture.people[item.recipient].key,
      identityResolution: { source: "dry-run-canonical-projection" },
      validity: "VALID",
      finalityStatus: "FINALIZED"
    });
    await db.update(schema.nominations).set({
      transactionHash,
      chainId: 10143,
      logIndex: 0,
      blockNumber: BigInt(index + 1),
      status: "CONFIRMED",
      confirmedAt: new Date(),
      indexedAt: new Date()
    }).where(eq(schema.nominations.id, nomination.id));
  }
}

function recipientIds(exposure: Awaited<ReturnType<ExperimentService["listRecipients"]>>) {
  return exposure.recipients.map((item) => JSON.stringify(item.recipient));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
