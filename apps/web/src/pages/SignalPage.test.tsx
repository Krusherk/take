import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SignalHistory } from "../../../../packages/shared/src/signal";
import { xConnectedMe } from "../test/identityFixture";
import type { TakeHistory } from "../types/identity";
import { SignalPage } from "./SignalPage";

const state = vi.hoisted(() => ({ history: { given: [], received: [] } as TakeHistory }));

const emptySignal: SignalHistory = {
  counts: { recommendations: 0, evaluated: 0, positive: 0, negative: 0, inconclusive: 0, pending: 0, notPlanned: 0, notSelected: 0 },
  domains: [],
  history: [],
};

vi.mock("../context/TakeIdentityContext", () => ({
  useTakeMe: () => ({ me: xConnectedMe, history: state.history }),
}));

vi.mock("../hooks/useSignal", () => ({
  useSignal: () => ({ data: emptySignal, error: null, reload: vi.fn() }),
}));

describe("Signal sticker page", () => {
  beforeEach(() => {
    state.history = { given: [], received: [] };
  });

  it("leads with the real person who backed the viewer", () => {
    state.history = {
      given: [],
      received: [{
        id: "nom-1",
        campaignId: "campaign-4",
        campaignTitle: "Builder Week",
        person: { displayName: "Ada Obi", username: "adaobi", avatarUrl: null, joined: true },
        transactionHash: "0xabc",
        status: "CONFIRMED",
        createdAt: "2026-10-06T10:00:00.000Z",
        confirmedAt: "2026-10-06T10:01:00.000Z",
      }],
    };
    const navigate = vi.fn();
    render(<SignalPage navigate={navigate} />);

    expect(screen.getByRole("heading", { name: "Ada Obi backed you." })).toBeInTheDocument();
    expect(screen.getByText("for Builder Week")).toBeInTheDocument();
    expect(screen.getByText("Ada Obi → you")).toBeInTheDocument();
    expect(screen.getByText("Confirmed. Waiting to see what happened.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ada Obi's profile picture" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Real X Person's profile picture" })).toBeInTheDocument();
    expect(screen.queryByText(/crack|rumey/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Builder Week" }));
    expect(navigate).toHaveBeenCalledWith("/campaign/campaign-4");
  });

  it("is honest when nobody has backed the viewer", () => {
    const navigate = vi.fn();
    render(<SignalPage navigate={navigate} />);

    expect(screen.getByRole("heading", { name: "Nobody has backed you yet." })).toBeInTheDocument();
    // Only the viewer's own face; the empty slot is a question mark, not a person.
    expect(screen.getAllByRole("img", { name: /profile picture/ })).toHaveLength(1);
    expect(screen.queryByText("Your signal starts with a person.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Give a TAKE" }));
    expect(navigate).toHaveBeenCalledWith("/explore");
  });
});
