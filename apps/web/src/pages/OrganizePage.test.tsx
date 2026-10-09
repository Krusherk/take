import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Campaign } from "../types/product";
import { OrganizePage } from "./OrganizePage";

const request = vi.hoisted(() => vi.fn(async (path: string) => {
  if (path === "/organizations/mine") {
    return [{ id: "org-1", name: "Monad Devs", slug: "monad-devs", role: "OWNER", joinedAt: "2026-01-01T00:00:00.000Z" }];
  }
  if (path.startsWith("/people")) return { people: [
    { displayName: "Ada Obi", username: "adaobi", avatarUrl: null, recipient: { type: "take_identity", takeIdentityId: "11111111-1111-4111-8111-111111111111" } },
    { displayName: "Tunde K", username: "tundek", avatarUrl: null, recipient: { type: "take_identity", takeIdentityId: "22222222-2222-4222-8222-222222222222" } },
  ] };
  if (path.endsWith("/campaigns")) return { campaignId: "new-1", message: "The campaign is ready." };
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

  it("locks a scheduled check with the new campaign, before nominations can open", async () => {
    render(<OrganizePage navigate={vi.fn()} />);
    fireEvent.change(await screen.findByPlaceholderText("Monad community spots"), { target: { value: "Builder Week" } });
    fireEvent.change(screen.getByPlaceholderText("Builder spot"), { target: { value: "Builder grant" } });
    fireEvent.change(screen.getByPlaceholderText("One TAKE each. Give it to someone else."), { target: { value: "One grant." } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Can give" }))[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Can receive" })[1]!);
    expect(screen.getByRole("heading", { name: "Schedule a check" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Add a check" }));
    fireEvent.click(screen.getByRole("button", { name: "Did they show up?" }));
    expect(screen.getByDisplayValue("Did they show up and take part?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "90 days" }));
    expect(screen.getByText(/Locked when you create the campaign/)).toBeInTheDocument();
    const before = Date.now();
    fireEvent.click(screen.getByRole("button", { name: /Create campaign/ }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/organizations/org-1/campaigns", expect.anything()));
    const call = request.mock.calls.find(([path]) => path === "/organizations/org-1/campaigns") as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body));
    expect(Date.parse(body.startTime)).toBeGreaterThan(before + 2 * 60_000);
    expect(body.evaluationPlan).toMatchObject({ domain: "ACCESS", question: "Did they show up and take part?", evidenceExpected: true });
    expect(Date.parse(body.evaluationPlan.evaluateAfter) - Date.parse(body.endTime)).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it("sends no check when the organizer leaves it off", async () => {
    request.mockClear();
    render(<OrganizePage navigate={vi.fn()} />);
    fireEvent.change(await screen.findByPlaceholderText("Monad community spots"), { target: { value: "Builder Week" } });
    fireEvent.change(screen.getByPlaceholderText("Builder spot"), { target: { value: "Builder grant" } });
    fireEvent.change(screen.getByPlaceholderText("One TAKE each. Give it to someone else."), { target: { value: "One grant." } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Can give" }))[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Can receive" })[1]!);
    fireEvent.click(screen.getByRole("button", { name: /Create campaign/ }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/organizations/org-1/campaigns", expect.anything()));
    const call = request.mock.calls.find(([path]) => path === "/organizations/org-1/campaigns") as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body));
    expect(body.evaluationPlan).toBeUndefined();
    expect(Date.parse(body.startTime)).toBeLessThan(Date.now());
  });
});
