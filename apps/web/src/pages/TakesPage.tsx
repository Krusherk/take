import { Avatar } from "../components/Avatar";
import { SocialEmpty } from "../components/ProductState";
import { ActivityRow } from "../components/Social";
import { FeedStage } from "../components/sticker/FeedStage";
import { PaperLabel, Sticker } from "../components/sticker/Sticker";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { activityFromHistory } from "../lib/currentIdentity";
import { campaignPath, isParticipantCampaign } from "../lib/productData";
import type { Person } from "../types/product";

export function TakesPage({ navigate, optimisticGivenCampaigns, optimisticRecipient }: { navigate: (path: TakePath) => void; optimisticGivenCampaigns: string[]; optimisticRecipient: Person | null }) {
  const { me, history } = useTakeMe();
  const { campaigns } = useTakeProduct();
  if (!me || !history) return null;
  const activity = activityFromHistory(me, history);
  const activeCampaigns = campaigns.filter((campaign) =>
    isParticipantCampaign(campaign)
    && campaign.sourceStatus === "ACTIVE"
    && campaign.status === "LIVE"
    && Boolean(
      campaign.viewer?.canParticipate
      || (campaign.viewer?.usedTakes ?? 0) > 0
      || optimisticGivenCampaigns.includes(campaign.id)
    )
  );

  return (
    <div className="page-container sticker-page sticker-feed takes-page">
      <FeedStage tag="YOUR TAKES" title="Every TAKE belongs to a person and a moment." lead="A TAKE is campaign-specific. It can’t be traded, saved, or used on yourself." mascot="lime" titleId="takes-title" />

      <section className="sticker-feed__list take-ledger" aria-label="Current TAKEs">
        {activeCampaigns.length ? (
          <ol>
            {activeCampaigns.map((campaign, index) => {
              const given = (campaign.viewer?.usedTakes ?? 0) > 0 || optimisticGivenCampaigns.includes(campaign.id);
              const entry = history.given.find((item) => item.campaignId === campaign.id);
              const recipient = entry?.person ? {
                id: `${entry.id}:recipient`, name: entry.person.displayName, handle: entry.person.username ? `@${entry.person.username}` : "", avatarUrl: entry.person.avatarUrl, joined: entry.person.joined,
                recipient: { type: "take_identity" as const, takeIdentityId: `${entry.id}:recipient` },
              } : optimisticRecipient;
              return (
                <Sticker as="li" key={campaign.id} tilt={index % 2 ? 0.8 : -0.8} delay={Math.min(420, 200 + index * 50)} className={`take-card${given ? " is-given" : ""}`}>
                  <div className="take-card__badge"><span>YOUR TAKE</span><strong>{given ? "GIVEN" : "01"}</strong></div>
                  <div className="take-card__campaign">
                    {given && recipient ? <Avatar person={recipient} size="md" /> : null}
                    <div><h2>{given && recipient ? `Given to ${recipient.name}` : campaign.title}</h2><p>{campaign.title} · {given ? "Choice recorded" : `Ends ${campaign.ends}`}</p></div>
                  </div>
                  {given
                    ? <button className="sticker-pill sticker-pill--paper sticker-pill--sm" type="button" onClick={() => navigate("/activity")}>VIEW CHOICE</button>
                    : <button className="sticker-pill sticker-pill--sm" type="button" onClick={() => navigate(campaignPath(campaign, "/give") as TakePath)}>GIVE IT</button>}
                </Sticker>
              );
            })}
          </ol>
        ) : <SocialEmpty title="No active TAKE right now." action="EXPLORE CAMPAIGNS" onAction={() => navigate("/explore")}>When you are eligible for a live campaign, your TAKE will appear here.</SocialEmpty>}
      </section>

      <section className="sticker-feed__list take-history" aria-labelledby="take-history-title">
        <h2 id="take-history-title" className="sticker-feed__heading"><PaperLabel size="sm" tilt={-2}>Given and received</PaperLabel></h2>
        {activity.length ? (
          <ol>
            {activity.map((item, index) => (
              <Sticker as="li" key={`${item.id}:${item.kind}`} tilt={index % 2 ? 0.6 : -0.6} delay={Math.min(460, 260 + index * 40)} className="sticker-feed__item">
                <ActivityRow item={item} detailed onCampaign={(id) => navigate(`/campaign/${id}`)} />
              </Sticker>
            ))}
          </ol>
        ) : (
          <SocialEmpty title="No TAKES yet." action="EXPLORE CAMPAIGNS" onAction={() => navigate("/explore")}>Your confirmed person-to-person choices will appear here.</SocialEmpty>
        )}
      </section>
    </div>
  );
}
