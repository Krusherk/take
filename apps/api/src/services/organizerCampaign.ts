import { randomBytes } from "node:crypto";
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
import { SignalService } from "./signal.js";
import { SANDBOX_ELIGIBILITY_DESCRIPTION, type SignalDomain } from "@take/shared";
import { CampaignService } from "./campaign.js";

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
  evaluationPlan?: { domain: SignalDomain; question: string; criteria: string; evaluateAfter: Date; evidenceExpected: boolean };
  /** Phase 1 "Sign-ups": collect people through a join link before anything is locked. */
  signups?: { deadline: Date | null; recipientSelfJoin: boolean };
  /** Operator-only open sandbox: anyone can give, no lists, results don't count. */
  sandbox?: boolean;
}

export type CampaignListIds = { giverAllowlistId: string; recipientAllowlistId: string };

export class OrganizerCampaignService {
  constructor(private readonly db: Database, private readonly env: ApiEnv) {}

  async create(input: OrganizerCampaignInput, actor: { takeIdentityId: string; isOperator: boolean }) {
    await assertOrganizationRole(this.db, input.organizationId, actor.takeIdentityId, ["OWNER", "ADMIN"]);
    if (input.sandbox) return this.createSandbox(input, actor);
    const now = new Date();
    const signups = input.signups ?? null;
    if (signups?.deadline) {
      if (signups.deadline <= now) throw new ServiceError("SIGNUP_DEADLINE_PASSED", "Pick a sign-up deadline in the future", 400);
      if (signups.deadline >= input.endTime) throw new ServiceError("SIGNUP_DEADLINE_AFTER_END", "Sign-ups have to close before nominations end", 400);
    }
    // With sign-ups first, nominations open when sign-ups close. Until then the
    // draft's start is a placeholder: the deadline, or a little ahead of now.
    const startTime = signups
      ? signups.deadline ?? new Date(Math.min(input.endTime.getTime() - 120_000, now.getTime() + 60 * 60_000))
      : input.startTime;
    if (input.endTime <= startTime) {
      throw new ServiceError("INVALID_CAMPAIGN_TIME", "Campaign end must be after its start", 400);
    }
    if (input.endTime <= now) {
      throw new ServiceError("INVALID_CAMPAIGN_TIME", "Campaign end must be in the future", 400);
    }
    if (input.evaluationPlan) {
      if (startTime <= now) {
        throw new ServiceError("EVALUATION_PLAN_TOO_LATE", "A scheduled check has to be locked before nominations open. Pick a start time a few minutes ahead.", 400);
      }
      if (input.evaluationPlan.evaluateAfter < input.endTime) {
        throw new ServiceError("EVALUATION_DATE_INVALID", "Schedule the check after nominations end.", 400);
      }
    }
    const givers = uniqueIds(input.giverIdentityIds);
    const recipients = uniqueIds(input.recipientIdentityIds);
    if (!signups && (!givers.length || !recipients.length)) {
      throw new ServiceError("ROSTER_REQUIRED", "Choose at least one person who can give a TAKE and one person who can receive it", 400);
    }
    if (recipients.some((id) => givers.includes(id))) {
      throw new ServiceError("SELECTOR_RECIPIENT_OVERLAP", "The same person cannot both give and receive in this campaign", 400);
    }
    if (givers.length || recipients.length) await this.requireIdentities([...givers, ...recipients]);

    const requests = new CampaignRequestService(this.db);
    const draft = await requests.createDraft({
      organizationId: input.organizationId,
      title: input.title,
      description: input.description,
      resourceName: input.resourceName,
      seatCount: input.seatCount,
      startTime,
      endTime: input.endTime,
      selectorMode: "DISJOINT",
      eligibilityDescription: "Only people on the organizer's giver list can give, one TAKE each, with a connected wallet. Nobody can give a TAKE to themselves."
    }, actor.takeIdentityId);
    await requests.submit(draft.id, actor.takeIdentityId);
    const provisioned = await requests.provision(draft.id, actor.takeIdentityId);
    if (!provisioned.campaign?.id) throw new ServiceError("CAMPAIGN_NOT_CREATED", "The campaign could not be created", 500);
    const campaignId = provisioned.campaign.id;

    if (input.evaluationPlan) {
      // Lock the check while the campaign is still an offchain draft. The
      // database trigger refuses it after publication or once nominations start.
      try {
        await new SignalService(this.db).lockPlan(campaignId, actor.takeIdentityId, input.evaluationPlan);
      } catch (error) {
        if (error instanceof ServiceError) throw new ServiceError(error.code, error.message, error.statusCode, { campaignId });
        throw error;
      }
    }

    // The chosen people are always saved, so a draft never loses its lists.
    const lists = await this.createLists(input.organizationId, input.title, givers, recipients, actor.takeIdentityId);
    const joinCode = newJoinCode();
    await this.db.insert(schema.campaignSignups).values({
      campaignId,
      joinCode,
      joinEnabled: Boolean(signups),
      giverAllowlistId: lists.giverAllowlistId,
      recipientAllowlistId: lists.recipientAllowlistId,
      recipientSelfJoin: signups?.recipientSelfJoin ?? false,
      signupDeadline: signups?.deadline ?? null,
      status: "OPEN",
      autoOpenApprovedByIdentityId: actor.isOperator ? actor.takeIdentityId : null,
      createdByIdentityId: actor.takeIdentityId
    });

    if (signups) {
      return {
        campaignId,
        stage: "SIGNUPS" as const,
        joinCode,
        message: signups.deadline
          ? "Sign-ups are open. Share the join link. TAKE locks the lists and opens nominations at the deadline."
          : "Sign-ups are open. Share the join link, then close sign-ups to open nominations."
      };
    }

    if (!actor.isOperator) {
      return {
        campaignId,
        stage: "DRAFT" as const,
        message: "The campaign and its people are saved. A TAKE operator has to open it on Monad before Explore can list it."
      };
    }

    try {
      await this.prepareForSignature(campaignId, lists, actor.takeIdentityId);
    } catch (error) {
      if (error instanceof ServiceError) {
        const details = error.details && typeof error.details === "object" ? error.details : {};
        throw new ServiceError(error.code, error.message, error.statusCode, { ...details, campaignId });
      }
      throw error;
    }
    await this.db.update(schema.campaignSignups).set({ status: "CLOSED", closedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.campaignSignups.campaignId, campaignId));
    return {
      campaignId,
      stage: "READY_TO_SIGN" as const,
      message: "The campaign is ready. Sign once to publish it on Monad, then sign again to open nominations. It shows as live in Explore after the second signature."
    };
  }

  /**
   * Open sandbox: open giver and recipient eligibility with empty roots, so the
   * contract lets any registered TAKE identity give one TAKE to anyone else
   * while it is active. No lists, snapshots or mechanism are locked.
   */
  private async createSandbox(input: OrganizerCampaignInput, actor: { takeIdentityId: string; isOperator: boolean }) {
    if (!actor.isOperator) throw new ServiceError("OPERATOR_REQUIRED", "Only a TAKE operator can open a sandbox campaign", 403);
    if (input.signups || input.evaluationPlan) {
      throw new ServiceError("SANDBOX_OPTIONS", "A sandbox has no sign-ups and no follow-up check", 400);
    }
    const now = new Date();
    if (input.endTime <= now || input.endTime <= input.startTime) {
      throw new ServiceError("INVALID_CAMPAIGN_TIME", "Campaign end must be in the future and after its start", 400);
    }
    const campaign = await new CampaignService(this.db).createDraft({
      organizationId: input.organizationId,
      title: input.title,
      description: input.description,
      resource: { type: "OPPORTUNITY", name: input.resourceName, quantity: input.seatCount },
      startTime: input.startTime < now ? now : input.startTime,
      endTime: input.endTime,
      nominationLimit: 1,
      nominatorEligibilityMode: "OPEN_REGISTERED",
      recipientEligibilityMode: "OPEN_REGISTERED",
      nominationVisibilityMode: "PUBLIC"
    }, actor.takeIdentityId);
    await this.db.update(schema.campaigns).set({
      eligibilityDescription: SANDBOX_ELIGIBILITY_DESCRIPTION,
      launchApprovedByIdentityId: actor.takeIdentityId,
      launchApprovedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(schema.campaigns.id, campaign.id));
    return {
      campaignId: campaign.id,
      stage: "READY_TO_SIGN" as const,
      sandbox: true,
      message: "Sandbox ready. Publish it on Monad, then open it. Anyone with a TAKE account can give while it runs."
    };
  }

  private async createLists(organizationId: string, title: string, giverIds: string[], recipientIds: string[], actorIdentityId: string): Promise<CampaignListIds> {
    const allowlists = new AllowlistService(this.db);
    const label = title.trim().slice(0, 100);
    const givers = await allowlists.create(organizationId, actorIdentityId, `${label} / givers`);
    for (const takeIdentityId of giverIds) await allowlists.addMember(givers.id, actorIdentityId, { takeIdentityId });
    const receivers = await allowlists.create(organizationId, actorIdentityId, `${label} / recipients`);
    for (const takeIdentityId of recipientIds) await allowlists.addMember(receivers.id, actorIdentityId, { takeIdentityId });
    return { giverAllowlistId: givers.id, recipientAllowlistId: receivers.id };
  }

  /**
   * Locks the saved lists into eligibility, mechanism and experiment artifacts
   * and approves launch. Everything after this is signing on Monad.
   */
  async prepareForSignature(
    campaignId: string,
    lists: CampaignListIds,
    actorIdentityId: string,
    options: { cutoffAt?: Date; allowPartialGivers?: boolean; minXAccountAgeDays?: number | null; approverIdentityId?: string } = {}
  ) {
    const [campaign] = await this.db.select().from(schema.campaigns).where(inArray(schema.campaigns.id, [campaignId])).limit(1);
    if (!campaign) throw new ServiceError("NOT_FOUND", "Campaign not found", 404);
    const givers = { id: lists.giverAllowlistId };
    const receivers = { id: lists.recipientAllowlistId };
    const eligibility = new SelectorEligibilityService(this.db, this.env);
    const cutoffAt = (options.cutoffAt ?? new Date(Math.min(Date.now(), campaign.startTime.getTime()) - 60_000)).toISOString();
    const minXAge = options.minXAccountAgeDays ?? null;
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
      }, ...(minXAge ? [{
        id: "SOCIAL" as const,
        label: "X account",
        enabled: true,
        maximumPoints: 1,
        rules: [{
          id: "x-account-age",
          label: `X account at least ${minXAge} days old`,
          points: 1,
          source: "AUTOMATED" as const,
          evidenceRule: { id: "x-account-age", version: 1, type: "X_ACCOUNT_MIN_AGE" as const, minimumDays: minXAge }
        }]
      }] : [])],
      requiredTotalPoints: minXAge ? 2 : 1,
      minimumDistinctCategories: minXAge ? 2 : 1,
      allowAppeals: false,
      integrityScreeningEnabled: false,
      newcomerPath: { enabled: false }
    });
    await eligibility.evaluate(campaignId, actorIdentityId);
    const assessments = await eligibility.listAssessments(campaignId, actorIdentityId);
    const blocked = assessments.filter((item) => item.status !== "ELIGIBLE");
    const eligibleCount = assessments.length - blocked.length;
    if (!assessments.length || (blocked.length && !(options.allowPartialGivers && eligibleCount > 0))) {
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
    await new CampaignLifecycleService(this.db, this.env).approveLaunch(campaignId, options.approverIdentityId ?? actorIdentityId);
    return {
      eligibleGivers: built.nominator.eligibleCount,
      eligibleRecipients: built.recipient.eligibleCount,
      skippedGivers: blocked.map((item) => item.person.name)
    };
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

function newJoinCode() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}
