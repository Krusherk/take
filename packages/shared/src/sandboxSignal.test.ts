import { describe, expect, it } from "vitest";
import { isSandboxCampaign } from "./sandbox.js";
import { scoreBackerPicks } from "./signal.js";

describe("isSandboxCampaign", () => {
  it("is true only for open giver eligibility without a locked mechanism", () => {
    expect(isSandboxCampaign({ nominatorEligibilityMode: "OPEN_REGISTERED", mechanismConfigId: null })).toBe(true);
    expect(isSandboxCampaign({ nominatorEligibilityMode: "EXTERNAL_ALLOWED" })).toBe(true);
    expect(isSandboxCampaign({ nominatorEligibilityMode: "MERKLE_ALLOWLIST", mechanismConfigId: null })).toBe(false);
    expect(isSandboxCampaign({ nominatorEligibilityMode: "OPEN_REGISTERED", mechanismConfigId: "m1" })).toBe(false);
  });
});

describe("scoreBackerPicks", () => {
  const pick = (state: string, backers: number) => ({ campaignId: "c", campaignTitle: "C", recipientName: "R", state, backers });

  it("is 0 with an honest note when nothing has been reviewed", () => {
    const result = scoreBackerPicks([pick("PENDING", 3), pick("NOT_SELECTED", 1), pick("NOT_PLANNED", 2)]);
    expect(result.score).toBe(0);
    expect(result.reviewedPicks).toBe(0);
    expect(result.note).toMatch(/No reviewed picks yet/);
  });

  it("gives more credit when fewer people backed a winner who passed", () => {
    expect(scoreBackerPicks([pick("POSITIVE", 1)]).score).toBe(10);
    expect(scoreBackerPicks([pick("POSITIVE", 4)]).score).toBe(2.5);
  });

  it("costs a little for a failed check and never goes below 0", () => {
    expect(scoreBackerPicks([pick("POSITIVE", 2), pick("NEGATIVE", 1)]).score).toBe(3);
    expect(scoreBackerPicks([pick("NEGATIVE", 1)]).score).toBe(0);
    expect(scoreBackerPicks([pick("INCONCLUSIVE", 1)]).picks[0]!.points).toBe(0);
  });
});
