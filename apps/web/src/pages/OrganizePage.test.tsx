import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Campaign } from "../types/product";
import { OrganizePage } from "./OrganizePage";

const request = vi.hoisted(() => vi.fn(async (path: string) => {
  if (path === "/organizations/mine") {
    return [{ id: "org-1", name: "Monad Devs", slug: "monad-devs", role: "OWNER", joinedAt: "2026-01-01T00:00:00.000Z" }];
  }
  if (path.startsWith("/people")) return { people: [] };
  if (path === "/operator/me") return { operator: true };
  return [];
}));

vi.mock("../context/TakeIdentityContext", () => ({
  useTakeMe: () => ({ request, me: { wallets: [] } }),
}));

vi.mock("../context/TakeProductContext", () => ({
  useTakeProduct: () => ({
    campaigns: [{
      id: "demo",
      organizationId: "org-1",
      title: "TAKE Demo",
      description: "One TAKE for a builder spot.",
      organizer: "Monad Devs",
      organizerMark: "M",
      status: "UPCOMING",
      sourceStatus: "DRAFT",
      resource: "1 builder spot",
      resourceName: "Builder spot",
      spots: 1,
      participants: null,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      starts: "06 OCT",
      ends: "13 OCT",
      nominationLimit: 1,
      nominationVisibilityMode: "PUBLIC",
      nominatorEligibilityMode: "MERKLE_ALLOWLIST",
      recipientEligibilityMode: "MERKLE_ALLOWLIST",
      viewer: null,
      visual: "coral",
      launchApproved: true,
    } satisfies Campaign],
    refetch: vi.fn(),
  }),
}));

vi.mock("../components/CampaignLaunchSigner", () => ({
  CampaignLaunchSigner: () => <div>Wallet signature</div>,
}));

describe("Organize page", () => {
  it("leads with the signature that makes a campaign live", async () => {
    render(<OrganizePage navigate={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Sign to publish on Monad." })).toBeInTheDocument();
    expect(screen.getByText("Wallet signature")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What are you giving?" })).toBeInTheDocument();
    expect(screen.queryByText(/TAKE will review/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Advanced mechanism/i)).not.toBeInTheDocument();
  });
});
