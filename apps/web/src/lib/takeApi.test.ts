import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTakeApiClient } from "./takeApi";

describe("TAKE authenticated API client", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("acquires and attaches one Privy access token centrally", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("verified-access-token");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createTakeApiClient(getAccessToken);

    await expect(client.request<{ ok: boolean }>("/me")).resolves.toEqual({ ok: true });
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer verified-access-token");
  });

  it("invalidates authenticated UI state on a 401 response", async () => {
    const onUnauthorized = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(
      { error: "UNAUTHORIZED", message: "Session expired" },
      { status: 401 },
    )));
    const client = createTakeApiClient(async () => "expired-token", { onUnauthorized });

    await expect(client.request("/me")).rejects.toEqual(expect.objectContaining({ status: 401 }));
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
