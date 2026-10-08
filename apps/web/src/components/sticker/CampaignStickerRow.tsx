import type { TakePath } from "../../hooks/usePathRouter";
import { campaignPath } from "../../lib/productData";
import type { Campaign } from "../../types/product";
import { CampaignSticker, StatusSticker, Sticker } from "./Sticker";

/** A campaign as a white sticker row: ticket, title, organizer, real count and dates, status. */
export function CampaignStickerRow({ campaign, index, navigate }: { campaign: Campaign; index: number; navigate: (path: TakePath) => void }) {
  const destination = campaignPath(campaign) as TakePath;
  const tilt = index % 2 ? 1.2 : -1.2;
  return (
    <Sticker as="li" tilt={tilt} delay={Math.min(360, 300 + index * 30)} className="sticker-row">
      <a href={destination} onClick={(event) => { event.preventDefault(); navigate(destination); }}>
        <CampaignSticker campaign={campaign} size="sm" tilt={0} />
        <span className="sticker-row__copy">
          <strong>{campaign.title}</strong>
          <em>by {campaign.organizer}</em>
          <small>{campaign.resource} · {campaign.status === "UPCOMING" ? `Opens ${campaign.starts}` : `Ends ${campaign.ends}`}{(campaign.viewer?.usedTakes ?? 0) > 0 ? " · TAKE given" : ""}</small>
        </span>
        <StatusSticker status={campaign.status} tilt={4} />
      </a>
    </Sticker>
  );
}
