import { z } from "zod";
import type { ApiEnv } from "../config/env.js";

export type ProviderEvidence<T> =
  | {
      status: "OBSERVED";
      value: T;
      providerObservedAt: Date;
      provenance: Record<string, unknown>;
    }
  | {
      status: "UNAVAILABLE";
      errorCode: string;
      providerObservedAt?: Date;
      provenance: Record<string, unknown>;
    };

const xUserResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    username: z.string().optional(),
    name: z.string().optional(),
    created_at: z.string().datetime({ offset: true }).optional(),
    profile_image_url: z.string().url().optional()
  })
});

const discordMemberSchema = z.object({
  user: z.object({ id: z.string() }).optional(),
  roles: z.array(z.string()),
  joined_at: z.string().datetime({ offset: true }).nullable().optional(),
  pending: z.boolean().optional()
});

const discordGuildSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner_id: z.string().optional()
});

export class XEvidenceProvider {
  constructor(private readonly env: ApiEnv) {}

  async getUser(subject: string): Promise<ProviderEvidence<{
    exists: boolean;
    subject: string;
    username?: string;
    name?: string;
    providerCreatedAt?: string;
    profileImageUrl?: string;
  }>> {
    if (!this.env.X_API_BEARER_TOKEN) {
      return unavailable("X_API_NOT_CONFIGURED", { provider: "x", endpoint: "users/by-id" });
    }
    const url = new URL(`https://api.x.com/2/users/${encodeURIComponent(subject)}`);
    url.searchParams.set("user.fields", "created_at,name,profile_image_url,username");
    const response = await requestJson(url, {
      headers: { authorization: `Bearer ${this.env.X_API_BEARER_TOKEN}` },
      timeoutMs: this.env.DRAND_REQUEST_TIMEOUT_MS,
      retryServerErrors: true
    });
    if (response.status === 404) {
      return {
        status: "OBSERVED",
        providerObservedAt: new Date(),
        provenance: { provider: "x", endpoint: "GET /2/users/:id", apiVersion: "2", status: 404 },
        value: { exists: false, subject }
      };
    }
    if (!response.ok) {
      return unavailable(
        providerError("X_API", response.status),
        { provider: "x", endpoint: "users/by-id", status: response.status }
      );
    }
    const parsed = xUserResponseSchema.safeParse(response.body);
    if (!parsed.success || parsed.data.data.id !== subject) {
      return unavailable("X_API_INVALID_RESPONSE", {
        provider: "x",
        endpoint: "users/by-id",
        validationIssues: parsed.success ? undefined : parsed.error.issues.map((issue) => issue.path.join("."))
      });
    }
    const data = parsed.data.data;
    return {
      status: "OBSERVED",
      providerObservedAt: new Date(),
      provenance: { provider: "x", endpoint: "GET /2/users/:id", apiVersion: "2" },
      value: compact({
        exists: true,
        subject: data.id,
        username: data.username,
        name: data.name,
        providerCreatedAt: data.created_at,
        profileImageUrl: data.profile_image_url
      })
    };
  }
}

export class DiscordEvidenceProvider {
  constructor(private readonly env: ApiEnv) {}

  installUrl(input: { organizationId: string; state: string }) {
    if (!this.env.DISCORD_APPLICATION_ID || !this.env.DISCORD_INSTALL_REDIRECT_URI) {
      throw new Error("Discord integration is not configured");
    }
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", this.env.DISCORD_APPLICATION_ID);
    url.searchParams.set("scope", "bot applications.commands");
    url.searchParams.set("permissions", "0");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", this.env.DISCORD_INSTALL_REDIRECT_URI);
    url.searchParams.set("state", input.state);
    url.searchParams.set("integration_type", "0");
    url.searchParams.set("prompt", "consent");
    return url.toString();
  }

  async getGuild(guildId: string): Promise<ProviderEvidence<{ id: string; name: string }>> {
    if (!this.env.DISCORD_BOT_TOKEN) {
      return unavailable("DISCORD_BOT_NOT_CONFIGURED", { provider: "discord", endpoint: "guild" });
    }
    const response = await requestJson(
      new URL(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}`),
      {
        headers: { authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` },
        timeoutMs: this.env.DRAND_REQUEST_TIMEOUT_MS,
        retryServerErrors: true
      }
    );
    if (!response.ok) {
      return unavailable(providerError("DISCORD_GUILD", response.status), {
        provider: "discord",
        endpoint: "guild",
        status: response.status
      });
    }
    const parsed = discordGuildSchema.safeParse(response.body);
    if (!parsed.success || parsed.data.id !== guildId) {
      return unavailable("DISCORD_GUILD_INVALID_RESPONSE", { provider: "discord", endpoint: "guild" });
    }
    return {
      status: "OBSERVED",
      providerObservedAt: new Date(),
      provenance: { provider: "discord", endpoint: "GET /guilds/:guildId", apiVersion: "10" },
      value: { id: parsed.data.id, name: parsed.data.name }
    };
  }

  async getGuildMember(guildId: string, userId: string): Promise<ProviderEvidence<{
    member: boolean;
    guildId: string;
    userId: string;
    roleIds: string[];
    joinedAt?: string;
    pending: boolean;
  }>> {
    if (!this.env.DISCORD_BOT_TOKEN) {
      return unavailable("DISCORD_BOT_NOT_CONFIGURED", {
        provider: "discord",
        endpoint: "guild-member",
        guildId
      });
    }
    const response = await requestJson(
      new URL(
        `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`
      ),
      {
        headers: { authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` },
        timeoutMs: this.env.DRAND_REQUEST_TIMEOUT_MS,
        retryServerErrors: true
      }
    );
    if (response.status === 404) {
      return {
        status: "OBSERVED",
        providerObservedAt: new Date(),
        provenance: { provider: "discord", endpoint: "GET /guilds/:guildId/members/:userId", apiVersion: "10" },
        value: { member: false, guildId, userId, roleIds: [], pending: false }
      };
    }
    if (!response.ok) {
      return unavailable(providerError("DISCORD_MEMBER", response.status), {
        provider: "discord",
        endpoint: "guild-member",
        guildId,
        status: response.status
      });
    }
    const parsed = discordMemberSchema.safeParse(response.body);
    if (!parsed.success || (parsed.data.user && parsed.data.user.id !== userId)) {
      return unavailable("DISCORD_MEMBER_INVALID_RESPONSE", {
        provider: "discord",
        endpoint: "guild-member",
        guildId
      });
    }
    return {
      status: "OBSERVED",
      providerObservedAt: new Date(),
      provenance: {
        provider: "discord",
        endpoint: "GET /guilds/:guildId/members/:userId",
        apiVersion: "10"
      },
      value: compact({
        member: true,
        guildId,
        userId,
        roleIds: parsed.data.roles,
        joinedAt: parsed.data.joined_at ?? undefined,
        pending: parsed.data.pending ?? false
      })
    };
  }
}

interface JsonResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

async function requestJson(
  url: URL,
  options: { headers: Record<string, string>; timeoutMs: number; retryServerErrors: boolean }
): Promise<JsonResponse> {
  let last: JsonResponse = { ok: false, status: 0, body: null };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: options.headers,
        signal: AbortSignal.timeout(options.timeoutMs)
      });
      const body = await response.json().catch(() => null);
      last = { ok: response.ok, status: response.status, body };
      if (response.ok || response.status === 404) return last;
      if (response.status === 429) {
        const retryAfter = retryAfterMs(response.headers.get("retry-after"), body);
        await sleep(Math.min(retryAfter, 5_000));
        continue;
      }
      if (options.retryServerErrors && response.status >= 500 && attempt < 2) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      return last;
    } catch {
      last = { ok: false, status: 0, body: null };
      if (attempt < 2) await sleep(250 * 2 ** attempt);
    }
  }
  return last;
}

function retryAfterMs(header: string | null, body: unknown) {
  if (header && Number.isFinite(Number(header))) return Number(header) * 1_000;
  const retryAfter = body && typeof body === "object" && "retry_after" in body
    ? Number((body as { retry_after?: unknown }).retry_after)
    : Number.NaN;
  return Number.isFinite(retryAfter) ? retryAfter * 1_000 : 1_000;
}

function unavailable(errorCode: string, provenance: Record<string, unknown>): ProviderEvidence<never> {
  return { status: "UNAVAILABLE", errorCode, provenance };
}

function providerError(prefix: string, status: number) {
  if (status === 0) return `${prefix}_UNAVAILABLE`;
  if (status === 401 || status === 403) return `${prefix}_NOT_AUTHORIZED`;
  if (status === 429) return `${prefix}_RATE_LIMITED`;
  return `${prefix}_HTTP_${status}`;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
