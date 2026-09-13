import { ArrowRight } from "lucide-react";
import { PrimaryAction, SecondaryAction, TextAction } from "../components/Actions";
import { Avatar } from "../components/Avatar";
import { CampaignArtwork, CampaignRow, CampaignStatus } from "../components/Campaign";
import { ProductError, ProductLoading, SocialEmpty } from "../components/ProductState";
import { ActivityRow } from "../components/Social";
import { TakeMascotAccent } from "../components/TakeMascotAccent";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { activityFromHistory, personFromHistoryPerson } from "../lib/currentIdentity";
import { campaignPath } from "../lib/productData";
import type { Campaign, Person } from "../types/product";

interface HomePageProps {
  navigate: (path: TakePath) => void;
  currentPerson: Person;
  optimisticGivenCampaigns: string[];
  optimisticRecipient: Person | null;
}

export function HomePage({ navigate, currentPerson, optimisticGivenCampaigns, optimisticRecipient }: HomePageProps) {
  const { history, me } = useTakeMe();
  const { campaigns, status, error, refetch } = useTakeProduct();
  const featured = campaigns.find((campaign) => campaign.status === "LIVE") ?? campaigns.find((campaign) => campaign.status === "UPCOMING") ?? campaigns[0];
  const activeTake = campaigns.find((campaign) => campaign.viewer?.canParticipate && (campaign.viewer.availableTakes ?? 0) > 0)
    ?? campaigns.find((campaign) => (campaign.viewer?.usedTakes ?? 0) > 0 || optimisticGivenCampaigns.includes(campaign.id));
  const isGiven = activeTake ? (activeTake.viewer?.usedTakes ?? 0) > 0 || optimisticGivenCampaigns.includes(activeTake.id) : false;
  const givenEntry = activeTake ? history?.given.find((entry) => entry.campaignId === activeTake.id) : undefined;
  const givenPerson = givenEntry?.person ? personFromHistoryPerson(givenEntry.person, `${givenEntry.id}:recipient`) : optimisticRecipient;
  const featuredEntry = featured ? history?.given.find((entry) => entry.campaignId === featured.id) : undefined;
  const featuredRecipient = featuredEntry?.person ? personFromHistoryPerson(featuredEntry.person, `${featuredEntry.id}:recipient`) : featured?.id === activeTake?.id ? givenPerson : null;
  const visibleActivity = me && history ? activityFromHistory(me, history).slice(0, 4) : [];

  return (
    <div className="page-container home-page">
      <header className="page-intro home-intro">
        <div>
          <span className="eyebrow">HOME</span>
          <h1>Good to see you, <em>{firstName(currentPerson.name)}.</em></h1>
        </div>
        <div className="home-intro__identity">
          <Avatar person={currentPerson} size="md" />
          <div><strong>{currentPerson.name}</strong>{currentPerson.handle ? <span>{currentPerson.handle}</span> : null}</div>
        </div>
      </header>

      {status === "loading" || status === "idle" ? <ProductLoading label="Loading your opportunities" /> : null}
      {status === "error" ? <ProductError message={error ?? "Campaigns are unavailable."} onRetry={() => void refetch()} /> : null}

      {status === "ready" ? (
        <>
          <section className="home-lead" aria-label="Your active TAKE and featured campaign">
            <ActiveTake campaign={activeTake} isGiven={isGiven} recipient={givenPerson} navigate={navigate} />
            {featured ? (
              <article className={`featured-campaign featured-campaign--${featured.visual}`}>
                <CampaignArtwork campaign={featured} giver={currentPerson} recipient={featuredRecipient} />
                <div className="featured-campaign__content">
                  <div className="featured-campaign__heading"><CampaignStatus status={featured.status} /><span>FEATURED OPPORTUNITY</span></div>
                  <div><h2>{featured.title}</h2><p>{featured.description}</p></div>
                  <div className="featured-campaign__foot">
                    <div className="campaign-organizer"><span>{featured.organizerMark}</span><div><small>ORGANIZED BY</small><strong>{featured.organizer}</strong></div></div>
                    <button type="button" aria-label={`View ${featured.title}`} onClick={() => navigate(campaignPath(featured) as TakePath)}>VIEW <ArrowRight size={18} /></button>
                  </div>
                </div>
              </article>
            ) : null}
          </section>

          <div className="home-columns">
            <section className="section-block" id="campaigns">
              <header className="section-heading"><div><span className="eyebrow">OPPORTUNITIES</span><h2>Open now</h2></div><TextAction onClick={() => navigate("/explore")}>EXPLORE ALL</TextAction></header>
              <div className="campaign-list">
                {campaigns.filter((campaign) => campaign.status !== "CLOSED").slice(0, 3).map((campaign) => <CampaignRow key={campaign.id} campaign={campaign} navigate={navigate} />)}
              </div>
            </section>

            <section className="section-block social-preview">
              <header className="section-heading"><div><span className="eyebrow">YOUR CIRCLE</span><h2>Recent choices</h2></div><TextAction onClick={() => navigate("/activity")}>SEE ALL</TextAction></header>
              <div className="activity-list">
                {visibleActivity.length ? visibleActivity.map((item) => <ActivityRow key={`${item.id}:${item.kind}`} item={item} onCampaign={(id) => navigate(`/campaign/${id}`)} />) : (
                  <SocialEmpty title="No choices yet." action="EXPLORE CAMPAIGNS" onAction={() => navigate("/explore")}>When you give or receive a TAKE, the person and opportunity will appear here.</SocialEmpty>
                )}
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ActiveTake({ campaign, isGiven, recipient, navigate }: { campaign?: Campaign; isGiven: boolean; recipient: Person | null; navigate: (path: TakePath) => void }) {
  if (!campaign) {
    return (
      <article className="available-take is-empty">
        <TakeMascotAccent character="yellow" />
        <div className="available-take__top"><span className="eyebrow">YOUR TAKE</span><span className="live-signal">NONE ACTIVE</span></div>
        <div className="available-take__empty"><strong>No TAKE is waiting.</strong><p>Explore live campaigns to see where you can participate.</p></div>
        <SecondaryAction full onClick={() => navigate("/explore")}>EXPLORE CAMPAIGNS</SecondaryAction>
      </article>
    );
  }

  return (
    <article className={`available-take${isGiven ? " is-given" : ""}`}>
      <TakeMascotAccent character={isGiven ? "purple" : "yellow"} />
      <div className="available-take__top"><span className="eyebrow">YOUR TAKE</span><span className="live-signal"><i />{isGiven ? "GIVEN" : "AVAILABLE"}</span></div>
      {isGiven && recipient ? (
        <div className="available-take__recipient"><Avatar person={recipient} size="lg" /><div><span>GIVEN TO</span><strong>{recipient.name}</strong>{recipient.handle ? <small>{recipient.handle}</small> : null}</div></div>
      ) : (
        <div className="available-take__count"><strong>01</strong><span>One person. One choice. Make it count.</span></div>
      )}
      <div className="available-take__campaign"><span>{campaign.title}</span><small>{campaign.status === "UPCOMING" ? `OPENS ${campaign.starts}` : `ENDS ${campaign.ends}`}</small></div>
      {isGiven ? <SecondaryAction full onClick={() => navigate("/takes")}>VIEW YOUR CHOICE</SecondaryAction> : <PrimaryAction full onClick={() => navigate(campaignPath(campaign, "/give") as TakePath)}>GIVE IT</PrimaryAction>}
    </article>
  );
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}
