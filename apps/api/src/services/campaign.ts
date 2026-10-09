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
    // Independent lookups run together; each sequential query costs a full database round trip.
    const [records, fixtureCreators, memberships] = await Promise.all([
      this.db.select().from(schema.campaigns).orderBy(desc(schema.campaigns.createdAt)),
      includeFixtureCampaigns ? Promise.resolve([] as string[]) : this.fixtureCreatorIds(),
      viewerIdentityId
        ? this.db.select({ organizationId: schema.organizationMembers.organizationId })
            .from(schema.organizationMembers)
            .where(eq(schema.organizationMembers.takeIdentityId, viewerIdentityId))
        : Promise.resolve([] as Array<{ organizationId: string }>)
    ]);
    const fixtureCreatorSet = new Set(fixtureCreators);
    const managedOrganizations = new Set(memberships.map((item) => item.organizationId));
    const joinedDrafts = viewerIdentityId
      ? new Set((await whenSignupsTableMissing(this.signupMemberships(viewerIdentityId), new Map())).keys())
      : new Set<string>();
    const visible = records.filter((campaign) =>
      !fixtureCreatorSet.has(campaign.createdByIdentityId)
      && (
        campaign.status !== "DRAFT"
        || Boolean(viewerIdentityId && (campaign.createdByIdentityId === viewerIdentityId || managedOrganizations.has(campaign.organizationId)))
        || joinedDrafts.has(campaign.id)
      )
    );
    return this.toViews(visible, viewerIdentityId);
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
    const [campaign, fixtureCreators] = await Promise.all([
      this.getCampaign(id),
      includeFixtureCampaigns ? Promise.resolve([] as string[]) : this.fixtureCreatorIds()
    ]);
    if (campaign && fixtureCreators.includes(campaign.createdByIdentityId)) return undefined;
    return campaign ? (await this.toViews([campaign], viewerIdentityId))[0] : undefined;
  }

  /** Campaigns whose sign-up lists include this person (they can see the draft they joined). */
  async signupMemberships(identityId: string, campaignIds?: string[]) {
    const rows = await this.db.select({
      campaignId: schema.campaignSignups.campaignId,
      allowlistId: schema.identityAllowlistMembers.allowlistId,
      giverAllowlistId: schema.campaignSignups.giverAllowlistId
    }).from(schema.identityAllowlistMembers)
      .innerJoin(schema.campaignSignups, or(
        eq(schema.campaignSignups.giverAllowlistId, schema.identityAllowlistMembers.allowlistId),
        eq(schema.campaignSignups.recipientAllowlistId, schema.identityAllowlistMembers.allowlistId)
      ))
      .where(and(
        eq(schema.identityAllowlistMembers.takeIdentityId, identityId),
        campaignIds ? inArray(schema.campaignSignups.campaignId, campaignIds) : undefined
      ));
    return new Map(rows.map((row) => [row.campaignId, row.allowlistId === row.giverAllowlistId ? "GIVER" as const : "RECIPIENT" as const]));
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
    if (campaign.endTime.getTime() <= Date.now()) {
      throw new ServiceError(
        "INVALID_CAMPAIGN_TIME",
        "This campaign window has already ended, so Monad would reject publication. Create a campaign whose end time is still in the future.",
        409
      );
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
    const now = new Date();
    if (now < campaign.startTime) {
      throw new ServiceError(
        "INVALID_CAMPAIGN_TIME",
        "Nominations cannot be activated before the campaign start time.",
        409
      );
    }
    if (now >= campaign.endTime) {
      throw new ServiceError(
        "INVALID_CAMPAIGN_TIME",
        "This campaign window has ended, so Monad would reject activation. Publish a new campaign with a current window.",
        409
      );
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

  /**
   * Builds campaign views with one query per related table for the whole list
   * (not one set per campaign), so the list costs the same few round trips
   * whether it holds two campaigns or fifty.
   */
  private async toViews(
    campaigns: Array<typeof schema.campaigns.$inferSelect>,
    viewerIdentityId?: string
  ) {
    if (!campaigns.length) return [];
    const campaignIds = campaigns.map((campaign) => campaign.id);
    const organizationIds = [...new Set(campaigns.map((campaign) => campaign.organizationId))];
    const experimentIds = [...new Set(campaigns.flatMap((campaign) => campaign.experimentId ? [campaign.experimentId] : []))];
    const [signupRows, joined] = await Promise.all([
      this.db.select({
        campaignId: schema.campaignSignups.campaignId,
        joinCode: schema.campaignSignups.joinCode,
        joinEnabled: schema.campaignSignups.joinEnabled,
        status: schema.campaignSignups.status,
        signupDeadline: schema.campaignSignups.signupDeadline
      }).from(schema.campaignSignups).where(inArray(schema.campaignSignups.campaignId, campaignIds)).then((rows) => rows, (error: unknown) => {
        if (isMissingTable(error)) return [];
        throw error;
      }),
      viewerIdentityId
        ? whenSignupsTableMissing(this.signupMemberships(viewerIdentityId, campaignIds), new Map<string, "GIVER" | "RECIPIENT">())
        : Promise.resolve(new Map<string, "GIVER" | "RECIPIENT">())
    ]);
    const signupsByCampaign = new Map(signupRows.map((row) => [row.campaignId, row]));
    const [organizations, resources, participantRows, nominationRows, experiments, lifecycleRows, eligibilities] = await Promise.all([
      this.db
        .select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug })
        .from(schema.organizations)
        .where(inArray(schema.organizations.id, organizationIds)),
      this.db
        .select()
        .from(schema.campaignResources)
        .where(inArray(schema.campaignResources.campaignId, campaignIds)),
      this.db
        .select({ campaignId: schema.nominationEdges.campaignId, value: countDistinct(schema.nominationEdges.canonicalGiverKey) })
        .from(schema.nominationEdges)
        .where(
          and(
            inArray(schema.nominationEdges.campaignId, campaignIds),
            eq(schema.nominationEdges.validity, "VALID"),
            eq(schema.nominationEdges.finalityStatus, "FINALIZED")
          )
        )
        .groupBy(schema.nominationEdges.campaignId),
      viewerIdentityId
        ? this.db
            .select({ campaignId: schema.nominations.campaignId, value: count(schema.nominations.id) })
            .from(schema.nominations)
            .where(
              and(
                inArray(schema.nominations.campaignId, campaignIds),
                eq(schema.nominations.giverIdentityId, viewerIdentityId),
                inArray(schema.nominations.status, [
                  "SUBMITTED",
                  "CHAIN_CONFIRMED",
                  "INDEXING_DELAYED",
                  "CONFIRMED"
                ])
              )
            )
            .groupBy(schema.nominations.campaignId)
        : Promise.resolve([] as Array<{ campaignId: string; value: number }>),
      experimentIds.length
        ? this.db.select({
            id: schema.campaignExperiments.id,
            version: schema.campaignExperiments.experimentVersion,
            variant: schema.campaignExperiments.variant,
            status: schema.campaignExperiments.status
          }).from(schema.campaignExperiments)
            .where(inArray(schema.campaignExperiments.id, experimentIds))
        : Promise.resolve([] as Array<{ id: string; version: string; variant: string; status: string }>),
      this.db.select({
        campaignId: schema.campaignLifecycleIntents.campaignId,
        action: schema.campaignLifecycleIntents.action,
        status: schema.campaignLifecycleIntents.status,
        transactionHash: schema.campaignLifecycleIntents.transactionHash
      }).from(schema.campaignLifecycleIntents)
        .where(inArray(schema.campaignLifecycleIntents.campaignId, campaignIds)),
      viewerIdentityId
        ? Promise.all(campaigns.map((campaign) => this.viewerEligibility(campaign, viewerIdentityId)))
        : Promise.resolve(campaigns.map(() => null))
    ]);

    const organizationById = new Map(organizations.map((item) => [item.id, item]));
    const resourceByCampaign = new Map<string, (typeof resources)[number]>();
    for (const resource of resources) if (!resourceByCampaign.has(resource.campaignId)) resourceByCampaign.set(resource.campaignId, resource);
    const participantsByCampaign = new Map(participantRows.map((row) => [row.campaignId, row.value]));
    const nominationsByCampaign = new Map(nominationRows.map((row) => [row.campaignId, row.value]));
    const experimentById = new Map(experiments.map((item) => [item.id, item]));
    const lifecycleByCampaign = new Map<string, typeof lifecycleRows>();
    for (const row of lifecycleRows) lifecycleByCampaign.set(row.campaignId, [...(lifecycleByCampaign.get(row.campaignId) ?? []), row]);

    return campaigns.map((campaign, index) => this.viewFrom(campaign, viewerIdentityId, {
      organization: organizationById.get(campaign.organizationId),
      resource: resourceByCampaign.get(campaign.id),
      participantAggregate: { value: participantsByCampaign.get(campaign.id) ?? 0 },
      nominationAggregate: { value: nominationsByCampaign.get(campaign.id) ?? 0 },
      eligibility: eligibilities[index] ?? null,
      experiment: campaign.experimentId ? experimentById.get(campaign.experimentId) : undefined,
      lifecycle: lifecycleByCampaign.get(campaign.id) ?? [],
      signup: signupsByCampaign.get(campaign.id),
      joinedAs: joined.get(campaign.id) ?? null
    }));
  }

  private viewFrom(
    campaign: typeof schema.campaigns.$inferSelect,
    viewerIdentityId: string | undefined,
    {
      organization, resource, participantAggregate, nominationAggregate, eligibility, experiment, lifecycle, signup, joinedAs
    }: {
      organization: { id: string; name: string; slug: string } | undefined;
      resource: typeof schema.campaignResources.$inferSelect | undefined;
      participantAggregate: { value: number };
      nominationAggregate: { value: number };
      eligibility: Awaited<ReturnType<CampaignService["viewerEligibility"]>> | null;
      experiment: { id: string; version: string; variant: string; status: string } | undefined;
      lifecycle: Array<{ action: string; status: string; transactionHash: string | null }>;
      signup?: { joinEnabled: boolean; status: string; signupDeadline: Date | null };
      joinedAs?: "GIVER" | "RECIPIENT" | null;
    }
  ) {
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
      signups: signup?.joinEnabled
        ? {
            status: signup.status,
            open: signup.status === "OPEN" && campaign.status === "DRAFT"
              && (!signup.signupDeadline || signup.signupDeadline.getTime() > Date.now()),
            deadline: signup.signupDeadline?.toISOString() ?? null,
            joinedAs: joinedAs ?? null
          }
        : null,
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

/** Postgres "undefined_table": the sign-ups migration has not been applied yet. */
export function isMissingTable(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth += 1) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "42P01") return true;
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

/** Campaign pages keep working on a database that has not been migrated for sign-ups yet. */
async function whenSignupsTableMissing<T>(query: Promise<T>, fallback: T): Promise<T> {
  try {
    return await query;
  } catch (error) {
    if (isMissingTable(error)) return fallback;
    throw error;
  }
}
