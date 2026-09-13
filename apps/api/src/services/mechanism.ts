import { and, desc, eq, inArray, max } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import {
  campaignMechanismConfigV1Schema,
  committedDrandRound,
  domainHash,
  DRAND_EVMNET_CHAIN_HASH,
  DRAND_EVMNET_GENESIS_TIME,
  DRAND_EVMNET_PERIOD_SECONDS,
  mechanismConfigHash,
  type CampaignMechanismConfigV1
} from "@take/mechanism";
import { assertOrganizationRole } from "./authorization.js";
import { notFound, ServiceError } from "./errors.js";

const LEGACY_TESTNET_MANAGER = "0xc3a0178b31d8844455c49988736d51a2336056e5";

export class MechanismService {
  constructor(private readonly db: Database) {}

  async getMechanism(campaignId: string) {
    const campaign = await this.campaign(campaignId);
    const config = await this.currentConfig(campaignId, campaign.mechanismConfigId);
    if (!config) {
      return {
        campaignId,
        manager: {
          address: campaign.managerContractAddress,
          version: campaign.managerVersion
        },
        mechanismVersion: "LEGACY_V1",
        assuranceLevel: "LOW_ASSURANCE",
        warning: "This legacy testnet campaign is not described as Sybil-resistant.",
        config: null,
        configHash: null,
        status: campaign.status
      };
    }

    const snapshots = await this.db
      .select()
      .from(schema.eligibilitySnapshots)
      .where(eq(schema.eligibilitySnapshots.mechanismConfigId, config.id));
    const [randomness] = await this.db
      .select()
      .from(schema.randomnessArtifacts)
      .where(eq(schema.randomnessArtifacts.mechanismConfigId, config.id))
      .orderBy(desc(schema.randomnessArtifacts.createdAt))
      .limit(1);

    return {
      campaignId,
      manager: {
        address: campaign.managerContractAddress,
        version: campaign.managerVersion
      },
      mechanismVersion: config.mechanismVersion,
      assuranceLevel: parsedConfig(config).assuranceLevel,
      warning: parsedConfig(config).assuranceLevel === "LOW_ASSURANCE"
        ? "This testnet mechanism is not described as Sybil-resistant."
        : null,
      config: parsedConfig(config),
      configHash: config.configHash,
      status: config.status,
      lockedAt: config.lockedAt?.toISOString() ?? null,
      snapshots: snapshots.map(publicSnapshotSummary),
      randomness: randomness ? {
        source: randomness.source,
        network: randomness.network,
        chainHash: randomness.chainHash,
        round: randomness.round.toString(),
        notBefore: randomness.notBefore.toISOString(),
        status: randomness.status,
        artifactHash: randomness.artifactHash,
        verifiedAt: randomness.verifiedAt?.toISOString() ?? null
      } : null
    };
  }

  async createDraft(campaignId: string, actorIdentityId: string, input: unknown) {
    const config = campaignMechanismConfigV1Schema.parse(input);
    const campaign = await this.campaign(campaignId);
    await assertOrganizationRole(this.db, campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    if (campaign.status !== "DRAFT") {
      throw new ServiceError("CAMPAIGN_NOT_DRAFT", "Only draft campaigns can receive a mechanism revision", 409);
    }
    if (campaign.mechanismConfigId) {
      throw new ServiceError(
        "MECHANISM_ALREADY_LOCKED",
        "A locked campaign mechanism cannot be revised",
        409
      );
    }
    if (config.campaignId !== campaign.id || config.organizationId !== campaign.organizationId) {
      throw new ServiceError("MECHANISM_SCOPE_MISMATCH", "Mechanism campaign or organization does not match the route", 400);
    }
    const [resource] = await this.db
      .select()
      .from(schema.campaignResources)
      .where(eq(schema.campaignResources.campaignId, campaign.id))
      .limit(1);
    if (!resource) notFound("Campaign resource not found");
    if (config.resourceQuantity !== resource.quantity) {
      throw new ServiceError(
        "RESOURCE_QUANTITY_MISMATCH",
        "Mechanism resource quantity must match the published campaign resource",
        409
      );
    }
    if (new Date(config.cutoffAt) > campaign.startTime) {
      throw new ServiceError("INVALID_ELIGIBILITY_CUTOFF", "Eligibility cutoff must not be after campaign start", 400);
    }
    this.assertDeploymentPolicy(config);
    this.assertRandomnessCommitment(config, campaign.endTime);

    const configHash = mechanismConfigHash(config);
    return this.db.transaction(async (tx) => {
      const [aggregate] = await tx
        .select({ revision: max(schema.campaignMechanismConfigs.revision) })
        .from(schema.campaignMechanismConfigs)
        .where(eq(schema.campaignMechanismConfigs.campaignId, campaign.id));
      const revision = Number(aggregate?.revision ?? 0) + 1;
      const [previous] = await tx
        .select({ id: schema.campaignMechanismConfigs.id })
        .from(schema.campaignMechanismConfigs)
        .where(
          and(
            eq(schema.campaignMechanismConfigs.campaignId, campaign.id),
            eq(schema.campaignMechanismConfigs.status, "DRAFT")
          )
        )
        .orderBy(desc(schema.campaignMechanismConfigs.revision))
        .limit(1);

      if (previous) {
        await tx
          .update(schema.campaignMechanismConfigs)
          .set({ status: "SUPERSEDED" })
          .where(eq(schema.campaignMechanismConfigs.id, previous.id));
      }

      const [created] = await tx
        .insert(schema.campaignMechanismConfigs)
        .values({
          campaignId: campaign.id,
          revision,
          mechanismVersion: config.mechanismVersion,
          status: "DRAFT",
          canonicalConfig: config,
          configHash,
          supersedesId: previous?.id,
          createdByIdentityId: actorIdentityId
        })
        .returning();
      if (!created) throw new Error("Failed to create mechanism revision");

      await tx.insert(schema.auditLogs).values({
        actorIdentityId,
        organizationId: campaign.organizationId,
        campaignId: campaign.id,
        action: "MECHANISM_DRAFT_CREATED",
        metadata: { mechanismConfigId: created.id, revision, configHash }
      });
      return serializeConfigRecord(created);
    });
  }

  async lock(campaignId: string, actorIdentityId: string) {
    const campaign = await this.campaign(campaignId);
    await assertOrganizationRole(this.db, campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    if (campaign.status !== "DRAFT") {
      throw new ServiceError("CAMPAIGN_NOT_DRAFT", "Only a draft campaign mechanism can be locked", 409);
    }
    const configRecord = await this.currentDraft(campaignId);
    if (!configRecord) notFound("No draft mechanism revision exists");
    const config = parsedConfig(configRecord);
    this.assertDeploymentPolicy(config);
    this.assertRandomnessCommitment(config, campaign.endTime);
    const experiment = campaign.experimentId
      ? await this.db.select().from(schema.campaignExperiments)
          .where(eq(schema.campaignExperiments.id, campaign.experimentId)).limit(1)
          .then((rows) => rows[0])
      : undefined;
    if (campaign.experimentId && (
      !experiment
      || experiment.status !== "DRAFT"
      || experiment.mechanismConfigId !== configRecord.id
    )) {
      throw new ServiceError(
        "EXPERIMENT_PROTOCOL_MISMATCH",
        "The V0 experiment draft must reference the mechanism revision being locked",
        409
      );
    }

    const snapshots = await this.db
      .select()
      .from(schema.eligibilitySnapshots)
      .where(eq(schema.eligibilitySnapshots.mechanismConfigId, configRecord.id))
      .orderBy(desc(schema.eligibilitySnapshots.createdAt));
    const nominator = snapshots.find((snapshot) => snapshot.subject === "NOMINATOR");
    const recipient = snapshots.find((snapshot) => snapshot.subject === "RECIPIENT");
    this.assertLockableSnapshot(nominator, "nominator");
    this.assertLockableSnapshot(recipient, "recipient");

    if (config.selectorRecipientMode === "DISJOINT_SELECTOR_RECIPIENT") {
      const members = await this.db
        .select({
          snapshotId: schema.eligibilitySnapshotMembers.snapshotId,
          canonicalSubjectKey: schema.eligibilitySnapshotMembers.canonicalSubjectKey
        })
        .from(schema.eligibilitySnapshotMembers)
        .where(
          and(
            inArray(schema.eligibilitySnapshotMembers.snapshotId, [nominator.id, recipient.id]),
            eq(schema.eligibilitySnapshotMembers.eligible, true)
          )
        );
      const nominatorKeys = new Set(
        members
          .filter((member) => member.snapshotId === nominator.id)
          .map((member) => member.canonicalSubjectKey.toLowerCase())
      );
      const overlap = members
        .filter(
          (member) => member.snapshotId === recipient.id
            && nominatorKeys.has(member.canonicalSubjectKey.toLowerCase())
        )
        .map((member) => member.canonicalSubjectKey);
      if (overlap.length > 0) {
        throw new ServiceError(
          "SELECTOR_RECIPIENT_OVERLAP",
          "Disjoint campaigns cannot lock while an identity is eligible in both populations",
          409,
          { count: overlap.length }
        );
      }
    }

    const rulesHash = domainHash("TAKE_CAMPAIGN_RULES_V1", {
      configHash: configRecord.configHash,
      resourceQuantity: config.resourceQuantity,
      nominatorSnapshot: {
        hash: nominator.snapshotHash,
        root: nominator.root
      },
      recipientSnapshot: {
        hash: recipient.snapshotHash,
        root: recipient.root
      },
      contract: config.contract,
      randomness: config.randomness,
      experimentProtocolHash: experiment?.protocolHash ?? null
    });
    const now = new Date();

    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .update(schema.campaignMechanismConfigs)
        .set({ status: "LOCKED", lockedByIdentityId: actorIdentityId, lockedAt: now })
        .where(
          and(
            eq(schema.campaignMechanismConfigs.id, configRecord.id),
            eq(schema.campaignMechanismConfigs.status, "DRAFT")
          )
        )
        .returning();
      if (!locked) {
        throw new ServiceError("MECHANISM_ALREADY_LOCKED", "The mechanism revision changed before it could be locked", 409);
      }

      await tx
        .update(schema.eligibilitySnapshots)
        .set({ status: "LOCKED", lockedByIdentityId: actorIdentityId, lockedAt: now })
        .where(inArray(schema.eligibilitySnapshots.id, [nominator.id, recipient.id]));

      const [updatedCampaign] = await tx
        .update(schema.campaigns)
        .set({
          mechanismConfigId: configRecord.id,
          managerContractAddress: config.contract.managerAddress.toLowerCase(),
          managerVersion: config.contract.managerVersion,
          rulesHash,
          nominationLimit: 1,
          nominatorEligibilityMode: contractEligibilityMode(config.nominatorPolicy.population.type),
          recipientEligibilityMode: contractEligibilityMode(config.recipientPolicy.population.type),
          nominatorEligibilityRoot: nominator.root,
          recipientEligibilityRoot: recipient.root,
          updatedAt: now
        })
        .where(eq(schema.campaigns.id, campaign.id))
        .returning();
      if (!updatedCampaign) throw new Error("Failed to attach locked mechanism to campaign");

      if (config.randomness.source === "DRAND") {
        await tx
          .insert(schema.randomnessArtifacts)
          .values({
            campaignId: campaign.id,
            mechanismConfigId: configRecord.id,
            source: "DRAND",
            network: config.randomness.network,
            chainHash: config.randomness.chainHash,
            round: BigInt(config.randomness.round),
            notBefore: new Date(config.randomness.notBefore),
            status: "COMMITTED"
          })
          .onConflictDoNothing();
      }

      await tx.insert(schema.auditLogs).values({
        actorIdentityId,
        organizationId: campaign.organizationId,
        campaignId: campaign.id,
        action: "MECHANISM_LOCKED",
        metadata: {
          mechanismConfigId: configRecord.id,
          configHash: configRecord.configHash,
          nominatorSnapshotHash: nominator.snapshotHash,
          recipientSnapshotHash: recipient.snapshotHash,
          experimentProtocolHash: experiment?.protocolHash ?? null,
          rulesHash
        }
      });
      return {
        config: serializeConfigRecord(locked),
        campaign: {
          id: updatedCampaign.id,
          rulesHash,
          nominatorEligibilityRoot: nominator.root,
          recipientEligibilityRoot: recipient.root,
          managerAddress: updatedCampaign.managerContractAddress,
          managerVersion: updatedCampaign.managerVersion
        }
      };
    });
  }

  async getAuditArtifact(campaignId: string) {
    const campaign = await this.campaign(campaignId);
    const config = await this.currentConfig(campaignId, campaign.mechanismConfigId);
    const [snapshots, graph, allocation, randomness, experiment] = await Promise.all([
      config
        ? this.db.select().from(schema.eligibilitySnapshots)
            .where(eq(schema.eligibilitySnapshots.mechanismConfigId, config.id))
        : Promise.resolve([]),
      this.db.select().from(schema.graphSnapshots)
        .where(eq(schema.graphSnapshots.campaignId, campaignId))
        .orderBy(desc(schema.graphSnapshots.createdAt)).limit(1),
      this.db.select().from(schema.allocationRuns)
        .where(eq(schema.allocationRuns.campaignId, campaignId))
        .orderBy(desc(schema.allocationRuns.startedAt)).limit(1),
      this.db.select().from(schema.randomnessArtifacts)
        .where(eq(schema.randomnessArtifacts.campaignId, campaignId))
        .orderBy(desc(schema.randomnessArtifacts.createdAt)).limit(1),
      campaign.experimentId
        ? this.db.select().from(schema.campaignExperiments)
            .where(eq(schema.campaignExperiments.id, campaign.experimentId)).limit(1)
            .then((rows) => rows[0])
        : Promise.resolve(undefined)
    ]);

    return {
      artifactVersion: "1",
      campaign: {
        id: campaign.id,
        chainId: campaign.chainId,
        onchainCampaignId: campaign.onchainCampaignId?.toString() ?? null,
        managerAddress: campaign.managerContractAddress,
        managerVersion: campaign.managerVersion,
        rulesHash: campaign.rulesHash,
        finalResultHash: campaign.finalResultHash
      },
      mechanism: config ? {
        config: parsedConfig(config),
        configHash: config.configHash,
        status: config.status,
        lockedAt: config.lockedAt?.toISOString() ?? null
      } : null,
      experiment: experiment ? {
        experimentVersion: experiment.experimentVersion,
        variant: experiment.variant,
        status: experiment.status,
        protocol: experiment.canonicalProtocol,
        protocolHash: experiment.protocolHash,
        lockedAt: experiment.lockedAt?.toISOString() ?? null,
        researchObservationsPublic: false
      } : null,
      eligibilitySnapshots: snapshots.map((snapshot) => ({
        subject: snapshot.subject,
        status: snapshot.status,
        root: snapshot.root,
        snapshotHash: snapshot.snapshotHash,
        policyHash: snapshot.policyHash,
        candidateCount: snapshot.candidateCount,
        eligibleCount: snapshot.eligibleCount,
        cutoffAt: snapshot.cutoffAt?.toISOString() ?? null,
        lockedAt: snapshot.lockedAt?.toISOString() ?? null
      })),
      graph: experiment && !["CLOSED", "ALLOCATING", "FINALIZED"].includes(campaign.status)
        ? { status: "HIDDEN_UNTIL_CAMPAIGN_CLOSE", signalCounts: null }
        : graph[0] ? publicGraphArtifact(graph[0]) : null,
      randomness: randomness[0] ? publicRandomnessArtifact(randomness[0]) : null,
      allocation: allocation[0] ? {
        strategyId: allocation[0].strategyId,
        strategyVersion: allocation[0].strategyVersion,
        inputSnapshotHash: allocation[0].inputSnapshotHash,
        inputArtifact: allocation[0].inputArtifact,
        resultHash: allocation[0].resultHash,
        resultArtifact: allocation[0].resultArtifact,
        status: allocation[0].status
      } : null
    };
  }

  async currentDraft(campaignId: string) {
    const [record] = await this.db
      .select()
      .from(schema.campaignMechanismConfigs)
      .where(
        and(
          eq(schema.campaignMechanismConfigs.campaignId, campaignId),
          eq(schema.campaignMechanismConfigs.status, "DRAFT")
        )
      )
      .orderBy(desc(schema.campaignMechanismConfigs.revision))
      .limit(1);
    return record;
  }

  private async currentConfig(campaignId: string, selectedId: string | null) {
    if (selectedId) {
      const [selected] = await this.db
        .select()
        .from(schema.campaignMechanismConfigs)
        .where(eq(schema.campaignMechanismConfigs.id, selectedId))
        .limit(1);
      if (selected) return selected;
    }
    const [latest] = await this.db
      .select()
      .from(schema.campaignMechanismConfigs)
      .where(eq(schema.campaignMechanismConfigs.campaignId, campaignId))
      .orderBy(desc(schema.campaignMechanismConfigs.revision))
      .limit(1);
    return latest;
  }

  private async campaign(campaignId: string) {
    const [campaign] = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) notFound("Campaign not found");
    return campaign;
  }

  private assertDeploymentPolicy(config: CampaignMechanismConfigV1) {
    if (config.assuranceLevel === "LOW_ASSURANCE") {
      if (config.contract.chainId !== 10143 || config.contract.managerVersion !== "LEGACY_V1") {
        throw new ServiceError(
          "LOW_ASSURANCE_TESTNET_ONLY",
          "Low-assurance mechanisms are restricted to the existing Monad testnet manager",
          409
        );
      }
      if (config.contract.managerAddress.toLowerCase() !== LEGACY_TESTNET_MANAGER) {
        throw new ServiceError("LEGACY_MANAGER_MISMATCH", "The legacy manager address is immutable", 409);
      }
      return;
    }
    throw new ServiceError(
      "PROTECTED_CAMPAIGNS_NOT_ENABLED",
      "Protected campaigns require a separately reviewed and explicitly approved V2 manager deployment",
      409
    );
  }

  private assertRandomnessCommitment(config: CampaignMechanismConfigV1, endTime: Date) {
    if (config.randomness.source !== "DRAND") {
      if (config.assuranceLevel === "PROTECTED") {
        throw new ServiceError("DRAND_REQUIRED", "Protected campaigns require drand randomness", 409);
      }
      return;
    }
    if (config.randomness.chainHash !== DRAND_EVMNET_CHAIN_HASH) {
      throw new ServiceError("DRAND_CHAIN_MISMATCH", "Only pinned drand evmnet is supported", 409);
    }
    const expected = committedDrandRound(endTime.toISOString(), {
      genesis_time: DRAND_EVMNET_GENESIS_TIME,
      period: DRAND_EVMNET_PERIOD_SECONDS
    });
    if (config.randomness.round !== expected.round || config.randomness.notBefore !== expected.notBefore) {
      throw new ServiceError(
        "DRAND_COMMITMENT_MISMATCH",
        "The committed drand round must be the first round at or after campaign end plus 600 seconds",
        409,
        expected
      );
    }
  }

  private assertLockableSnapshot(
    snapshot: typeof schema.eligibilitySnapshots.$inferSelect | undefined,
    label: string
  ): asserts snapshot is typeof schema.eligibilitySnapshots.$inferSelect {
    if (!snapshot) {
      throw new ServiceError("ELIGIBILITY_SNAPSHOT_MISSING", `The ${label} snapshot has not been built`, 409);
    }
    if (snapshot.status !== "READY") {
      throw new ServiceError(
        "ELIGIBILITY_SNAPSHOT_NOT_READY",
        `The ${label} snapshot is ${snapshot.status.toLowerCase()} and cannot be locked`,
        409
      );
    }
  }
}

function parsedConfig(record: typeof schema.campaignMechanismConfigs.$inferSelect) {
  return campaignMechanismConfigV1Schema.parse(record.canonicalConfig);
}

function serializeConfigRecord(record: typeof schema.campaignMechanismConfigs.$inferSelect) {
  return {
    id: record.id,
    campaignId: record.campaignId,
    revision: record.revision,
    status: record.status,
    configHash: record.configHash,
    config: parsedConfig(record),
    createdAt: record.createdAt.toISOString(),
    lockedAt: record.lockedAt?.toISOString() ?? null
  };
}

function contractEligibilityMode(populationType: CampaignMechanismConfigV1["nominatorPolicy"]["population"]["type"]) {
  return populationType === "OPEN_EXTERNAL" ? "EXTERNAL_ALLOWED" as const : "MERKLE_ALLOWLIST" as const;
}

function publicSnapshotSummary(snapshot: typeof schema.eligibilitySnapshots.$inferSelect) {
  return {
    id: snapshot.id,
    audience: snapshot.subject,
    status: snapshot.status,
    root: snapshot.root,
    snapshotHash: snapshot.snapshotHash,
    candidateCount: snapshot.candidateCount,
    eligibleCount: snapshot.eligibleCount,
    cutoffAt: snapshot.cutoffAt?.toISOString() ?? null,
    lockedAt: snapshot.lockedAt?.toISOString() ?? null
  };
}

function publicRandomnessArtifact(artifact: typeof schema.randomnessArtifacts.$inferSelect) {
  return {
    source: artifact.source,
    network: artifact.network,
    chainHash: artifact.chainHash,
    round: artifact.round.toString(),
    notBefore: artifact.notBefore.toISOString(),
    status: artifact.status,
    randomness: artifact.randomness,
    signature: artifact.signature,
    publicKey: artifact.publicKey,
    schemeId: artifact.schemeId,
    artifactHash: artifact.artifactHash,
    verifiedAt: artifact.verifiedAt?.toISOString() ?? null
  };
}

function publicGraphArtifact(snapshot: typeof schema.graphSnapshots.$inferSelect) {
  const artifact = isRecord(snapshot.artifact) ? snapshot.artifact : {};
  const signals = Array.isArray(artifact.signals) ? artifact.signals : [];
  const signalCounts = signals.reduce<Record<string, number>>((counts, signal) => {
    if (!isRecord(signal) || typeof signal.signalType !== "string" || typeof signal.status !== "string") {
      return counts;
    }
    const key = `${signal.signalType}:${signal.status}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  return {
    id: snapshot.id,
    algorithmVersion: snapshot.algorithmVersion,
    edgeCutoffBlock: snapshot.edgeCutoffBlock.toString(),
    edgeCutoffBlockHash: snapshot.edgeCutoffBlockHash,
    inputHash: snapshot.inputHash,
    signalCounts
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
