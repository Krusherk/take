import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { personFromMe } from "../lib/currentIdentity";
import { xConnectedMe } from "../test/identityFixture";
import type { TakeHistory } from "../types/identity";
import type { Campaign, Person } from "../types/product";
import { CampaignPage } from "./CampaignPage";

const state = vi.hoisted(() => ({
  campaigns: [] as Campaign[],
  people: [] as Person[],
  history: { given: [], received: [] } as unknown as TakeHistory,
  authenticated: true,
  login: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ authenticated: state.authenticated }),
  useLogin: () => ({ login: state.login }),
}));

vi.mock("../context/TakeIdentityContext", () => ({
  useTakeMe: () => ({ me: state.authenticated ? xConnectedMe : null, history: state.history, request: vi.fn() }),
}));

vi.mock("../context/TakeProductContext", () => ({
  useTakeProduct: () => ({ campaigns: state.campaigns, peoplePreview: state.people, status: "ready", error: null, refetch: state.refetch }),
}));

vi.mock("../components/eligibility/ParticipantEligibilityPanel", () => ({ ParticipantEligibilityPanel: () => null }));

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "demo",
    organizationId: "org-1",
    title: "Builder Spot Drive",
    description: "One builder spot. Give it to someone else.",
    organizer: "Monad Devs",
    organizerMark: "M",
    status: "LIVE",
    sourceStatus: "ACTIVE",
    resource: "1 builder spot",
    resourceName: "Builder spots",
    spots: 1,
    participants: null,
    startsAt: "2026-10-06T10:00:00.000Z",
    endsAt: "2026-10-13T10:00:00.000Z",
    starts: "06 OCT",
    ends: "13 OCT",
    nominationLimit: 1,
    nominationVisibilityMode: "PRIVATE",
    nominatorEligibilityMode: "MERKLE_ALLOWLIST",
    recipientEligibilityMode: "MERKLE_ALLOWLIST",
    viewer: { usedTakes: 0, availableTakes: 1, canParticipate: true, eligibility: null },
    visual: "coral",
    onchain: { published: true, network: "Monad Testnet", chainId: 10143, managerContractAddress: "0xc3a0", campaignId: "4", authorityWalletAddress: "0xbc50", organizerAddress: "0xbc50", lifecycle: { activate: { status: "COMPLETED", transactionHash: "0xabc" } } },
    ...overrides,
  } as Campaign;
}

const renderPage = (navigate = vi.fn()) => render(<CampaignPage campaignId="demo" navigate={navigate} optimisticGivenCampaigns={[]} optimisticRecipient={null} />);

describe("Campaign detail sticker page", () => {
  beforeEach(() => {
    state.campaigns = [campaign()];
    state.people = [];
    state.history = { given: [], received: [] } as unknown as TakeHistory;
    state.authenticated = true;
    state.login.mockReset();
    state.refetch.mockReset();
  });

  it("shows the real campaign and the signed-in person, then opens the give flow", () => {
    const navigate = vi.fn();
    const { container } = renderPage(navigate);

    expect(container.querySelector(".sticker-page.sticker-detail")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Builder Spot Drive");
    expect(screen.getByText("by Monad Devs")).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByText("you")).toBeInTheDocument();
    expect(container.querySelector(`.sticker-campaign__handoff img[src="${personFromMe(xConnectedMe).avatarUrl}"]`)).not.toBeNull();
    expect(screen.getByText(/1 builder spot · ends 13 OCT/)).toBeInTheDocument();
    expect(screen.queryByText(/rumey/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Give your TAKE" }));
    expect(navigate).toHaveBeenCalledWith("/campaign/demo/give");
  });

  it("names the person the TAKE went to and links to the choice", () => {
    state.campaigns = [campaign({ viewer: { usedTakes: 1, availableTakes: 0, canParticipate: true, eligibility: null } })];
    state.history = { given: [{ id: "n1", campaignId: "demo", campaignTitle: "Builder Spot Drive", person: { displayName: "Ada Obi", username: "adaobi", avatarUrl: null, joined: true }, transactionHash: "0x1", status: "CONFIRMED", createdAt: "2026-10-07", confirmedAt: "2026-10-07" }], received: [] } as unknown as TakeHistory;
    const navigate = vi.fn();
    renderPage(navigate);

    expect(screen.getByRole("heading", { name: "You gave your TAKE to Ada Obi." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View your choice" }));
    expect(navigate).toHaveBeenCalledWith("/takes");
  });

  it("is honest when the person is not on the giver list", () => {
    state.campaigns = [campaign({ viewer: { usedTakes: 0, availableTakes: 0, canParticipate: false, eligibility: null } })];
    const navigate = vi.fn();
    renderPage(navigate);

    expect(screen.getByRole("heading", { name: "You can’t give in this one." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Give your TAKE" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See other campaigns" }));
    expect(navigate).toHaveBeenCalledWith("/explore");
  });

  it("asks signed-out visitors to sign in", () => {
    state.authenticated = false;
    state.campaigns = [campaign({ viewer: null })];
    renderPage();

    expect(screen.getByRole("heading", { name: "Sign in to see your TAKE." })).toBeInTheDocument();
    expect(screen.queryByText("you")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to see if you can give" }));
    expect(state.login).toHaveBeenCalledTimes(1);
  });

  it("keeps the onchain record and transaction links", () => {
    renderPage();
    expect(screen.getByText("Onchain record")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View transaction" })).toHaveAttribute("href", "https://testnet.monadexplorer.com/tx/0xabc");
  });

  it("sends drafts back to Organize", () => {
    state.campaigns = [campaign({ sourceStatus: "DRAFT", status: "UPCOMING", onchain: { published: false, network: "Monad Testnet", chainId: 10143, managerContractAddress: null, campaignId: null, authorityWalletAddress: null, organizerAddress: null, lifecycle: {} } })];
    const navigate = vi.fn();
    renderPage(navigate);

    expect(screen.getByText("OFFCHAIN DRAFT")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue campaign setup" }));
    expect(navigate).toHaveBeenCalledWith("/organize");
  });
});
