import { beforeEach, describe, expect, it, vi } from "vitest";

const privy = vi.hoisted(() => ({
  verify: vi.fn(async (token: string) => ({ user_id: token.split("|")[0] })),
  get: vi.fn(async (id: string) => ({ id, linked_accounts: [] })),
}));

vi.mock("@privy-io/node", () => ({
  PrivyClient: class {
    utils() { return { auth: () => ({ verifyAccessToken: privy.verify }) }; }
    users() { return { _get: privy.get }; }
  },
}));

import { PrivyAuthService } from "./privyAuth.js";

describe("PrivyAuthService user lookups", () => {
  beforeEach(() => { privy.verify.mockClear(); privy.get.mockClear(); });
  const service = () => new PrivyAuthService({ PRIVY_APP_ID: "app", PRIVY_APP_SECRET: "secret", PRIVY_VERIFICATION_KEY: undefined });

  it("verifies every token but shares one Privy user fetch across a page's parallel requests", async () => {
    const auth = service();
    await Promise.all([
      auth.verifyAccessToken("did:a|1", { fresh: true }),
      auth.verifyAccessToken("did:a|2", { fresh: true }),
      auth.verifyAccessToken("did:a|3"),
      auth.verifyAccessToken("did:a|4"),
    ]);
    expect(privy.verify).toHaveBeenCalledTimes(4);
    expect(privy.get).toHaveBeenCalledTimes(1);
    await auth.verifyAccessToken("did:a|5");
    expect(privy.get).toHaveBeenCalledTimes(1);
  });

  it("re-fetches for identity routes once the earlier lookup is done, and never mixes users", async () => {
    const auth = service();
    await auth.verifyAccessToken("did:a|1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const fresh = await auth.verifyAccessToken("did:a|2", { fresh: true });
    expect(privy.get).toHaveBeenCalledTimes(2);
    const other = await auth.verifyAccessToken("did:b|1");
    expect(other.user.id).toBe("did:b");
    expect(fresh.user.id).toBe("did:a");
  });

  it("does not keep a failed lookup", async () => {
    const auth = service();
    privy.get.mockRejectedValueOnce(new Error("privy down"));
    await expect(auth.verifyAccessToken("did:c|1")).rejects.toThrow("privy down");
    await expect(auth.verifyAccessToken("did:c|2")).resolves.toMatchObject({ user: { id: "did:c" } });
  });
});
