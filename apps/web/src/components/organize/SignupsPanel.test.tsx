import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignupsPanel, type SignupsView } from "./SignupsPanel";

function view(overrides: Partial<SignupsView> = {}): SignupsView {
  return {
    campaignId: "c1",
    code: "abc234xyz9",
    joinEnabled: true,
    open: true,
    status: "OPEN",
    campaignStatus: "DRAFT",
    signupDeadline: null,
    recipientSelfJoin: false,
    autoOpen: true,
    canOpen: true,
    lastError: null,
    closeReport: {},
    interestCount: 0,
    givers: [
      { takeIdentityId: "g1", displayName: "Bo", username: "bo", avatarUrl: null, via: "JOIN_LINK", broughtBy: null, joinedAt: "2026-10-09T10:00:00Z" },
      { takeIdentityId: "g2", displayName: "Cy", username: "cy", avatarUrl: null, via: "RECIPIENT_LINK", broughtBy: { takeIdentityId: "r1", displayName: "Ada", username: "ada" }, joinedAt: "2026-10-09T10:01:00Z" },
    ],
    recipients: [
      { takeIdentityId: "r1", displayName: "Ada", username: "ada", avatarUrl: null, via: "ORGANIZER", broughtBy: null, joinedAt: "2026-10-09T09:00:00Z" },
    ],
    ...overrides,
  };
}

describe("SignupsPanel", () => {
  it("lists joiners with who brought them, copies links, removes and opens", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onFeedback = vi.fn();
    const onOpened = vi.fn();
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/remove")) return view({ givers: view().givers.slice(1) });
      if (path.endsWith("/close")) return { ...view({ status: "CLOSED", open: false, campaignStatus: "ACTIVE" }), result: { outcome: "OPEN" } };
      void init;
      return view();
    }) as never;
    render(<SignupsPanel campaignId="c1" request={request} onFeedback={onFeedback} onOpened={onOpened} />);

    expect(await screen.findByText("SIGN-UPS OPEN")).toBeInTheDocument();
    expect(screen.getByText("brought by @ada")).toBeInTheDocument();
    expect(screen.getByText(/\/join\/abc234xyz9/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Copy join link/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/abc234xyz9`));
    fireEvent.click(screen.getByRole("button", { name: "Copy Ada’s share link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/abc234xyz9?for=ada`));

    fireEvent.click(screen.getByRole("button", { name: "Remove Bo" }));
    await waitFor(() => expect(screen.queryByText("Bo")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Close sign-ups and open/ }));
    await waitFor(() => expect(onOpened).toHaveBeenCalled());
    expect(onFeedback).toHaveBeenLastCalledWith("success", "Nominations are open.", expect.any(String));
    expect(screen.getByText("LISTS LOCKED")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("tells a non-operator that an operator opens it", async () => {
    const request = vi.fn(async () => view({ canOpen: false, autoOpen: false })) as never;
    render(<SignupsPanel campaignId="c1" request={request} onFeedback={vi.fn()} onOpened={vi.fn()} />);
    expect(await screen.findByText(/Only a TAKE operator can open nominations/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Close sign-ups and open/ })).not.toBeInTheDocument();
  });
});
