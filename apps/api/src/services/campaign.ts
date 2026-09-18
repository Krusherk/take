import { and, count, countDistinct, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { buildActivateCampaignCall, buildCloseCampaignCall, buildCreateCampaignCall } from "@take/chain";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import { CampaignStatus, hashJson } from "@take/shared";
import type { z } from "zod";
import { createCampaignSchema } from "@take/shared";
import type { Address, Hex } from "viem";
import { assertOrganizationRole } from "./authorization.js";
import { ServiceError } from "./errors.js";

type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export class CampaignService {
  constructor(private readonly db: Database) {}

  async listCampaigns(viewerIdentityId?: string, includeFixtureCampaigns = true) {
    const records = await this.db.select().from(schema.campaigns);
    const fixtureCreators = includeFixtureCampaigns ? [] : await this.fixtureCreatorIds();
    const fixtureCreatorSet = new Set(fixtureCreators);
    const memberships = viewerIdentityId
      ? await this.db.select({ organizationId: schema.organizationMembers.organizationId })
          .from(schema.organizationMembers)
          .where(eq(schema.organizationMembers.takeIdentityId, viewerIdentityId))
      : [];
    const managedOrganizations = new Set(memberships.map((item) => item.organizationId));
    const visible = records.filter((campaign) =>
      !fixtureCreatorSet.has(campaign.createdByIdentityId)
      && (
        campaign.status !== "DRAFT"
        || Boolean(viewerIdentityId && (campaign.createdByIdentityId === viewerIdentityId || managedOrganizations.has(campaign.organizationId)))
      )
    );
    return Promise.all(visible.map((campaign) => this.toView(campaign, viewerIdentityId)));
  }

  async getCampaign(id: string) {
    const [campaign] = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .limit(1);
    return campaign;
  }

  async getCampaignView(id: string, viewerIdentityId?: string, includeFixtureCampaigns = true) {
    const campaign = await this.getCampaign(id);
    if (campaign && !includeFixtureCampaigns && (await this.fixtureCreatorIds()).includes(campaign.createdByIdentityId)) return undefined;
    return campaign ? this.toView(campaign, viewerIdentityId) : undefined;
  }

  async canManageCampaign(campaignId: string, identityId: string) {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) return false;
    if (campaign.createdByIdentityId === identityId) return true;
    const [membership] = await this.db
      .select({ id: schema.organizationMembers.id })
      .from(schema.organizationMembers)
      .where(and(
        eq(schema.organizationMembers.organizationId, campaign.organizationId),
        eq(schema.organizationMembers.takeIdentityId, identityId),
        inArray(schema.organizationMembers.role, ["OWNER", "ADMIN"])
      ))
      .limit(1);
    return Boolean(membership);
  }

  private async fixtureCreatorIds() {
    return this.db.select({ id: schema.takeIdentities.id })
      .from(schema.takeIdentities)
      .innerJoin(schema.users, eq(schema.users.id, schema.takeIdentities.userId))
      .where(or(
        ilike(schema.users.privyUserId, "take-dev-eligibility-%"),
        ilike(schema.users.privyUserId, "did:privy:seed-%"),
        ilike(schema.users.privyUserId, "did:privy:mechanism-%"),
        ilike(schema.users.privyUserId, "did:privy:v0-%"),
        ilike(schema.users.privyUserId, "did:privy:test-%")
      )).then((rows) => rows.map((row) => row.id));
  }

  async createDraft(input: CreateCampaignInput, creatorIdentityId: string) {
    await this.assertCanManageOrganization(input.organizationId, creatorIdentityId);

    return this.db.transaction(async (tx) => {
      const [campaign] = await tx
        .insert(schema.campaigns)
        .values({
          organizationId: input.organizationId,
          createdByIdentityId: creatorIdentityId,
          status: CampaignStatus.DRAFT,
          title: input.title,
          description: input.description,
          startTime: input.startTime,
          endTime: input.endTime,
          nominationLimit: input.nominationLimit,
          nominatorEligibilityMode: input.nominatorEligibilityMode,
          recipientEligibilityMode: input.recipientEligibilityMode,
          nominationVisibilityMode: input.nominationVisibilityMode
        })
        .returning();

      if (!campaign) {
        throw new Error("Failed to create campaign");
      }

      await tx.insert(schema.campaignResources).values({
        campaignId: campaign.id,
        type: input.resource.type,
        name: input.resource.name,
        description: input.resource.description,
        quantity: input.resource.quantity,
        unitValue: input.resource.unitValue,
        chain: input.resource.chain,
        contractAddress: input.resource.contractAddress,
        tokenId: input.resource.tokenId,
        claimInstructions: input.resource.claimInstructions
      });

      await tx.insert(schema.auditLogs).values({
        actorIdentityId: creatorIdentityId,
        organizationId: input.organizationId,
        campaignId: campaign.id,
        action: "CAMPAIGN_DRAFT_CREATED",
        metadata: { title: input.title }
      });

      return campaign;
    });
  }

  async preparePublish(campaignId: string, actorIdentityId: string, contractAddress: string, chainId: number, operatorManaged = false) {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) {
      throw new Error("Campaign not found");
    }
    if (!operatorManaged) await this.assertCanManageOrganization(campaign.organizationId, actorIdentityId);
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new Error("Only draft campaigns can be published");
    }

    const managerAddress = campaign.managerContractAddress ?? contractAddress;
    const targetChainId = campaign.chainId ?? chainId;
    let rulesHash = campaign.rulesHash;
    if (campaign.mechanismConfigId) {
      const [mechanism] = await this.db
        .select()
        .from(schema.campaignMechanismConfigs)
        .where(
          and(
            eq(schema.campaignMechanismConfigs.id, campaign.mechanismConfigId),
            eq(schema.campaignMechanismConfigs.status, "LOCKED")
          )
        )
        .limit(1);
      if (!mechanism || !rulesHash) {
        throw new ServiceError(
          "MECHANISM_NOT_LOCKED",
          "Campaign mechanism and eligibility must be locked before publication",
          409
        );
      }
    }
    if (campaign.experimentId) {
      const [experiment] = await this.db
        .select({ status: schema.campaignExperiments.status })
        .from(schema.campaignExperiments)
        .where(eq(schema.campaignExperiments.id, campaign.experimentId))
        .limit(1);
      if (experiment?.status !== "LOCKED") {
        throw new ServiceError(
          "EXPERIMENT_NOT_LOCKED",
          "The V0 experiment protocol must be locked before publication",
          409
        );
      }
    }
    if (campaign.managerVersion === "LEGACY_V1" && campaign.nominationVisibilityMode === "SEALED") {
      throw new ServiceError(
        "SEALED_MODE_UNSUPPORTED",
        "The immutable legacy manager does not support sealed nominations",
        409
      );
    }
    const metadataHash = hashJson({
      title: campaign.title,
      description: campaign.description,
      metadataUri: campaign.metadataUri
    });
    rulesHash ??= hashJson({
        campaignId: campaign.id,
        organizationId: campaign.organizationId,
        startTime: campaign.startTime.toISOString(),
        endTime: campaign.endTime.toISOString(),
        nominationLimit: campaign.nominationLimit,
        nominatorEligibilityMode: campaign.nominatorEligibilityMode,
        recipientEligibilityMode: campaign.recipientEligibilityMode,
        nominationVisibilityMode: campaign.nominationVisibilityMode,
        nominatorEligibilityRoot: campaign.nominatorEligibilityRoot,
        recipientEligibilityRoot: campaign.recipientEligibilityRoot,
        managerAddress,
        managerVersion: campaign.managerVersion
      });

    const [updated] = await this.db
      .update(schema.campaigns)
      .set({
        metadataHash,
        rulesHash,
        chainId: targetChainId,
        managerContractAddress: managerAddress.toLowerCase(),
        updatedAt: new Date()
      })
      .where(eq(schema.campaigns.id, campaign.id))
      .returning();

    if (!updated) {
      throw new Error("Failed to prepare campaign publish");
    }

    return {
      campaign: updated,
      transaction: buildCreateCampaignCall({
        contractAddress: managerAddress as Address,
        chainId: targetChainId,
        metadataHash,
        startTime: BigInt(Math.floor(campaign.startTime.getTime() / 1000)),
        endTime: BigInt(Math.floor(campaign.endTime.getTime() / 1000)),
        nominationLimit: campaign.nominationLimit,
        nominatorEligibilityMode: eligibilityModeToContract(campaign.nominatorEligibilityMode),
        recipientEligibilityMode: eligibilityModeToContract(campaign.recipientEligibilityMode),
        nominationVisibilityMode: campaign.nominationVisibilityMode === "PUBLIC" ? 0 : 1,
        nominatorEligibilityRoot: campaign.nominatorEligibilityRoot as Hex | undefined,
        recipientEligibilityRoot: campaign.recipientEligibilityRoot as Hex | undefined,
        rulesHash: rulesHash as Hex
      })
    };
  }

  async prepareClose(campaignId: string, actorIdentityId: string, contractAddress: string, chainId: number, operatorManaged = false) {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) {
      throw new Error("Campaign not found");
    }
    if (!operatorManaged) await this.assertCanManageOrganization(campaign.organizationId, actorIdentityId);
    if (!campaign.onchainCampaignId) {
      throw new Error("Campaign is not published onchain");
    }
    const managerAddress = campaign.managerContractAddress ?? contractAddress;
    const targetChainId = campaign.chainId ?? chainId;

    return {
      campaign,
      transaction: buildCloseCampaignCall({
        contractAddress: managerAddress as Address,
        chainId: targetChainId,
        campaignId: campaign.onchainCampaignId
      })
    };
  }

  async prepareActivate(campaignId: string, actorIdentityId: string, contractAddress: string, chainId: number, operatorManaged = false) {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) throw new Error("Campaign not found");
    if (!operatorManaged) await this.assertCanManageOrganization(campaign.organizationId, actorIdentityId);
    if (campaign.status !== CampaignStatus.CREATED || !campaign.onchainCampaignId) {
      throw new ServiceError("CAMPAIGN_NOT_CREATED", "Wait for the published campaign to be indexed before activation", 409);
    }
    return {
      campaign,
      transaction: buildActivateCampaignCall({
        contractAddress: (campaign.managerContractAddress ?? contractAddress) as Address,
        chainId: campaign.chainId ?? chainId,
        campaignId: campaign.onchainCampaignId
      })
    };
  }

  private async assertCanManageOrganization(organizationId: string, takeIdentityId: string) {
    await assertOrganizationRole(this.db, organizationId, takeIdentityId, ["OWNER", "ADMIN"]);
  }

  private async toView(
    campaign: typeof schema.campaigns.$inferSelect,
    viewerIdentityId?: string
  ) {
    const [[organization], [resource], [participantAggregate], [nominationAggregate], eligibility, [experiment], lifecycle] = await Promise.all([
      this.db
        .select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, campaign.organizationId))
        .limit(1),
      this.db
        .select()
        .from(schema.campaignResources)
        .where(eq(schema.campaignResources.campaignId, campaign.id))
        .limit(1),
      this.db
        .select({ value: countDistinct(schema.nominationEdges.canonicalGiverKey) })
        .from(schema.nominationEdges)
        .where(
          and(
            eq(schema.nominationEdges.campaignId, campaign.id),
            eq(schema.nominationEdges.validity, "VALID"),
            eq(schema.nominationEdges.finalityStatus, "FINALIZED")
          )
        ),
      viewerIdentityId
        ? this.db
            .select({ value: count(schema.nominations.id) })
            .from(schema.nominations)
            .where(
              and(
                eq(schema.nominations.campaignId, campaign.id),
                eq(schema.nominations.giverIdentityId, viewerIdentityId),
                inArray(schema.nominations.status, [
                  "SUBMITTED",
                  "CHAIN_CONFIRMED",
                  "INDEXING_DELAYED",
                  "CONFIRMED"
                ])
              )
            )
        : Promise.resolve([{ value: 0 }]),
      viewerIdentityId
        ? this.viewerEligibility(campaign, viewerIdentityId)
        : Promise.resolve(null),
      campaign.experimentId
        ? this.db.select({
            id: schema.campaignExperiments.id,
            version: schema.campaignExperiments.experimentVersion,
            variant: schema.campaignExperiments.variant,
            status: schema.campaignExperiments.status
          }).from(schema.campaignExperiments)
            .where(eq(schema.campaignExperiments.id, campaign.experimentId)).limit(1)
        : Promise.resolve([]),
      this.db.select({
        action: schema.campaignLifecycleIntents.action,
        status: schema.campaignLifecycleIntents.status,
        transactionHash: schema.campaignLifecycleIntents.transactionHash
      }).from(schema.campaignLifecycleIntents)
        .where(eq(schema.campaignLifecycleIntents.campaignId, campaign.id))
    ]);

    const usedTakes = Number(nominationAggregate?.value ?? 0);
    const eligibleToParticipate = eligibility?.status === "ELIGIBLE"
      || eligibility?.status === "LEGACY_UNCHECKED";
    const canParticipate =
      Boolean(viewerIdentityId) &&
      campaign.status === CampaignStatus.ACTIVE &&
      new Date() >= campaign.startTime &&
      new Date() < campaign.endTime &&
      eligibleToParticipate &&
      usedTakes < campaign.nominationLimit;

    return {
      id: campaign.id,
      organization: organization ?? null,
      onchainCampaignId: campaign.onchainCampaignId?.toString() ?? null,
      chainId: campaign.chainId,
      status: campaign.status,
      title: campaign.title,
      description: campaign.description,
      metadataUri: campaign.metadataUri,
      metadataHash: campaign.metadataHash,
      rulesHash: campaign.rulesHash,
      finalResultHash: campaign.finalResultHash,
      eligibilityDescription: campaign.eligibilityDescription,
      startTime: campaign.startTime.toISOString(),
      endTime: campaign.endTime.toISOString(),
      nominationLimit: campaign.nominationLimit,
      nominationVisibilityMode: campaign.nominationVisibilityMode,
      nominatorEligibilityMode: campaign.nominatorEligibilityMode,
      recipientEligibilityMode: campaign.recipientEligibilityMode,
      resource: resource
        ? {
            id: resource.id,
            type: resource.type,
            name: resource.name,
            description: resource.description,
            quantity: resource.quantity,
            unitValue: resource.unitValue,
            chain: resource.chain,
            escrowStatus: resource.escrowStatus
          }
        : null,
      participantCount: experiment && !["CLOSED", "ALLOCATING", "FINALIZED"].includes(campaign.status)
        ? null
        : Number(participantAggregate?.value ?? 0),
      experiment: experiment ? {
        id: experiment.id,
        version: experiment.version,
        variant: experiment.variant,
        status: experiment.status,
        activeNominationDataHidden: !["CLOSED", "ALLOCATING", "FINALIZED"].includes(campaign.status)
      } : null,
      onchain: {
        published: Boolean(campaign.onchainCampaignId),
        network: campaign.chainId === 143 ? "Monad Mainnet" : "Monad Testnet",
        chainId: campaign.chainId,
        managerContractAddress: campaign.managerContractAddress,
        campaignId: campaign.onchainCampaignId?.toString() ?? null,
        authorityWalletAddress: campaign.onchainOperatorWalletAddress,
        organizerAddress: campaign.onchainOrganizerAddress,
        lifecycle: Object.fromEntries(lifecycle.map((item) => [item.action.toLowerCase(), {
          status: item.status,
          transactionHash: item.transactionHash
        }]))
      },
      launchApproved: Boolean(campaign.launchApprovedAt),
      viewer: viewerIdentityId
        ? {
            usedTakes,
            availableTakes: Math.max(0, campaign.nominationLimit - usedTakes),
            canParticipate,
            eligibility
          }
        : null,
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString()
    };
  }

  private async viewerEligibility(
    campaign: typeof schema.campaigns.$inferSelect,
    viewerIdentityId: string
  ) {
    if (!campaign.mechanismConfigId) {
      return {
        status: "LEGACY_UNCHECKED" as const,
        locked: false,
        reasons: [{
          reasonCode: "LEGACY_CAMPAIGN",
          explanation: "This campaign uses an earlier eligibility setup."
        }]
      };
    }

    const [snapshot] = await this.db
      .select()
      .from(schema.eligibilitySnapshots)
      .where(
        and(
          eq(schema.eligibilitySnapshots.mechanismConfigId, campaign.mechanismConfigId),
          eq(schema.eligibilitySnapshots.subject, "NOMINATOR")
        )
      )
      .orderBy(desc(schema.eligibilitySnapshots.createdAt))
      .limit(1);

    if (!snapshot || snapshot.status === "EVALUATING") {
      return { status: "CHECKING_ELIGIBILITY" as const, locked: false, reasons: [] };
    }
    if (snapshot.status === "FAILED") {
      return {
        status: "EVIDENCE_UNAVAILABLE" as const,
        locked: false,
        reasons: [{
          reasonCode: "EVIDENCE_UNAVAILABLE",
          explanation: "Required eligibility evidence could not be verified. Try again after the organizer refreshes it."
        }]
      };
    }
    if (snapshot.mode === "EXTERNAL_ALLOWED") {
      return snapshot.status === "LOCKED"
        ? { status: "ELIGIBLE" as const, locked: true, reasons: [] }
        : { status: "CHECKING_ELIGIBILITY" as const, locked: false, reasons: [] };
    }

    const [member] = await this.db
      .select()
      .from(schema.eligibilitySnapshotMembers)
      .where(
        and(
          eq(schema.eligibilitySnapshotMembers.snapshotId, snapshot.id),
          eq(schema.eligibilitySnapshotMembers.takeIdentityId, viewerIdentityId)
        )
      )
      .limit(1);
    if (!member) {
      return {
        status: "NOT_ELIGIBLE" as const,
        locked: snapshot.status === "LOCKED",
        reasons: [{
          reasonCode: "NOT_IN_CANDIDATE_POPULATION",
          explanation: "Your identity was not in this campaign's candidate population at the cutoff."
        }]
      };
    }

    const evaluations = await this.db
      .select({
        decision: schema.eligibilityEvaluations.decision,
        reasonCode: schema.eligibilityEvaluations.reasonCode,
        explanation: schema.eligibilityEvaluations.publicExplanation
      })
      .from(schema.eligibilityEvaluations)
      .where(eq(schema.eligibilityEvaluations.memberId, member.id));
    const reasons = evaluations
      .filter((evaluation) => evaluation.decision !== "PASS")
      .map((evaluation) => ({
        reasonCode: evaluation.reasonCode,
        explanation: evaluation.explanation
      }));

    if (member.decision === "UNKNOWN") {
      return { status: "EVIDENCE_UNAVAILABLE" as const, locked: false, reasons };
    }
    if (member.decision !== "PASS") {
      return { status: "NOT_ELIGIBLE" as const, locked: snapshot.status === "LOCKED", reasons };
    }
    return snapshot.status === "LOCKED"
      ? { status: "ELIGIBLE" as const, locked: true, reasons: [] }
      : { status: "CHECKING_ELIGIBILITY" as const, locked: false, reasons: [] };
  }
}

function eligibilityModeToContract(mode: string): number {
  switch (mode) {
    case "OPEN_REGISTERED":
      return 0;
    case "MERKLE_ALLOWLIST":
      return 1;
    case "ORGANIZER_APPROVED":
      return 2;
    case "EXTERNAL_ALLOWED":
      return 3;
    default:
      throw new Error(`Unsupported eligibility mode: ${mode}`);
  }
}
