import { describe, expect, it } from "vitest";
import { organizePhase, preferredCampaignId } from "./organizePhase";

const campaign = {
  id: "demo",
  sourceStatus: "DRAFT",
  launchApproved: true,
  startsAt: "2026-10-06T10:00:00.000Z",
  endsAt: "2026-10-13T10:00:00.000Z",
};

describe("organizePhase", () => {
  const now = Date.parse("2026-10-06T12:00:00.000Z");

  it("treats an approved draft inside its window as ready to sign", () => {
    expect(organizePhase(campaign, now)).toBe("SIGN_TO_PUBLISH");
  });

  it("asks for the open signature after publication", () => {
    expect(organizePhase({ ...campaign, sourceStatus: "CREATED", launchApproved: true }, now)).toBe("SIGN_TO_OPEN");
  });

  it("marks an in-window active campaign as live", () => {
    expect(organizePhase({ ...campaign, sourceStatus: "ACTIVE" }, now)).toBe("LIVE");
  });

  it("does not call an ended campaign live", () => {
    expect(organizePhase({ ...campaign, sourceStatus: "ACTIVE", endsAt: "2026-10-06T11:00:00.000Z" }, now)).toBe("ENDED");
  });

  it("prefers a campaign the organizer can sign", () => {
    expect(preferredCampaignId([
      { ...campaign, id: "old", sourceStatus: "CLOSED", endsAt: "2026-09-01T00:00:00.000Z" },
      campaign,
    ])).toBe("demo");
  });
});
