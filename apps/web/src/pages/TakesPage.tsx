import { PrimaryAction, SecondaryAction } from "../components/Actions";
import { Avatar } from "../components/Avatar";
import { SocialEmpty } from "../components/ProductState";
import { ActivityRow } from "../components/Social";
import { TakeMascotAccent } from "../components/TakeMascotAccent";
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
    <div className="page-container takes-page">
      <header className="page-intro compact-intro">
        <div><span className="eyebrow">YOUR TAKES</span><h1>Every TAKE belongs to a person and a moment.</h1></div>
        <p>A TAKE is campaign-specific. It can’t be traded, saved, or used on yourself.</p>
        <TakeMascotAccent character="green" className="mascot-intro mascot-intro--takes" />
      </header>

      <section className="take-ledger" aria-label="Current TAKEs">
        {activeCampaigns.length ? activeCampaigns.map((campaign) => {
          const given = campaign.viewer!.usedTakes > 0 || optimisticGivenCampaigns.includes(campaign.id);
          const entry = history.given.find((item) => item.campaignId === campaign.id);
          const recipient = entry?.person ? {
            id: `${entry.id}:recipient`, name: entry.person.displayName, handle: entry.person.username ? `@${entry.person.username}` : "", avatarUrl: entry.person.avatarUrl, joined: entry.person.joined,
            recipient: { type: "take_identity" as const, takeIdentityId: `${entry.id}:recipient` },
          } : optimisticRecipient;
          return (
            <article key={campaign.id} className={`take-ledger__available${given ? " is-given" : ""}`}>
              <div><span className="eyebrow">YOUR TAKE</span><strong>{given ? "GIVEN" : "01"}</strong></div>
              <div className="take-ledger__campaign">
                {given && recipient ? <Avatar person={recipient} size="md" /> : null}
                <div><h2>{given && recipient ? `Given to ${recipient.name}` : campaign.title}</h2><p>{campaign.title} · {given ? "Choice recorded" : `Ends ${campaign.ends}`}</p></div>
              </div>
              {given ? <SecondaryAction onClick={() => navigate("/activity")}>VIEW CHOICE</SecondaryAction> : <PrimaryAction onClick={() => navigate(campaignPath(campaign, "/give") as TakePath)}>GIVE IT</PrimaryAction>}
            </article>
          );
        }) : <SocialEmpty title="No active TAKE right now." action="EXPLORE CAMPAIGNS" onAction={() => navigate("/explore")}>When you are eligible for a live campaign, your TAKE will appear here.</SocialEmpty>}
      </section>

      <section className="take-history">
        <header className="section-heading"><div><span className="eyebrow">HISTORY</span><h2>Given and received</h2></div></header>
        {activity.length ? activity.map((item) => <ActivityRow key={`${item.id}:${item.kind}`} item={item} detailed onCampaign={(id) => navigate(`/campaign/${id}`)} />) : (
          <SocialEmpty title="No TAKES yet." action="EXPLORE CAMPAIGNS" onAction={() => navigate("/explore")}>Your confirmed person-to-person choices will appear here.</SocialEmpty>
        )}
      </section>
    </div>
  );
}
