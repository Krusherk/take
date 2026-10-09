import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { xConnectedMe } from "../test/identityFixture";
import type { TakeHistory } from "../types/identity";
import type { Campaign } from "../types/product";
import { ActivityPage } from "./ActivityPage";
import { NotificationsPage } from "./NotificationsPage";
import { TakesPage } from "./TakesPage";

const state = vi.hoisted(() => ({ history: { given: [], received: [] } as TakeHistory, campaigns: [] as Campaign[] }));

const notificationsRequest = vi.hoisted(() => vi.fn(async () => []));

vi.mock("../context/TakeIdentityContext", () => ({
  useTakeMe: () => ({ me: xConnectedMe, history: state.history, request: notificationsRequest }),
}));

vi.mock("../context/TakeProductContext", () => ({
  useTakeProduct: () => ({ campaigns: state.campaigns, status: "ready", error: null, refetch: vi.fn() }),
}));

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "demo",
    organizationId: "org-1",
    title: "Builder Week",
    description: "One builder spot.",
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

const receivedFromAda: TakeHistory["received"][number] = {
  id: "nom-1",
  campaignId: "demo",
  campaignTitle: "Builder Week",
  person: { displayName: "Ada Obi", username: "adaobi", avatarUrl: null, joined: true },
  transactionHash: "0xabc",
  status: "CONFIRMED",
  createdAt: "2026-10-06T10:00:00.000Z",
  confirmedAt: "2026-10-06T10:01:00.000Z",
};

describe("sticker feed pages", () => {
  beforeEach(() => {
    state.history = { given: [], received: [] };
    state.campaigns = [];
  });

  it("notifications show the real giver and deadlines, and mark all read", () => {
    state.history = { given: [], received: [receivedFromAda] };
    state.campaigns = [campaign()];
    const navigate = vi.fn();
    const onMarkRead = vi.fn();
    render(<NotificationsPage navigate={navigate} read={false} onMarkRead={onMarkRead} />);

    expect(screen.getByRole("heading", { name: "When someone chooses you, you’ll know." })).toBeInTheDocument();
    expect(screen.getByText("Ada Obi")).toBeInTheDocument();
    expect(screen.getByText("Builder Week is open until 13 OCT.")).toBeInTheDocument();
    expect(screen.queryByText(/crack|rumey|kubo/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "MARK ALL READ" }));
    expect(onMarkRead).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole("button", { name: "Builder Week" })[0]!);
    expect(navigate).toHaveBeenCalledWith("/campaign/demo");
  });

  it("notifications disable mark read once read and offer Explore when empty", () => {
    const navigate = vi.fn();
    render(<NotificationsPage navigate={navigate} read onMarkRead={vi.fn()} />);
    expect(screen.getByRole("button", { name: "ALL READ" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /EXPLORE CAMPAIGNS/ }));
    expect(navigate).toHaveBeenCalledWith("/explore");
  });

  it("Your Takes sends an unused TAKE to the give flow", () => {
    state.campaigns = [campaign()];
    const navigate = vi.fn();
    render(<TakesPage navigate={navigate} optimisticGivenCampaigns={[]} optimisticRecipient={null} />);

    expect(screen.getByRole("heading", { name: "Every TAKE belongs to a person and a moment." })).toBeInTheDocument();
    expect(screen.getByText("01")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "GIVE IT" }));
    expect(navigate).toHaveBeenCalledWith("/campaign/demo/give");
  });

  it("Your Takes shows who a given TAKE went to", () => {
    state.campaigns = [campaign({ viewer: { usedTakes: 1, availableTakes: 0, canParticipate: false, eligibility: null } })];
    state.history = { given: [{ ...receivedFromAda, id: "nom-2" }], received: [] };
    const navigate = vi.fn();
    render(<TakesPage navigate={navigate} optimisticGivenCampaigns={[]} optimisticRecipient={null} />);

    expect(screen.getByRole("heading", { name: "Given to Ada Obi" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "VIEW CHOICE" }));
    expect(navigate).toHaveBeenCalledWith("/activity");
  });

  it("Activity filters given and received", () => {
    state.history = { given: [], received: [receivedFromAda] };
    render(<ActivityPage navigate={vi.fn()} />);

    expect(screen.getByText("1 CHOICE")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "GIVEN" }));
    expect(screen.getByText("No TAKES given yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GIVEN" })).toHaveAttribute("aria-pressed", "true");
  });
});
