import type { Campaign, Person } from "../../types/product";
import { TakeHandoffGraphic, type TakeHandoffState } from "../TakeHandoffGraphic";

export function HomeCampaignArtwork({ campaign, giver, recipient }: {
  campaign: Campaign;
  giver?: Person | null;
  recipient?: Person | null;
}) {
  return (
    <div className={`campaign-artwork campaign-artwork--${campaign.visual}`} aria-hidden="true">
      <img className="campaign-artwork__world" src="/assets/take-opportunity-trail-v1.png" alt="" decoding="async" />
      <span className="campaign-artwork__sticker">PASS IT FORWARD</span>
      <span className="campaign-artwork__spark campaign-artwork__spark--one" />
      <span className="campaign-artwork__spark campaign-artwork__spark--two" />
      <TakeHandoffGraphic state={handoffState(campaign)} giver={giver} recipient={recipient} accent={campaign.visual} />
    </div>
  );
}

function handoffState(campaign: Campaign): TakeHandoffState {
  if ((campaign.viewer?.usedTakes ?? 0) > 0) return "given";
  if (campaign.viewer?.canParticipate && (campaign.viewer.availableTakes ?? 0) > 0) return "available";
  return "anonymous";
}
