import type { Campaign } from "../types/product";
import { isParticipantCampaign } from "./productData";

/** The person holds an unused TAKE in this live campaign. */
export function holdsTake(campaign: Campaign, optimisticGivenCampaigns: readonly string[] = []): boolean {
  return campaign.status === "LIVE"
    && Boolean(campaign.viewer?.canParticipate)
    && (campaign.viewer?.availableTakes ?? 0) > 0
    && (campaign.viewer?.usedTakes ?? 0) === 0
    && !optimisticGivenCampaigns.includes(campaign.id);
}

export function gaveTake(campaign: Campaign, optimisticGivenCampaigns: readonly string[] = []): boolean {
  return (campaign.viewer?.usedTakes ?? 0) > 0 || optimisticGivenCampaigns.includes(campaign.id);
}

const time = (value: string, fallback: number) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Live campaigns: ones the person can give in first, then the ones ending soonest. */
export function rankLive(campaigns: readonly Campaign[], optimisticGivenCampaigns: readonly string[] = []): Campaign[] {
  return campaigns
    .filter((campaign) => isParticipantCampaign(campaign) && campaign.status === "LIVE")
    .map((campaign, index) => ({ campaign, index }))
    .sort((a, b) =>
      Number(holdsTake(b.campaign, optimisticGivenCampaigns)) - Number(holdsTake(a.campaign, optimisticGivenCampaigns))
      || time(a.campaign.endsAt, Infinity) - time(b.campaign.endsAt, Infinity)
      || a.index - b.index)
    .map(({ campaign }) => campaign);
}

/** Upcoming campaigns, opening soonest first. */
export function rankUpcoming(campaigns: readonly Campaign[]): Campaign[] {
  return campaigns
    .filter((campaign) => isParticipantCampaign(campaign) && campaign.status === "UPCOMING")
    .slice()
    .sort((a, b) => time(a.startsAt, Infinity) - time(b.startsAt, Infinity));
}

/** Closed campaigns, most recently ended first. */
export function rankClosed(campaigns: readonly Campaign[]): Campaign[] {
  return campaigns
    .filter((campaign) => isParticipantCampaign(campaign) && campaign.status === "CLOSED")
    .slice()
    .sort((a, b) => time(b.endsAt, 0) - time(a.endsAt, 0));
}
