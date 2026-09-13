import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import { domainHash } from "@take/mechanism";
import { assertOrganizationRole } from "./authorization.js";
import { notFound, ServiceError } from "./errors.js";

export type AllowlistMemberInput =
  | { takeIdentityId: string }
  | { externalIdentityId: string }
  | { subjectKey: string };

export class AllowlistService {
  constructor(private readonly db: Database) {}

  async list(organizationId: string, actorIdentityId: string) {
    await assertOrganizationRole(this.db, organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    const records = await this.db
      .select()
      .from(schema.identityAllowlists)
      .where(eq(schema.identityAllowlists.organizationId, organizationId))
      .orderBy(asc(schema.identityAllowlists.createdAt));
    return Promise.all(records.map(async (record) => ({
      ...serializeAllowlist(record),
      members: await this.members(record.id)
    })));
  }

  async create(organizationId: string, actorIdentityId: string, name: string) {
    await assertOrganizationRole(this.db, organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    const [created] = await this.db
      .insert(schema.identityAllowlists)
      .values({
        organizationId,
        name,
        createdByIdentityId: actorIdentityId
      })
      .returning();
    if (!created) throw new Error("Failed to create identity allowlist");
    return serializeAllowlist(created);
  }

  async addMember(allowlistId: string, actorIdentityId: string, input: AllowlistMemberInput) {
    const allowlist = await this.allowlist(allowlistId);
    await assertOrganizationRole(this.db, allowlist.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    if (allowlist.status !== "DRAFT") {
      throw new ServiceError("ALLOWLIST_LOCKED", "A locked allowlist cannot be changed", 409);
    }
    const identity = await this.resolveInput(input);
    const [created] = await this.db
      .insert(schema.identityAllowlistMembers)
      .values({
        allowlistId,
        subjectKey: identity.subjectKey,
        takeIdentityId: identity.takeIdentityId,
        externalIdentityId: identity.externalIdentityId,
        source: "ORGANIZER",
        metadata: {}
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      throw new ServiceError("ALLOWLIST_MEMBER_EXISTS", "This immutable identity is already in the allowlist", 409);
    }
    return created;
  }

  async lock(allowlistId: string, actorIdentityId: string) {
    const allowlist = await this.allowlist(allowlistId);
    await assertOrganizationRole(this.db, allowlist.organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    if (allowlist.status !== "DRAFT") {
      throw new ServiceError("ALLOWLIST_ALREADY_LOCKED", "The allowlist is already locked", 409);
    }
    const members = await this.members(allowlistId);
    if (members.length === 0) {
      throw new ServiceError("ALLOWLIST_EMPTY", "An empty allowlist cannot be locked", 409);
    }
    const resolved = await Promise.all(members.map(async (member) => ({
      subjectKey: member.subjectKey.toLowerCase(),
      canonicalSubjectKey: (await this.canonicalKey(member)).toLowerCase(),
      takeIdentityId: member.takeIdentityId,
      externalIdentityId: member.externalIdentityId
    })));
    const unique = new Set(resolved.map((member) => member.canonicalSubjectKey));
    if (unique.size !== resolved.length) {
      throw new ServiceError(
        "ALLOWLIST_CANONICAL_DUPLICATE",
        "The allowlist contains multiple aliases for the same TAKE identity",
        409
      );
    }
    const artifact = {
      artifactVersion: "1",
      allowlistId,
      organizationId: allowlist.organizationId,
      members: resolved.sort((left, right) => left.canonicalSubjectKey.localeCompare(right.canonicalSubjectKey))
    };
    const artifactHash = domainHash("TAKE_IDENTITY_ALLOWLIST_V1", artifact);
    const now = new Date();
    const [locked] = await this.db
      .update(schema.identityAllowlists)
      .set({
        status: "LOCKED",
        artifactHash,
        lockedByIdentityId: actorIdentityId,
        lockedAt: now
      })
      .where(
        and(
          eq(schema.identityAllowlists.id, allowlistId),
          eq(schema.identityAllowlists.status, "DRAFT")
        )
      )
      .returning();
    if (!locked) {
      throw new ServiceError("ALLOWLIST_CHANGED", "The allowlist changed before it could be locked", 409);
    }
    await this.db.insert(schema.auditLogs).values({
      actorIdentityId,
      organizationId: allowlist.organizationId,
      action: "IDENTITY_ALLOWLIST_LOCKED",
      metadata: { allowlistId, artifactHash, memberCount: resolved.length }
    });
    return { ...serializeAllowlist(locked), artifact };
  }

  private async allowlist(id: string) {
    const [record] = await this.db
      .select()
      .from(schema.identityAllowlists)
      .where(eq(schema.identityAllowlists.id, id))
      .limit(1);
    if (!record) notFound("Identity allowlist not found");
    return record;
  }

  private members(allowlistId: string) {
    return this.db
      .select()
      .from(schema.identityAllowlistMembers)
      .where(eq(schema.identityAllowlistMembers.allowlistId, allowlistId))
      .orderBy(asc(schema.identityAllowlistMembers.subjectKey));
  }

  private async resolveInput(input: AllowlistMemberInput) {
    if ("takeIdentityId" in input) {
      const [identity] = await this.db
        .select({ id: schema.takeIdentities.id, key: schema.takeIdentities.protocolIdentityKey })
        .from(schema.takeIdentities)
        .where(eq(schema.takeIdentities.id, input.takeIdentityId))
        .limit(1);
      if (!identity) notFound("TAKE identity not found");
      return { subjectKey: identity.key, takeIdentityId: identity.id, externalIdentityId: null };
    }
    if ("externalIdentityId" in input) {
      const [identity] = await this.db
        .select({ id: schema.externalIdentities.id, key: schema.externalIdentities.externalIdentityKey })
        .from(schema.externalIdentities)
        .where(eq(schema.externalIdentities.id, input.externalIdentityId))
        .limit(1);
      if (!identity) notFound("External identity not found");
      return { subjectKey: identity.key, takeIdentityId: null, externalIdentityId: identity.id };
    }
    return { subjectKey: input.subjectKey.toLowerCase(), takeIdentityId: null, externalIdentityId: null };
  }

  private async canonicalKey(member: typeof schema.identityAllowlistMembers.$inferSelect) {
    if (member.takeIdentityId) {
      const [identity] = await this.db
        .select({ key: schema.takeIdentities.protocolIdentityKey })
        .from(schema.takeIdentities)
        .where(eq(schema.takeIdentities.id, member.takeIdentityId))
        .limit(1);
      if (!identity) notFound("Allowlisted TAKE identity no longer exists");
      return identity.key;
    }
    if (member.externalIdentityId) {
      const [external] = await this.db
        .select({ key: schema.externalIdentities.externalIdentityKey, takeIdentityId: schema.externalIdentities.takeIdentityId })
        .from(schema.externalIdentities)
        .where(eq(schema.externalIdentities.id, member.externalIdentityId))
        .limit(1);
      if (!external) notFound("Allowlisted external identity no longer exists");
      if (external.takeIdentityId) {
        const [identity] = await this.db
          .select({ key: schema.takeIdentities.protocolIdentityKey })
          .from(schema.takeIdentities)
          .where(eq(schema.takeIdentities.id, external.takeIdentityId))
          .limit(1);
        if (identity) return identity.key;
      }
      return external.key;
    }
    return member.subjectKey;
  }
}

function serializeAllowlist(record: typeof schema.identityAllowlists.$inferSelect) {
  return {
    id: record.id,
    organizationId: record.organizationId,
    name: record.name,
    status: record.status,
    artifactHash: record.artifactHash,
    createdAt: record.createdAt.toISOString(),
    lockedAt: record.lockedAt?.toISOString() ?? null
  };
}
