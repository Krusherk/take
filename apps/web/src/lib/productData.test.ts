import { describe, expect, it } from "vitest";
import { campaignFromApi, parseCampaignPath, parseInvitePath, personFromApi } from "./productData";
import type { ApiCampaign, ApiPerson } from "../types/product";

const campaign: ApiCampaign = {
  id: "campaign-live",
  organization: { id: "org-1", name: "TAKE Foundation", slug: "take-foundation" },
  status: "ACTIVE",
  title: "Creator Allocation",
  description: "A focused opportunity for independent creators.",
  startTime: "2026-01-01T00:00:00.000Z",
  endTime: "2099-09-14T00:00:00.000Z",
  nominationLimit: 1,
  nominationVisibilityMode: "PRIVATE_UNTIL_CLOSE",
  nominatorEligibilityMode: "OPEN",
  recipientEligibilityMode: "OPEN",
  resource: { id: "resource-1", type: "ACCESS", name: "Creator Spot", description: null, quantity: 100 },
  participantCount: 842,
  viewer: {
    usedTakes: 0,
    availableTakes: 1,
    canParticipate: true,
    eligibility: { status: "ELIGIBLE", locked: true, reasons: [] },
  },
};

describe("product data normalization", () => {
  it("maps API campaigns into a live product opportunity without fabricating social context", () => {
    expect(campaignFromApi(campaign)).toMatchObject({
      id: "campaign-live",
      title: "Creator Allocation",
      organizer: "TAKE Foundation",
      status: "LIVE",
      resource: "100 creator spot",
      participants: 842,
      viewer: { usedTakes: 0, availableTakes: 1, canParticipate: true },
    });
  });

  it("preserves the immutable recipient binding while normalizing social presentation", () => {
    const source: ApiPerson = {
      recipient: { type: "external_identity", externalIdentityId: "external-identity-42" },
      displayName: "Sarah Chen",
      username: "@sarah",
      avatarUrl: "https://images.example/sarah.jpg",
      joined: false,
    };

    expect(personFromApi(source)).toEqual({
      id: "external-identity-42",
      name: "Sarah Chen",
      handle: "@sarah",
      avatarUrl: "https://images.example/sarah.jpg",
      joined: false,
      relationship: "External identity",
      recipient: source.recipient,
    });
  });

  it("parses campaign and invitation routes without a hardcoded campaign alias", () => {
    expect(parseCampaignPath("/campaign/campaign-live/confirm")).toEqual({ campaignId: "campaign-live", step: "confirm" });
    expect(parseInvitePath("/invite/nomination-42")).toBe("nomination-42");
  });
});
