import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

export const campaignStatusEnum = pgEnum("campaign_status", [
  "DRAFT",
  "CREATED",
  "ACTIVE",
  "CLOSED",
  "ALLOCATING",
  "FINALIZED",
  "CANCELLED"
]);

export const eligibilityModeEnum = pgEnum("eligibility_mode", [
  "OPEN_REGISTERED",
  "MERKLE_ALLOWLIST",
  "ORGANIZER_APPROVED",
  "EXTERNAL_ALLOWED"
]);

export const nominationVisibilityModeEnum = pgEnum("nomination_visibility_mode", [
  "PUBLIC",
  "SEALED"
]);

export const nominationStatusEnum = pgEnum("nomination_status", [
  "PREPARING",
  "AWAITING_SIGNATURE",
  "SUBMITTED",
  "CHAIN_CONFIRMED",
  "INDEXING_DELAYED",
  "CONFIRMED",
  "FAILED"
]);

export const organizationRoleEnum = pgEnum("organization_role", ["OWNER", "ADMIN", "MEMBER"]);

export const allocationRunStatusEnum = pgEnum("allocation_run_status", [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "FINALIZED"
]);

export const mechanismConfigStatusEnum = pgEnum("mechanism_config_status", [
  "DRAFT",
  "LOCKED",
  "SUPERSEDED"
]);

export const eligibilitySnapshotStatusEnum = pgEnum("eligibility_snapshot_status", [
  "COLLECTING",
  "EVALUATING",
  "READY",
  "LOCKED",
  "FAILED"
]);

export const eligibilityDecisionEnum = pgEnum("eligibility_decision", [
  "PASS",
  "FAIL",
  "UNKNOWN"
]);

export const chainFinalityStatusEnum = pgEnum("chain_finality_status", [
  "UNCONFIRMED",
  "FINALIZED",
  "ORPHANED"
]);

export const graphSignalStatusEnum = pgEnum("graph_signal_status", [
  "AUTO_CLEARED",
  "NEEDS_REVIEW",
  "NOT_RUN",
  "CONFIRMED_MANIPULATION",
  "DISMISSED"
]);

export const reviewCaseStatusEnum = pgEnum("review_case_status", [
  "OPEN",
  "UNDER_REVIEW",
  "RESOLVED",
  "APPEALED",
  "CLOSED"
]);

export const randomnessStatusEnum = pgEnum("randomness_status", [
  "COMMITTED",
  "FETCHING",
  "VERIFIED",
  "FAILED"
]);

export const experimentStatusEnum = pgEnum("experiment_status", ["DRAFT", "LOCKED"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  privyUserId: varchar("privy_user_id", { length: 191 }).notNull().unique(),
  displayName: varchar("display_name", { length: 160 }),
  avatarUrl: text("avatar_url"),
  status: varchar("status", { length: 32 }).notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const takeIdentities = pgTable("take_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  protocolIdentityKey: varchar("protocol_identity_key", { length: 66 }).notNull().unique(),
  creationNonce: varchar("creation_nonce", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userIdx: uniqueIndex("take_identities_user_id_idx").on(table.userId)
}));

export const socialAccounts = pgTable("social_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  takeIdentityId: uuid("take_identity_id").notNull().references(() => takeIdentities.id, {
    onDelete: "cascade"
  }),
  provider: varchar("provider", { length: 32 }).notNull(),
  providerUserId: varchar("provider_user_id", { length: 191 }).notNull(),
  username: varchar("username", { length: 128 }),
  displayName: varchar("display_name", { length: 160 }),
  avatarUrl: text("avatar_url"),
  isActive: boolean("is_active").notNull().default(true),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull().defaultNow(),
  lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  providerUserIdx: uniqueIndex("social_accounts_provider_user_id_idx").on(
    table.provider,
    table.providerUserId
  )
}));

export const wallets = pgTable("wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  takeIdentityId: uuid("take_identity_id").notNull().references(() => takeIdentities.id, {
    onDelete: "cascade"
  }),
  privyWalletId: varchar("privy_wallet_id", { length: 191 }),
  address: varchar("address", { length: 42 }).notNull(),
  walletType: varchar("wallet_type", { length: 32 }).notNull(),
  chainType: varchar("chain_type", { length: 32 }).notNull().default("ethereum"),
  isPrimary: boolean("is_primary").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull().defaultNow(),
  lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  addressIdx: uniqueIndex("wallets_address_idx").on(table.address),
  identityIdx: index("wallets_take_identity_id_idx").on(table.takeIdentityId)
}));

export const externalIdentities = pgTable("external_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: varchar("provider", { length: 32 }).notNull(),
  immutableProviderUserId: varchar("immutable_provider_user_id", { length: 191 }).notNull(),
  externalIdentityKey: varchar("external_identity_key", { length: 66 }).notNull().unique(),
  takeIdentityId: uuid("take_identity_id").references(() => takeIdentities.id, {
    onDelete: "set null"
  }),
  currentUsername: varchar("current_username", { length: 128 }),
  displayName: varchar("display_name", { length: 160 }),
  avatarUrl: text("avatar_url"),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull().defaultNow(),
  lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  providerUserIdx: uniqueIndex("external_identities_provider_user_id_idx").on(
    table.provider,
    table.immutableProviderUserId
  ),
  takeIdentityIdx: index("external_identities_take_identity_id_idx").on(table.takeIdentityId)
}));

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 96 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const organizationMembers = pgTable("organization_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade"
  }),
  takeIdentityId: uuid("take_identity_id").notNull().references(() => takeIdentities.id, {
    onDelete: "cascade"
  }),
  role: organizationRoleEnum("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  memberIdx: uniqueIndex("organization_members_unique_idx").on(
    table.organizationId,
    table.takeIdentityId
  )
}));

export const identityAllowlists = pgTable("identity_allowlists", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade"
  }),
  name: varchar("name", { length: 160 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("DRAFT"),
  artifactHash: varchar("artifact_hash", { length: 66 }),
  createdByIdentityId: uuid("created_by_identity_id").notNull().references(() => takeIdentities.id),
  lockedByIdentityId: uuid("locked_by_identity_id").references(() => takeIdentities.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true })
}, (table) => ({
  organizationIdx: index("identity_allowlists_organization_idx").on(table.organizationId, table.status)
}));

export const identityAllowlistMembers = pgTable("identity_allowlist_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  allowlistId: uuid("allowlist_id").notNull().references(() => identityAllowlists.id, {
    onDelete: "cascade"
  }),
  subjectKey: varchar("subject_key", { length: 66 }).notNull(),
  takeIdentityId: uuid("take_identity_id").references(() => takeIdentities.id, { onDelete: "set null" }),
  externalIdentityId: uuid("external_identity_id").references(() => externalIdentities.id, {
    onDelete: "set null"
  }),
  source: varchar("source", { length: 32 }).notNull().default("ORGANIZER"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  subjectIdx: uniqueIndex("identity_allowlist_members_subject_idx").on(table.allowlistId, table.subjectKey)
}));

export const discordGuildIntegrations = pgTable("discord_guild_integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade"
  }),
  guildId: varchar("guild_id", { length: 20 }).notNull(),
  guildName: varchar("guild_name", { length: 160 }),
  status: varchar("status", { length: 32 }).notNull().default("PENDING"),
  permissions: jsonb("permissions").notNull().default(sql`'[]'::jsonb`),
  installedByIdentityId: uuid("installed_by_identity_id").notNull().references(() => takeIdentities.id),
  installedAt: timestamp("installed_at", { withTimezone: true }),
  lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
  lastErrorCode: varchar("last_error_code", { length: 96 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  guildIdx: uniqueIndex("discord_guild_integrations_org_guild_idx").on(
    table.organizationId,
    table.guildId
  )
}));

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  createdByIdentityId: uuid("created_by_identity_id").notNull().references(() => takeIdentities.id),
  campaignRequestId: uuid("campaign_request_id"),
  onchainCampaignId: bigint("onchain_campaign_id", { mode: "bigint" }),
  chainId: integer("chain_id"),
  managerContractAddress: varchar("manager_contract_address", { length: 42 }),
  managerVersion: varchar("manager_version", { length: 32 }).notNull().default("LEGACY_V1"),
  mechanismConfigId: uuid("mechanism_config_id"),
  experimentId: uuid("experiment_id"),
  status: campaignStatusEnum("status").notNull().default("DRAFT"),
  title: varchar("title", { length: 160 }).notNull(),
  description: text("description"),
  metadataUri: text("metadata_uri"),
  metadataHash: varchar("metadata_hash", { length: 66 }),
  rulesHash: varchar("rules_hash", { length: 66 }),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  nominationLimit: integer("nomination_limit").notNull().default(1),
  nominatorEligibilityMode: eligibilityModeEnum("nominator_eligibility_mode").notNull(),
  recipientEligibilityMode: eligibilityModeEnum("recipient_eligibility_mode").notNull(),
  nominationVisibilityMode: nominationVisibilityModeEnum("nomination_visibility_mode").notNull(),
  nominatorEligibilityRoot: varchar("nominator_eligibility_root", { length: 66 }),
  recipientEligibilityRoot: varchar("recipient_eligibility_root", { length: 66 }),
  finalResultHash: varchar("final_result_hash", { length: 66 }),
  eligibilityDescription: text("eligibility_description"),
  imageUrl: text("image_url"),
  launchApprovedByIdentityId: uuid("launch_approved_by_identity_id").references(() => takeIdentities.id),
  launchApprovedAt: timestamp("launch_approved_at", { withTimezone: true }),
  onchainOperatorWalletAddress: varchar("onchain_operator_wallet_address", { length: 42 }),
  onchainOrganizerAddress: varchar("onchain_organizer_address", { length: 42 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  onchainIdx: uniqueIndex("campaigns_chain_manager_onchain_idx").on(
    table.chainId,
    table.managerContractAddress,
    table.onchainCampaignId
  ),
  statusIdx: index("campaigns_status_idx").on(table.status),
  organizationIdx: index("campaigns_organization_id_idx").on(table.organizationId)
}));

export const campaignRequests = pgTable("campaign_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  requestedByIdentityId: uuid("requested_by_identity_id").notNull().references(() => takeIdentities.id),
  status: varchar("status", { length: 32 }).notNull().default("DRAFT"),
  title: varchar("title", { length: 160 }).notNull(),
  description: text("description").notNull(),
  resourceName: varchar("resource_name", { length: 160 }).notNull(),
  resourceDescription: text("resource_description"),
  seatCount: integer("seat_count").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  selectorMode: varchar("selector_mode", { length: 32 }).notNull().default("DISJOINT"),
  eligibilityDescription: text("eligibility_description"),
  operatorNote: text("operator_note"),
  provisionedCampaignId: uuid("provisioned_campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  organizationIdx: index("campaign_requests_organization_idx").on(table.organizationId, table.status),
  requesterIdx: index("campaign_requests_requester_idx").on(table.requestedByIdentityId, table.createdAt)
}));

export const campaignLifecycleIntents = pgTable("campaign_lifecycle_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 24 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("PREPARING"),
  chainId: integer("chain_id").notNull(),
  contractAddress: varchar("contract_address", { length: 42 }).notNull(),
  requiredFromAddress: varchar("required_from_address", { length: 42 }),
  expectedCalldata: text("expected_calldata").notNull(),
  expectedRulesHash: varchar("expected_rules_hash", { length: 66 }),
  transactionHash: varchar("transaction_hash", { length: 66 }).unique(),
  eventName: varchar("event_name", { length: 96 }).notNull(),
  eventLogIndex: integer("event_log_index"),
  eventBlockNumber: bigint("event_block_number", { mode: "bigint" }),
  emittedOnchainCampaignId: bigint("emitted_onchain_campaign_id", { mode: "bigint" }),
  emittedOrganizerAddress: varchar("emitted_organizer_address", { length: 42 }),
  errorCode: varchar("error_code", { length: 96 }),
  errorMessage: text("error_message"),
  createdByIdentityId: uuid("created_by_identity_id").notNull().references(() => takeIdentities.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  indexedAt: timestamp("indexed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  actionIdx: uniqueIndex("campaign_lifecycle_intents_action_idx").on(table.campaignId, table.action),
  transactionIdx: index("campaign_lifecycle_intents_transaction_idx").on(table.chainId, table.transactionHash)
}));

export const campaignMechanismConfigs = pgTable("campaign_mechanism_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  mechanismVersion: varchar("mechanism_version", { length: 64 }).notNull(),
  status: mechanismConfigStatusEnum("status").notNull().default("DRAFT"),
  canonicalConfig: jsonb("canonical_config").notNull(),
  configHash: varchar("config_hash", { length: 66 }).notNull(),
  supersedesId: uuid("supersedes_id"),
  createdByIdentityId: uuid("created_by_identity_id").notNull().references(() => takeIdentities.id),
  lockedByIdentityId: uuid("locked_by_identity_id").references(() => takeIdentities.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true })
}, (table) => ({
  revisionIdx: uniqueIndex("campaign_mechanism_configs_revision_idx").on(table.campaignId, table.revision),
  hashIdx: uniqueIndex("campaign_mechanism_configs_hash_idx").on(table.configHash),
  campaignStatusIdx: index("campaign_mechanism_configs_campaign_status_idx").on(table.campaignId, table.status)
}));

export const campaignResources = pgTable("campaign_resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 64 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  quantity: integer("quantity").notNull(),
  unitValue: varchar("unit_value", { length: 96 }),
  chain: varchar("chain", { length: 64 }),
  contractAddress: varchar("contract_address", { length: 42 }),
  tokenId: varchar("token_id", { length: 128 }),
  claimInstructions: text("claim_instructions"),
  escrowStatus: varchar("escrow_status", { length: 32 }).notNull().default("NONE")
});

export const eligibilitySnapshots = pgTable("eligibility_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  mechanismConfigId: uuid("mechanism_config_id").references(() => campaignMechanismConfigs.id, {
    onDelete: "restrict"
  }),
  subject: varchar("subject", { length: 32 }).notNull(),
  mode: eligibilityModeEnum("mode").notNull(),
  status: eligibilitySnapshotStatusEnum("status").notNull().default("COLLECTING"),
  root: varchar("root", { length: 66 }),
  snapshotHash: varchar("snapshot_hash", { length: 66 }).notNull(),
  policyHash: varchar("policy_hash", { length: 66 }),
  canonicalArtifact: jsonb("canonical_artifact"),
  cutoffAt: timestamp("cutoff_at", { withTimezone: true }),
  candidateCount: integer("candidate_count").notNull().default(0),
  eligibleCount: integer("eligible_count").notNull().default(0),
  lockedByIdentityId: uuid("locked_by_identity_id").references(() => takeIdentities.id),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  campaignSubjectIdx: index("eligibility_snapshots_campaign_subject_idx").on(
    table.campaignId,
    table.subject
  )
}));

export const evidenceObservations = pgTable("evidence_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
  mechanismConfigId: uuid("mechanism_config_id").references(() => campaignMechanismConfigs.id, {
    onDelete: "cascade"
  }),
  subjectKey: varchar("subject_key", { length: 66 }).notNull(),
  takeIdentityId: uuid("take_identity_id").references(() => takeIdentities.id, { onDelete: "set null" }),
  externalIdentityId: uuid("external_identity_id").references(() => externalIdentities.id, {
    onDelete: "set null"
  }),
  source: varchar("source", { length: 64 }).notNull(),
  fact: varchar("fact", { length: 96 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  scope: jsonb("scope").notNull().default(sql`'{}'::jsonb`),
  value: jsonb("value"),
  provenance: jsonb("provenance").notNull().default(sql`'{}'::jsonb`),
  providerObservedAt: timestamp("provider_observed_at", { withTimezone: true }),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  payloadHash: varchar("payload_hash", { length: 66 }).notNull(),
  evidenceHash: varchar("evidence_hash", { length: 66 }).notNull(),
  deduplicationKey: varchar("deduplication_key", { length: 66 }).notNull(),
  errorCode: varchar("error_code", { length: 96 }),
  retentionClass: varchar("retention_class", { length: 32 }).notNull().default("STANDARD"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  evidenceHashIdx: uniqueIndex("evidence_observations_hash_idx").on(table.evidenceHash),
  deduplicationIdx: uniqueIndex("evidence_observations_deduplication_idx").on(table.deduplicationKey),
  subjectFactIdx: index("evidence_observations_subject_fact_idx").on(table.subjectKey, table.fact),
  campaignIdx: index("evidence_observations_campaign_idx").on(table.campaignId)
}));

export const eligibilitySnapshotMembers = pgTable("eligibility_snapshot_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id").notNull().references(() => eligibilitySnapshots.id, {
    onDelete: "cascade"
  }),
  subjectKey: varchar("subject_key", { length: 66 }).notNull(),
  canonicalSubjectKey: varchar("canonical_subject_key", { length: 66 }).notNull(),
  takeIdentityId: uuid("take_identity_id").references(() => takeIdentities.id, { onDelete: "set null" }),
  externalIdentityId: uuid("external_identity_id").references(() => externalIdentities.id, {
    onDelete: "set null"
  }),
  decision: eligibilityDecisionEnum("decision").notNull(),
  eligible: boolean("eligible").notNull().default(false),
  ordinal: integer("ordinal").notNull(),
  merkleLeaf: varchar("merkle_leaf", { length: 66 }),
  merkleProof: jsonb("merkle_proof").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  subjectIdx: uniqueIndex("eligibility_snapshot_members_subject_idx").on(table.snapshotId, table.subjectKey),
  ordinalIdx: uniqueIndex("eligibility_snapshot_members_ordinal_idx").on(table.snapshotId, table.ordinal),
  takeIdentityIdx: index("eligibility_snapshot_members_take_identity_idx").on(table.takeIdentityId)
}));

export const eligibilityEvaluations = pgTable("eligibility_evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id").notNull().references(() => eligibilitySnapshots.id, {
    onDelete: "cascade"
  }),
  memberId: uuid("member_id").notNull().references(() => eligibilitySnapshotMembers.id, {
    onDelete: "cascade"
  }),
  ruleId: varchar("rule_id", { length: 96 }).notNull(),
  ruleType: varchar("rule_type", { length: 96 }).notNull(),
  ruleVersion: integer("rule_version").notNull(),
  decision: eligibilityDecisionEnum("decision").notNull(),
  reasonCode: varchar("reason_code", { length: 96 }).notNull(),
  evidenceObservationIds: jsonb("evidence_observation_ids").notNull().default(sql`'[]'::jsonb`),
  publicExplanation: text("public_explanation").notNull(),
  internalDetails: jsonb("internal_details"),
  evaluatorVersion: varchar("evaluator_version", { length: 32 }).notNull(),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  ruleIdx: uniqueIndex("eligibility_evaluations_member_rule_idx").on(table.memberId, table.ruleId),
  snapshotDecisionIdx: index("eligibility_evaluations_snapshot_decision_idx").on(
    table.snapshotId,
    table.decision
  )
}));

export const campaignEligibilityPolicies = pgTable("campaign_eligibility_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("DRAFT"),
  candidateAllowlistId: uuid("candidate_allowlist_id").notNull().references(() => identityAllowlists.id, {
    onDelete: "restrict"
  }),
  finalAllowlistId: uuid("final_allowlist_id").references(() => identityAllowlists.id, {
    onDelete: "restrict"
  }),
  preset: varchar("preset", { length: 64 }).notNull(),
  canonicalPolicy: jsonb("canonical_policy").notNull(),
  policyHash: varchar("policy_hash", { length: 66 }).notNull(),
  createdByIdentityId: uuid("created_by_identity_id").notNull().references(() => takeIdentities.id),
  lockedByIdentityId: uuid("locked_by_identity_id").references(() => takeIdentities.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true })
}, (table) => ({
  revisionIdx: uniqueIndex("campaign_eligibility_policies_revision_idx").on(table.campaignId, table.revision),
  hashIdx: uniqueIndex("campaign_eligibility_policies_hash_idx").on(table.policyHash),
  campaignStatusIdx: index("campaign_eligibility_policies_campaign_status_idx").on(table.campaignId, table.status)
}));

export const selectorEligibilityAssessments = pgTable("selector_eligibility_assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  policyId: uuid("policy_id").notNull().references(() => campaignEligibilityPolicies.id, { onDelete: "cascade" }),
  takeIdentityId: uuid("take_identity_id").notNull().references(() => takeIdentities.id, { onDelete: "restrict" }),
  automaticStatus: varchar("automatic_status", { length: 32 }).notNull(),
  finalStatus: varchar("final_status", { length: 32 }).notNull(),
  qualificationPath: varchar("qualification_path", { length: 32 }),
  totalPoints: integer("total_points").notNull().default(0),
  categoryScores: jsonb("category_scores").notNull().default(sql`'[]'::jsonb`),
  missingRuleIds: jsonb("missing_rule_ids").notNull().default(sql`'[]'::jsonb`),
  integrityStatus: varchar("integrity_status", { length: 32 }).notNull().default("NO_DATA"),
  integrityReasons: jsonb("integrity_reasons").notNull().default(sql`'[]'::jsonb`),
  assessmentArtifact: jsonb("assessment_artifact").notNull(),
  assessmentHash: varchar("assessment_hash", { length: 66 }).notNull(),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true })
}, (table) => ({
  policyIdentityIdx: uniqueIndex("selector_eligibility_assessments_policy_identity_idx").on(
    table.policyId,
    table.takeIdentityId
  ),
  campaignStatusIdx: index("selector_eligibility_assessments_campaign_status_idx").on(
    table.campaignId,
    table.finalStatus
  ),
  hashIdx: uniqueIndex("selector_eligibility_assessments_hash_idx").on(table.assessmentHash)
}));

export const selectorIntegrityObservations = pgTable("selector_integrity_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  policyId: uuid("policy_id").notNull().references(() => campaignEligibilityPolicies.id, { onDelete: "cascade" }),
  takeIdentityId: uuid("take_identity_id").notNull().references(() => takeIdentities.id, { onDelete: "restrict" }),
  signalType: varchar("signal_type", { length: 96 }).notNull(),
  evidenceFamily: varchar("evidence_family", { length: 64 }).notNull(),
  strength: varchar("strength", { length: 16 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("OBSERVED"),
  publicExplanation: text("public_explanation").notNull(),
  restrictedEvidence: jsonb("restricted_evidence").notNull().default(sql`'{}'::jsonb`),
  provenance: jsonb("provenance").notNull().default(sql`'{}'::jsonb`),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  observationHash: varchar("observation_hash", { length: 66 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  hashIdx: uniqueIndex("selector_integrity_observations_hash_idx").on(table.observationHash),
  identityIdx: index("selector_integrity_observations_identity_idx").on(
    table.policyId,
    table.takeIdentityId
  )
}));

export const campaignExperiments = pgTable("campaign_experiments", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  mechanismConfigId: uuid("mechanism_config_id").notNull().references(() => campaignMechanismConfigs.id, {
    onDelete: "restrict"
  }),
  giverSnapshotId: uuid("giver_snapshot_id").notNull().references(() => eligibilitySnapshots.id, {
    onDelete: "restrict"
  }),
  recipientSnapshotId: uuid("recipient_snapshot_id").notNull().references(() => eligibilitySnapshots.id, {
    onDelete: "restrict"
  }),
  experimentVersion: varchar("experiment_version", { length: 64 }).notNull(),
  variant: varchar("variant", { length: 32 }).notNull(),
  status: experimentStatusEnum("status").notNull().default("DRAFT"),
  selectedPopularityProxy: varchar("selected_popularity_proxy", { length: 64 }).notNull(),
  canonicalProtocol: jsonb("canonical_protocol").notNull(),
  protocolHash: varchar("protocol_hash", { length: 66 }).notNull(),
  createdByIdentityId: uuid("created_by_identity_id").notNull().references(() => takeIdentities.id),
  lockedByIdentityId: uuid("locked_by_identity_id").references(() => takeIdentities.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true })
}, (table) => ({
  campaignIdx: uniqueIndex("campaign_experiments_campaign_idx").on(table.campaignId),
  protocolHashIdx: uniqueIndex("campaign_experiments_protocol_hash_idx").on(table.protocolHash),
  statusIdx: index("campaign_experiments_status_idx").on(table.status)
}));

export const experimentContextObservations = pgTable("experiment_context_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  experimentId: uuid("experiment_id").notNull().references(() => campaignExperiments.id, {
    onDelete: "cascade"
  }),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  canonicalRecipientKey: varchar("canonical_recipient_key", { length: 66 }).notNull(),
  proxyType: varchar("proxy_type", { length: 64 }).notNull(),
  numericValue: bigint("numeric_value", { mode: "number" }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  provenance: jsonb("provenance").notNull().default(sql`'{}'::jsonb`),
  observationHash: varchar("observation_hash", { length: 66 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  recipientProxyIdx: uniqueIndex("experiment_context_recipient_proxy_idx").on(
    table.experimentId,
    table.canonicalRecipientKey,
    table.proxyType
  ),
  observationHashIdx: uniqueIndex("experiment_context_observation_hash_idx").on(table.observationHash),
  campaignIdx: index("experiment_context_campaign_idx").on(table.campaignId)
}));

export const recipientDiscoveryExposures = pgTable("recipient_discovery_exposures", {
  id: uuid("id").primaryKey().defaultRandom(),
  experimentId: uuid("experiment_id").notNull().references(() => campaignExperiments.id, {
    onDelete: "cascade"
  }),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  viewerIdentityId: uuid("viewer_identity_id").notNull().references(() => takeIdentities.id),
  query: text("query").notNull().default(""),
  orderedRecipientKeys: jsonb("ordered_recipient_keys").notNull(),
  exposureHash: varchar("exposure_hash", { length: 66 }).notNull(),
  servedAt: timestamp("served_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  exposureHashIdx: uniqueIndex("recipient_discovery_exposure_hash_idx").on(table.exposureHash),
  viewerCampaignIdx: index("recipient_discovery_viewer_campaign_idx").on(
    table.viewerIdentityId,
    table.campaignId,
    table.servedAt
  )
}));

export const nominationAttempts = pgTable("nomination_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  experimentId: uuid("experiment_id").references(() => campaignExperiments.id, { onDelete: "set null" }),
  giverIdentityId: uuid("giver_identity_id").notNull().references(() => takeIdentities.id),
  giverCanonicalKey: varchar("giver_canonical_key", { length: 66 }).notNull(),
  recipientTakeIdentityId: uuid("recipient_take_identity_id").references(() => takeIdentities.id),
  recipientExternalIdentityId: uuid("recipient_external_identity_id").references(
    () => externalIdentities.id
  ),
  recipientCanonicalKey: varchar("recipient_canonical_key", { length: 66 }),
  idempotencyKey: uuid("idempotency_key"),
  accepted: boolean("accepted").notNull(),
  reasonCode: varchar("reason_code", { length: 96 }).notNull(),
  details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  campaignGiverIdx: index("nomination_attempts_campaign_giver_idx").on(
    table.campaignId,
    table.giverIdentityId,
    table.createdAt
  ),
  idempotencyIdx: index("nomination_attempts_idempotency_idx").on(table.idempotencyKey)
}));

export const chainTransactions = pgTable("chain_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  chainId: integer("chain_id").notNull(),
  transactionHash: varchar("transaction_hash", { length: 66 }).notNull().unique(),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
  lifecycleIntentId: uuid("lifecycle_intent_id").references(() => campaignLifecycleIntents.id, { onDelete: "set null" }),
  action: varchar("action", { length: 32 }),
  submittedByIdentityId: uuid("submitted_by_identity_id").references(() => takeIdentities.id),
  fromAddress: varchar("from_address", { length: 42 }),
  toAddress: varchar("to_address", { length: 42 }),
  status: varchar("status", { length: 32 }).notNull().default("SUBMITTED"),
  blockNumber: bigint("block_number", { mode: "bigint" }),
  errorMessage: text("error_message"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true })
});

export const chainIndexerCursors = pgTable("chain_indexer_cursors", {
  id: uuid("id").primaryKey().defaultRandom(),
  chainId: integer("chain_id").notNull(),
  contractAddress: varchar("contract_address", { length: 42 }).notNull(),
  lastScannedBlock: bigint("last_scanned_block", { mode: "bigint" }).notNull().default(0n),
  lastFinalizedBlock: bigint("last_finalized_block", { mode: "bigint" }).notNull().default(0n),
  lastFinalizedBlockHash: varchar("last_finalized_block_hash", { length: 66 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  chainContractIdx: uniqueIndex("chain_indexer_cursors_chain_contract_idx").on(
    table.chainId,
    table.contractAddress
  )
}));

export const chainEvents = pgTable("chain_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  chainId: integer("chain_id").notNull(),
  contractAddress: varchar("contract_address", { length: 42 }).notNull(),
  eventName: varchar("event_name", { length: 96 }).notNull(),
  transactionHash: varchar("transaction_hash", { length: 66 }).notNull(),
  logIndex: integer("log_index").notNull(),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  blockHash: varchar("block_hash", { length: 66 }),
  transactionIndex: integer("transaction_index"),
  blockTimestamp: timestamp("block_timestamp", { withTimezone: true }),
  finalityStatus: chainFinalityStatusEnum("finality_status").notNull().default("UNCONFIRMED"),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  orphanedAt: timestamp("orphaned_at", { withTimezone: true }),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  indexedAt: timestamp("indexed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  eventIdx: uniqueIndex("chain_events_unique_log_idx").on(
    table.chainId,
    table.transactionHash,
    table.logIndex
  ),
  campaignLookupIdx: index("chain_events_name_block_idx").on(table.eventName, table.blockNumber)
}));

export const nominations = pgTable("nominations", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  giverIdentityId: uuid("giver_identity_id").notNull().references(() => takeIdentities.id),
  experimentId: uuid("experiment_id").references(() => campaignExperiments.id, { onDelete: "set null" }),
  nominatorSnapshotId: uuid("nominator_snapshot_id").references(() => eligibilitySnapshots.id, {
    onDelete: "restrict"
  }),
  recipientSnapshotId: uuid("recipient_snapshot_id").references(() => eligibilitySnapshots.id, {
    onDelete: "restrict"
  }),
  recipientTakeIdentityId: uuid("recipient_take_identity_id").references(() => takeIdentities.id),
  recipientExternalIdentityId: uuid("recipient_external_identity_id").references(
    () => externalIdentities.id
  ),
  idempotencyKey: uuid("idempotency_key").notNull(),
  chainId: integer("chain_id"),
  transactionHash: varchar("transaction_hash", { length: 66 }),
  logIndex: integer("log_index"),
  blockNumber: bigint("block_number", { mode: "bigint" }),
  status: nominationStatusEnum("status").notNull(),
  source: varchar("source", { length: 32 }).notNull().default("api"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  indexedAt: timestamp("indexed_at", { withTimezone: true })
}, (table) => ({
  idempotencyIdx: uniqueIndex("nominations_idempotency_key_idx").on(table.idempotencyKey),
  chainEventIdx: uniqueIndex("nominations_chain_event_idx").on(
    table.chainId,
    table.transactionHash,
    table.logIndex
  ),
  campaignGiverIdx: index("nominations_campaign_giver_idx").on(
    table.campaignId,
    table.giverIdentityId
  ),
  recipientTakeIdx: index("nominations_recipient_take_identity_idx").on(
    table.recipientTakeIdentityId
  ),
  recipientExternalIdx: index("nominations_recipient_external_identity_idx").on(
    table.recipientExternalIdentityId
  )
}));

export const nominationEdges = pgTable("nomination_edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  chainEventId: uuid("chain_event_id").notNull().references(() => chainEvents.id, { onDelete: "restrict" }),
  nominationId: uuid("nomination_id").references(() => nominations.id, { onDelete: "set null" }),
  experimentId: uuid("experiment_id").references(() => campaignExperiments.id, { onDelete: "set null" }),
  nominatorSnapshotId: uuid("nominator_snapshot_id").references(() => eligibilitySnapshots.id, {
    onDelete: "restrict"
  }),
  recipientSnapshotId: uuid("recipient_snapshot_id").references(() => eligibilitySnapshots.id, {
    onDelete: "restrict"
  }),
  chainId: integer("chain_id").notNull(),
  contractAddress: varchar("contract_address", { length: 42 }).notNull(),
  transactionHash: varchar("transaction_hash", { length: 66 }).notNull(),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  blockHash: varchar("block_hash", { length: 66 }).notNull(),
  transactionIndex: integer("transaction_index").notNull(),
  logIndex: integer("log_index").notNull(),
  blockTimestamp: timestamp("block_timestamp", { withTimezone: true }).notNull(),
  giverIdentityKey: varchar("giver_identity_key", { length: 66 }).notNull(),
  recipientIdentityKey: varchar("recipient_identity_key", { length: 66 }).notNull(),
  canonicalGiverKey: varchar("canonical_giver_key", { length: 66 }).notNull(),
  canonicalRecipientKey: varchar("canonical_recipient_key", { length: 66 }).notNull(),
  identityResolution: jsonb("identity_resolution").notNull().default(sql`'{}'::jsonb`),
  validity: varchar("validity", { length: 16 }).notNull().default("VALID"),
  invalidReason: varchar("invalid_reason", { length: 96 }),
  finalityStatus: chainFinalityStatusEnum("finality_status").notNull().default("UNCONFIRMED"),
  indexedAt: timestamp("indexed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  chainEventIdx: uniqueIndex("nomination_edges_chain_event_idx").on(table.chainEventId),
  chainLogIdx: uniqueIndex("nomination_edges_chain_log_idx").on(
    table.chainId,
    table.contractAddress,
    table.transactionHash,
    table.logIndex
  ),
  giverIdx: index("nomination_edges_campaign_giver_idx").on(table.campaignId, table.canonicalGiverKey),
  recipientIdx: index("nomination_edges_campaign_recipient_idx").on(
    table.campaignId,
    table.canonicalRecipientKey
  ),
  orderIdx: index("nomination_edges_campaign_order_idx").on(
    table.campaignId,
    table.blockNumber,
    table.transactionIndex,
    table.logIndex
  )
}));

export const graphSnapshots = pgTable("graph_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  edgeCutoffBlock: bigint("edge_cutoff_block", { mode: "bigint" }).notNull(),
  edgeCutoffBlockHash: varchar("edge_cutoff_block_hash", { length: 66 }).notNull(),
  inputHash: varchar("input_hash", { length: 66 }).notNull(),
  algorithmVersion: varchar("algorithm_version", { length: 32 }).notNull(),
  artifact: jsonb("artifact").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  inputHashIdx: uniqueIndex("graph_snapshots_input_hash_idx").on(table.inputHash),
  campaignIdx: index("graph_snapshots_campaign_idx").on(table.campaignId, table.createdAt)
}));

export const graphSignalObservations = pgTable("graph_signal_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  graphSnapshotId: uuid("graph_snapshot_id").notNull().references(() => graphSnapshots.id, {
    onDelete: "cascade"
  }),
  signalHash: varchar("signal_hash", { length: 66 }).notNull(),
  signalType: varchar("signal_type", { length: 96 }).notNull(),
  algorithmVersion: varchar("algorithm_version", { length: 32 }).notNull(),
  status: graphSignalStatusEnum("status").notNull(),
  strengthBasisPoints: integer("strength_basis_points"),
  evidence: jsonb("evidence").notNull().default(sql`'{}'::jsonb`),
  limitation: text("limitation"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  hashIdx: uniqueIndex("graph_signal_observations_hash_idx").on(table.signalHash),
  snapshotStatusIdx: index("graph_signal_observations_snapshot_status_idx").on(
    table.graphSnapshotId,
    table.status
  )
}));

export const graphSignalSubjects = pgTable("graph_signal_subjects", {
  id: uuid("id").primaryKey().defaultRandom(),
  graphSignalId: uuid("graph_signal_id").notNull().references(() => graphSignalObservations.id, {
    onDelete: "cascade"
  }),
  subjectKey: varchar("subject_key", { length: 66 }).notNull(),
  nominationEdgeId: uuid("nomination_edge_id").references(() => nominationEdges.id, {
    onDelete: "set null"
  })
}, (table) => ({
  subjectIdx: uniqueIndex("graph_signal_subjects_unique_idx").on(
    table.graphSignalId,
    table.subjectKey,
    table.nominationEdgeId
  ),
  lookupIdx: index("graph_signal_subjects_lookup_idx").on(table.subjectKey)
}));

export const reviewCases = pgTable("review_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  graphSignalId: uuid("graph_signal_id").references(() => graphSignalObservations.id, {
    onDelete: "set null"
  }),
  eligibilityPolicyId: uuid("eligibility_policy_id").references(() => campaignEligibilityPolicies.id, {
    onDelete: "cascade"
  }),
  eligibilityAssessmentId: uuid("eligibility_assessment_id").references(() => selectorEligibilityAssessments.id, {
    onDelete: "cascade"
  }),
  subjectIdentityId: uuid("subject_identity_id").references(() => takeIdentities.id, {
    onDelete: "restrict"
  }),
  caseType: varchar("case_type", { length: 96 }).notNull(),
  status: reviewCaseStatusEnum("status").notNull().default("OPEN"),
  publicSummary: text("public_summary"),
  restrictedSummary: text("restricted_summary"),
  openedByIdentityId: uuid("opened_by_identity_id").references(() => takeIdentities.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  campaignStatusIdx: index("review_cases_campaign_status_idx").on(table.campaignId, table.status)
}));

export const reviewCaseEvents = pgTable("review_case_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewCaseId: uuid("review_case_id").notNull().references(() => reviewCases.id, {
    onDelete: "cascade"
  }),
  sequence: integer("sequence").notNull(),
  eventType: varchar("event_type", { length: 96 }).notNull(),
  actorIdentityId: uuid("actor_identity_id").references(() => takeIdentities.id),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  sequenceIdx: uniqueIndex("review_case_events_sequence_idx").on(table.reviewCaseId, table.sequence)
}));

export const reviewDecisions = pgTable("review_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewCaseId: uuid("review_case_id").notNull().references(() => reviewCases.id, {
    onDelete: "cascade"
  }),
  revision: integer("revision").notNull(),
  decision: varchar("decision", { length: 64 }).notNull(),
  reasonCode: varchar("reason_code", { length: 96 }).notNull(),
  publicExplanation: text("public_explanation").notNull(),
  restrictedEvidence: jsonb("restricted_evidence").notNull().default(sql`'{}'::jsonb`),
  decidedByIdentityId: uuid("decided_by_identity_id").notNull().references(() => takeIdentities.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  revisionIdx: uniqueIndex("review_decisions_revision_idx").on(table.reviewCaseId, table.revision)
}));

export const selectorEvidenceSubmissions = pgTable("selector_evidence_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  policyId: uuid("policy_id").notNull().references(() => campaignEligibilityPolicies.id, { onDelete: "cascade" }),
  assessmentId: uuid("assessment_id").notNull().references(() => selectorEligibilityAssessments.id, {
    onDelete: "cascade"
  }),
  reviewCaseId: uuid("review_case_id").notNull().references(() => reviewCases.id, { onDelete: "cascade" }),
  submittedByIdentityId: uuid("submitted_by_identity_id").notNull().references(() => takeIdentities.id),
  submissionType: varchar("submission_type", { length: 40 }).notNull(),
  targetRuleId: varchar("target_rule_id", { length: 96 }),
  evidenceType: varchar("evidence_type", { length: 64 }),
  explanation: text("explanation").notNull(),
  links: jsonb("links").notNull().default(sql`'[]'::jsonb`),
  status: varchar("status", { length: 32 }).notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  reviewCaseIdx: uniqueIndex("selector_evidence_submissions_review_case_idx").on(table.reviewCaseId),
  assessmentIdx: index("selector_evidence_submissions_assessment_idx").on(table.assessmentId, table.status)
}));

export const randomnessArtifacts = pgTable("randomness_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  mechanismConfigId: uuid("mechanism_config_id").notNull().references(() => campaignMechanismConfigs.id, {
    onDelete: "restrict"
  }),
  source: varchar("source", { length: 32 }).notNull(),
  network: varchar("network", { length: 32 }).notNull(),
  chainHash: varchar("chain_hash", { length: 66 }).notNull(),
  round: bigint("round", { mode: "bigint" }).notNull(),
  notBefore: timestamp("not_before", { withTimezone: true }).notNull(),
  status: randomnessStatusEnum("status").notNull().default("COMMITTED"),
  randomness: varchar("randomness", { length: 66 }),
  signature: text("signature"),
  previousSignature: text("previous_signature"),
  publicKey: text("public_key"),
  schemeId: varchar("scheme_id", { length: 96 }),
  periodSeconds: integer("period_seconds"),
  genesisTime: bigint("genesis_time", { mode: "bigint" }),
  relayResponses: jsonb("relay_responses").notNull().default(sql`'[]'::jsonb`),
  artifactHash: varchar("artifact_hash", { length: 66 }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  errorCode: varchar("error_code", { length: 96 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  mechanismIdx: uniqueIndex("randomness_artifacts_mechanism_idx").on(table.mechanismConfigId),
  roundIdx: index("randomness_artifacts_round_lookup_idx").on(table.network, table.chainHash, table.round),
  campaignIdx: index("randomness_artifacts_campaign_idx").on(table.campaignId)
}));

export const allocationRuns = pgTable("allocation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  mechanismConfigId: uuid("mechanism_config_id").references(() => campaignMechanismConfigs.id, {
    onDelete: "restrict"
  }),
  nominatorSnapshotId: uuid("nominator_snapshot_id").references(() => eligibilitySnapshots.id, {
    onDelete: "restrict"
  }),
  recipientSnapshotId: uuid("recipient_snapshot_id").references(() => eligibilitySnapshots.id, {
    onDelete: "restrict"
  }),
  graphSnapshotId: uuid("graph_snapshot_id").references(() => graphSnapshots.id, {
    onDelete: "restrict"
  }),
  randomnessArtifactId: uuid("randomness_artifact_id").references(() => randomnessArtifacts.id, {
    onDelete: "restrict"
  }),
  strategyId: varchar("strategy_id", { length: 96 }).notNull(),
  strategyVersion: varchar("strategy_version", { length: 32 }).notNull(),
  configuration: jsonb("configuration").notNull().default(sql`'{}'::jsonb`),
  inputSnapshotHash: varchar("input_snapshot_hash", { length: 66 }).notNull(),
  randomnessSeed: varchar("randomness_seed", { length: 128 }),
  artifactVersion: varchar("artifact_version", { length: 32 }).notNull().default("1"),
  codeVersion: varchar("code_version", { length: 96 }),
  inputArtifact: jsonb("input_artifact"),
  resultArtifact: jsonb("result_artifact"),
  status: allocationRunStatusEnum("status").notNull().default("PENDING"),
  resultHash: varchar("result_hash", { length: 66 }),
  createdByIdentityId: uuid("created_by_identity_id").references(() => takeIdentities.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true })
}, (table) => ({
  replayIdx: uniqueIndex("allocation_runs_replay_idx").on(
    table.campaignId,
    table.inputSnapshotHash,
    table.resultHash
  )
}));

export const allocationResults = pgTable("allocation_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  allocationRunId: uuid("allocation_run_id").notNull().references(() => allocationRuns.id, {
    onDelete: "cascade"
  }),
  recipientTakeIdentityId: uuid("recipient_take_identity_id").references(() => takeIdentities.id),
  recipientExternalIdentityId: uuid("recipient_external_identity_id").references(
    () => externalIdentities.id
  ),
  recipientKey: varchar("recipient_key", { length: 66 }),
  score: integer("score").notNull(),
  rank: integer("rank"),
  selectionOrder: integer("selection_order"),
  tieBreaker: varchar("tie_breaker", { length: 66 }),
  selected: boolean("selected").notNull().default(false),
  explanation: jsonb("explanation").notNull().default(sql`'{}'::jsonb`)
});

export const simulationRuns = pgTable("simulation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  mechanismConfigId: uuid("mechanism_config_id").references(() => campaignMechanismConfigs.id, {
    onDelete: "set null"
  }),
  configHash: varchar("config_hash", { length: 66 }),
  simulatorVersion: varchar("simulator_version", { length: 32 }).notNull(),
  runCount: integer("run_count").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("RUNNING"),
  report: jsonb("report"),
  reportHash: varchar("report_hash", { length: 66 }),
  killCriteriaPassed: boolean("kill_criteria_passed"),
  createdByIdentityId: uuid("created_by_identity_id").references(() => takeIdentities.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true })
}, (table) => ({
  reportHashIdx: uniqueIndex("simulation_runs_report_hash_idx").on(table.reportHash),
  campaignIdx: index("simulation_runs_campaign_idx").on(table.campaignId, table.startedAt)
}));

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipientTakeIdentityId: uuid("recipient_take_identity_id").references(() => takeIdentities.id),
  recipientExternalIdentityId: uuid("recipient_external_identity_id").references(
    () => externalIdentities.id
  ),
  type: varchar("type", { length: 64 }).notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorIdentityId: uuid("actor_identity_id").references(() => takeIdentities.id),
  organizationId: uuid("organization_id").references(() => organizations.id),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  action: varchar("action", { length: 96 }).notNull(),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
