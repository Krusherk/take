import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import {
  canonicalArtifact,
  createEvidenceObservation,
  discordSnowflakeCreatedAt,
  domainHash,
  type EligibilityPolicyV1,
  type EvidenceFact,
  type EvidenceObservationV1,
  type EvidenceSource
} from "@take/mechanism";
import type { ApiEnv } from "../config/env.js";
import { DiscordEvidenceProvider, type ProviderEvidence, XEvidenceProvider } from "./evidenceProviders.js";
import { ServiceError } from "./errors.js";

export interface EvidenceSubject {
  subjectKey: `0x${string}`;
  canonicalSubjectKey: `0x${string}`;
  takeIdentityId: string | null;
  externalIdentityId: string | null;
  provider?: "twitter" | "discord" | "github";
  providerSubject?: string;
}

interface SaveObservationInput {
  campaignId: string;
  mechanismConfigId?: string;
  subject: EvidenceSubject;
  source: EvidenceSource;
  fact: EvidenceFact;
  status: "OBSERVED" | "UNAVAILABLE";
  scope?: Record<string, string>;
  value: unknown;
  providerObservedAt?: Date;
  errorCode?: string;
  provenance?: Record<string, unknown>;
  retentionClass?: string;
}

export class EvidenceService {
  private readonly x: XEvidenceProvider;
  private readonly discord: DiscordEvidenceProvider;

  constructor(
    private readonly db: Database,
    private readonly env: ApiEnv
  ) {
    this.x = new XEvidenceProvider(env);
    this.discord = new DiscordEvidenceProvider(env);
  }

  async resolveCandidates(
    policy: EligibilityPolicyV1,
    organizationId: string,
    cutoffAt: Date
  ): Promise<EvidenceSubject[]> {
    let candidates: EvidenceSubject[];
    switch (policy.population.type) {
      case "TAKE_IDENTITIES_AS_OF_CUTOFF": {
        const rows = await this.db
          .select({
            takeIdentityId: schema.takeIdentities.id,
            subjectKey: schema.takeIdentities.protocolIdentityKey
          })
          .from(schema.takeIdentities)
          .where(
            and(
              eq(schema.takeIdentities.status, "ACTIVE"),
              lte(schema.takeIdentities.createdAt, cutoffAt)
            )
          )
          .orderBy(asc(schema.takeIdentities.protocolIdentityKey));
        candidates = rows.map((row) => ({
          subjectKey: asIdentityKey(row.subjectKey),
          canonicalSubjectKey: asIdentityKey(row.subjectKey),
          takeIdentityId: row.takeIdentityId,
          externalIdentityId: null
        }));
        break;
      }
      case "KNOWN_EXTERNAL_IDENTITIES_AS_OF_CUTOFF": {
        const rows = await this.db
          .select({
            externalIdentityId: schema.externalIdentities.id,
            externalIdentityKey: schema.externalIdentities.externalIdentityKey,
            takeIdentityId: schema.externalIdentities.takeIdentityId,
            provider: schema.externalIdentities.provider,
            providerSubject: schema.externalIdentities.immutableProviderUserId,
            protocolIdentityKey: schema.takeIdentities.protocolIdentityKey
          })
          .from(schema.externalIdentities)
          .leftJoin(
            schema.takeIdentities,
            eq(schema.takeIdentities.id, schema.externalIdentities.takeIdentityId)
          )
          .where(
            and(
              inArray(schema.externalIdentities.provider, policy.population.providers),
              lte(schema.externalIdentities.firstObservedAt, cutoffAt)
            )
          )
          .orderBy(asc(schema.externalIdentities.externalIdentityKey));
        candidates = rows.map((row) => {
          const canonical = row.protocolIdentityKey ?? row.externalIdentityKey;
          return {
            subjectKey: asIdentityKey(canonical),
            canonicalSubjectKey: asIdentityKey(canonical),
            takeIdentityId: row.takeIdentityId,
            externalIdentityId: row.externalIdentityId,
            provider: asSupportedProvider(row.provider),
            providerSubject: row.providerSubject
          };
        });
        break;
      }
      case "ORGANIZER_ALLOWLIST": {
        const [allowlist] = await this.db
          .select()
          .from(schema.identityAllowlists)
          .where(
            and(
              eq(schema.identityAllowlists.id, policy.population.allowlistId),
              eq(schema.identityAllowlists.organizationId, organizationId)
            )
          )
          .limit(1);
        if (!allowlist) {
          throw new ServiceError("ALLOWLIST_NOT_FOUND", "The candidate allowlist does not exist", 404);
        }
        if (allowlist.status !== "LOCKED") {
          throw new ServiceError("ALLOWLIST_NOT_LOCKED", "Candidate allowlists must be locked before evaluation", 409);
        }
        const members = await this.db
          .select()
          .from(schema.identityAllowlistMembers)
          .where(eq(schema.identityAllowlistMembers.allowlistId, allowlist.id))
          .orderBy(asc(schema.identityAllowlistMembers.subjectKey));
        candidates = await Promise.all(members.map((member) => this.resolveAllowlistMember(member)));
        break;
      }
      case "OPEN_EXTERNAL":
        return [];
    }

    const byCanonical = new Map<string, EvidenceSubject>();
    for (const candidate of candidates) {
      const key = candidate.canonicalSubjectKey.toLowerCase();
      if (byCanonical.has(key)) {
        throw new ServiceError(
          "DUPLICATE_CANONICAL_CANDIDATE",
          "The candidate population contains multiple aliases for one TAKE identity",
          409,
          { canonicalSubjectKey: candidate.canonicalSubjectKey }
        );
      }
      byCanonical.set(key, candidate);
    }
    return [...byCanonical.values()].sort((left, right) => left.subjectKey.localeCompare(right.subjectKey));
  }

  async collectForSubject(input: {
    campaignId: string;
    mechanismConfigId?: string;
    organizationId: string;
    cutoffAt: Date;
    policy: EligibilityPolicyV1;
    subject: EvidenceSubject;
  }): Promise<EvidenceObservationV1[]> {
    const observations: EvidenceObservationV1[] = [];
    const ruleTypes = new Set(input.policy.allOf.map((rule) => rule.type));
    const socialProviders = new Set<string>();
    if (["X_CONNECTED", "X_ACCOUNT_CREATED_BEFORE", "X_ACCOUNT_MIN_AGE"].some((type) => ruleTypes.has(type as never))) {
      socialProviders.add("twitter");
    }
    if (["DISCORD_CONNECTED", "DISCORD_ACCOUNT_CREATED_BEFORE", "DISCORD_ACCOUNT_MIN_AGE"].some((type) => ruleTypes.has(type as never))) {
      socialProviders.add("discord");
    }
    if (ruleTypes.has("GITHUB_CONNECTED")) socialProviders.add("github");

    if (ruleTypes.has("TAKE_ACCOUNT_REQUIRED") || ruleTypes.has("TAKE_MEMBER_RECIPIENT_REQUIRED")) {
      observations.push(await this.save({
        ...input,
        source: "TAKE_DATABASE",
        fact: "TAKE_ACCOUNT",
        status: "OBSERVED",
        value: { exists: Boolean(input.subject.takeIdentityId) },
        providerObservedAt: input.cutoffAt,
        provenance: { table: "take_identities", cutoffAt: input.cutoffAt.toISOString() }
      }));
    }

    const socials = input.subject.takeIdentityId
      ? await this.db
          .select()
          .from(schema.socialAccounts)
          .where(eq(schema.socialAccounts.takeIdentityId, input.subject.takeIdentityId))
      : [];
    const external = input.subject.externalIdentityId
      ? (await this.db
          .select()
          .from(schema.externalIdentities)
          .where(eq(schema.externalIdentities.id, input.subject.externalIdentityId))
          .limit(1))[0]
      : undefined;

    for (const provider of socialProviders) {
      const account = socials.find((item) => item.provider === provider);
      const externalMatch = external?.provider === provider ? external : undefined;
      const connected = Boolean(
        (account && account.firstObservedAt <= input.cutoffAt)
        || (externalMatch && externalMatch.firstObservedAt <= input.cutoffAt)
      );
      const providerSubject = account?.providerUserId ?? externalMatch?.immutableProviderUserId;
      const connectionObservation = await this.save({
        ...input,
        source: "PRIVY",
        fact: "SOCIAL_ACCOUNT",
        status: "OBSERVED",
        scope: { provider },
        value: compact({
          connected,
          subject: providerSubject,
          username: account?.username ?? externalMatch?.currentUsername ?? undefined
        }),
        providerObservedAt: account?.lastObservedAt ?? externalMatch?.lastObservedAt ?? input.cutoffAt,
        provenance: { source: account ? "social_accounts" : externalMatch ? "external_identities" : "absence" }
      });
      observations.push(connectionObservation);

      if (provider === "twitter" && connected && providerSubject && (
        ruleTypes.has("X_ACCOUNT_CREATED_BEFORE") || ruleTypes.has("X_ACCOUNT_MIN_AGE")
      )) {
        observations.push(await this.saveProviderResult({
          ...input,
          source: "X_API",
          fact: "SOCIAL_ACCOUNT",
          scope: { provider: "twitter", evidence: "account-history" },
          result: await this.x.getUser(providerSubject)
        }));
      }

      if (provider === "discord" && connected && providerSubject && (
        ruleTypes.has("DISCORD_ACCOUNT_CREATED_BEFORE") || ruleTypes.has("DISCORD_ACCOUNT_MIN_AGE")
      )) {
        try {
          observations.push(await this.save({
            ...input,
            source: "DISCORD_SNOWFLAKE",
            fact: "SOCIAL_ACCOUNT",
            status: "OBSERVED",
            scope: { provider: "discord", evidence: "account-history" },
            value: { connected: true, subject: providerSubject, providerCreatedAt: discordSnowflakeCreatedAt(providerSubject) },
            providerObservedAt: account?.firstObservedAt ?? externalMatch?.firstObservedAt ?? input.cutoffAt,
            provenance: { derivation: "discord-snowflake-v1" }
          }));
        } catch {
          observations.push(await this.save({
            ...input,
            source: "DISCORD_SNOWFLAKE",
            fact: "SOCIAL_ACCOUNT",
            status: "UNAVAILABLE",
            scope: { provider: "discord", evidence: "account-history" },
            value: null,
            errorCode: "DISCORD_SUBJECT_INVALID",
            provenance: { derivation: "discord-snowflake-v1" }
          }));
        }
      }
    }

    const guildIds = [...new Set(input.policy.allOf.flatMap((rule) =>
      "guildId" in rule ? [rule.guildId] : []
    ))];
    for (const guildId of guildIds) {
      const discordAccount = socials.find(
        (account) => account.provider === "discord" && account.firstObservedAt <= input.cutoffAt
      );
      const externalDiscord = external?.provider === "discord" ? external : undefined;
      const discordSubject = discordAccount?.providerUserId ?? externalDiscord?.immutableProviderUserId;
      if (!discordSubject) {
        observations.push(await this.save({
          ...input,
          source: "DISCORD_API",
          fact: "DISCORD_GUILD_MEMBER",
          status: "OBSERVED",
          scope: { guildId },
          value: { member: false, guildId, roleIds: [], pending: false },
          providerObservedAt: input.cutoffAt,
          provenance: { source: "no-connected-discord" }
        }));
        continue;
      }
      const [integration] = await this.db
        .select()
        .from(schema.discordGuildIntegrations)
        .where(
          and(
            eq(schema.discordGuildIntegrations.organizationId, input.organizationId),
            eq(schema.discordGuildIntegrations.guildId, guildId),
            eq(schema.discordGuildIntegrations.status, "ACTIVE")
          )
        )
        .limit(1);
      if (!integration) {
        observations.push(await this.save({
          ...input,
          source: "DISCORD_API",
          fact: "DISCORD_GUILD_MEMBER",
          status: "UNAVAILABLE",
          scope: { guildId },
          value: null,
          errorCode: "DISCORD_GUILD_NOT_INSTALLED",
          provenance: { guildId }
        }));
        continue;
      }
      observations.push(await this.saveProviderResult({
        ...input,
        source: "DISCORD_API",
        fact: "DISCORD_GUILD_MEMBER",
        scope: { guildId },
        result: await this.discord.getGuildMember(guildId, discordSubject),
        retentionClass: "RESTRICTED_COMMUNITY"
      }));
    }

    if (["WALLET_CONNECTED", "WALLET_FIRST_SEEN_BEFORE", "WALLET_MIN_ACTIVE_MONTHS"].some((type) => ruleTypes.has(type as never))) {
      const wallets = input.subject.takeIdentityId
        ? await this.db
            .select()
            .from(schema.wallets)
            .where(eq(schema.wallets.takeIdentityId, input.subject.takeIdentityId))
        : [];
      if (wallets.length === 0) {
        observations.push(await this.save({
          ...input,
          source: "TAKE_DATABASE",
          fact: "WALLET",
          status: "OBSERVED",
          value: { connected: false },
          providerObservedAt: input.cutoffAt,
          provenance: { table: "wallets", source: "absence" },
          retentionClass: "RESTRICTED_WALLET"
        }));
      } else {
        for (const wallet of wallets) {
          observations.push(await this.save({
            ...input,
            source: "TAKE_DATABASE",
            fact: "WALLET",
            status: "OBSERVED",
            scope: { addressHash: domainHash("TAKE_WALLET_ADDRESS_V1", wallet.address.toLowerCase()) },
            value: {
              connected: wallet.firstObservedAt <= input.cutoffAt,
              chainType: wallet.chainType,
              firstObservedAt: wallet.firstObservedAt.toISOString(),
              lastObservedAt: wallet.lastObservedAt.toISOString()
            },
            providerObservedAt: wallet.lastObservedAt,
            provenance: { table: "wallets", historyType: "TAKE_OBSERVED" },
            retentionClass: "RESTRICTED_WALLET"
          }));
        }
      }
      if (ruleTypes.has("WALLET_MIN_ACTIVE_MONTHS") || input.policy.allOf.some(
        (rule) => rule.type === "WALLET_FIRST_SEEN_BEFORE" && rule.source === "CHAIN_HISTORY"
      )) {
        observations.push(await this.save({
          ...input,
          source: "MONAD_RPC",
          fact: "WALLET",
          status: "UNAVAILABLE",
          scope: { historyType: "CHAIN_HISTORY" },
          value: null,
          errorCode: "CHAIN_WALLET_HISTORY_PROVIDER_NOT_CONFIGURED",
          provenance: { limitation: "Configured RPC does not prove complete wallet history" },
          retentionClass: "RESTRICTED_WALLET"
        }));
      }
    }

    if (ruleTypes.has("EXTERNAL_RECIPIENT_ALLOWED")) {
      observations.push(await this.save({
        ...input,
        source: "TAKE_DATABASE",
        fact: "EXTERNAL_IDENTITY",
        status: "OBSERVED",
        value: {
          exists: Boolean(external),
          provider: external?.provider
        },
        providerObservedAt: external?.lastObservedAt ?? input.cutoffAt,
        provenance: { table: "external_identities" }
      }));
    }

    for (const rule of input.policy.allOf) {
      if (rule.type !== "MERKLE_ALLOWLIST") continue;
      const [member] = await this.db
        .select({ id: schema.identityAllowlistMembers.id })
        .from(schema.identityAllowlistMembers)
        .where(
          and(
            eq(schema.identityAllowlistMembers.allowlistId, rule.allowlistId),
            eq(schema.identityAllowlistMembers.subjectKey, input.subject.subjectKey)
          )
        )
        .limit(1);
      observations.push(await this.save({
        ...input,
        source: "ORGANIZER_ALLOWLIST",
        fact: "ALLOWLIST_MEMBERSHIP",
        status: "OBSERVED",
        scope: { allowlistId: rule.allowlistId },
        value: { included: Boolean(member) },
        providerObservedAt: input.cutoffAt,
        provenance: { table: "identity_allowlist_members" }
      }));
    }

    for (const rule of input.policy.allOf) {
      if (rule.type !== "PROOF_OF_HUMAN_REQUIRED") continue;
      observations.push(await this.save({
        ...input,
        source: "PROOF_OF_HUMAN",
        fact: "PROOF_OF_HUMAN",
        status: "UNAVAILABLE",
        scope: { provider: rule.provider, action: rule.action },
        value: null,
        errorCode: "PROOF_OF_HUMAN_PROVIDER_NOT_CONFIGURED",
        provenance: { provider: rule.provider }
      }));
    }

    return observations;
  }

  private async resolveAllowlistMember(
    member: typeof schema.identityAllowlistMembers.$inferSelect
  ): Promise<EvidenceSubject> {
    if (member.takeIdentityId) {
      const [identity] = await this.db
        .select({ key: schema.takeIdentities.protocolIdentityKey })
        .from(schema.takeIdentities)
        .where(eq(schema.takeIdentities.id, member.takeIdentityId))
        .limit(1);
      if (!identity) throw new ServiceError("ALLOWLIST_IDENTITY_MISSING", "Allowlist TAKE identity no longer exists", 409);
      return {
        subjectKey: asIdentityKey(identity.key),
        canonicalSubjectKey: asIdentityKey(identity.key),
        takeIdentityId: member.takeIdentityId,
        externalIdentityId: null
      };
    }
    if (member.externalIdentityId) {
      const [external] = await this.db
        .select()
        .from(schema.externalIdentities)
        .where(eq(schema.externalIdentities.id, member.externalIdentityId))
        .limit(1);
      if (!external) throw new ServiceError("ALLOWLIST_EXTERNAL_IDENTITY_MISSING", "Allowlist external identity no longer exists", 409);
      if (external.takeIdentityId) {
        const [identity] = await this.db
          .select({ key: schema.takeIdentities.protocolIdentityKey })
          .from(schema.takeIdentities)
          .where(eq(schema.takeIdentities.id, external.takeIdentityId))
          .limit(1);
        if (identity) {
          return {
            subjectKey: asIdentityKey(identity.key),
            canonicalSubjectKey: asIdentityKey(identity.key),
            takeIdentityId: external.takeIdentityId,
            externalIdentityId: external.id,
            provider: asSupportedProvider(external.provider),
            providerSubject: external.immutableProviderUserId
          };
        }
      }
      return {
        subjectKey: asIdentityKey(external.externalIdentityKey),
        canonicalSubjectKey: asIdentityKey(external.externalIdentityKey),
        takeIdentityId: null,
        externalIdentityId: external.id,
        provider: asSupportedProvider(external.provider),
        providerSubject: external.immutableProviderUserId
      };
    }
    return {
      subjectKey: asIdentityKey(member.subjectKey),
      canonicalSubjectKey: asIdentityKey(member.subjectKey),
      takeIdentityId: null,
      externalIdentityId: null
    };
  }

  private async saveProviderResult<T>(input: Omit<SaveObservationInput, "status" | "value"> & {
    result: ProviderEvidence<T>;
  }) {
    if (input.result.status === "UNAVAILABLE") {
      return this.save({
        ...input,
        status: "UNAVAILABLE",
        value: null,
        errorCode: input.result.errorCode,
        providerObservedAt: input.result.providerObservedAt,
        provenance: input.result.provenance
      });
    }
    return this.save({
      ...input,
      status: "OBSERVED",
      value: input.result.value,
      providerObservedAt: input.result.providerObservedAt,
      provenance: input.result.provenance
    });
  }

  private async save(input: SaveObservationInput): Promise<EvidenceObservationV1> {
    const observedAt = new Date();
    const collectedAt = new Date();
    const id = randomUUID();
    const observation = createEvidenceObservation({
      id,
      subjectKey: input.subject.subjectKey,
      source: input.source,
      fact: input.fact,
      status: input.status,
      scope: input.scope,
      value: input.value,
      providerObservedAt: input.providerObservedAt?.toISOString(),
      observedAt: observedAt.toISOString(),
      collectedAt: collectedAt.toISOString(),
      errorCode: input.errorCode
    });
    const payloadHash = domainHash("TAKE_EVIDENCE_PAYLOAD_V1", input.value);
    const deduplicationKey = domainHash("TAKE_EVIDENCE_DEDUPLICATION_V1", {
      source: input.source,
      subjectKey: input.subject.subjectKey,
      fact: input.fact,
      scope: input.scope ?? {},
      providerObservedAt: input.providerObservedAt?.toISOString() ?? null,
      payloadHash,
      errorCode: input.errorCode ?? null
    });
    const [created] = await this.db
      .insert(schema.evidenceObservations)
      .values({
        id,
        campaignId: input.campaignId,
        mechanismConfigId: input.mechanismConfigId,
        subjectKey: input.subject.subjectKey,
        takeIdentityId: input.subject.takeIdentityId,
        externalIdentityId: input.subject.externalIdentityId,
        source: input.source,
        fact: input.fact,
        status: input.status,
        scope: jsonValue(input.scope ?? {}),
        value: input.value === null ? null : jsonValue(input.value),
        provenance: jsonValue(input.provenance ?? {}),
        providerObservedAt: input.providerObservedAt,
        observedAt,
        collectedAt,
        payloadHash,
        evidenceHash: observation.evidenceHash,
        deduplicationKey,
        errorCode: input.errorCode,
        retentionClass: input.retentionClass ?? "STANDARD"
      })
      .onConflictDoNothing({ target: schema.evidenceObservations.deduplicationKey })
      .returning();
    const row = created ?? (await this.db
      .select()
      .from(schema.evidenceObservations)
      .where(eq(schema.evidenceObservations.deduplicationKey, deduplicationKey))
      .limit(1))[0];
    if (!row) throw new Error("Failed to persist evidence observation");
    return rowToObservation(row);
  }
}

function rowToObservation(row: typeof schema.evidenceObservations.$inferSelect): EvidenceObservationV1 {
  return {
    id: row.id,
    version: "1",
    subjectKey: asIdentityKey(row.subjectKey),
    source: row.source as EvidenceSource,
    fact: row.fact as EvidenceFact,
    status: row.status as "OBSERVED" | "UNAVAILABLE",
    scope: row.scope as Record<string, string>,
    value: row.value,
    providerObservedAt: row.providerObservedAt?.toISOString(),
    observedAt: row.observedAt.toISOString(),
    collectedAt: row.collectedAt.toISOString(),
    evidenceHash: asIdentityKey(row.evidenceHash),
    errorCode: row.errorCode ?? undefined
  };
}

function asIdentityKey(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ServiceError("INVALID_IDENTITY_KEY", "Stored identity key is not bytes32", 500);
  }
  return value.toLowerCase() as `0x${string}`;
}

function asSupportedProvider(value: string): "twitter" | "discord" | "github" {
  if (value !== "twitter" && value !== "discord" && value !== "github") {
    throw new ServiceError("UNSUPPORTED_IDENTITY_PROVIDER", `Unsupported evidence provider: ${value}`, 409);
  }
  return value;
}

function jsonValue(value: unknown) {
  return JSON.parse(canonicalArtifact(value)) as Record<string, unknown> | unknown[] | string | number | boolean | null;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
