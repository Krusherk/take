import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import {
  campaignExperimentDraftV0Schema,
  campaignExperimentProtocolV0Schema,
  campaignMechanismConfigV1Schema,
  domainHash,
  experimentProtocolHash,
  orderRecipientsForViewer,
  organizerFamiliaritySchema,
  PRIMARY_RESEARCH_QUESTIONS_V0,
  TAKE_EXPERIMENT_VERSION,
  type CampaignExperimentDraftV0,
  type CampaignExperimentProtocolV0
} from "@take/mechanism";
import type { Hex } from "viem";
import { assertOrganizationRole } from "./authorization.js";
import { notFound, ServiceError } from "./errors.js";

const FALLBACK_SCALE = {
  0: "ORGANIZER_DOES_NOT_RECOGNIZE",
  1: "MINIMALLY_VISIBLE",
  2: "MODERATELY_VISIBLE",
  3: "HIGHLY_VISIBLE"
} as const;

export class ExperimentService {
  constructor(private readonly db: Database) {}

  async createDraft(campaignId: string, actorIdentityId: string, rawInput: unknown, operatorManaged = false) {
    const input = campaignExperimentDraftV0Schema.parse(rawInput);
    const campaign = await this.getCampaign(campaignId);
    if (!operatorManaged) await assertOrganizationRole(this.db, campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    if (campaign.status !== "DRAFT") {
      throw new ServiceError("CAMPAIGN_NOT_DRAFT", "Only draft campaigns can receive an experiment protocol", 409);
    }
    if (campaign.nominationLimit !== 1) {
      throw new ServiceError("V0_REQUIRES_ONE_TAKE", "V0 requires exactly one TAKE per eligible canonical giver", 409);
    }

    const [giverSnapshot, recipientSnapshot] = await Promise.all([
      this.getSnapshot(campaignId, input.giverSnapshotId, "NOMINATOR"),
      this.getSnapshot(campaignId, input.recipientSnapshotId, "RECIPIENT")
    ]);
    if (giverSnapshot.mechanismConfigId !== recipientSnapshot.mechanismConfigId || !giverSnapshot.mechanismConfigId) {
      throw new ServiceError("EXPERIMENT_SNAPSHOT_MISMATCH", "Experiment snapshots must belong to one mechanism revision", 409);
    }
    if (!giverSnapshot.root || !recipientSnapshot.root) {
      throw new ServiceError("V0_REQUIRES_ROSTERED_RECIPIENTS", "V0 snapshots must be closed rooted populations", 409);
    }
    if (!["READY", "LOCKED"].includes(giverSnapshot.status) || !["READY", "LOCKED"].includes(recipientSnapshot.status)) {
      throw new ServiceError("EXPERIMENT_SNAPSHOT_NOT_READY", "Experiment snapshots must be ready before preregistration", 409);
    }

    const [configRecord, resource] = await Promise.all([
      this.db.select().from(schema.campaignMechanismConfigs)
        .where(eq(schema.campaignMechanismConfigs.id, giverSnapshot.mechanismConfigId)).limit(1)
        .then((rows) => rows[0]),
      this.db.select().from(schema.campaignResources)
        .where(eq(schema.campaignResources.campaignId, campaignId)).limit(1)
        .then((rows) => rows[0])
    ]);
    if (!configRecord) notFound("Mechanism revision not found");
    if (!resource) notFound("Campaign resource not found");
    const config = campaignMechanismConfigV1Schema.parse(configRecord.canonicalConfig);
    if (config.nominationLimit !== 1 || config.allocation.strategyId !== "RAW_UNIQUE_SUPPORT" || config.allocation.strategyVersion !== "2") {
      throw new ServiceError("V0_MECHANISM_MISMATCH", "V0 requires one TAKE and RAW_UNIQUE_SUPPORT@2", 409);
    }
    if (config.recipientPolicy.population.type === "OPEN_EXTERNAL") {
      throw new ServiceError("V0_REQUIRES_ROSTERED_RECIPIENTS", "V0 pilots require an explicit recipient roster", 409);
    }
    const expectedVariant = config.selectorRecipientMode === "DISJOINT_SELECTOR_RECIPIENT" ? "DISJOINT" : "OVERLAPPING";
    if (input.variant !== expectedVariant) {
      throw new ServiceError("EXPERIMENT_VARIANT_MISMATCH", "Experiment variant must match the mechanism population mode", 409);
    }

    const recipientKeys = await this.eligibleRecipientKeys(recipientSnapshot.id);
    this.validateObservations(input, recipientKeys, campaign.startTime);
    const protocol = buildProtocol({
      campaignId,
      mechanismConfigId: configRecord.id,
      input,
      resource,
      giverSnapshot,
      recipientSnapshot
    });
    const protocolHash = experimentProtocolHash(protocol);

    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.campaignExperiments)
        .where(eq(schema.campaignExperiments.campaignId, campaignId)).limit(1);
      if (existing?.status === "LOCKED") {
        throw new ServiceError("EXPERIMENT_ALREADY_LOCKED", "The experiment protocol is immutable", 409);
      }

      const experimentId = existing?.id ?? randomUUID();
      const values = {
        mechanismConfigId: configRecord.id,
        giverSnapshotId: giverSnapshot.id,
        recipientSnapshotId: recipientSnapshot.id,
        experimentVersion: TAKE_EXPERIMENT_VERSION,
        variant: input.variant,
        status: "DRAFT" as const,
        selectedPopularityProxy: input.popularityProxy,
        canonicalProtocol: protocol,
        protocolHash,
        updatedAt: new Date()
      };
      const [experiment] = existing
        ? await tx.update(schema.campaignExperiments).set(values)
            .where(eq(schema.campaignExperiments.id, existing.id)).returning()
        : await tx.insert(schema.campaignExperiments).values({
            id: experimentId,
            campaignId,
            createdByIdentityId: actorIdentityId,
            ...values
          }).returning();
      if (!experiment) throw new Error("Failed to store experiment protocol");

      await tx.delete(schema.experimentContextObservations)
        .where(eq(schema.experimentContextObservations.experimentId, experiment.id));
      await tx.insert(schema.experimentContextObservations).values(
        input.popularityObservations.map((observation) => observationValues({
          experimentId: experiment.id,
          campaignId,
          proxyType: input.popularityProxy,
          observation
        }))
      );
      await tx.update(schema.campaigns)
        .set({ experimentId: experiment.id, updatedAt: new Date() })
        .where(eq(schema.campaigns.id, campaignId));
      await tx.insert(schema.auditLogs).values({
        actorIdentityId,
        organizationId: campaign.organizationId,
        campaignId,
        action: "EXPERIMENT_V0_DRAFT_SAVED",
        metadata: { experimentId: experiment.id, protocolHash, selectedPopularityProxy: input.popularityProxy }
      });
      return serializeExperiment(experiment);
    });
  }

  async lock(campaignId: string, actorIdentityId: string, operatorManaged = false) {
    const campaign = await this.getCampaign(campaignId);
    if (!operatorManaged) await assertOrganizationRole(this.db, campaign.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    if (campaign.status !== "DRAFT") {
      throw new ServiceError("CAMPAIGN_NOT_DRAFT", "The experiment must lock before publication", 409);
    }
    const experiment = await this.getExperiment(campaignId);
    if (experiment.status === "LOCKED") return serializeExperiment(experiment);
    if (campaign.mechanismConfigId !== experiment.mechanismConfigId) {
      throw new ServiceError("MECHANISM_NOT_LOCKED", "Lock the referenced mechanism and snapshots first", 409);
    }
    const [config, giverSnapshot, recipientSnapshot] = await Promise.all([
      this.db.select().from(schema.campaignMechanismConfigs)
        .where(eq(schema.campaignMechanismConfigs.id, experiment.mechanismConfigId)).limit(1)
        .then((rows) => rows[0]),
      this.db.select().from(schema.eligibilitySnapshots)
        .where(eq(schema.eligibilitySnapshots.id, experiment.giverSnapshotId)).limit(1)
        .then((rows) => rows[0]),
      this.db.select().from(schema.eligibilitySnapshots)
        .where(eq(schema.eligibilitySnapshots.id, experiment.recipientSnapshotId)).limit(1)
        .then((rows) => rows[0])
    ]);
    if (config?.status !== "LOCKED" || giverSnapshot?.status !== "LOCKED" || recipientSnapshot?.status !== "LOCKED") {
      throw new ServiceError("EXPERIMENT_DEPENDENCY_NOT_LOCKED", "Mechanism and eligibility snapshots must be locked first", 409);
    }
    const protocol = campaignExperimentProtocolV0Schema.parse(experiment.canonicalProtocol);
    if (experimentProtocolHash(protocol) !== experiment.protocolHash) {
      throw new ServiceError("EXPERIMENT_PROTOCOL_HASH_MISMATCH", "Stored experiment protocol does not match its hash", 500);
    }
    const recipientKeys = await this.eligibleRecipientKeys(experiment.recipientSnapshotId);
    const observations = await this.db.select().from(schema.experimentContextObservations)
      .where(eq(schema.experimentContextObservations.experimentId, experiment.id));
    const observedKeys = new Set(observations.map((item) => item.canonicalRecipientKey.toLowerCase()));
    if (observations.length !== recipientKeys.length || recipientKeys.some((key) => !observedKeys.has(key))) {
      throw new ServiceError("POPULARITY_OBSERVATIONS_INCOMPLETE", "Every rostered recipient needs one preregistered popularity observation", 409);
    }

    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [locked] = await tx.update(schema.campaignExperiments).set({
        status: "LOCKED",
        lockedByIdentityId: actorIdentityId,
        lockedAt: now,
        updatedAt: now
      }).where(and(
        eq(schema.campaignExperiments.id, experiment.id),
        eq(schema.campaignExperiments.status, "DRAFT")
      )).returning();
      if (!locked) throw new ServiceError("EXPERIMENT_ALREADY_LOCKED", "Experiment changed before lock", 409);
      await tx.insert(schema.auditLogs).values({
        actorIdentityId,
        organizationId: campaign.organizationId,
        campaignId,
        action: "EXPERIMENT_V0_LOCKED",
        metadata: { experimentId: locked.id, protocolHash: locked.protocolHash }
      });
      return serializeExperiment(locked);
    });
  }

  async getPublic(campaignId: string) {
    const experiment = await this.getExperiment(campaignId, false);
    if (!experiment) return null;
    const campaign = await this.getCampaign(campaignId);
    return {
      ...serializeExperiment(experiment),
      popularityObservations: {
        public: false,
        count: await this.db.select({ id: schema.experimentContextObservations.id })
          .from(schema.experimentContextObservations)
          .where(eq(schema.experimentContextObservations.experimentId, experiment.id))
          .then((rows) => rows.length)
      },
      activeNominationDataHidden: !["CLOSED", "ALLOCATING", "FINALIZED"].includes(campaign.status)
    };
  }

  async replaceInternalObservations(campaignId: string, rawInput: unknown) {
    const experiment = await this.getExperiment(campaignId);
    if (experiment.status !== "DRAFT") {
      throw new ServiceError("EXPERIMENT_ALREADY_LOCKED", "Research observations are immutable after lock", 409);
    }
    const input = campaignExperimentDraftV0Schema.pick({ popularityObservations: true }).parse(rawInput);
    const recipientKeys = await this.eligibleRecipientKeys(experiment.recipientSnapshotId);
    const campaign = await this.getCampaign(campaignId);
    const normalized: CampaignExperimentDraftV0 = {
      variant: experiment.variant as CampaignExperimentDraftV0["variant"],
      giverSnapshotId: experiment.giverSnapshotId,
      recipientSnapshotId: experiment.recipientSnapshotId,
      popularityProxy: experiment.selectedPopularityProxy as CampaignExperimentDraftV0["popularityProxy"],
      popularityObservations: input.popularityObservations
    };
    this.validateObservations(normalized, recipientKeys, campaign.startTime);
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.experimentContextObservations)
        .where(eq(schema.experimentContextObservations.experimentId, experiment.id));
      await tx.insert(schema.experimentContextObservations).values(
        normalized.popularityObservations.map((observation) => observationValues({
          experimentId: experiment.id,
          campaignId,
          proxyType: normalized.popularityProxy,
          observation
        }))
      );
    });
    return { stored: normalized.popularityObservations.length };
  }

  async listRecipients(campaignId: string, viewerIdentityId: string, query = "") {
    const experiment = await this.getExperiment(campaignId);
    if (experiment.status !== "LOCKED") {
      throw new ServiceError("EXPERIMENT_NOT_LOCKED", "Recipient discovery opens after protocol lock", 409);
    }
    const [viewer] = await this.db.select({ key: schema.takeIdentities.protocolIdentityKey })
      .from(schema.takeIdentities).where(eq(schema.takeIdentities.id, viewerIdentityId)).limit(1);
    if (!viewer) notFound("Viewer identity not found");
    const members = await this.db.select().from(schema.eligibilitySnapshotMembers)
      .where(and(
        eq(schema.eligibilitySnapshotMembers.snapshotId, experiment.recipientSnapshotId),
        eq(schema.eligibilitySnapshotMembers.eligible, true)
      ));
    const people = await Promise.all(members.map((member) => this.personForMember(member)));
    const normalizedQuery = query.trim().toLowerCase();
    const viewerKey = viewer.key.toLowerCase();
    const matched = people.filter((person) =>
      person.canonicalRecipientId.toLowerCase() !== viewerKey
      && (!normalizedQuery || searchable(person).includes(normalizedQuery))
    );
    const ordered = orderRecipientsForViewer({
      campaignId,
      canonicalViewerId: viewer.key.toLowerCase() as Hex,
      recipients: matched
    }).sort((left, right) => {
      if (!normalizedQuery) return 0;
      return queryRank(left, normalizedQuery) - queryRank(right, normalizedQuery);
    });
    const exposureId = randomUUID();
    const orderedKeys = ordered.map((person) => person.canonicalRecipientId);
    const exposureHash = domainHash("TAKE_RECIPIENT_EXPOSURE_V0", {
      exposureId,
      experimentId: experiment.id,
      campaignId,
      viewerIdentityId,
      query: normalizedQuery,
      orderedKeys
    });
    await this.db.insert(schema.recipientDiscoveryExposures).values({
      id: exposureId,
      experimentId: experiment.id,
      campaignId,
      viewerIdentityId,
      query: normalizedQuery,
      orderedRecipientKeys: orderedKeys,
      exposureHash
    });
    return {
      experimentVersion: TAKE_EXPERIMENT_VERSION,
      exposureId,
      exposureHash,
      recipients: ordered.map(({ canonicalRecipientId: _key, ...person }) => person)
    };
  }

  private validateObservations(input: CampaignExperimentDraftV0, recipientKeys: string[], campaignStart: Date) {
    const expected = new Set(recipientKeys);
    const supplied = new Set<string>();
    for (const observation of input.popularityObservations) {
      const key = observation.canonicalRecipientKey.toLowerCase();
      if (!expected.has(key) || supplied.has(key)) {
        throw new ServiceError("POPULARITY_OBSERVATION_SCOPE_INVALID", "Observations must map one-to-one to rostered recipients", 400);
      }
      supplied.add(key);
      if (Object.keys(observation.provenance).length === 0) {
        throw new ServiceError("POPULARITY_PROVENANCE_REQUIRED", "Every popularity observation requires provenance", 400);
      }
      if (new Date(observation.observedAt) >= campaignStart) {
        throw new ServiceError("POPULARITY_OBSERVED_TOO_LATE", "Popularity observations must predate campaign start", 409);
      }
      if (input.popularityProxy === "ORGANIZER_FAMILIARITY") {
        organizerFamiliaritySchema.parse(observation.value);
      }
    }
    if (supplied.size !== expected.size) {
      throw new ServiceError("POPULARITY_OBSERVATIONS_INCOMPLETE", "Every rostered recipient requires one preregistered observation", 409);
    }
  }

  private async eligibleRecipientKeys(snapshotId: string) {
    const members = await this.db.select({ key: schema.eligibilitySnapshotMembers.canonicalSubjectKey })
      .from(schema.eligibilitySnapshotMembers)
      .where(and(
        eq(schema.eligibilitySnapshotMembers.snapshotId, snapshotId),
        eq(schema.eligibilitySnapshotMembers.eligible, true)
      ));
    const keys = [...new Set(members.map((member) => member.key.toLowerCase()))].sort();
    if (keys.length === 0) {
      throw new ServiceError("RECIPIENT_ROSTER_EMPTY", "V0 requires at least one eligible rostered recipient", 409);
    }
    return keys;
  }

  private async personForMember(member: typeof schema.eligibilitySnapshotMembers.$inferSelect) {
    if (member.takeIdentityId) {
      const [person] = await this.db.select({
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        username: schema.socialAccounts.username
      }).from(schema.takeIdentities)
        .innerJoin(schema.users, eq(schema.users.id, schema.takeIdentities.userId))
        .leftJoin(schema.socialAccounts, and(
          eq(schema.socialAccounts.takeIdentityId, schema.takeIdentities.id),
          eq(schema.socialAccounts.isActive, true)
        ))
        .where(eq(schema.takeIdentities.id, member.takeIdentityId)).limit(1);
      return {
        canonicalRecipientId: member.canonicalSubjectKey.toLowerCase() as Hex,
        recipient: { type: "take_identity" as const, takeIdentityId: member.takeIdentityId },
        displayName: person?.displayName ?? person?.username ?? "TAKE member",
        username: person?.username ?? null,
        avatarUrl: person?.avatarUrl ?? null,
        joined: true
      };
    }
    if (member.externalIdentityId) {
      const [person] = await this.db.select().from(schema.externalIdentities)
        .where(eq(schema.externalIdentities.id, member.externalIdentityId)).limit(1);
      return {
        canonicalRecipientId: member.canonicalSubjectKey.toLowerCase() as Hex,
        recipient: { type: "external_identity" as const, externalIdentityId: member.externalIdentityId },
        displayName: person?.displayName ?? person?.currentUsername ?? "TAKE recipient",
        username: person?.currentUsername ?? null,
        avatarUrl: person?.avatarUrl ?? null,
        joined: Boolean(person?.takeIdentityId)
      };
    }
    return {
      canonicalRecipientId: member.canonicalSubjectKey.toLowerCase() as Hex,
      recipient: { type: "subject_key" as const, subjectKey: member.subjectKey },
      displayName: "Rostered recipient",
      username: null,
      avatarUrl: null,
      joined: false
    };
  }

  private async getSnapshot(campaignId: string, snapshotId: string, subject: "NOMINATOR" | "RECIPIENT") {
    const [snapshot] = await this.db.select().from(schema.eligibilitySnapshots).where(and(
      eq(schema.eligibilitySnapshots.id, snapshotId),
      eq(schema.eligibilitySnapshots.campaignId, campaignId),
      eq(schema.eligibilitySnapshots.subject, subject)
    )).limit(1);
    if (!snapshot) notFound(`${subject.toLowerCase()} snapshot not found`);
    return snapshot;
  }

  private async getExperiment(campaignId: string, required?: true): Promise<typeof schema.campaignExperiments.$inferSelect>;
  private async getExperiment(campaignId: string, required: false): Promise<typeof schema.campaignExperiments.$inferSelect | undefined>;
  private async getExperiment(campaignId: string, required = true) {
    const [experiment] = await this.db.select().from(schema.campaignExperiments)
      .where(eq(schema.campaignExperiments.campaignId, campaignId)).limit(1);
    if (!experiment && required) notFound("Campaign experiment not found");
    return experiment;
  }

  private async getCampaign(campaignId: string) {
    const [campaign] = await this.db.select().from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId)).limit(1);
    if (!campaign) notFound("Campaign not found");
    return campaign;
  }
}

function buildProtocol(input: {
  campaignId: string;
  mechanismConfigId: string;
  input: CampaignExperimentDraftV0;
  resource: typeof schema.campaignResources.$inferSelect;
  giverSnapshot: typeof schema.eligibilitySnapshots.$inferSelect;
  recipientSnapshot: typeof schema.eligibilitySnapshots.$inferSelect;
}): CampaignExperimentProtocolV0 {
  return campaignExperimentProtocolV0Schema.parse({
    experimentVersion: TAKE_EXPERIMENT_VERSION,
    campaignId: input.campaignId,
    mechanismConfigId: input.mechanismConfigId,
    variant: input.input.variant,
    resource: { type: input.resource.type, name: input.resource.name, seatCount: input.resource.quantity },
    eligibility: {
      giverSnapshotId: input.giverSnapshot.id,
      giverRoot: input.giverSnapshot.root,
      recipientSnapshotId: input.recipientSnapshot.id,
      recipientRoot: input.recipientSnapshot.root,
      cutoffAt: input.giverSnapshot.cutoffAt?.toISOString()
    },
    nomination: { takesPerEligibleCanonicalGiver: 1, recipientPopulation: "ROSTERED" },
    activeInformationPolicy: "HIDE_NOMINATION_DERIVED_SOCIAL_PROOF",
    recipientOrderingPolicy: "PER_VIEWER_DETERMINISTIC_SUPPORT_INDEPENDENT",
    allocation: { strategyId: "RAW_UNIQUE_SUPPORT", strategyVersion: "2" },
    popularity: {
      primaryProxy: "X_FOLLOWER_COUNT",
      selectedProxy: input.input.popularityProxy,
      fallbackScale: FALLBACK_SCALE,
      affectsMechanism: false
    },
    primaryResearchQuestions: PRIMARY_RESEARCH_QUESTIONS_V0,
    operationalWarnings: {
      popularitySpearmanLowerBound: 0.7,
      winnerOverlap: 0.8,
      topDecileSeatShareMultiple: 3,
      interpretation: "OPERATIONAL_HEURISTIC_NOT_SCIENTIFIC_DEFINITION"
    },
    informationModel: {
      productHidesActiveSupport: true,
      cryptographicBallotSecrecy: false,
      chainEventsMayBeReconstructed: true
    }
  });
}

function observationValues(input: {
  experimentId: string;
  campaignId: string;
  proxyType: CampaignExperimentDraftV0["popularityProxy"];
  observation: CampaignExperimentDraftV0["popularityObservations"][number];
}) {
  const collectedAt = new Date();
  const value = {
    experimentId: input.experimentId,
    campaignId: input.campaignId,
    canonicalRecipientKey: input.observation.canonicalRecipientKey.toLowerCase(),
    proxyType: input.proxyType,
    numericValue: input.observation.value,
    observedAt: new Date(input.observation.observedAt),
    collectedAt,
    provenance: input.observation.provenance
  };
  return {
    ...value,
    observationHash: domainHash("TAKE_EXPERIMENT_CONTEXT_V0", {
      ...value,
      observedAt: value.observedAt.toISOString(),
      collectedAt: value.collectedAt.toISOString()
    })
  };
}

function serializeExperiment(experiment: typeof schema.campaignExperiments.$inferSelect) {
  return {
    id: experiment.id,
    campaignId: experiment.campaignId,
    experimentVersion: experiment.experimentVersion,
    variant: experiment.variant,
    status: experiment.status,
    protocol: campaignExperimentProtocolV0Schema.parse(experiment.canonicalProtocol),
    protocolHash: experiment.protocolHash,
    createdAt: experiment.createdAt.toISOString(),
    lockedAt: experiment.lockedAt?.toISOString() ?? null
  };
}

function searchable(person: { displayName: string; username: string | null }) {
  return `${person.displayName} ${person.username ?? ""}`.toLowerCase();
}

function queryRank(person: { displayName: string; username: string | null }, query: string) {
  const username = person.username?.toLowerCase().replace(/^@/, "") ?? "";
  const normalized = query.replace(/^@/, "");
  const name = person.displayName.toLowerCase();
  if (username === normalized) return 0;
  if (username.startsWith(normalized)) return 1;
  if (name.startsWith(query)) return 2;
  return 3;
}
