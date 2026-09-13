import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TakeMe } from "../types/identity";
import { TakeIdentityProvider, useTakeMe } from "./TakeIdentityContext";

const auth = vi.hoisted(() => ({
  state: {
    ready: true,
    authenticated: true,
    user: { id: "did:privy:alice" } as { id: string } | null,
  },
  getAccessToken: vi.fn<() => Promise<string | null>>(async () => "did:privy:alice"),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ...auth.state, getAccessToken: auth.getAccessToken }),
}));

function Probe() {
  const { me, status, clear } = useTakeMe();
  return (
    <div>
      <span>{status}</span>
      {me ? <strong>{me.user.displayName}</strong> : null}
      <button type="button" onClick={clear}>CLEAR</button>
    </div>
  );
}

describe("TakeIdentityProvider", () => {
  beforeEach(() => {
    auth.state.ready = true;
    auth.state.authenticated = true;
    auth.state.user = { id: "did:privy:alice" };
    auth.getAccessToken.mockImplementation(async () => auth.state.user?.id ?? null);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/me/history")) {
        return Response.json({ given: [], received: [] });
      }
      const id = auth.state.user?.id ?? "did:privy:none";
      return Response.json(identityFor(id, id.endsWith("bob") ? "Bob" : "Alice"));
    }));
  });

  it("never exposes the previous authenticated profile while a different Privy user loads", async () => {
    const { rerender } = render(<TakeIdentityProvider><Probe /></TakeIdentityProvider>);
    await screen.findByText("Alice");

    auth.state.user = { id: "did:privy:bob" };
    rerender(<TakeIdentityProvider><Probe /></TakeIdentityProvider>);

    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    await screen.findByText("Bob");
  });

  it("clears cached TAKE identity immediately on logout cleanup", async () => {
    render(<TakeIdentityProvider><Probe /></TakeIdentityProvider>);
    await screen.findByText("Alice");
    fireEvent.click(screen.getByRole("button", { name: "CLEAR" }));

    await waitFor(() => expect(screen.queryByText("Alice")).not.toBeInTheDocument());
    expect(screen.getByText("unauthenticated")).toBeInTheDocument();
  });
});

function identityFor(id: string, name: string): TakeMe {
  return {
    user: {
      id: `${id}:user`,
      takeIdentityId: `${id}:take`,
      displayName: name,
      username: name.toLowerCase(),
      avatarUrl: `https://example.com/${name.toLowerCase()}.jpg`,
      bio: null,
      joinedAt: "2026-09-01T00:00:00.000Z",
    },
    socials: {
      twitter: { connected: true, subject: `${id}:twitter`, username: name.toLowerCase(), name },
      discord: { connected: false },
      farcaster: { connected: false },
      github: { connected: false },
    },
    wallets: [],
    takes: { given: 0, received: 0 },
  };
}
