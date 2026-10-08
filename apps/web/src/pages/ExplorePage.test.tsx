import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { xConnectedMe } from "../test/identityFixture";
import type { Campaign } from "../types/product";
import { ExplorePage } from "./ExplorePage";

const product = vi.hoisted(() => ({ campaigns: [] as Campaign[] }));

vi.mock("../context/TakeIdentityContext", () => ({
  useTakeMe: () => ({ me: xConnectedMe, history: { given: [], received: [] } }),
}));

vi.mock("../context/TakeProductContext", () => ({
  useTakeProduct: () => ({ campaigns: product.campaigns, status: "ready", error: null, refetch: vi.fn() }),
}));

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "demo",
    organizationId: "org-1",
    title: "TAKE Demo",
    description: "One builder spot. Give it to someone else.",
    organizer: "Monad Devs",
    organizerMark: "M",
    status: "LIVE",
    sourceStatus: "ACTIVE",
    resource: "1 builder spot",
    resourceName: "Builder spots",
    spots: 1,
    participants: 4,
    startsAt: "2026-10-06T10:00:00.000Z",
    endsAt: "2026-10-13T10:00:00.000Z",
    starts: "06 OCT",
    ends: "13 OCT",
    nominationLimit: 1,
    nominationVisibilityMode: "PUBLIC",
    nominatorEligibilityMode: "MERKLE_ALLOWLIST",
    recipientEligibilityMode: "MERKLE_ALLOWLIST",
    viewer: { usedTakes: 0, availableTakes: 1, canParticipate: true, eligibility: null },
    visual: "coral",
    onchain: { published: true, network: "monad-testnet", chainId: 10143, managerContractAddress: null, campaignId: "4", authorityWalletAddress: null, organizerAddress: null, lifecycle: {} },
    ...overrides,
  };
}

describe("Explore sticker page", () => {
  beforeEach(() => {
    product.campaigns = [
      campaign(),
      campaign({ id: "grants", title: "Creator Grants", organizer: "Kitchen DAO", organizerMark: "K", status: "CLOSED", sourceStatus: "CLOSED", resource: "3 grants", spots: 3, viewer: null }),
    ];
  });

  it("makes the live campaign the page, from real campaign data", () => {
    render(<ExplorePage navigate={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "TAKE Demo" })).toBeInTheDocument();
    expect(screen.getByText("by Monad Devs")).toBeInTheDocument();
    expect(screen.getByText("1 spot · ends Oct 13")).toBeInTheDocument();
    expect(screen.getByText("One builder spot. Give it to someone else.")).toBeInTheDocument();
    expect(screen.getByText("LIVE", { selector: ".status-sticker--live span" })).toBeInTheDocument();
    expect(screen.queryByText(/Pass an opportunity/)).not.toBeInTheDocument();
  });

  it("sends Give your TAKE to the existing give flow", () => {
    const navigate = vi.fn();
    render(<ExplorePage navigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Give your TAKE" }));
    expect(navigate).toHaveBeenCalledWith("/campaign/demo/give");
  });

  it("does not offer a give when the viewer cannot give", () => {
    product.campaigns = [campaign({ viewer: { usedTakes: 0, availableTakes: 0, canParticipate: false, eligibility: null } })];
    const navigate = vi.fn();
    render(<ExplorePage navigate={navigate} />);
    expect(screen.queryByRole("button", { name: "Give your TAKE" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open TAKE Demo" }));
    expect(navigate).toHaveBeenCalledWith("/campaign/demo");
  });

  it("keeps search and the live, upcoming, and closed filters working", () => {
    render(<ExplorePage navigate={vi.fn()} />);
    expect(screen.getByText("Creator Grants")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "CLOSED" }));
    expect(screen.getByRole("heading", { name: "Creator Grants" })).toBeInTheDocument();
    expect(screen.queryByText("TAKE Demo")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "UPCOMING" }));
    expect(screen.getByRole("heading", { name: "Nothing is scheduled." })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ALL" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search campaigns" }), { target: { value: "kitchen" } });
    expect(screen.getByRole("heading", { name: "Creator Grants" })).toBeInTheDocument();
    expect(screen.queryByText("TAKE Demo")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search campaigns" }), { target: { value: "nothing like this" } });
    expect(screen.getByRole("heading", { name: "No opportunities found." })).toBeInTheDocument();
  });

  it("uses original artwork instead of a photo when a campaign has no image", () => {
    render(<ExplorePage navigate={vi.fn()} />);
    expect(screen.getByRole("img", { name: "TAKE Demo artwork" }).tagName.toLowerCase()).toBe("svg");
  });
});
