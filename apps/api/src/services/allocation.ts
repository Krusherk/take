import { and, asc, desc, eq, or } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { buildFinalizeAllocationCall } from "@take/chain";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import {
  allocate,
  allocateRawUniqueSupportV0,
  allocationInputHashV0,
  allocationInputSnapshotHash,
  buildAllocationInputsV0,
  campaignMechanismConfigV1Schema,
  deriveAllocationSeed,
  domainHash,
  type AllocationStrategyConfig,
  type CampaignMechanismConfigV1,
  type NominationEdgeV1
} from "@take/mechanism";
import type { ApiEnv } from "../config/env.js";
import { assertOrganizationRole } from "./authorization.js";
import { notFound, ServiceError } from "./errors.js";
import { GraphService } from "./graph.js";
import { RandomnessService } from "./randomness.js";

const LEGACY_STRATEGY: AllocationStrategyConfig = {
  strategyId: "RAW_UNIQUE_SUPPORT",
  strategyVersion: "2"
};

type DbReader = Pick<Database, "select">;

export class AllocationService {
  private readonly graph: GraphService;
  private readonly randomness: RandomnessService;

  constructor(
    private readonly db: Database,
    env: ApiEnv
  ) {
    this.graph = new GraphService(db);
    this.randomness = new RandomnessService(db, env);
  }

  async run(campaignId: string, actorIdentityId: string) {
    const [campaign] = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) notFound("Campaign not found");
    await assertOrganizationRole(this.db, campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    if (campaign.status !== "CLOSED") {
      throw new ServiceError("CAMPAIGN_NOT_CLOSED", "Allocation requires a closed campaign", 409);
    }
    if (!campaign.chainId || !campaign.managerContractAddress || !campaign.onchainCampaignId) {
      throw new ServiceError("CAMPAIGN_CHAIN_STATE_MISSING", "Campaign chain deployment is incomplete", 409);
    }
    const [resource] = await this.db
      .select()
      .from(schema.campaignResources)
      .where(eq(schema.campaignResources.campaignId, campaignId))
      .limit(1);
    if (!resource) notFound("Campaign resource not found");

    const configRecord = campaign.mechanismConfigId
      ? (await this.db
          .select()
          .from(schema.campaignMechanismConfigs)
          .where(
            and(
              eq(schema.campaignMechanismConfigs.id, campaign.mechanismConfigId),
              eq(schema.campaignMechanismConfigs.status, "LOCKED")
            )
          )
          .limit(1))[0]
      : undefined;
    const config = configRecord
      ? campaignMechanismConfigV1Schema.parse(configRecord.canonicalConfig)
      : null;
    const experiment = campaign.experimentId
      ? (await this.db.select().from(schema.campaignExperiments).where(and(
          eq(schema.campaignExperiments.id, campaign.experimentId),
          eq(schema.campaignExperiments.status, "LOCKED")
        )).limit(1))[0]
      : undefined;
    if (campaign.experimentId && !experiment) {
      throw new ServiceError("EXPERIMENT_NOT_LOCKED", "V0 allocation requires a locked experiment protocol", 409);
    }
    if (config && resource.quantity !== config.resourceQuantity) {
      throw new ServiceError(
        "LOCKED_RESOURCE_QUANTITY_MISMATCH",
        "Campaign resource quantity no longer matches the locked mechanism",
        409
      );
    }

    if (config?.recipientPolicy.population.type === "OPEN_EXTERNAL") {
      await this.validateOpenExternalRecipients(campaignId, config);
    }
    const graphSnapshot = await this.graph.analyzeCampaign(campaignId);
    const rows = await this.db
      .select()
      .from(schema.nominationEdges)
      .where(
        and(
          eq(schema.nominationEdges.campaignId, campaignId),
          eq(schema.nominationEdges.finalityStatus, "FINALIZED")
        )
      )
      .orderBy(
        asc(schema.nominationEdges.blockNumber),
        asc(schema.nominationEdges.transactionIndex),
        asc(schema.nominationEdges.logIndex)
      );
    if (rows.length === 0) {
      throw new ServiceError("NO_FINALIZED_NOMINATIONS", "No finalized nomination edges are available", 409);
    }
    const edges = rows.map(toMechanismEdge);
    const strategy = config?.allocation ?? LEGACY_STRATEGY;
    const resourceQuantity = config?.resourceQuantity ?? resource.quantity;
    if (experiment && (strategy.strategyId !== "RAW_UNIQUE_SUPPORT" || strategy.strategyVersion !== "2")) {
      throw new ServiceError("V0_ALLOCATION_STRATEGY_INVALID", "V0 production allocation is fixed to RAW_UNIQUE_SUPPORT@2", 409);
    }
    const v0Input = experiment ? buildAllocationInputsV0(edges) : null;
    const preliminaryInputHash = v0Input
      ? allocationInputHashV0({ campaignId, seatCount: resourceQuantity, inputs: v0Input.inputs })
      : allocationInputSnapshotHash({ campaignId, strategy, resourceQuantity, edges });
    const randomness = await this.resolveRandomness({
      campaign,
      config,
      inputSnapshotHash: preliminaryInputHash
    });
    const artifact = v0Input
      ? allocateRawUniqueSupportV0({
          campaignId,
          resourceQuantity,
          inputs: v0Input.inputs,
          excludedEdges: v0Input.excluded,
          randomnessSeed: randomness.seed
        })
      : allocate({ campaignId, strategy, resourceQuantity, edges, randomnessSeed: randomness.seed });
    if (artifact.inputSnapshotHash !== preliminaryInputHash) {
      throw new Error("Allocation input hash changed while deriving randomness");
    }
    const [existing] = await this.db
      .select()
      .from(schema.allocationRuns)
      .where(
        and(
          eq(schema.allocationRuns.campaignId, campaignId),
          eq(schema.allocationRuns.inputSnapshotHash, artifact.inputSnapshotHash),
          eq(schema.allocationRuns.resultHash, artifact.resultHash),
          eq(schema.allocationRuns.status, "COMPLETED")
        )
      )
      .limit(1);
    if (existing) return this.getRun(existing.id);

    const snapshots = configRecord
      ? await this.db
          .select()
          .from(schema.eligibilitySnapshots)
          .where(
            and(
              eq(schema.eligibilitySnapshots.mechanismConfigId, configRecord.id),
              eq(schema.eligibilitySnapshots.status, "LOCKED")
            )
          )
      : [];
    const nominatorSnapshotId = experiment?.giverSnapshotId
      ?? snapshots.find((snapshot) => snapshot.subject === "NOMINATOR")?.id;
    const recipientSnapshotId = experiment?.recipientSnapshotId
      ?? snapshots.find((snapshot) => snapshot.subject === "RECIPIENT")?.id;

    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .insert(schema.allocationRuns)
        .values({
          campaignId,
          mechanismConfigId: configRecord?.id,
          nominatorSnapshotId,
          recipientSnapshotId,
          graphSnapshotId: graphSnapshot.id,
          randomnessArtifactId: randomness.artifactId,
          strategyId: strategy.strategyId,
          strategyVersion: strategy.strategyVersion,
          configuration: {
            ...strategy,
            resourceQuantity,
            randomnessSource: randomness.source,
            graphSignalsAffectAllocation: false,
            researchVariablesAffectAllocation: false,
            experimentVersion: experiment?.experimentVersion ?? null
          },
          inputSnapshotHash: artifact.inputSnapshotHash,
          randomnessSeed: randomness.seed,
          artifactVersion: artifact.artifactVersion,
          codeVersion: experiment ? "TAKE_EXPERIMENT_V0" : "TAKE_MECHANISM_V1",
          inputArtifact: {
            campaignId,
            mechanismConfigHash: configRecord?.configHash ?? null,
            experimentId: experiment?.id ?? null,
            experimentProtocolHash: experiment?.protocolHash ?? null,
            graphSnapshotId: graphSnapshot.id,
            graphInputHash: graphSnapshot.inputHash,
            edgeCutoffBlock: graphSnapshot.edgeCutoffBlock,
            edgeCutoffBlockHash: graphSnapshot.edgeCutoffBlockHash,
            ...(v0Input
              ? {
                  allocationInputs: v0Input.inputs,
                  objectiveExclusions: v0Input.excluded,
                  behavioralObservationsExcludedByDesign: true,
                  researchVariablesExcludedByDesign: true
                }
              : { edges }),
            randomness: randomness.publicArtifact
          },
          resultArtifact: artifact,
          status: "COMPLETED",
          resultHash: artifact.resultHash,
          createdByIdentityId: actorIdentityId,
          completedAt: new Date()
        })
        .onConflictDoNothing({
          target: [
            schema.allocationRuns.campaignId,
            schema.allocationRuns.inputSnapshotHash,
            schema.allocationRuns.resultHash
          ]
        })
        .returning();
      if (!run) {
        const [raced] = await tx
          .select({ id: schema.allocationRuns.id })
          .from(schema.allocationRuns)
          .where(
            and(
              eq(schema.allocationRuns.campaignId, campaignId),
              eq(schema.allocationRuns.inputSnapshotHash, artifact.inputSnapshotHash),
              eq(schema.allocationRuns.resultHash, artifact.resultHash)
            )
          )
          .limit(1);
        if (!raced) throw new Error("Failed to create or recover allocation run");
        return this.getRun(raced.id, tx);
      }

      for (const result of artifact.results) {
        const identity = await resolveRecipientIdentity(tx, result.recipientKey);
        await tx.insert(schema.allocationResults).values({
          allocationRunId: run.id,
          recipientTakeIdentityId: identity.takeIdentityId,
          recipientExternalIdentityId: identity.externalIdentityId,
          recipientKey: result.recipientKey,
          score: result.uniqueSupport,
          rank: result.rank,
          selectionOrder: result.selectionOrder,
          tieBreaker: result.tieBreaker,
          selected: result.selected,
          explanation: result.explanation
        });
      }

      await tx
        .update(schema.campaigns)
        .set({ status: "ALLOCATING", updatedAt: new Date() })
        .where(eq(schema.campaigns.id, campaignId));
      await tx.insert(schema.auditLogs).values({
        actorIdentityId,
        organizationId: campaign.organizationId,
        campaignId,
        action: "MECHANISM_ALLOCATION_COMPLETED",
        metadata: {
          allocationRunId: run.id,
          strategyId: strategy.strategyId,
          strategyVersion: strategy.strategyVersion,
          inputSnapshotHash: artifact.inputSnapshotHash,
          resultHash: artifact.resultHash,
          graphSignalsAffectAllocation: false,
          researchVariablesAffectAllocation: false,
          experimentVersion: experiment?.experimentVersion ?? null,
          legacy: !configRecord
        }
      });
      return this.getRun(run.id, tx);
    });
  }

  async getLatestResults(campaignId: string) {
    const [run] = await this.db
      .select()
      .from(schema.allocationRuns)
      .where(eq(schema.allocationRuns.campaignId, campaignId))
      .orderBy(desc(schema.allocationRuns.startedAt))
      .limit(1);
    return run ? this.getRun(run.id) : null;
  }

  async prepareFinalize(campaignId: string, allocationRunId: string, actorIdentityId: string) {
    const [record] = await this.db
      .select({
        campaign: schema.campaigns,
        runId: schema.allocationRuns.id,
        runStatus: schema.allocationRuns.status,
        resultHash: schema.allocationRuns.resultHash
      })
      .from(schema.campaigns)
      .innerJoin(schema.allocationRuns, eq(schema.allocationRuns.campaignId, schema.campaigns.id))
      .where(
        and(
          eq(schema.campaigns.id, campaignId),
          eq(schema.allocationRuns.id, allocationRunId)
        )
      )
      .limit(1);
    if (!record) notFound("Allocation run not found");
    await assertOrganizationRole(this.db, record.campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    if (record.campaign.status !== "ALLOCATING" || record.runStatus !== "COMPLETED" || !record.resultHash) {
      throw new ServiceError("ALLOCATION_NOT_FINALIZABLE", "Allocation is not ready for its immutable result commitment", 409);
    }
    if (!record.campaign.onchainCampaignId || !record.campaign.chainId || !record.campaign.managerContractAddress) {
      throw new ServiceError("CAMPAIGN_CHAIN_STATE_MISSING", "Campaign chain deployment is incomplete", 409);
    }
    return {
      allocationRunId,
      inputSnapshotHash: (await this.getRun(allocationRunId)).run.inputSnapshotHash,
      resultHash: record.resultHash,
      transaction: buildFinalizeAllocationCall({
        contractAddress: record.campaign.managerContractAddress as Address,
        chainId: record.campaign.chainId,
        campaignId: record.campaign.onchainCampaignId,
        resultHash: record.resultHash as Hex
      })
    };
  }

  private async getRun(id: string, executor: DbReader = this.db) {
    const [run] = await executor
      .select()
      .from(schema.allocationRuns)
      .where(eq(schema.allocationRuns.id, id))
      .limit(1);
    if (!run) notFound("Allocation run not found");
    const results = await executor
      .select()
      .from(schema.allocationResults)
      .where(eq(schema.allocationResults.allocationRunId, id))
      .orderBy(asc(schema.allocationResults.rank));
    return {
      run: {
        id: run.id,
        strategyId: run.strategyId,
        strategyVersion: run.strategyVersion,
        status: run.status,
        inputSnapshotHash: run.inputSnapshotHash,
        resultHash: run.resultHash,
        completedAt: run.completedAt?.toISOString() ?? null,
        artifact: run.resultArtifact
      },
      results: await Promise.all(results.map(async (result) => ({
        rank: result.rank,
        score: result.score,
        selected: result.selected,
        selectionOrder: result.selectionOrder,
        recipientKey: result.recipientKey,
        explanation: result.explanation,
        person: result.recipientTakeIdentityId
          ? await this.getTakePerson(result.recipientTakeIdentityId, executor)
          : result.recipientExternalIdentityId
            ? await this.getExternalPerson(result.recipientExternalIdentityId, executor)
            : null
      })))
    };
  }

  private async resolveRandomness(input: {
    campaign: typeof schema.campaigns.$inferSelect;
    config: CampaignMechanismConfigV1 | null;
    inputSnapshotHash: Hex;
  }) {
    const { campaign, config, inputSnapshotHash } = input;
    if (config?.randomness.source === "DRAND") {
      const artifact = await this.randomness.retrieveForCampaign(campaign.id);
      if (!artifact.randomness || artifact.status !== "VERIFIED") {
        throw new ServiceError("DRAND_NOT_VERIFIED", "The committed drand artifact is not verified", 409);
      }
      const seed = deriveAllocationSeed({
        chainId: campaign.chainId!,
        managerAddress: campaign.managerContractAddress!,
        onchainCampaignId: campaign.onchainCampaignId!.toString(),
        rulesHash: campaign.rulesHash!,
        inputSnapshotHash,
        drandChainHash: artifact.chainHash,
        drandRound: Number(artifact.round),
        randomness: artifact.randomness
      });
      return {
        source: "DRAND" as const,
        seed,
        artifactId: artifact.id,
        publicArtifact: artifact
      };
    }
    const seed = domainHash("TAKE_LOW_ASSURANCE_DETERMINISTIC_SEED_V1", {
      campaignId: campaign.id,
      managerAddress: campaign.managerContractAddress,
      onchainCampaignId: campaign.onchainCampaignId?.toString(),
      rulesHash: campaign.rulesHash,
      inputSnapshotHash
    });
    return {
      source: "LEGACY_DETERMINISTIC" as const,
      seed,
      artifactId: undefined,
      publicArtifact: {
        source: "LEGACY_DETERMINISTIC",
        warning: "This low-assurance legacy campaign did not commit to external randomness."
      }
    };
  }

  private async validateOpenExternalRecipients(
    campaignId: string,
    config: CampaignMechanismConfigV1
  ) {
    if (config.recipientPolicy.population.type !== "OPEN_EXTERNAL") return;
    const providers = config.recipientPolicy.population.providers;
    const edges = await this.db
      .select()
      .from(schema.nominationEdges)
      .where(
        and(
          eq(schema.nominationEdges.campaignId, campaignId),
          eq(schema.nominationEdges.finalityStatus, "FINALIZED"),
          eq(schema.nominationEdges.validity, "VALID")
        )
      );
    for (const edge of edges) {
      const [[member], [external]] = await Promise.all([
        this.db.select({ id: schema.takeIdentities.id })
          .from(schema.takeIdentities)
          .where(eq(schema.takeIdentities.protocolIdentityKey, edge.canonicalRecipientKey))
          .limit(1),
        this.db.select({ id: schema.externalIdentities.id, provider: schema.externalIdentities.provider })
          .from(schema.externalIdentities)
          .where(
            or(
              eq(schema.externalIdentities.externalIdentityKey, edge.recipientIdentityKey),
              eq(schema.externalIdentities.externalIdentityKey, edge.canonicalRecipientKey)
            )
          )
          .limit(1)
      ]);
      if (member || (external && providers.includes(external.provider as typeof providers[number]))) continue;
      await this.db
        .update(schema.nominationEdges)
        .set({ validity: "INVALID", invalidReason: "OPEN_EXTERNAL_IDENTITY_UNKNOWN" })
        .where(eq(schema.nominationEdges.id, edge.id));
    }
  }

  private async getTakePerson(identityId: string, executor: DbReader) {
    const [person] = await executor
      .select({
        displayName: schema.users.displayName,
        username: schema.socialAccounts.username,
        avatarUrl: schema.users.avatarUrl
      })
      .from(schema.takeIdentities)
      .innerJoin(schema.users, eq(schema.users.id, schema.takeIdentities.userId))
      .leftJoin(
        schema.socialAccounts,
        and(
          eq(schema.socialAccounts.takeIdentityId, identityId),
          eq(schema.socialAccounts.isActive, true)
        )
      )
      .where(eq(schema.takeIdentities.id, identityId))
      .limit(1);
    return person ? {
      displayName: person.displayName ?? person.username ?? "TAKE member",
      username: person.username,
      avatarUrl: person.avatarUrl
    } : null;
  }

  private async getExternalPerson(identityId: string, executor: DbReader) {
    const [person] = await executor
      .select({
        displayName: schema.externalIdentities.displayName,
        username: schema.externalIdentities.currentUsername,
        avatarUrl: schema.externalIdentities.avatarUrl
      })
      .from(schema.externalIdentities)
      .where(eq(schema.externalIdentities.id, identityId))
      .limit(1);
    return person ? {
      displayName: person.displayName ?? person.username ?? "TAKE recipient",
      username: person.username,
      avatarUrl: person.avatarUrl
    } : null;
  }
}

function toMechanismEdge(row: typeof schema.nominationEdges.$inferSelect): NominationEdgeV1 {
  return {
    id: row.id,
    campaignId: row.campaignId,
    chainId: row.chainId,
    contractAddress: row.contractAddress as `0x${string}`,
    transactionHash: row.transactionHash as `0x${string}`,
    blockNumber: row.blockNumber.toString(),
    transactionIndex: row.transactionIndex,
    logIndex: row.logIndex,
    blockTimestamp: row.blockTimestamp.toISOString(),
    giverIdentityKey: row.giverIdentityKey as `0x${string}`,
    recipientIdentityKey: row.recipientIdentityKey as `0x${string}`,
    canonicalGiverKey: row.canonicalGiverKey as `0x${string}`,
    canonicalRecipientKey: row.canonicalRecipientKey as `0x${string}`,
    validity: row.validity as "VALID" | "INVALID",
    invalidReason: row.invalidReason ?? undefined
  };
}

async function resolveRecipientIdentity(executor: DbReader, recipientKey: string) {
  const [takeIdentity] = await executor
    .select({ id: schema.takeIdentities.id })
    .from(schema.takeIdentities)
    .where(eq(schema.takeIdentities.protocolIdentityKey, recipientKey))
    .limit(1);
  if (takeIdentity) return { takeIdentityId: takeIdentity.id, externalIdentityId: null };
  const [external] = await executor
    .select({ id: schema.externalIdentities.id })
    .from(schema.externalIdentities)
    .where(eq(schema.externalIdentities.externalIdentityKey, recipientKey))
    .limit(1);
  return { takeIdentityId: null, externalIdentityId: external?.id ?? null };
}
