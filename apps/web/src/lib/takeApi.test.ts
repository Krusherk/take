import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTakeApiClient, READ_TIMEOUT_MS } from "./takeApi";

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

  it("retries a read once when the server answers 504, and never retries a write", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 504 }))
      .mockResolvedValueOnce(Response.json([{ id: "c1" }]))
      .mockResolvedValueOnce(new Response("", { status: 504 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createTakeApiClient(async () => "token");
    await expect(client.request("/campaigns")).resolves.toEqual([{ id: "c1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(client.request("/me/gas-drip", { method: "POST" })).rejects.toEqual(expect.objectContaining({ status: 504 }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("abandons a read that hangs and tries again instead of waiting for the platform limit", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createTakeApiClient(async () => "token");
    const pending = client.request("/campaigns");
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS + 1);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
