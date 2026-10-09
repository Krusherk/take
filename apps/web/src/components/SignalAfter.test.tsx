import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CampaignAfter, RecipientEvaluation, SignalRecommendation } from "../../../../packages/shared/src/signal";
import { RecommendationRow } from "./Signal";
import { afterSteps } from "./SignalAfter";
import { reviewDue, TeamReviewPanel } from "./SignalControls";

const now = Date.parse("2026-10-09T12:00:00.000Z");
const plan = { id: "p1", campaignId: "c1", domain: "BUILDER" as const, question: "Did they ship?", criteria: "Yes: shipped.", evaluateAfter: "2026-11-01T12:00:00.000Z", evidenceExpected: true, createdAt: "2026-10-01T00:00:00.000Z", lockedAt: "2026-10-01T00:00:00.000Z" };
const base: SignalRecommendation = {
  id: "e1", giver: { key: "0x9", name: "Me", avatarUrl: null }, recipient: { key: "0x1", name: "Ada Obi", avatarUrl: null },
  campaign: { id: "c1", title: "Builder Week", resource: "1 grant", status: "FINALIZED" }, givenAt: "2026-10-02T10:00:00.000Z",
  domain: "BUILDER", plan, evaluation: null, state: "PENDING", receivedOpportunity: true,
};
const yes: RecipientEvaluation = { status: "POSITIVE", evidenceUrls: ["https://example.com/v1"], note: "shipped v1", isPublic: true, evaluatedAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z", evaluator: { key: "", name: "Monad Devs", avatarUrl: null } };

describe("Signal after the TAKE", () => {
  it("walks Given → Chosen → Team check → Outcome from real fields", () => {
    expect(afterSteps(base, now).map((step) => [step.label, step.state])).toEqual([["Given", "done"], ["Chosen", "done"], ["Team check", "now"], ["Outcome", "todo"]]);
    expect(afterSteps(base, now)[2]!.detail).toContain("in 23 days");
    expect(afterSteps({ ...base, receivedOpportunity: null }, now)[1]).toMatchObject({ label: "Chosen?", state: "now" });
    expect(afterSteps({ ...base, plan: null, state: "NOT_PLANNED" }, now)[2]).toMatchObject({ detail: "not scheduled", state: "off" });
    const reviewed = afterSteps({ ...base, state: "POSITIVE", evaluation: yes }, Date.parse("2026-11-03T00:00:00.000Z"));
    expect(reviewed.every((step) => step.state === "done")).toBe(true);
    expect(reviewed[3]!.label).toBe("Yes");
  });

  it("says when the team checks, and has nothing for givers to vote on", () => {
    render(<ol><RecommendationRow item={base} navigate={vi.fn()} /></ol>);
    expect(screen.getByText(/The team checks on .*: did they ship\?/)).toBeInTheDocument();
    expect(screen.queryByText(/CALL IT/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Not sure" })).toBeNull();
  });

  it("shows the team's review to everyone once recorded", () => {
    render(<ol><RecommendationRow item={{ ...base, state: "POSITIVE", evaluation: yes }} navigate={vi.fn()} /></ol>);
    expect(screen.getByText("Team review: Yes")).toBeInTheDocument();
    expect(screen.getByText(/shipped v1/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Link/ })).toHaveAttribute("href", "https://example.com/v1");
  });

  it("explains a missing check and links to scheduling one", () => {
    const navigate = vi.fn();
    render(<ol><RecommendationRow item={{ ...base, plan: null, state: "NOT_PLANNED" }} navigate={navigate} /></ol>);
    expect(screen.getByText(/can't be added later/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /Schedule a check in your next campaign/ }));
    expect(navigate).toHaveBeenCalledWith("/organize");
  });
});

describe("Team review panel", () => {
  const after = (evaluateAfter: string, status = "FINALIZED"): CampaignAfter => ({
    campaignId: "c1", title: "Builder Week", status, resource: "1 grant", seats: 1, plan: { ...plan, evaluateAfter }, allocationCommitted: status === "FINALIZED",
    recipients: status === "FINALIZED" ? [{ person: { key: "0x" + "1".padStart(64, "0"), name: "Ada Obi", avatarUrl: null }, supporters: 3, evaluation: null }] : [], recommendations: [],
  });

  it("counts down to the review date", () => {
    expect(reviewDue("2026-11-01T12:00:00.000Z", now)).toBe("Review due in 23 days");
    expect(reviewDue("2026-10-10T11:00:00.000Z", now)).toBe("Review due tomorrow");
    expect(reviewDue("2026-10-01T00:00:00.000Z", now)).toBe("Review due now");
  });

  it("waits for the result and the date before anyone can record", () => {
    const { rerender } = render(<TeamReviewPanel data={after(new Date(Date.now() + 5 * 86400000).toISOString(), "ACTIVE")} request={vi.fn() as never} onSaved={async () => {}} />);
    expect(screen.getByText(/Review opens once the result is committed/)).toBeInTheDocument();
    rerender(<TeamReviewPanel data={after(new Date(Date.now() + 5 * 86400000).toISOString())} request={vi.fn() as never} onSaved={async () => {}} />);
    expect(screen.getByRole("button", { name: "Review due in 5 days" })).toBeDisabled();
    expect(screen.getByText(/Only the organizer and TAKE operators/)).toBeInTheDocument();
  });

  it("records Yes / No / Unclear through the existing evaluation endpoint", async () => {
    const request = vi.fn(async () => ({}));
    const onSaved = vi.fn(async () => {});
    render(<TeamReviewPanel data={after("2026-10-01T00:00:00.000Z")} request={request as never} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Record review" }));
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByPlaceholderText("Shipped v1 on Oct 30."), { target: { value: "shipped v1" } });
    fireEvent.change(screen.getByPlaceholderText("https://"), { target: { value: "https://example.com/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save review" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [path, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/operator/campaigns/c1/evaluations");
    expect(JSON.parse(String(init.body))).toEqual({ recipientKey: "0x" + "1".padStart(64, "0"), status: "POSITIVE", evidenceUrls: ["https://example.com/v1"], note: "shipped v1", isPublic: true });
  });
});
