import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import type { ApiEnv } from "../config/env.js";
import { assertOrganizationRole } from "./authorization.js";
import { ServiceError } from "./errors.js";
import { OrganizerCampaignService } from "./organizerCampaign.js";

type SignupRow = typeof schema.campaignSignups.$inferSelect;
type Role = "GIVER" | "RECIPIENT";
type Actor = { takeIdentityId: string; isOperator: boolean };

export type SignupPerson = {
  takeIdentityId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
};

/** Minimal surface of the AutoFinalizer this service needs (keeps the import graph acyclic). */
export type SignupOpener = {
  publishAndOpen(campaignId: string, actorIdentityId: string): Promise<{ outcome: string; transactionHash?: string; detail?: string }>;
};

const MIN_NOMINATION_WINDOW_MS = 5 * 60_000;

/**
 * Phase 1 of a campaign: people join a draft through its join link. Closing
 * sign-ups locks the lists, publishes with the TAKE server wallet and opens
 * nominations. Who brought whom is recorded for the organizer only; it never
 * changes eligibility or weight.
 */
export class CampaignSignupService {
  constructor(private readonly db: Database, private readonly env: ApiEnv) {}

  // ---------------------------------------------------------------- public join

  async joinView(code: string, viewerIdentityId: string | null, forRef: string | null) {
    const signup = await this.byCode(code);
    const campaign = await this.campaign(signup.campaignId);
    const [organization] = await this.db.select({ name: schema.organizations.name })
      .from(schema.organizations).where(eq(schema.organizations.id, campaign.organizationId)).limit(1);
    const [resource] = await this.db.select({ name: schema.campaignResources.name, quantity: schema.campaignResources.quantity })
      .from(schema.campaignResources).where(eq(schema.campaignResources.campaignId, campaign.id)).limit(1);
    const members = await this.members(signup);
    const forPerson = forRef ? await this.resolveRecipientRef(signup, forRef) : null;
    let viewer: { joinedAs: Role | null; removed: boolean; interested: boolean } | null = null;
    if (viewerIdentityId) {
      const giver = members.givers.some((member) => member.takeIdentityId === viewerIdentityId);
      const recipient = members.recipients.some((member) => member.takeIdentityId === viewerIdentityId);
      const [interest] = await this.db.select({ id: schema.campaignSignupInterest.id })
        .from(schema.campaignSignupInterest)
        .where(and(
          eq(schema.campaignSignupInterest.organizationId, campaign.organizationId),
          eq(schema.campaignSignupInterest.takeIdentityId, viewerIdentityId)
        )).limit(1);
      viewer = {
        joinedAs: giver ? "GIVER" : recipient ? "RECIPIENT" : null,
        removed: signup.removedIdentityIds.includes(viewerIdentityId),
        interested: Boolean(interest)
      };
    }
    return {
      code: signup.joinCode,
      open: this.isOpen(signup, campaign.status),
      campaign: {
        id: campaign.id,
        title: campaign.title,
        description: campaign.description,
        status: campaign.status,
        endTime: campaign.endTime.toISOString(),
        organizationName: organization?.name ?? null,
        resourceName: resource?.name ?? null,
        seatCount: resource?.quantity ?? null
      },
      signupDeadline: signup.signupDeadline?.toISOString() ?? null,
      recipientSelfJoin: signup.recipientSelfJoin,
      counts: { givers: members.givers.length, recipients: members.recipients.length },
      for: forPerson,
      viewer
    };
  }

  async join(code: string, identity: { takeIdentityId: string }, input: { role: Role; forRef?: string | null }) {
    const signup = await this.byCode(code);
    const campaign = await this.campaign(signup.campaignId);
    if (!this.isOpen(signup, campaign.status)) {
      throw new ServiceError("SIGNUPS_CLOSED", "Sign-ups for this campaign are closed.", 409);
    }
    if (signup.removedIdentityIds.includes(identity.takeIdentityId)) {
      throw new ServiceError("SIGNUP_REMOVED", "The organizer removed you from this campaign.", 403);
    }
    if (input.role === "RECIPIENT" && !signup.recipientSelfJoin) {
      throw new ServiceError("RECIPIENT_JOIN_DISABLED", "This campaign only takes givers through its link.", 403);
    }
    const members = await this.members(signup);
    const asGiver = members.givers.find((member) => member.takeIdentityId === identity.takeIdentityId);
    const asRecipient = members.recipients.find((member) => member.takeIdentityId === identity.takeIdentityId);
    if (asGiver || asRecipient) {
      const joinedAs: Role = asGiver ? "GIVER" : "RECIPIENT";
      return { campaignId: campaign.id, joinedAs, alreadyJoined: true };
    }
    const forPerson = input.forRef ? await this.resolveRecipientRef(signup, input.forRef) : null;
    const [me] = await this.db.select({ key: schema.takeIdentities.protocolIdentityKey })
      .from(schema.takeIdentities).where(eq(schema.takeIdentities.id, identity.takeIdentityId)).limit(1);
    if (!me) throw new ServiceError("PERSON_NOT_FOUND", "Your TAKE account was not found", 404);
    const allowlistId = input.role === "GIVER" ? signup.giverAllowlistId : signup.recipientAllowlistId;
    await this.db.insert(schema.identityAllowlistMembers).values({
      allowlistId,
      subjectKey: me.key,
      takeIdentityId: identity.takeIdentityId,
      source: "JOIN_LINK",
      metadata: {
        via: forPerson ? "RECIPIENT_LINK" : "JOIN_LINK",
        ...(forPerson ? { referredByIdentityId: forPerson.takeIdentityId, forHandle: forPerson.username } : {})
      }
    }).onConflictDoNothing();
    return { campaignId: campaign.id, joinedAs: input.role, alreadyJoined: false, broughtBy: forPerson };
  }

  async registerInterest(code: string, identity: { takeIdentityId: string }) {
    const signup = await this.byCode(code);
    const campaign = await this.campaign(signup.campaignId);
    await this.db.insert(schema.campaignSignupInterest).values({
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      takeIdentityId: identity.takeIdentityId
    }).onConflictDoNothing();
    return { interested: true };
  }

  // ----------------------------------------------------------- organizer view

  async organizerView(campaignId: string, actor: Actor) {
    const { signup, campaign } = await this.authorize(campaignId, actor);
    const members = await this.members(signup);
    const people = await this.people([...members.givers, ...members.recipients].map((member) => member.takeIdentityId)
      .concat(members.givers.concat(members.recipients).map((member) => member.referredByIdentityId).filter((id): id is string => Boolean(id))));
    const view = (member: Member) => ({
      ...(people.get(member.takeIdentityId) ?? fallbackPerson(member.takeIdentityId)),
      via: member.via,
      broughtBy: member.referredByIdentityId ? people.get(member.referredByIdentityId) ?? null : null,
      joinedAt: member.addedAt.toISOString()
    });
    const [interest] = await this.db.select({ count: sql<number>`count(*)::int` })
      .from(schema.campaignSignupInterest)
      .where(eq(schema.campaignSignupInterest.organizationId, campaign.organizationId));
    return {
      campaignId,
      code: signup.joinCode,
      joinEnabled: signup.joinEnabled,
      open: this.isOpen(signup, campaign.status),
      status: signup.status,
      campaignStatus: campaign.status,
      signupDeadline: signup.signupDeadline?.toISOString() ?? null,
      recipientSelfJoin: signup.recipientSelfJoin,
      minXAccountAgeDays: signup.minXAccountAgeDays,
      xAccountAgeAvailable: Boolean(this.env.X_API_BEARER_TOKEN),
      autoOpen: Boolean(signup.autoOpenApprovedByIdentityId),
      canOpen: actor.isOperator || Boolean(signup.autoOpenApprovedByIdentityId),
      lastError: signup.lastError,
      closeReport: signup.closeReport,
      interestCount: interest?.count ?? 0,
      givers: members.givers.map(view),
      recipients: members.recipients.map(view)
    };
  }

  async listForOrganizer(actor: Actor) {
    const rows = await this.db.select({
      campaignId: schema.campaignSignups.campaignId,
      title: schema.campaigns.title,
      status: schema.campaignSignups.status,
      joinEnabled: schema.campaignSignups.joinEnabled,
      campaignStatus: schema.campaigns.status,
      signupDeadline: schema.campaignSignups.signupDeadline,
      organizationId: schema.campaigns.organizationId,
      createdAt: schema.campaignSignups.createdAt
    }).from(schema.campaignSignups)
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignSignups.campaignId))
      .innerJoin(schema.organizationMembers, and(
        eq(schema.organizationMembers.organizationId, schema.campaigns.organizationId),
        eq(schema.organizationMembers.takeIdentityId, actor.takeIdentityId),
        inArray(schema.organizationMembers.role, ["OWNER", "ADMIN"])
      ))
      .where(eq(schema.campaigns.status, "DRAFT"))
      .orderBy(sql`${schema.campaignSignups.createdAt} desc`)
      .limit(20);
    return rows.map((row) => ({ ...row, signupDeadline: row.signupDeadline?.toISOString() ?? null, createdAt: row.createdAt.toISOString() }));
  }

  async removeMember(campaignId: string, actor: Actor, takeIdentityId: string) {
    const { signup, campaign } = await this.authorize(campaignId, actor);
    this.assertEditable(signup, campaign.status);
    await this.db.delete(schema.identityAllowlistMembers).where(and(
      inArray(schema.identityAllowlistMembers.allowlistId, [signup.giverAllowlistId, signup.recipientAllowlistId]),
      eq(schema.identityAllowlistMembers.takeIdentityId, takeIdentityId)
    ));
    await this.db.update(schema.campaignSignups).set({
      removedIdentityIds: sql`array(select distinct unnest(${schema.campaignSignups.removedIdentityIds} || ARRAY[${takeIdentityId}]::uuid[]))`,
      updatedAt: new Date()
    }).where(eq(schema.campaignSignups.campaignId, campaignId));
    return this.organizerView(campaignId, actor);
  }

  async addMember(campaignId: string, actor: Actor, takeIdentityId: string, role: Role) {
    const { signup, campaign } = await this.authorize(campaignId, actor);
    this.assertEditable(signup, campaign.status);
    const members = await this.members(signup);
    const other = role === "GIVER" ? members.recipients : members.givers;
    if (other.some((member) => member.takeIdentityId === takeIdentityId)) {
      throw new ServiceError("SELECTOR_RECIPIENT_OVERLAP", "The same person cannot both give and receive in this campaign", 400);
    }
    const [identity] = await this.db.select({ key: schema.takeIdentities.protocolIdentityKey })
      .from(schema.takeIdentities).where(eq(schema.takeIdentities.id, takeIdentityId)).limit(1);
    if (!identity) throw new ServiceError("PERSON_NOT_FOUND", "Choose people who already have a TAKE account", 400);
    await this.db.insert(schema.identityAllowlistMembers).values({
      allowlistId: role === "GIVER" ? signup.giverAllowlistId : signup.recipientAllowlistId,
      subjectKey: identity.key,
      takeIdentityId,
      source: "ORGANIZER",
      metadata: { via: "ORGANIZER" }
    }).onConflictDoNothing();
    await this.db.update(schema.campaignSignups).set({
      removedIdentityIds: sql`array_remove(${schema.campaignSignups.removedIdentityIds}, ${takeIdentityId}::uuid)`,
      updatedAt: new Date()
    }).where(eq(schema.campaignSignups.campaignId, campaignId));
    return this.organizerView(campaignId, actor);
  }

  async updateSettings(campaignId: string, actor: Actor, input: {
    signupDeadline?: Date | null;
    recipientSelfJoin?: boolean;
    joinEnabled?: boolean;
    minXAccountAgeDays?: number | null;
  }) {
    const { signup, campaign } = await this.authorize(campaignId, actor);
    this.assertEditable(signup, campaign.status);
    if (input.signupDeadline) {
      if (input.signupDeadline <= new Date()) throw new ServiceError("SIGNUP_DEADLINE_PASSED", "Pick a sign-up deadline in the future", 400);
      if (input.signupDeadline.getTime() > campaign.endTime.getTime() - MIN_NOMINATION_WINDOW_MS) {
        throw new ServiceError("SIGNUP_DEADLINE_AFTER_END", "Leave at least five minutes for nominations after sign-ups close", 400);
      }
    }
    if (input.minXAccountAgeDays && !this.env.X_API_BEARER_TOKEN) {
      throw new ServiceError("X_ACCOUNT_AGE_UNAVAILABLE", "TAKE cannot check X account age yet, so this rule is not available.", 400);
    }
    await this.db.update(schema.campaignSignups).set({
      ...(input.signupDeadline !== undefined ? { signupDeadline: input.signupDeadline } : {}),
      ...(input.recipientSelfJoin !== undefined ? { recipientSelfJoin: input.recipientSelfJoin } : {}),
      ...(input.joinEnabled !== undefined ? { joinEnabled: input.joinEnabled } : {}),
      ...(input.minXAccountAgeDays !== undefined ? { minXAccountAgeDays: input.minXAccountAgeDays } : {}),
      ...(actor.isOperator && !signup.autoOpenApprovedByIdentityId ? { autoOpenApprovedByIdentityId: actor.takeIdentityId } : {}),
      updatedAt: new Date()
    }).where(eq(schema.campaignSignups.campaignId, campaignId));
    return this.organizerView(campaignId, actor);
  }

  /** Organizer pressed "Close sign-ups and open". */
  async requestClose(campaignId: string, actor: Actor, opener: SignupOpener) {
    const { signup, campaign } = await this.authorize(campaignId, actor);
    if (!actor.isOperator && !signup.autoOpenApprovedByIdentityId) {
      throw new ServiceError("OPERATOR_REQUIRED", "A TAKE operator has to open this campaign. Your lists are saved.", 403);
    }
    if (campaign.status !== "DRAFT" && signup.status === "CLOSED") {
      return { ...(await this.organizerView(campaignId, actor)), result: { outcome: "ALREADY_OPEN" } };
    }
    await this.db.update(schema.campaignSignups).set({
      closeRequestedByIdentityId: actor.takeIdentityId,
      closeRequestedAt: new Date(),
      ...(actor.isOperator && !signup.autoOpenApprovedByIdentityId ? { autoOpenApprovedByIdentityId: actor.takeIdentityId } : {}),
      ...(signup.status === "FAILED" ? { status: "OPEN" } : {}),
      updatedAt: new Date()
    }).where(eq(schema.campaignSignups.campaignId, campaignId));
    const result = await this.closeAndOpen(campaignId, opener);
    const view = await this.organizerView(campaignId, actor);
    if (result.outcome === "FAILED") {
      throw new ServiceError(result.code ?? "SIGNUPS_CLOSE_FAILED", result.message ?? "TAKE could not open this campaign", 409, { view });
    }
    return { ...view, result };
  }

  // ------------------------------------------------------------- lock + open

  /** Called by the scheduled finalizer: closes due sign-ups and notifies givers once nominations open. */
  async runDue(opener: SignupOpener, now = new Date()) {
    const due = await this.db.select().from(schema.campaignSignups).where(or(
      and(
        eq(schema.campaignSignups.status, "OPEN"),
        sql`${schema.campaignSignups.autoOpenApprovedByIdentityId} is not null`,
        lte(schema.campaignSignups.signupDeadline, now)
      ),
      // Lists already locked whose publish/open did not complete in the request.
      eq(schema.campaignSignups.status, "CLOSING")
    ));
    const steps: Array<{ campaignId: string; outcome: string; code?: string; message?: string }> = [];
    for (const row of due) {
      try {
        steps.push({ campaignId: row.campaignId, ...(await this.closeAndOpen(row.campaignId, opener)) });
      } catch (error) {
        steps.push({ campaignId: row.campaignId, outcome: "ERROR", code: error instanceof ServiceError ? error.code : "ERROR" });
      }
    }
    const notified = await this.notifyOpened();
    return { steps, notified };
  }

  async closeAndOpen(campaignId: string, opener: SignupOpener): Promise<{ outcome: string; code?: string; message?: string; transactionHash?: string }> {
    // Claim: OPEN -> CLOSING (CLOSING can be resumed by any later run).
    const [claimed] = await this.db.update(schema.campaignSignups).set({ status: "CLOSING", lastError: null, updatedAt: new Date() })
      .where(and(eq(schema.campaignSignups.campaignId, campaignId), inArray(schema.campaignSignups.status, ["OPEN", "CLOSING"])))
      .returning();
    if (!claimed) {
      const [row] = await this.db.select().from(schema.campaignSignups).where(eq(schema.campaignSignups.campaignId, campaignId)).limit(1);
      return { outcome: row?.status ?? "NOT_FOUND" };
    }
    const signup = claimed;
    let campaign = await this.campaign(campaignId);
    const actor = signup.autoOpenApprovedByIdentityId ?? signup.closeRequestedByIdentityId;
    if (!actor) return this.fail(signup, "OPERATOR_REQUIRED", "A TAKE operator has to open this campaign.");

    if (campaign.status === "DRAFT" && !campaign.launchApprovedAt) {
      const now = new Date();
      if (campaign.endTime.getTime() - now.getTime() < MIN_NOMINATION_WINDOW_MS) {
        return this.fail(signup, "NOMINATION_WINDOW_TOO_SHORT", "Nominations would end less than five minutes after opening. Create a new campaign with a later end.");
      }
      const cutoffAt = new Date(now.getTime() - 1_000);
      const skipped = await this.dropGiversWithoutWallet(signup, cutoffAt);
      const members = await this.members(signup);
      if (!members.givers.length || !members.recipients.length) {
        return this.fail(signup, "ROSTER_REQUIRED", "At least one giver with a wallet and one recipient have to join before nominations can open.");
      }
      if (!campaign.rulesHash) {
        await this.db.update(schema.campaigns).set({ startTime: now, updatedAt: new Date() }).where(eq(schema.campaigns.id, campaignId));
      }
      try {
        const report = await new OrganizerCampaignService(this.db, this.env).prepareForSignature(
          campaignId,
          { giverAllowlistId: signup.giverAllowlistId, recipientAllowlistId: signup.recipientAllowlistId },
          signup.createdByIdentityId,
          { cutoffAt, allowPartialGivers: true, minXAccountAgeDays: signup.minXAccountAgeDays, approverIdentityId: actor }
        );
        await this.db.update(schema.campaignSignups).set({
          closeReport: { ...report, skippedGivers: [...skipped, ...report.skippedGivers.map((name) => ({ name, reason: "NOT_ELIGIBLE" }))], lockedAt: now.toISOString() },
          updatedAt: new Date()
        }).where(eq(schema.campaignSignups.campaignId, campaignId));
      } catch (error) {
        if (error instanceof ServiceError) return this.fail(signup, error.code, error.message);
        throw error;
      }
      campaign = await this.campaign(campaignId);
    }

    if (campaign.status === "DRAFT" || campaign.status === "CREATED") {
      const result = await opener.publishAndOpen(campaignId, actor);
      campaign = await this.campaign(campaignId);
      if (campaign.status !== "ACTIVE") {
        // Stays CLOSING; the next scheduled run resumes from here.
        await this.db.update(schema.campaignSignups).set({ lastError: result.detail ?? null, updatedAt: new Date() })
          .where(eq(schema.campaignSignups.campaignId, campaignId));
        return { outcome: "OPENING", code: result.outcome, ...(result.transactionHash ? { transactionHash: result.transactionHash } : {}) };
      }
    }
    await this.db.update(schema.campaignSignups).set({ status: "CLOSED", closedAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(schema.campaignSignups.campaignId, campaignId));
    await this.notifyOpened(campaignId);
    return { outcome: "OPEN" };
  }

  /** In-app notification to every eligible giver once nominations are open. Runs once per campaign. */
  async notifyOpened(onlyCampaignId?: string) {
    const ready = await this.db.select({ campaignId: schema.campaignSignups.campaignId, title: schema.campaigns.title, endTime: schema.campaigns.endTime })
      .from(schema.campaignSignups)
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignSignups.campaignId))
      .where(and(
        eq(schema.campaignSignups.status, "CLOSED"),
        isNull(schema.campaignSignups.openedNotifiedAt),
        eq(schema.campaigns.status, "ACTIVE"),
        onlyCampaignId ? eq(schema.campaignSignups.campaignId, onlyCampaignId) : undefined
      ));
    let count = 0;
    for (const item of ready) {
      const [claimed] = await this.db.update(schema.campaignSignups).set({ openedNotifiedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.campaignSignups.campaignId, item.campaignId), isNull(schema.campaignSignups.openedNotifiedAt)))
        .returning({ campaignId: schema.campaignSignups.campaignId });
      if (!claimed) continue;
      const givers = await this.db.selectDistinct({ takeIdentityId: schema.eligibilitySnapshotMembers.takeIdentityId })
        .from(schema.eligibilitySnapshotMembers)
        .innerJoin(schema.eligibilitySnapshots, eq(schema.eligibilitySnapshots.id, schema.eligibilitySnapshotMembers.snapshotId))
        .where(and(
          eq(schema.eligibilitySnapshots.campaignId, item.campaignId),
          eq(schema.eligibilitySnapshots.subject, "NOMINATOR"),
          eq(schema.eligibilitySnapshotMembers.eligible, true)
        ));
      const ids = givers.map((giver) => giver.takeIdentityId).filter((id): id is string => Boolean(id));
      if (!ids.length) continue;
      await this.db.insert(schema.notifications).values(ids.map((recipientTakeIdentityId) => ({
        recipientTakeIdentityId,
        type: "NOMINATIONS_OPEN",
        payload: { campaignId: item.campaignId, title: item.title, endTime: item.endTime.toISOString() }
      })));
      count += ids.length;
    }
    return count;
  }

  // ---------------------------------------------------------------- helpers

  private async fail(signup: SignupRow, code: string, message: string) {
    await this.db.update(schema.campaignSignups).set({
      status: "FAILED",
      lastError: message,
      closeReport: { ...(signup.closeReport as object), failure: { code, message, at: new Date().toISOString() } },
      updatedAt: new Date()
    }).where(eq(schema.campaignSignups.campaignId, signup.campaignId));
    return { outcome: "FAILED", code, message };
  }

  /** Givers need a wallet that existed before the cutoff, or eligibility would block the whole list. */
  private async dropGiversWithoutWallet(signup: SignupRow, cutoffAt: Date) {
    const members = await this.members(signup);
    const ids = members.givers.map((member) => member.takeIdentityId);
    if (!ids.length) return [];
    const withWallet = await this.db.selectDistinct({ takeIdentityId: schema.wallets.takeIdentityId })
      .from(schema.wallets)
      .where(and(
        inArray(schema.wallets.takeIdentityId, ids),
        eq(schema.wallets.isActive, true),
        eq(schema.wallets.chainType, "ethereum"),
        lte(schema.wallets.firstObservedAt, cutoffAt)
      ));
    const ok = new Set(withWallet.map((row) => row.takeIdentityId));
    const missing = ids.filter((id) => !ok.has(id));
    if (!missing.length) return [];
    const people = await this.people(missing);
    await this.db.delete(schema.identityAllowlistMembers).where(and(
      eq(schema.identityAllowlistMembers.allowlistId, signup.giverAllowlistId),
      inArray(schema.identityAllowlistMembers.takeIdentityId, missing)
    ));
    return missing.map((id) => ({ name: people.get(id)?.displayName ?? "TAKE member", takeIdentityId: id, reason: "NO_WALLET" }));
  }

  private isOpen(signup: SignupRow, campaignStatus: string) {
    return signup.joinEnabled
      && signup.status === "OPEN"
      && campaignStatus === "DRAFT"
      && (!signup.signupDeadline || signup.signupDeadline.getTime() > Date.now());
  }

  private assertEditable(signup: SignupRow, campaignStatus: string) {
    if (campaignStatus !== "DRAFT" || !["OPEN", "FAILED"].includes(signup.status)) {
      throw new ServiceError("SIGNUPS_LOCKED", "The lists are locked now that nominations are opening.", 409);
    }
  }

  private async authorize(campaignId: string, actor: Actor) {
    const [signup] = await this.db.select().from(schema.campaignSignups).where(eq(schema.campaignSignups.campaignId, campaignId)).limit(1);
    if (!signup) throw new ServiceError("NOT_FOUND", "This campaign has no sign-ups", 404);
    const campaign = await this.campaign(campaignId);
    if (!actor.isOperator) {
      await assertOrganizationRole(this.db, campaign.organizationId, actor.takeIdentityId, ["OWNER", "ADMIN"]);
    }
    return { signup, campaign };
  }

  private async byCode(code: string) {
    const [signup] = await this.db.select().from(schema.campaignSignups)
      .where(eq(schema.campaignSignups.joinCode, code.trim().toLowerCase())).limit(1);
    if (!signup) throw new ServiceError("NOT_FOUND", "This join link does not exist", 404);
    return signup;
  }

  private async campaign(id: string) {
    const [campaign] = await this.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1);
    if (!campaign) throw new ServiceError("NOT_FOUND", "Campaign not found", 404);
    return campaign;
  }

  private async members(signup: SignupRow) {
    const rows = await this.db.select().from(schema.identityAllowlistMembers)
      .where(inArray(schema.identityAllowlistMembers.allowlistId, [signup.giverAllowlistId, signup.recipientAllowlistId]))
      .orderBy(schema.identityAllowlistMembers.addedAt);
    const toMember = (row: typeof rows[number]): Member | null => {
      if (!row.takeIdentityId) return null;
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        takeIdentityId: row.takeIdentityId,
        via: typeof metadata.via === "string" ? metadata.via : row.source,
        referredByIdentityId: typeof metadata.referredByIdentityId === "string" ? metadata.referredByIdentityId : null,
        addedAt: row.addedAt
      };
    };
    return {
      givers: rows.filter((row) => row.allowlistId === signup.giverAllowlistId).map(toMember).filter((m): m is Member => Boolean(m)),
      recipients: rows.filter((row) => row.allowlistId === signup.recipientAllowlistId).map(toMember).filter((m): m is Member => Boolean(m))
    };
  }

  /** `?for=` is an X handle or a TAKE identity id of someone on the recipient list. */
  private async resolveRecipientRef(signup: SignupRow, ref: string): Promise<SignupPerson | null> {
    const members = await this.members(signup);
    const ids = members.recipients.map((member) => member.takeIdentityId);
    if (!ids.length) return null;
    const people = await this.people(ids);
    const normalized = ref.trim().replace(/^@/, "").toLowerCase();
    for (const person of people.values()) {
      if (person.takeIdentityId === normalized || person.username?.toLowerCase() === normalized) return person;
    }
    return null;
  }

  async people(ids: string[]) {
    const unique = [...new Set(ids)];
    const map = new Map<string, SignupPerson>();
    if (!unique.length) return map;
    const rows = await this.db.select({
      takeIdentityId: schema.takeIdentities.id,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
      username: schema.socialAccounts.username,
      socialName: schema.socialAccounts.displayName,
      socialAvatar: schema.socialAccounts.avatarUrl
    }).from(schema.takeIdentities)
      .innerJoin(schema.users, eq(schema.users.id, schema.takeIdentities.userId))
      .leftJoin(schema.socialAccounts, and(
        eq(schema.socialAccounts.takeIdentityId, schema.takeIdentities.id),
        eq(schema.socialAccounts.provider, "twitter"),
        eq(schema.socialAccounts.isActive, true)
      ))
      .where(inArray(schema.takeIdentities.id, unique));
    for (const row of rows) {
      if (map.has(row.takeIdentityId) && !row.username) continue;
      map.set(row.takeIdentityId, {
        takeIdentityId: row.takeIdentityId,
        displayName: row.displayName ?? row.socialName ?? row.username ?? "TAKE member",
        username: row.username,
        avatarUrl: row.avatarUrl ?? row.socialAvatar
      });
    }
    return map;
  }
}

type Member = { takeIdentityId: string; via: string; referredByIdentityId: string | null; addedAt: Date };

function fallbackPerson(takeIdentityId: string): SignupPerson {
  return { takeIdentityId, displayName: "TAKE member", username: null, avatarUrl: null };
}
