import { evidenceHash } from "./canonical.js";
import type {
  EligibilityPolicyV1,
  EligibilityRuleV1,
  EvidenceObservationV1,
  EvidenceSource,
  RuleEvaluationV1,
  SubjectEligibilityEvaluationV1
} from "./types.js";

const DAY_MS = 86_400_000;
const DISCORD_EPOCH_MS = 1_420_070_400_000n;

export function discordSnowflakeCreatedAt(subject: string): string {
  if (!/^\d{1,20}$/.test(subject)) {
    throw new TypeError("Discord subject must be a snowflake");
  }
  const timestamp = (BigInt(subject) >> 22n) + DISCORD_EPOCH_MS;
  return new Date(Number(timestamp)).toISOString();
}

export function createEvidenceObservation(input: Omit<EvidenceObservationV1, "version" | "evidenceHash">): EvidenceObservationV1 {
  const value = {
    version: "1" as const,
    ...input
  };
  return {
    ...value,
    evidenceHash: evidenceHash(value)
  };
}

export function unavailableEvidence(input: {
  id: string;
  subjectKey: `0x${string}`;
  source: EvidenceSource;
  fact: EvidenceObservationV1["fact"];
  observedAt: string;
  collectedAt?: string;
  errorCode: string;
  scope?: Record<string, string>;
}): EvidenceObservationV1 {
  return createEvidenceObservation({
    ...input,
    collectedAt: input.collectedAt ?? input.observedAt,
    status: "UNAVAILABLE",
    value: null
  });
}

export function evaluateEligibility(input: {
  policy: EligibilityPolicyV1;
  subjectKey: `0x${string}`;
  cutoffAt: string;
  observations: readonly EvidenceObservationV1[];
}): SubjectEligibilityEvaluationV1 {
  const observations = input.observations.filter((item) => item.subjectKey.toLowerCase() === input.subjectKey.toLowerCase());
  const evaluations = input.policy.allOf.map((rule) => evaluateRule(rule, observations, input.cutoffAt));
  const decision = evaluations.some((item) => item.decision === "UNKNOWN")
    ? "UNKNOWN"
    : evaluations.some((item) => item.decision === "FAIL")
      ? "FAIL"
      : "PASS";

  return {
    subjectKey: input.subjectKey,
    audience: input.policy.audience,
    decision,
    eligible: decision === "PASS",
    evaluations,
    evaluatorVersion: "1"
  };
}

function evaluateRule(
  rule: EligibilityRuleV1,
  observations: readonly EvidenceObservationV1[],
  cutoffAt: string
): RuleEvaluationV1 {
  switch (rule.type) {
    case "TAKE_ACCOUNT_REQUIRED":
      return booleanFact(rule, observations, "TAKE_ACCOUNT", "exists", "TAKE_ACCOUNT_MISSING", "TAKE account verified.");
    case "X_CONNECTED":
      return socialConnected(rule, observations, "twitter", "X_NOT_CONNECTED", "X connected.");
    case "X_ACCOUNT_CREATED_BEFORE":
      return socialCreatedBefore(rule, observations, "twitter", rule.before, "X_ACCOUNT_TOO_NEW", "X account predates the cutoff.");
    case "X_ACCOUNT_MIN_AGE":
      return socialMinimumAge(rule, observations, "twitter", rule.minimumDays, cutoffAt, "X_ACCOUNT_TOO_NEW", "X account age verified.");
    case "DISCORD_CONNECTED":
      return socialConnected(rule, observations, "discord", "DISCORD_NOT_CONNECTED", "Discord connected.");
    case "DISCORD_ACCOUNT_CREATED_BEFORE":
      return socialCreatedBefore(rule, observations, "discord", rule.before, "DISCORD_ACCOUNT_TOO_NEW", "Discord account predates the cutoff.");
    case "DISCORD_ACCOUNT_MIN_AGE":
      return socialMinimumAge(rule, observations, "discord", rule.minimumDays, cutoffAt, "DISCORD_ACCOUNT_TOO_NEW", "Discord account age verified.");
    case "DISCORD_GUILD_MEMBER":
      return guildBoolean(rule, observations, rule.guildId, "member", "DISCORD_GUILD_MEMBERSHIP_REQUIRED", "Discord community membership verified.");
    case "DISCORD_GUILD_JOINED_BEFORE":
      return guildJoinedBefore(rule, observations, rule.guildId, rule.before);
    case "DISCORD_ROLE_REQUIRED":
      return guildRole(rule, observations);
    case "WALLET_CONNECTED":
      return walletConnected(rule, observations);
    case "WALLET_FIRST_SEEN_BEFORE":
      return walletFirstSeen(rule, observations);
    case "WALLET_MIN_ACTIVE_MONTHS":
      return walletActiveMonths(rule, observations);
    case "GITHUB_CONNECTED":
      return socialConnected(rule, observations, "github", "GITHUB_NOT_CONNECTED", "GitHub connected.");
    case "PROOF_OF_HUMAN_REQUIRED":
      return proofOfHuman(rule, observations);
    case "EXTERNAL_RECIPIENT_ALLOWED":
      return externalRecipient(rule, observations);
    case "TAKE_MEMBER_RECIPIENT_REQUIRED":
      return booleanFact(rule, observations, "TAKE_ACCOUNT", "exists", "TAKE_MEMBER_RECIPIENT_REQUIRED", "Recipient is a TAKE member.");
    case "MERKLE_ALLOWLIST":
      return allowlist(rule, observations);
  }
}

function booleanFact(
  rule: EligibilityRuleV1,
  observations: readonly EvidenceObservationV1[],
  fact: EvidenceObservationV1["fact"],
  field: string,
  failure: string,
  success: string
): RuleEvaluationV1 {
  const matches = observations.filter((item) => item.fact === fact);
  const unavailable = matches.find((item) => item.status === "UNAVAILABLE");
  const observed = matches.find((item) => item.status === "OBSERVED");
  if (!observed) return unknown(rule, unavailable, `${fact}_EVIDENCE_UNAVAILABLE`);
  return outcome(rule, Boolean(record(observed.value)[field]), observed, failure, success);
}

function socialConnected(
  rule: EligibilityRuleV1,
  observations: readonly EvidenceObservationV1[],
  provider: string,
  failure: string,
  success: string
): RuleEvaluationV1 {
  const candidates = socialObservations(observations, provider);
  const observation = candidates.find(
    (item) => item.status === "OBSERVED" && typeof record(item.value).connected === "boolean"
  ) ?? candidates.find((item) => item.status === "UNAVAILABLE");
  if (!observation || observation.status === "UNAVAILABLE") return unknown(rule, observation, `${provider.toUpperCase()}_EVIDENCE_UNAVAILABLE`);
  return outcome(rule, Boolean(record(observation.value).connected), observation, failure, success);
}

function socialCreatedBefore(
  rule: EligibilityRuleV1,
  observations: readonly EvidenceObservationV1[],
  provider: string,
  before: string,
  failure: string,
  success: string
): RuleEvaluationV1 {
  const candidates = socialObservations(observations, provider);
  const connection = candidates.find(
    (item) => item.status === "OBSERVED" && typeof record(item.value).connected === "boolean"
  );
  if (connection && !record(connection.value).connected) {
    return outcome(rule, false, connection, socialConnectionFailure(provider), `${provider} connected.`);
  }
  const missingAccount = candidates.find(
    (item) => item.status === "OBSERVED" && record(item.value).exists === false
  );
  if (missingAccount) {
    return outcome(rule, false, missingAccount, `${providerReasonPrefix(provider)}_USER_NOT_FOUND`, `${provider} account verified.`);
  }
  const observation = candidates.find(
    (item) => item.status === "OBSERVED" && typeof record(item.value).providerCreatedAt === "string"
  ) ?? candidates.find((item) => item.status === "UNAVAILABLE");
  if (!observation || observation.status === "UNAVAILABLE") return unknown(rule, observation, `${provider.toUpperCase()}_EVIDENCE_UNAVAILABLE`);
  const createdAt = record(observation.value).providerCreatedAt;
  if (typeof createdAt !== "string") return unknown(rule, observation, `${provider.toUpperCase()}_CREATION_TIME_UNAVAILABLE`);
  return outcome(rule, toTime(createdAt) < toTime(before), observation, failure, success, { createdAt, before });
}

function socialMinimumAge(
  rule: EligibilityRuleV1,
  observations: readonly EvidenceObservationV1[],
  provider: string,
  minimumDays: number,
  cutoffAt: string,
  failure: string,
  success: string
): RuleEvaluationV1 {
  const candidates = socialObservations(observations, provider);
  const connection = candidates.find(
    (item) => item.status === "OBSERVED" && typeof record(item.value).connected === "boolean"
  );
  if (connection && !record(connection.value).connected) {
    return outcome(rule, false, connection, socialConnectionFailure(provider), `${provider} connected.`);
  }
  const missingAccount = candidates.find(
    (item) => item.status === "OBSERVED" && record(item.value).exists === false
  );
  if (missingAccount) {
    return outcome(rule, false, missingAccount, `${providerReasonPrefix(provider)}_USER_NOT_FOUND`, `${provider} account verified.`);
  }
  const observation = candidates.find(
    (item) => item.status === "OBSERVED" && typeof record(item.value).providerCreatedAt === "string"
  ) ?? candidates.find((item) => item.status === "UNAVAILABLE");
  if (!observation || observation.status === "UNAVAILABLE") return unknown(rule, observation, `${provider.toUpperCase()}_EVIDENCE_UNAVAILABLE`);
  const createdAt = record(observation.value).providerCreatedAt;
  if (typeof createdAt !== "string") return unknown(rule, observation, `${provider.toUpperCase()}_CREATION_TIME_UNAVAILABLE`);
  const ageDays = Math.floor((toTime(cutoffAt) - toTime(createdAt)) / DAY_MS);
  return outcome(rule, ageDays >= minimumDays, observation, failure, success, { createdAt, cutoffAt, ageDays, minimumDays });
}

function guildBoolean(
  rule: EligibilityRuleV1,
  observations: readonly EvidenceObservationV1[],
  guildId: string,
  field: string,
  failure: string,
  success: string
): RuleEvaluationV1 {
  const observation = guildObservation(observations, guildId);
  if (!observation || observation.status === "UNAVAILABLE") return unknown(rule, observation, "DISCORD_GUILD_EVIDENCE_UNAVAILABLE");
  return outcome(rule, Boolean(record(observation.value)[field]), observation, failure, success);
}

function guildJoinedBefore(
  rule: EligibilityRuleV1,
  observations: readonly EvidenceObservationV1[],
  guildId: string,
  before: string
): RuleEvaluationV1 {
  const observation = guildObservation(observations, guildId);
  if (!observation || observation.status === "UNAVAILABLE") return unknown(rule, observation, "DISCORD_GUILD_EVIDENCE_UNAVAILABLE");
  const value = record(observation.value);
  if (!value.member) return outcome(rule, false, observation, "DISCORD_GUILD_MEMBERSHIP_REQUIRED", "Discord community membership verified.");
  if (typeof value.joinedAt !== "string") return unknown(rule, observation, "DISCORD_GUILD_JOIN_TIME_UNAVAILABLE");
  return outcome(
    rule,
    toTime(value.joinedAt) < toTime(before),
    observation,
    "DISCORD_GUILD_JOINED_AFTER_CUTOFF",
    "Discord community join date verified.",
    { joinedAt: value.joinedAt, before }
  );
}

function guildRole(rule: Extract<EligibilityRuleV1, { type: "DISCORD_ROLE_REQUIRED" }>, observations: readonly EvidenceObservationV1[]): RuleEvaluationV1 {
  const observation = guildObservation(observations, rule.guildId);
  if (!observation || observation.status === "UNAVAILABLE") return unknown(rule, observation, "DISCORD_GUILD_EVIDENCE_UNAVAILABLE");
  const value = record(observation.value);
  if (!value.member) return outcome(rule, false, observation, "DISCORD_GUILD_MEMBERSHIP_REQUIRED", "Discord community membership verified.");
  if (!Array.isArray(value.roleIds)) return unknown(rule, observation, "DISCORD_ROLE_EVIDENCE_UNAVAILABLE");
  const roles = new Set(value.roleIds.filter((item): item is string => typeof item === "string"));
  const passes = rule.match === "ALL"
    ? rule.roleIds.every((roleId) => roles.has(roleId))
    : rule.roleIds.some((roleId) => roles.has(roleId));
  return outcome(rule, passes, observation, "DISCORD_ROLE_REQUIRED", "Discord role verified.", { requiredRoleIds: rule.roleIds });
}

function walletConnected(rule: Extract<EligibilityRuleV1, { type: "WALLET_CONNECTED" }>, observations: readonly EvidenceObservationV1[]): RuleEvaluationV1 {
  const wallets = observations.filter((item) => item.fact === "WALLET");
  const observed = wallets.filter((item) => item.status === "OBSERVED");
  if (observed.length === 0) return unknown(rule, wallets.find((item) => item.status === "UNAVAILABLE"), "WALLET_EVIDENCE_UNAVAILABLE");
  const match = observed.find((item) => {
    const value = record(item.value);
    return Boolean(value.connected) && (!rule.chainType || value.chainType === rule.chainType);
  });
  return outcome(rule, Boolean(match), match ?? observed[0]!, "WALLET_NOT_CONNECTED", "Wallet connection verified.");
}

function walletFirstSeen(rule: Extract<EligibilityRuleV1, { type: "WALLET_FIRST_SEEN_BEFORE" }>, observations: readonly EvidenceObservationV1[]): RuleEvaluationV1 {
  const wallets = observations.filter((item) => item.fact === "WALLET");
  const observed = wallets.filter((item) => item.status === "OBSERVED");
  if (observed.length === 0) return unknown(rule, wallets.find((item) => item.status === "UNAVAILABLE"), "WALLET_EVIDENCE_UNAVAILABLE");
  const field = rule.source === "TAKE_OBSERVED" ? "firstObservedAt" : "firstChainActivityAt";
  const dated = observed.filter((item) => typeof record(item.value)[field] === "string");
  if (dated.length === 0) return unknown(rule, observed[0], `${rule.source}_WALLET_HISTORY_UNAVAILABLE`);
  const passes = dated.some((item) => toTime(record(item.value)[field] as string) < toTime(rule.before));
  return outcome(rule, passes, dated[0]!, "WALLET_FIRST_SEEN_AFTER_CUTOFF", "Wallet persistence verified.", { source: rule.source, before: rule.before });
}

function walletActiveMonths(rule: Extract<EligibilityRuleV1, { type: "WALLET_MIN_ACTIVE_MONTHS" }>, observations: readonly EvidenceObservationV1[]): RuleEvaluationV1 {
  const wallets = observations.filter((item) => item.fact === "WALLET" && item.status === "OBSERVED");
  const withHistory = wallets.filter((item) => typeof record(item.value).activeMonths === "number");
  if (withHistory.length === 0) return unknown(rule, observations.find((item) => item.fact === "WALLET"), "CHAIN_WALLET_HISTORY_UNAVAILABLE");
  const maximum = Math.max(...withHistory.map((item) => Number(record(item.value).activeMonths)));
  return outcome(rule, maximum >= rule.minimumMonths, withHistory[0]!, "WALLET_ACTIVE_MONTHS_TOO_LOW", "Wallet activity history verified.", { activeMonths: maximum });
}

function proofOfHuman(rule: Extract<EligibilityRuleV1, { type: "PROOF_OF_HUMAN_REQUIRED" }>, observations: readonly EvidenceObservationV1[]): RuleEvaluationV1 {
  const match = observations.find((item) => item.fact === "PROOF_OF_HUMAN" && item.scope?.provider === rule.provider && item.scope.action === rule.action);
  if (!match || match.status === "UNAVAILABLE") return unknown(rule, match, "PROOF_OF_HUMAN_UNAVAILABLE");
  return outcome(rule, Boolean(record(match.value).verified), match, "PROOF_OF_HUMAN_REQUIRED", "Proof of human verified.");
}

function externalRecipient(rule: Extract<EligibilityRuleV1, { type: "EXTERNAL_RECIPIENT_ALLOWED" }>, observations: readonly EvidenceObservationV1[]): RuleEvaluationV1 {
  const match = observations.find((item) => item.fact === "EXTERNAL_IDENTITY");
  if (!match || match.status === "UNAVAILABLE") return unknown(rule, match, "EXTERNAL_IDENTITY_EVIDENCE_UNAVAILABLE");
  const value = record(match.value);
  const passes = Boolean(value.exists) && typeof value.provider === "string" && rule.providers.includes(value.provider as "twitter" | "discord" | "github");
  return outcome(rule, passes, match, "EXTERNAL_RECIPIENT_NOT_ALLOWED", "External recipient identity is allowed.");
}

function allowlist(rule: Extract<EligibilityRuleV1, { type: "MERKLE_ALLOWLIST" }>, observations: readonly EvidenceObservationV1[]): RuleEvaluationV1 {
  const match = observations.find((item) => item.fact === "ALLOWLIST_MEMBERSHIP" && item.scope?.allowlistId === rule.allowlistId);
  if (!match || match.status === "UNAVAILABLE") return unknown(rule, match, "ALLOWLIST_EVIDENCE_UNAVAILABLE");
  return outcome(rule, Boolean(record(match.value).included), match, "NOT_ON_ALLOWLIST", "Allowlist membership verified.");
}

function socialObservations(observations: readonly EvidenceObservationV1[], provider: string) {
  return observations.filter((item) => item.fact === "SOCIAL_ACCOUNT" && item.scope?.provider === provider);
}

function guildObservation(observations: readonly EvidenceObservationV1[], guildId: string) {
  return observations.find((item) => item.fact === "DISCORD_GUILD_MEMBER" && item.scope?.guildId === guildId);
}

function socialConnectionFailure(provider: string) {
  return provider === "twitter" ? "X_NOT_CONNECTED" : `${provider.toUpperCase()}_NOT_CONNECTED`;
}

function providerReasonPrefix(provider: string) {
  return provider === "twitter" ? "X" : provider.toUpperCase();
}

function unknown(rule: EligibilityRuleV1, observation: EvidenceObservationV1 | undefined, reasonCode: string): RuleEvaluationV1 {
  return {
    ruleId: rule.id,
    ruleType: rule.type,
    ruleVersion: 1,
    decision: "UNKNOWN",
    reasonCode: observation?.errorCode ?? reasonCode,
    evidenceObservationIds: observation ? [observation.id] : [],
    publicExplanation: "Required evidence is temporarily unavailable."
  };
}

function outcome(
  rule: EligibilityRuleV1,
  passes: boolean,
  observation: EvidenceObservationV1,
  failureCode: string,
  successExplanation: string,
  details?: Record<string, unknown>
): RuleEvaluationV1 {
  return {
    ruleId: rule.id,
    ruleType: rule.type,
    ruleVersion: 1,
    decision: passes ? "PASS" : "FAIL",
    reasonCode: passes ? "RULE_PASSED" : failureCode,
    evidenceObservationIds: [observation.id],
    publicExplanation: passes ? successExplanation : publicFailure(failureCode),
    internalDetails: details
  };
}

function publicFailure(reasonCode: string): string {
  const messages: Record<string, string> = {
    TAKE_ACCOUNT_MISSING: "A TAKE account is required.",
    TAKE_MEMBER_RECIPIENT_REQUIRED: "The recipient must be a TAKE member.",
    X_NOT_CONNECTED: "Connect X to participate.",
    X_ACCOUNT_TOO_NEW: "The connected X account does not meet the campaign cutoff.",
    X_USER_NOT_FOUND: "The connected X account could not be found by X.",
    DISCORD_NOT_CONNECTED: "Connect Discord to participate.",
    DISCORD_ACCOUNT_TOO_NEW: "The connected Discord account does not meet the campaign cutoff.",
    DISCORD_GUILD_MEMBERSHIP_REQUIRED: "Membership in the required Discord community was not verified.",
    DISCORD_GUILD_JOINED_AFTER_CUTOFF: "The Discord community was joined after the campaign cutoff.",
    DISCORD_ROLE_REQUIRED: "The required Discord role was not verified.",
    WALLET_NOT_CONNECTED: "A connected wallet is required.",
    WALLET_FIRST_SEEN_AFTER_CUTOFF: "The connected wallet does not meet the campaign cutoff.",
    WALLET_ACTIVE_MONTHS_TOO_LOW: "The connected wallet does not meet the activity-history requirement.",
    GITHUB_NOT_CONNECTED: "Connect GitHub to participate.",
    PROOF_OF_HUMAN_REQUIRED: "Proof of human was not verified.",
    EXTERNAL_RECIPIENT_NOT_ALLOWED: "This external identity is not an allowed recipient.",
    NOT_ON_ALLOWLIST: "This identity is not on the campaign allowlist."
  };
  return messages[reasonCode] ?? "This campaign requirement was not met.";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toTime(value: string): number {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new TypeError(`Invalid timestamp: ${value}`);
  return time;
}
