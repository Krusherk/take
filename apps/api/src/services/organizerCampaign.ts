import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import { TAKE_SELECTOR_ELIGIBILITY_VERSION } from "@take/mechanism";
import type { ApiEnv } from "../config/env.js";
import { assertOrganizationRole } from "./authorization.js";
import { AllowlistService } from "./allowlist.js";
import { CampaignLifecycleService } from "./campaignLifecycle.js";
import { CampaignRequestService } from "./campaignRequests.js";
import { EligibilitySnapshotService } from "./eligibilitySnapshots.js";
import { ServiceError } from "./errors.js";
import { ExperimentService } from "./experiment.js";
import { MechanismService } from "./mechanism.js";
import { SelectorEligibilityService } from "./selectorEligibility.js";

export interface OrganizerCampaignInput {
  organizationId: string;
  title: string;
  description: string;
  resourceName: string;
  seatCount: number;
  startTime: Date;
  endTime: Date;
  giverIdentityIds: string[];
  recipientIdentityIds: string[];
}

export class OrganizerCampaignService {
  constructor(private readonly db: Database, private readonly env: ApiEnv) {}

  async create(input: OrganizerCampaignInput, actor: { takeIdentityId: string; isOperator: boolean }) {
    await assertOrganizationRole(this.db, input.organizationId, actor.takeIdentityId, ["OWNER", "ADMIN"]);
    if (input.endTime <= input.startTime) {
      throw new ServiceError("INVALID_CAMPAIGN_TIME", "Campaign end must be after its start", 400);
    }
    if (input.endTime <= new Date()) {
      throw new ServiceError("INVALID_CAMPAIGN_TIME", "Campaign end must be in the future", 400);
    }
    const givers = uniqueIds(input.giverIdentityIds);
    const recipients = uniqueIds(input.recipientIdentityIds);
    if (!givers.length || !recipients.length) {
      throw new ServiceError("ROSTER_REQUIRED", "Choose at least one person who can give a TAKE and one person who can receive it", 400);
    }
    if (recipients.some((id) => givers.includes(id))) {
      throw new ServiceError("SELECTOR_RECIPIENT_OVERLAP", "The same person cannot both give and receive in this campaign", 400);
    }
    await this.requireIdentities([...givers, ...recipients]);

    const requests = new CampaignRequestService(this.db);
    const draft = await requests.createDraft({
      organizationId: input.organizationId,
      title: input.title,
      description: input.description,
      resourceName: input.resourceName,
      seatCount: input.seatCount,
      startTime: input.startTime,
      endTime: input.endTime,
      selectorMode: "DISJOINT",
      eligibilityDescription: "Only people on the organizer's giver list can give, one TAKE each, with a connected wallet. Nobody can give a TAKE to themselves."
    }, actor.takeIdentityId);
    await requests.submit(draft.id, actor.takeIdentityId);
    const provisioned = await requests.provision(draft.id, actor.takeIdentityId);
    if (!provisioned.campaign?.id) throw new ServiceError("CAMPAIGN_NOT_CREATED", "The campaign could not be created", 500);
    const campaignId = provisioned.campaign.id;

    if (!actor.isOperator) {
      return {
        campaignId,
        stage: "DRAFT" as const,
        message: "The campaign is saved. The TAKE campaign wallet still has to sign it onto Monad before Explore can list it."
      };
    }

    try {
      await this.prepareForSignature(campaignId, input.title, givers, recipients, actor.takeIdentityId);
    } catch (error) {
      if (error instanceof ServiceError) {
        const details = error.details && typeof error.details === "object" ? error.details : {};
        throw new ServiceError(error.code, error.message, error.statusCode, { ...details, campaignId });
      }
      throw error;
    }
    return {
      campaignId,
      stage: "READY_TO_SIGN" as const,
      message: "The campaign is ready. Sign once to publish it on Monad, then sign again to open nominations. It shows as live in Explore after the second signature."
    };
  }

  private async prepareForSignature(
    campaignId: string,
    title: string,
    giverIdentityIds: string[],
    recipientIdentityIds: string[],
    actorIdentityId: string
  ) {
    const [campaign] = await this.db.select().from(schema.campaigns).where(inArray(schema.campaigns.id, [campaignId])).limit(1);
    if (!campaign) throw new ServiceError("NOT_FOUND", "Campaign not found", 404);
    const allowlists = new AllowlistService(this.db);
    const eligibility = new SelectorEligibilityService(this.db, this.env);
    const label = title.trim().slice(0, 120);
    const givers = await allowlists.create(campaign.organizationId, actorIdentityId, `${label} / givers`);
    for (const takeIdentityId of giverIdentityIds) {
      await allowlists.addMember(givers.id, actorIdentityId, { takeIdentityId });
    }
    const receivers = await allowlists.create(campaign.organizationId, actorIdentityId, `${label} / recipients`);
    for (const takeIdentityId of recipientIdentityIds) {
      await allowlists.addMember(receivers.id, actorIdentityId, { takeIdentityId });
    }

    const cutoffAt = new Date(Math.min(Date.now(), campaign.startTime.getTime()) - 60_000).toISOString();
    await eligibility.saveDraft(campaignId, actorIdentityId, {
      version: TAKE_SELECTOR_ELIGIBILITY_VERSION,
      campaignId,
      candidateAllowlistId: givers.id,
      preset: "CUSTOM",
      cutoffAt,
      categories: [{
        id: "ONCHAIN",
        label: "Wallet",
        enabled: true,
        maximumPoints: 1,
        rules: [{
          id: "wallet-connected",
          label: "Wallet connected",
          points: 1,
          source: "AUTOMATED",
          evidenceRule: { id: "wallet-connected", version: 1, type: "WALLET_CONNECTED", chainType: "ethereum" }
        }]
      }],
      requiredTotalPoints: 1,
      minimumDistinctCategories: 1,
      allowAppeals: false,
      integrityScreeningEnabled: false,
      newcomerPath: { enabled: false }
    });
    await eligibility.evaluate(campaignId, actorIdentityId);
    const assessments = await eligibility.listAssessments(campaignId, actorIdentityId);
    const blocked = assessments.filter((item) => item.status !== "ELIGIBLE");
    if (!assessments.length || blocked.length) {
      const names = blocked.map((item) => item.person.name).join(", ");
      throw new ServiceError(
        "GIVERS_NOT_ELIGIBLE",
        names
          ? `${names} cannot give a TAKE until a wallet is connected on their TAKE account.`
          : "None of the chosen people can give a TAKE yet. They need a connected wallet.",
        409
      );
    }
    await eligibility.lock(campaignId, actorIdentityId, true);
    await eligibility.prepareMechanism({
      campaignId,
      actorIdentityId,
      recipientAllowlistId: receivers.id,
      selectorRecipientMode: "DISJOINT_SELECTOR_RECIPIENT",
      operatorManaged: true
    });

    const snapshots = new EligibilitySnapshotService(this.db, this.env);
    const built = await snapshots.createForCurrentDraft(campaignId, actorIdentityId, true);
    if (built.nominator.status !== "READY" || built.nominator.eligibleCount < 1) {
      throw new ServiceError("GIVERS_NOT_ELIGIBLE", "TAKE could not confirm anyone who can give. Check that each giver has a connected wallet.", 409);
    }
    if (built.recipient.status !== "READY" || built.recipient.eligibleCount < 1) {
      throw new ServiceError("RECIPIENTS_NOT_ELIGIBLE", "TAKE could not confirm anyone who can receive. Each recipient needs a TAKE account.", 409);
    }

    const members = await this.db.select({ key: schema.eligibilitySnapshotMembers.canonicalSubjectKey })
      .from(schema.eligibilitySnapshotMembers)
      .where(and(
        eq(schema.eligibilitySnapshotMembers.snapshotId, built.recipient.id),
        eq(schema.eligibilitySnapshotMembers.eligible, true)
      ));
    const recipientKeys = [...new Set(members.map((member) => member.key.toLowerCase()))].sort();
    if (recipientKeys.some((key) => !/^0x[0-9a-f]{64}$/.test(key)) || recipientKeys.length !== built.recipient.eligibleCount) {
      throw new ServiceError("RECIPIENTS_NOT_ELIGIBLE", "A chosen recipient is missing a TAKE identity key, so the campaign cannot be signed yet.", 409);
    }
    const observedAt = new Date(campaign.startTime.getTime() - 60_000).toISOString();
    const experiments = new ExperimentService(this.db);
    await experiments.createDraft(campaignId, actorIdentityId, {
      variant: "DISJOINT",
      giverSnapshotId: built.nominator.id,
      recipientSnapshotId: built.recipient.id,
      popularityProxy: "ORGANIZER_FAMILIARITY",
      popularityObservations: recipientKeys.map((canonicalRecipientKey) => ({
        canonicalRecipientKey,
        value: 1,
        observedAt,
        provenance: { source: "ORGANIZER_PERCEPTION", scale: "TAKE_V0_FIXED_0_3", collectedBy: "TAKE_OPERATOR" }
      }))
    }, true);
    await new MechanismService(this.db).lock(campaignId, actorIdentityId, true);
    await experiments.lock(campaignId, actorIdentityId, true);
    await new CampaignLifecycleService(this.db, this.env).approveLaunch(campaignId, actorIdentityId);
  }

  private async requireIdentities(ids: string[]) {
    const found = await this.db.select({ id: schema.takeIdentities.id })
      .from(schema.takeIdentities)
      .where(inArray(schema.takeIdentities.id, ids));
    if (found.length !== new Set(ids).size) {
      throw new ServiceError("PERSON_NOT_FOUND", "Choose people who already have a TAKE account", 400);
    }
  }
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}
