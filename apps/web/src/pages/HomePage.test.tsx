import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { personFromMe } from "../lib/currentIdentity";
import { xConnectedMe } from "../test/identityFixture";
import type { Campaign } from "../types/product";
import { HomePage } from "./HomePage";

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

const person = personFromMe(xConnectedMe);

describe("Home sticker page", () => {
  beforeEach(() => {
    product.campaigns = [campaign()];
  });

  it("greets the signed-in person by name and sends the one action to the give flow", () => {
    const navigate = vi.fn();
    render(<HomePage navigate={navigate} currentPerson={person} optimisticGivenCampaigns={[]} optimisticRecipient={null} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(`${person.name.split(" ")[0]}.`);
    expect(screen.getByRole("heading", { name: "You have one TAKE." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Give your TAKE" }));
    expect(navigate).toHaveBeenCalledWith("/campaign/demo/give");
  });

  it("points to the person's choice once the TAKE is given", () => {
    product.campaigns = [campaign({ viewer: { usedTakes: 1, availableTakes: 0, canParticipate: true, eligibility: null } })];
    const navigate = vi.fn();
    render(<HomePage navigate={navigate} currentPerson={person} optimisticGivenCampaigns={[]} optimisticRecipient={null} />);

    fireEvent.click(screen.getByRole("button", { name: "View your choice" }));
    expect(navigate).toHaveBeenCalledWith("/takes");
  });

  it("sends people with no TAKE waiting to Explore", () => {
    product.campaigns = [];
    const navigate = vi.fn();
    render(<HomePage navigate={navigate} currentPerson={person} optimisticGivenCampaigns={[]} optimisticRecipient={null} />);

    expect(screen.getByRole("heading", { name: "No TAKE is waiting." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explore campaigns" }));
    expect(navigate).toHaveBeenCalledWith("/explore");
  });
});
