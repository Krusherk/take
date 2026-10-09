import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const real = vi.hoisted(() => ({
  ready: false,
  login: vi.fn(),
  getAccessToken: vi.fn(async () => "token"),
  loginOptions: [] as Array<{ onComplete?: (value: unknown) => void } | undefined>,
}));

vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePrivy: () => ({ ready: real.ready, authenticated: real.ready, user: real.ready ? { id: "did:privy:1" } : null, getAccessToken: real.getAccessToken, logout: vi.fn() }),
  useUser: () => ({ user: null, refreshUser: vi.fn() }),
  useWallets: () => ({ wallets: [], ready: real.ready }),
  useSendTransaction: () => ({ sendTransaction: vi.fn() }),
  useCreateWallet: () => ({ createWallet: vi.fn() }),
  useLogin: (options: { onComplete?: (value: unknown) => void }) => { real.loginOptions.push(options); return { login: real.login }; },
  useLoginWithOAuth: () => ({ initOAuth: vi.fn(), state: { status: "initial" } }),
  useLoginWithEmail: () => ({ sendCode: vi.fn(), loginWithCode: vi.fn(), state: { status: "initial" } }),
  useLinkAccount: () => ({ linkTwitter: vi.fn(), linkDiscord: vi.fn(), linkGithub: vi.fn(), linkWallet: vi.fn() }),
  useUnlinkOAuth: () => ({ unlink: vi.fn() }),
  useUnlinkWallet: () => ({ unlink: vi.fn() }),
}));
vi.mock("@privy-io/chains", () => ({ addRpcUrlOverrideToChain: (chain: unknown) => chain }));
vi.mock("viem/chains", () => ({ monadTestnet: { id: 10143 } }));

import { loadPrivy, privyNeededNow, PrivyHost, resetPrivyBridgeForTests, useLogin, usePrivy } from "./privy";

function Consumer({ onComplete }: { onComplete: (value: unknown) => void }) {
  const { ready, authenticated } = usePrivy();
  const { login } = useLogin({ onComplete });
  return <><p>{ready ? "ready" : "waiting"}:{authenticated ? "in" : "out"}</p><button type="button" onClick={() => login()}>Sign in</button></>;
}

describe("lazy Privy bridge", () => {
  it("decides when Privy is needed on first paint", () => {
    window.localStorage.clear();
    expect(privyNeededNow({ search: "" })).toBe(false);
    expect(privyNeededNow({ search: "?privy_oauth_code=x" })).toBe(true);
    // Analytics ids survive sign-out and must not count as a session.
    window.localStorage.setItem("privy:caid", "x");
    expect(privyNeededNow({ search: "" })).toBe(false);
    window.localStorage.setItem("privy:refresh_token", "x");
    expect(privyNeededNow({ search: "" })).toBe(true);
    window.localStorage.clear();
  });

  it("treats visitors without a session as signed out at once, without loading Privy", async () => {
    window.localStorage.clear();
    resetPrivyBridgeForTests();
    const { unmount } = render(<><Consumer onComplete={vi.fn()} /><PrivyHost /></>);
    expect(screen.getByText("ready:out")).toBeInTheDocument();
    // No idle load: nothing requested Privy after a few seconds of doing nothing.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(real.loginOptions.length).toBe(0);
    unmount();
    resetPrivyBridgeForTests();
  });

  it("paints before Privy loads, queues login until ready, and relays callbacks", async () => {
    window.localStorage.setItem("privy:token", "x");
    const onComplete = vi.fn();
    render(<><Consumer onComplete={onComplete} /><PrivyHost /></>);
    expect(screen.getByText("waiting:out")).toBeInTheDocument();

    // A tap before the SDK is ready still signs in once it is.
    act(() => screen.getByRole("button", { name: "Sign in" }).click());
    await waitFor(() => expect(real.loginOptions.length).toBeGreaterThan(0));
    expect(real.login).not.toHaveBeenCalled();

    real.ready = true;
    act(() => { loadPrivy(); });
    // Re-render the bridge with the ready SDK.
    await act(async () => { real.loginOptions.at(-1); });
    render(<PrivyHost />);
    await waitFor(() => expect(screen.getByText("ready:in")).toBeInTheDocument());
    await waitFor(() => expect(real.login).toHaveBeenCalledTimes(1));

    act(() => real.loginOptions.at(-1)?.onComplete?.({ isNewUser: true }));
    expect(onComplete).toHaveBeenCalledWith({ isNewUser: true });
    window.localStorage.clear();
  });
});
