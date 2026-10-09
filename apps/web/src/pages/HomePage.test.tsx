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

  it("with no live campaigns shows a clear empty state with Explore and Organize", () => {
    product.campaigns = [];
    const navigate = vi.fn();
    render(<HomePage navigate={navigate} currentPerson={person} optimisticGivenCampaigns={[]} optimisticRecipient={null} />);

    expect(screen.getByRole("heading", { name: "Nothing is live right now." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explore campaigns" }));
    expect(navigate).toHaveBeenCalledWith("/explore");
    fireEvent.click(screen.getByRole("button", { name: /Organize a campaign/ }));
    expect(navigate).toHaveBeenCalledWith("/organize");
  });

  it("never names one campaign when the person holds no TAKE", () => {
    const watching = { usedTakes: 0, availableTakes: 0, canParticipate: false, eligibility: null };
    product.campaigns = [
      campaign({ id: "a", title: "Alpha Spots", viewer: watching }),
      campaign({ id: "b", title: "Beta Tickets", viewer: watching }),
      campaign({ id: "c", title: "Gamma Seats", viewer: watching }),
    ];
    const navigate = vi.fn();
    render(<HomePage navigate={navigate} currentPerson={person} optimisticGivenCampaigns={[]} optimisticRecipient={null} />);

    expect(screen.getByRole("heading", { name: "3 campaigns are live." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /is live\./ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Live now · 3" })).toBeInTheDocument();
    for (const title of ["Alpha Spots", "Beta Tickets", "Gamma Seats"]) expect(screen.getByText(title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explore live campaigns" }));
    expect(navigate).toHaveBeenCalledWith("/explore");
  });

  it("gives each held TAKE its own give action when there are several", () => {
    product.campaigns = [
      campaign({ id: "a", title: "Alpha Spots", endsAt: "2026-10-20T10:00:00.000Z" }),
      campaign({ id: "b", title: "Beta Tickets", endsAt: "2026-10-11T10:00:00.000Z" }),
      campaign({ id: "c", title: "Gamma Seats", viewer: { usedTakes: 0, availableTakes: 0, canParticipate: false, eligibility: null } }),
    ];
    const navigate = vi.fn();
    render(<HomePage navigate={navigate} currentPerson={person} optimisticGivenCampaigns={[]} optimisticRecipient={null} />);

    expect(screen.getByRole("heading", { name: "You have 2 TAKEs." })).toBeInTheDocument();
    const gives = screen.getAllByRole("button", { name: /^Give your TAKE in / });
    expect(gives.map((button) => button.getAttribute("aria-label"))).toEqual(["Give your TAKE in Beta Tickets", "Give your TAKE in Alpha Spots"]);
    fireEvent.click(gives[1]!);
    expect(navigate).toHaveBeenCalledWith("/campaign/a/give");
    expect(screen.getByRole("heading", { name: "Live now · 3" })).toBeInTheDocument();
  });

  it("caps the live list on Home and points to Explore for the rest", () => {
    const watching = { usedTakes: 0, availableTakes: 0, canParticipate: false, eligibility: null };
    product.campaigns = Array.from({ length: 6 }, (_, index) => campaign({ id: `c${index}`, title: `Campaign ${index}`, viewer: watching }));
    const navigate = vi.fn();
    const { container } = render(<HomePage navigate={navigate} currentPerson={person} optimisticGivenCampaigns={[]} optimisticRecipient={null} />);

    expect(container.querySelectorAll("#campaigns .sticker-row")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: /Explore all 6/ }));
    expect(navigate).toHaveBeenCalledWith("/explore");
  });
});
