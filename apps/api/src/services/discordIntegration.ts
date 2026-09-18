import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@take/database";
import { schema } from "@take/database";
import type { ApiEnv } from "../config/env.js";
import { assertOrganizationRole } from "./authorization.js";
import { DiscordEvidenceProvider } from "./evidenceProviders.js";
import { ServiceError } from "./errors.js";

export class DiscordIntegrationService {
  private readonly provider: DiscordEvidenceProvider;

  constructor(
    private readonly db: Database,
    private readonly env: ApiEnv
  ) {
    this.provider = new DiscordEvidenceProvider(env);
  }

  async list(organizationId: string, actorIdentityId: string) {
    await assertOrganizationRole(this.db, organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    const integrations = await this.db
      .select()
      .from(schema.discordGuildIntegrations)
      .where(eq(schema.discordGuildIntegrations.organizationId, organizationId))
      .orderBy(asc(schema.discordGuildIntegrations.createdAt));
    return {
      configured: Boolean(this.env.DISCORD_APPLICATION_ID && this.env.DISCORD_BOT_TOKEN),
      integrations: integrations.map(serializeIntegration)
    };
  }

  async beginInstall(organizationId: string, actorIdentityId: string) {
    await assertOrganizationRole(this.db, organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    if (!this.env.DISCORD_APPLICATION_ID || !this.env.DISCORD_BOT_TOKEN || !this.env.DISCORD_INSTALL_REDIRECT_URI) {
      throw new ServiceError("DISCORD_NOT_CONFIGURED", "Discord evidence is not configured for this TAKE deployment", 503);
    }
    const state = this.signedState({
      organizationId,
      actorIdentityId,
      expiresAt: Date.now() + 10 * 60 * 1_000
    });
    return {
      installUrl: this.provider.installUrl({ organizationId, state }),
      state,
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString()
    };
  }

  async confirmInstall(organizationId: string, actorIdentityId: string, guildId: string) {
    await assertOrganizationRole(this.db, organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    const result = await this.provider.getGuild(guildId);
    if (result.status === "UNAVAILABLE") {
      throw new ServiceError(result.errorCode, "TAKE could not verify its bot installation in this Discord guild", 409);
    }
    const now = new Date();
    const [integration] = await this.db
      .insert(schema.discordGuildIntegrations)
      .values({
        organizationId,
        guildId,
        guildName: result.value.name,
        status: "ACTIVE",
        permissions: [],
        installedByIdentityId: actorIdentityId,
        installedAt: now,
        lastHealthCheckAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [schema.discordGuildIntegrations.organizationId, schema.discordGuildIntegrations.guildId],
        set: {
          guildName: result.value.name,
          status: "ACTIVE",
          installedByIdentityId: actorIdentityId,
          installedAt: now,
          lastHealthCheckAt: now,
          lastErrorCode: null,
          updatedAt: now
        }
      })
      .returning();
    if (!integration) throw new Error("Failed to store Discord guild integration");
    await this.db.insert(schema.auditLogs).values({
      actorIdentityId,
      organizationId,
      action: "DISCORD_GUILD_INTEGRATION_CONFIRMED",
      metadata: { guildId, guildName: result.value.name }
    });
    return serializeIntegration(integration);
  }

  async listRoles(organizationId: string, actorIdentityId: string, guildId: string) {
    await assertOrganizationRole(this.db, organizationId, actorIdentityId, ["OWNER", "ADMIN"]);
    const [integration] = await this.db
      .select()
      .from(schema.discordGuildIntegrations)
      .where(and(
        eq(schema.discordGuildIntegrations.organizationId, organizationId),
        eq(schema.discordGuildIntegrations.guildId, guildId),
        eq(schema.discordGuildIntegrations.status, "ACTIVE")
      ))
      .limit(1);
    if (!integration) {
      throw new ServiceError("DISCORD_GUILD_NOT_CONNECTED", "This Discord guild is not connected to the organization", 404);
    }
    const result = await this.provider.getGuildRoles(guildId);
    if (result.status === "UNAVAILABLE") {
      throw new ServiceError(result.errorCode, "TAKE could not retrieve roles from the connected Discord guild", 409);
    }
    return {
      guildId,
      roles: result.value
        .filter((role) => role.id !== guildId && !role.managed)
        .sort((left, right) => right.position - left.position)
        .map(({ id, name }) => ({ id, name }))
    };
  }

  async completeInstall(state: string, guildId: string) {
    const payload = this.verifySignedState(state);
    return this.confirmInstall(payload.organizationId, payload.actorIdentityId, guildId);
  }

  private signedState(payload: { organizationId: string; actorIdentityId: string; expiresAt: number }) {
    const secret = this.env.DISCORD_INSTALL_STATE_SECRET;
    if (!secret) {
      throw new ServiceError(
        "DISCORD_STATE_SECRET_NOT_CONFIGURED",
        "Discord installation state signing is not configured",
        503
      );
    }
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", secret).update(body).digest("base64url");
    return `${body}.${signature}`;
  }

  private verifySignedState(state: string) {
    const secret = this.env.DISCORD_INSTALL_STATE_SECRET;
    if (!secret) {
      throw new ServiceError("DISCORD_STATE_SECRET_NOT_CONFIGURED", "Discord installation state signing is not configured", 503);
    }
    const [body, suppliedSignature, extra] = state.split(".");
    if (!body || !suppliedSignature || extra) {
      throw new ServiceError("DISCORD_INSTALL_STATE_INVALID", "Discord installation state is invalid", 400);
    }
    const expectedSignature = createHmac("sha256", secret).update(body).digest("base64url");
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ServiceError("DISCORD_INSTALL_STATE_INVALID", "Discord installation state is invalid", 400);
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      throw new ServiceError("DISCORD_INSTALL_STATE_INVALID", "Discord installation state is invalid", 400);
    }
    if (!isInstallState(value) || value.expiresAt < Date.now()) {
      throw new ServiceError("DISCORD_INSTALL_STATE_EXPIRED", "Discord installation state has expired", 400);
    }
    return value;
  }
}

function isInstallState(value: unknown): value is {
  organizationId: string;
  actorIdentityId: string;
  expiresAt: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return typeof state.organizationId === "string"
    && typeof state.actorIdentityId === "string"
    && typeof state.expiresAt === "number"
    && Number.isSafeInteger(state.expiresAt);
}

function serializeIntegration(record: typeof schema.discordGuildIntegrations.$inferSelect) {
  return {
    id: record.id,
    organizationId: record.organizationId,
    guildId: record.guildId,
    guildName: record.guildName,
    status: record.status,
    installedAt: record.installedAt?.toISOString() ?? null,
    lastHealthCheckAt: record.lastHealthCheckAt?.toISOString() ?? null,
    lastErrorCode: record.lastErrorCode
  };
}
