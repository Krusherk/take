import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SignalRecommendation } from "../../../../packages/shared/src/signal";
import { RecommendationRow } from "./Signal";
import { afterSteps, CallIt } from "./SignalAfter";

const now = Date.parse("2026-10-09T12:00:00.000Z");
const base: SignalRecommendation = {
  id: "e1", giver: { key: "0x9", name: "Me", avatarUrl: null }, recipient: { key: "0x1", name: "Ada Obi", avatarUrl: null },
  campaign: { id: "c1", title: "Builder Week", resource: "1 grant", status: "FINALIZED" }, givenAt: "2026-10-02T10:00:00.000Z",
  domain: "BUILDER", plan: { id: "p1", campaignId: "c1", domain: "BUILDER", question: "Did they ship what they planned?", criteria: "Yes: shipped.", evaluateAfter: "2026-11-01T12:00:00.000Z", evidenceExpected: true, createdAt: "2026-10-01T00:00:00.000Z", lockedAt: "2026-10-01T00:00:00.000Z" },
  evaluation: null, state: "PENDING", receivedOpportunity: true,
};

describe("after the TAKE", () => {
  it("walks Given → Chosen → Check → Outcome from real fields", () => {
    expect(afterSteps(base, now).map((step) => [step.label, step.state])).toEqual([["Given", "done"], ["Chosen", "done"], ["Check", "now"], ["Outcome", "todo"]]);
    expect(afterSteps(base, now)[2]!.detail).toContain("in 23 days");
    expect(afterSteps({ ...base, receivedOpportunity: null }, now)[1]).toMatchObject({ label: "Chosen?", state: "now" });
    expect(afterSteps({ ...base, plan: null, state: "NOT_PLANNED" }, now)[2]).toMatchObject({ detail: "not scheduled", state: "off" });
    const recorded = afterSteps({ ...base, state: "POSITIVE", evaluation: { status: "POSITIVE", evidenceUrls: [], note: null, isPublic: false, evaluatedAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z", evaluator: { key: "", name: "Op", avatarUrl: null } } }, Date.parse("2026-11-03T00:00:00.000Z"));
    expect(recorded.every((step) => step.state === "done")).toBe(true);
  });

  it("lets a giver call it, and shows the split only when the API returns it", async () => {
    const onCall = vi.fn(async () => {});
    const { rerender } = render(<CallIt item={base} entry={{ campaignId: "c1", recipientKey: "0x1", mine: null, open: true, closesAt: base.plan!.evaluateAfter, split: null }} onCall={onCall} />);
    expect(screen.getByText(/No money, no points/)).toBeInTheDocument();
    expect(screen.getByText(/shows after the results are committed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    await waitFor(() => expect(onCall).toHaveBeenCalledWith("UNSURE"));
    rerender(<CallIt item={base} entry={{ campaignId: "c1", recipientKey: "0x1", mine: "YES", open: true, closesAt: base.plan!.evaluateAfter, split: { yes: 4, unsure: 2, no: 1, total: 7 } }} onCall={onCall} />);
    expect(screen.getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "People who backed Ada Obi: 4 yes, 2 not sure, 1 no" })).toBeInTheDocument();
  });

  it("explains a missing check honestly and links to scheduling one", () => {
    const navigate = vi.fn();
    render(<ol><RecommendationRow item={{ ...base, plan: null, state: "NOT_PLANNED" }} navigate={navigate} calls={{ available: true, find: () => null, make: async () => {} }} /></ol>);
    expect(screen.queryByText(/Nothing is scheduled/)).toBeNull();
    expect(screen.getByText(/can't be added later/)).toBeInTheDocument();
    expect(screen.queryByText("CALL IT")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: /Schedule a check in your next campaign/ }));
    expect(navigate).toHaveBeenCalledWith("/organize");
  });

  it("hides calls when the calls endpoint is not available", () => {
    render(<ol><RecommendationRow item={base} navigate={vi.fn()} calls={{ available: false, find: () => null, make: async () => {} }} /></ol>);
    expect(screen.queryByText("CALL IT")).toBeNull();
    expect(screen.getByRole("progressbar", { name: "After the TAKE" })).toBeInTheDocument();
  });
});
