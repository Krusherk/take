import { afterEach, describe, expect, it, vi } from "vitest";
import { apiEnvSchema } from "../config/env.js";
import { DiscordEvidenceProvider, XEvidenceProvider } from "./evidenceProviders.js";

const rawEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://take:take@localhost:5432/take",
  X_API_BEARER_TOKEN: "x-test-token",
} as const;
const baseEnv = apiEnvSchema.parse(rawEnv);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.sequential("X evidence provider", () => {
  it("records a verified negative fact for a missing X user", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(404, {})));

    const evidence = await new XEvidenceProvider(baseEnv).getUser("123456");

    expect(evidence).toMatchObject({
      status: "OBSERVED",
      value: { exists: false, subject: "123456" },
      provenance: { provider: "x", status: 404 },
    });
  });

  it("retries a rate limit and returns verified provider metadata", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(429, { retry_after: 0 }))
      .mockResolvedValueOnce(response(200, {
        data: {
          id: "123456",
          username: "take_member",
          name: "Take Member",
          created_at: "2020-01-01T00:00:00.000Z",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const evidence = await new XEvidenceProvider(baseEnv).getUser("123456");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(evidence).toMatchObject({
      status: "OBSERVED",
      value: {
        exists: true,
        subject: "123456",
        username: "take_member",
        providerCreatedAt: "2020-01-01T00:00:00.000Z",
      },
    });
  });

  it("keeps provider failure distinct from an ineligible account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(503, {})));

    const evidence = await new XEvidenceProvider(baseEnv).getUser("123456");

    expect(evidence).toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "X_API_HTTP_503",
    });
  });
});

describe("Discord evidence provider", () => {
  const discordEnv = apiEnvSchema.parse({
    ...rawEnv,
    DISCORD_APPLICATION_ID: "123456",
    DISCORD_BOT_TOKEN: "discord-test-token",
    DISCORD_INSTALL_REDIRECT_URI: "https://take.example/integrations/discord/callback",
    DISCORD_INSTALL_STATE_SECRET: "test-state-secret",
  });

  it("treats a missing guild member as observed non-membership", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(404, {})));

    const evidence = await new DiscordEvidenceProvider(discordEnv).getGuildMember("100", "200");

    expect(evidence).toMatchObject({
      status: "OBSERVED",
      value: { member: false, guildId: "100", userId: "200", roleIds: [] },
    });
  });

  it("returns UNKNOWN-compatible evidence when Discord is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(500, {})));

    const evidence = await new DiscordEvidenceProvider(discordEnv).getGuildMember("100", "200");

    expect(evidence).toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "DISCORD_MEMBER_HTTP_500",
    });
  });
});

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
