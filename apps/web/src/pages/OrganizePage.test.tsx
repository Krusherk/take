import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Campaign } from "../types/product";
import { OrganizePage } from "./OrganizePage";

const operatorState = vi.hoisted(() => ({ value: true }));
const request = vi.hoisted(() => vi.fn(async (path: string) => {
  if (path === "/organizations/mine") {
    return [{ id: "org-1", name: "Monad Devs", slug: "monad-devs", role: "OWNER", joinedAt: "2026-01-01T00:00:00.000Z" }];
  }
  if (path.startsWith("/people")) return { people: [
    { displayName: "Ada Obi", username: "adaobi", avatarUrl: null, recipient: { type: "take_identity", takeIdentityId: "11111111-1111-4111-8111-111111111111" } },
    { displayName: "Tunde K", username: "tundek", avatarUrl: null, recipient: { type: "take_identity", takeIdentityId: "22222222-2222-4222-8222-222222222222" } },
  ] };
  if (path.endsWith("/campaigns")) return operatorState.value
    ? { campaignId: "new-1", stage: "READY_TO_SIGN", message: "The campaign is ready." }
    : { campaignId: "new-1", stage: "DRAFT", message: "The campaign is saved." };
  if (path === "/operator/me") return { operator: operatorState.value };
  if (path === "/operator/server-wallet") return { configured: true, address: "0xCAf7053F61c7c6087B3Da5f43A027E77113C6ebE", balanceWei: "15000000000000000000" };
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
    fireEvent.click(await screen.findByRole("checkbox", { name: /Let people join with a link first/ }));
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
    fireEvent.click(await screen.findByRole("checkbox", { name: /Let people join with a link first/ }));
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

  it("uses wheels for the time, and offers server signing to operators", async () => {
    operatorState.value = true;
    render(<OrganizePage navigate={vi.fn()} />);
    expect(await screen.findByRole("spinbutton", { name: "Nominations end, day" })).toBeInTheDocument();
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Let people join with a link first/ }));
    expect(await screen.findByRole("checkbox", { name: /Let TAKE sign it onto Monad/ })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /Open as soon as I sign/ }));
    expect(screen.getByRole("spinbutton", { name: "Nominations open, hour" })).toBeInTheDocument();
  });

  it("tells a non-operator, next to the button, that the draft is not on Monad", async () => {
    operatorState.value = false;
    render(<OrganizePage navigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Let people join with a link first/ }));
    fireEvent.change(await screen.findByPlaceholderText("Monad community spots"), { target: { value: "Builder Week" } });
    fireEvent.change(screen.getByPlaceholderText("Builder spot"), { target: { value: "Builder grant" } });
    fireEvent.change(screen.getByPlaceholderText("One TAKE each. Give it to someone else."), { target: { value: "One grant." } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Can give" }))[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Can receive" })[1]!);
    expect(screen.queryByRole("checkbox", { name: /Let TAKE sign it onto Monad/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Create campaign/ }));
    const status = await screen.findByText("Saved as a draft. Not on Monad yet.");
    expect(status.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText(/not a TAKE operator/)).toBeInTheDocument();
    operatorState.value = true;
  });

  it("shows form problems as an error toast", async () => {
    render(<OrganizePage navigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Create and open sign-ups/ }));
    expect(await screen.findByText(/things to fix\./)).toBeInTheDocument();
  });

  it("creates a sign-ups campaign without people and shows its join link", async () => {
    request.mockClear();
    request.mockImplementationOnce(async () => [{ id: "org-1", name: "Monad Devs", slug: "monad-devs", role: "OWNER", joinedAt: "2026-01-01T00:00:00.000Z" }]);
    render(<OrganizePage navigate={vi.fn()} />);
    expect(await screen.findByRole("checkbox", { name: /Let people join with a link first/ })).toBeChecked();
    expect(screen.getByRole("spinbutton", { name: "Sign-ups close, day" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Open as soon as I sign/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Monad community spots"), { target: { value: "WL round" } });
    fireEvent.change(screen.getByPlaceholderText("Builder spot"), { target: { value: "WL spot" } });
    fireEvent.change(screen.getByPlaceholderText("One TAKE each. Give it to someone else."), { target: { value: "Back a builder." } });
    fireEvent.click(screen.getByRole("checkbox", { name: /join as recipients/ }));
    fireEvent.click(screen.getByRole("button", { name: /Create and open sign-ups/ }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/organizations/org-1/campaigns", expect.anything()));
    const call = request.mock.calls.find(([path]) => path === "/organizations/org-1/campaigns") as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body));
    expect(body.giverIdentityIds).toEqual([]);
    expect(body.signups.recipientSelfJoin).toBe(true);
    expect(Date.parse(body.signups.deadline)).toBeGreaterThan(Date.now());
    expect(Date.parse(body.signups.deadline)).toBeLessThan(Date.parse(body.endTime));
  });
});
