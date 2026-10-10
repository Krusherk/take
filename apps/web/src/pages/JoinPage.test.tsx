import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JoinPage, readJoinFor, type JoinView } from "./JoinPage";

const auth = vi.hoisted(() => ({ authenticated: false }));
const initOAuth = vi.hoisted(() => vi.fn());
const request = vi.hoisted(() => vi.fn());
const me = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("../lib/privy", () => ({
  usePrivy: () => ({ ready: true, authenticated: auth.authenticated }),
  useLoginWithOAuth: () => ({ initOAuth, state: { status: "initial" } }),
}));
vi.mock("../context/TakeIdentityContext", () => ({
  useTakeMe: () => ({ me: me.value, request, status: auth.authenticated ? "ready" : "unauthenticated" }),
}));
vi.mock("../context/TakeProductContext", () => ({ useTakeProduct: () => ({ refetch: vi.fn(async () => undefined) }) }));
vi.mock("../lib/currentIdentity", () => ({
  personFromMe: () => ({ id: "me", name: "Me", handle: "@me", avatarUrl: null, joined: true, recipient: { type: "take_identity", takeIdentityId: "me" } }),
}));

function joinView(overrides: Partial<JoinView> = {}): JoinView {
  return {
    code: "abc234xyz9",
    open: true,
    campaign: { id: "c1", title: "WL round", description: "Back a builder.", status: "DRAFT", endTime: "2026-10-20T10:00:00Z", organizationName: "Monad NFT", resourceName: "WL spot", seatCount: 20 },
    signupDeadline: "2026-10-12T18:00:00Z",
    recipientSelfJoin: true,
    counts: { givers: 4, recipients: 6 },
    for: null,
    viewer: null,
    ...overrides,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/join/abc234xyz9");
  auth.authenticated = false;
  me.value = null;
  request.mockReset();
  initOAuth.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("JoinPage", () => {
  it("shows a signed-out visitor who they back and signs in with X, returning to the link", async () => {
    window.history.replaceState(null, "", "/join/abc234xyz9?for=@ada");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(joinView({
      for: { takeIdentityId: "r1", displayName: "Ada", username: "ada", avatarUrl: null },
    })), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<JoinPage code="abc234xyz9" navigate={vi.fn()} />);
    expect(await screen.findByText("Back @ada on TAKE")).toBeInTheDocument();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/join/abc234xyz9?for=ada");
    expect(screen.queryByRole("button", { name: /Join as recipient/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sign in with X to join/ }));
    expect(initOAuth).toHaveBeenCalledWith({ provider: "twitter" });
    expect(window.sessionStorage.getItem("take-post-auth-destination")).toBe("/join/abc234xyz9");
    // The referral survives the OAuth round trip.
    expect(readJoinFor("abc234xyz9", "")).toBe("ada");
  });

  it("joins a signed-in giver and lands on the campaign", async () => {
    auth.authenticated = true;
    me.value = { id: "me" };
    request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") return { campaignId: "c1", joinedAs: "GIVER", gas: { outcome: "SENT" } };
      return joinView({ viewer: { joinedAs: null, removed: false, interested: false } });
    });
    const navigate = vi.fn();
    render(<JoinPage code="abc234xyz9" navigate={navigate} />);
    expect(await screen.findByRole("button", { name: "Join as recipient" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Join as giver" }));
    expect(await screen.findByText(/You’re in as a giver/)).toBeInTheDocument();
    expect(screen.getByText(/sent a little MON/)).toBeInTheDocument();
    const post = request.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ role: "GIVER", for: null });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/campaign/c1"), { timeout: 3000 });
  });

  it("tells someone outside the member list that the campaign is members-only", async () => {
    auth.authenticated = true;
    me.value = { id: "me" };
    request.mockImplementation(async () => joinView({
      viewer: { joinedAs: null, removed: false, interested: false },
      membersOnly: { community: "Monad Builders", viewerIsMember: false },
    }));
    render(<JoinPage code="abc234xyz9" navigate={vi.fn()} />);
    expect(await screen.findByText("This campaign is for Monad Builders members only.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join as giver" })).not.toBeInTheDocument();
  });

  it("closed links offer to notify about the next campaign", async () => {
    auth.authenticated = true;
    me.value = { id: "me" };
    request.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST") return { interested: true };
      return joinView({ open: false, viewer: { joinedAs: null, removed: false, interested: false } });
    });
    render(<JoinPage code="abc234xyz9" navigate={vi.fn()} />);
    expect(await screen.findByText("Sign-ups closed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Notify me/ }));
    expect(await screen.findByText(/We’ll let you know/)).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("/join/abc234xyz9/interest", { method: "POST" });
  });
});
