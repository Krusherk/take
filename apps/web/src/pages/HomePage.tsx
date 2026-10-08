import { ArrowRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { ProductError, ProductLoading } from "../components/ProductState";
import { CampaignStickerRow } from "../components/sticker/CampaignStickerRow";
import { CampaignSticker, EmptySlotSticker, FaceSticker, MascotSticker, PaperLabel, PassArrow, StatusSticker, Sticker } from "../components/sticker/Sticker";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { activityFromHistory, personFromHistoryPerson } from "../lib/currentIdentity";
import { campaignPath, isParticipantCampaign } from "../lib/productData";
import type { ActivityItem, Campaign, Person } from "../types/product";

interface HomePageProps {
  navigate: (path: TakePath) => void;
  currentPerson: Person;
  optimisticGivenCampaigns: string[];
  optimisticRecipient: Person | null;
}

export function HomePage({ navigate, currentPerson, optimisticGivenCampaigns, optimisticRecipient }: HomePageProps) {
  const { history, me } = useTakeMe();
  const { campaigns, status, error, refetch } = useTakeProduct();
  const participantCampaigns = campaigns.filter(isParticipantCampaign);
  const featured = participantCampaigns.find((campaign) => campaign.status === "LIVE") ?? participantCampaigns.find((campaign) => campaign.status === "UPCOMING") ?? participantCampaigns[0];
  const activeTake = participantCampaigns.find((campaign) => campaign.viewer?.canParticipate && (campaign.viewer.availableTakes ?? 0) > 0)
    ?? participantCampaigns.find((campaign) => (campaign.viewer?.usedTakes ?? 0) > 0 || optimisticGivenCampaigns.includes(campaign.id));
  const isGiven = activeTake ? (activeTake.viewer?.usedTakes ?? 0) > 0 || optimisticGivenCampaigns.includes(activeTake.id) : false;
  const givenEntry = activeTake ? history?.given.find((entry) => entry.campaignId === activeTake.id) : undefined;
  const givenPerson = givenEntry?.person ? personFromHistoryPerson(givenEntry.person, `${givenEntry.id}:recipient`) : optimisticRecipient;
  const visibleActivity = me && history ? activityFromHistory(me, history).slice(0, 4) : [];
  const openCampaigns = participantCampaigns.filter((campaign) => campaign.status !== "CLOSED");
  // The hero already shows the active TAKE's campaign; the board lists the rest.
  const showFeatured = featured && featured.id !== activeTake?.id ? featured : null;
  const shownIds = new Set([activeTake?.id, showFeatured?.id]);
  const moreOpen = openCampaigns.filter((campaign) => !shownIds.has(campaign.id)).slice(0, 3);

  return (
    <div className="page-container sticker-page sticker-home">
      <section className="sticker-home__hello" aria-labelledby="home-greeting">
        <MascotSticker kind="star" tilt={12} delay={260} className="sticker-home__star" />
        <h1 id="home-greeting" className="sticker-home__greeting">
          <PaperLabel size="sm" tilt={-2.5} delay={80}>good to see you,</PaperLabel>
          <NameSticker name={firstName(currentPerson.name)} />
        </h1>
        <p className="sticker-home__line">People lift people. Your next choice starts here.</p>
      </section>

      {status === "loading" || status === "idle" ? <ProductLoading label="Loading your opportunities" /> : null}
      {status === "error" ? <ProductError message={error ?? "Campaigns are unavailable."} onRetry={() => void refetch()} /> : null}

      {status === "ready" ? (
        <>
          <YourTake campaign={activeTake} isGiven={isGiven} recipient={givenPerson} currentPerson={currentPerson} navigate={navigate} />

          <div className="sticker-home__board">
            {showFeatured ? (
              <section className="sticker-home__section" aria-labelledby="home-featured">
                <h2 id="home-featured"><PaperLabel size="sm" tilt={-2}>Featured opportunity</PaperLabel></h2>
                <FeaturedSticker campaign={showFeatured} navigate={navigate} />
              </section>
            ) : null}

            <section className="sticker-home__section" id="campaigns" aria-labelledby="home-open">
              <SectionHead id="home-open" title="Open now" action="Explore all" onAction={() => navigate("/explore")} />
              {!openCampaigns.length ? (
                <HomeEmpty title="No participant campaigns yet." action="Organize a campaign" onAction={() => navigate("/organize")}>Drafts stay in Organize until TAKE publishes them to Monad.</HomeEmpty>
              ) : moreOpen.length ? (
                <ul className="sticker-home__list">{moreOpen.map((campaign, index) => <CampaignStickerRow key={campaign.id} campaign={campaign} index={index} navigate={navigate} />)}</ul>
              ) : (
                <p className="sticker-home__aside">Everything open right now is above.</p>
              )}
            </section>

            <section className="sticker-home__section" aria-labelledby="home-recent">
              <SectionHead id="home-recent" title="Recent choices" action="See all" onAction={() => navigate("/activity")} />
              {visibleActivity.length ? (
                <ul className="sticker-home__list">{visibleActivity.map((item, index) => <ChoiceRow key={`${item.id}:${item.kind}`} item={item} index={index} onCampaign={(id) => navigate(`/campaign/${id}`)} />)}</ul>
              ) : (
                <HomeEmpty title="No choices yet." action="Find a campaign" onAction={() => navigate("/explore")}>When you give or receive a TAKE, the person and opportunity will appear here.</HomeEmpty>
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The one clear next action: give it, see who you chose, or go find a campaign. */
function YourTake({ campaign, isGiven, recipient, currentPerson, navigate }: {
  campaign?: Campaign;
  isGiven: boolean;
  recipient: Person | null;
  currentPerson: Person;
  navigate: (path: TakePath) => void;
}) {
  const state = !campaign ? "none" : isGiven ? "given" : "available";
  const headline = state === "none" ? "No TAKE is waiting." : state === "given" ? "Your TAKE is given." : "You have one TAKE.";
  const action = !campaign
    ? { label: "Explore campaigns", to: "/explore" as TakePath }
    : isGiven
      ? { label: "View your choice", to: "/takes" as TakePath }
      : { label: "Give your TAKE", to: campaignPath(campaign, "/give") as TakePath };

  return (
    <section className={`sticker-home__take sticker-home__take--${state}`} aria-labelledby="home-your-take">
      <div className="sticker-home__art">
        {campaign ? (
          <a className="sticker-home__ticket" href={campaignPath(campaign)} aria-label={`Open ${campaign.title}`} onClick={(event) => { event.preventDefault(); navigate(campaignPath(campaign) as TakePath); }}>
            <CampaignSticker campaign={campaign} tilt={-5} delay={140} />
          </a>
        ) : (
          <span className="sticker-home__ticket sticker-home__ticket--idle" aria-hidden="true"><CampaignSticker campaign={{ title: "TAKE" }} tilt={-5} delay={140} /></span>
        )}
        <span className="sticker-home__state">
          <Sticker tilt={-8} delay={220} as="span" className={`status-sticker status-sticker--${state === "available" ? "live" : state === "given" ? "upcoming" : "closed"}`}>
            <span>{state === "available" ? "YOUR TAKE" : state === "given" ? "GIVEN" : "NONE ACTIVE"}</span>
          </Sticker>
        </span>
        <MascotSticker kind="lime" tilt={-9} delay={300} className="sticker-home__mascot" />
      </div>

      <h2 id="home-your-take"><PaperLabel size="lg" tilt={2} delay={160}>{headline}</PaperLabel></h2>

      {campaign ? (
        <>
          <PaperLabel size="sm" tilt={-1.5} delay={200} className="sticker-home__meta">
            {campaign.title} · by {campaign.organizer} · {campaign.status === "UPCOMING" ? `opens ${campaign.starts}` : `ends ${campaign.ends}`}
          </PaperLabel>
          <div className="sticker-home__handoff" role="group" aria-label={isGiven && recipient ? `You gave your TAKE to ${recipient.name}` : "Your TAKE"}>
            <FaceSticker person={currentPerson} size="sm" tilt={-6} delay={230} label="you" />
            <PassArrow className="pass-arrow--sm" />
            {isGiven && recipient
              ? <FaceSticker person={recipient} size="sm" tilt={5} delay={270} label={recipient.name} />
              : <EmptySlotSticker size="sm" tilt={5} delay={270} label={isGiven ? "given" : "someone else"} />}
          </div>
        </>
      ) : (
        <PaperLabel size="sm" tilt={-1} delay={240}>Explore live campaigns to see where you can participate.</PaperLabel>
      )}

      <Sticker tilt={-1.5} delay={320} className="sticker-cta">
        <button className="sticker-pill" type="button" onClick={() => navigate(action.to)}>{action.label}</button>
      </Sticker>
      {campaign && !isGiven ? <p className="sticker-note">One person. One choice. You cannot give it to yourself.</p> : null}
      {campaign?.description ? <PaperLabel size="md" tilt={1} delay={360} className="sticker-home__copy">{campaign.description}</PaperLabel> : null}
    </section>
  );
}

function FeaturedSticker({ campaign, navigate }: { campaign: Campaign; navigate: (path: TakePath) => void }) {
  const destination = campaignPath(campaign) as TakePath;
  return (
    <Sticker as="div" tilt={1.2} delay={280} className="sticker-row sticker-home__featured">
      <a href={destination} aria-label={`View ${campaign.title}`} onClick={(event) => { event.preventDefault(); navigate(destination); }}>
        <CampaignSticker campaign={campaign} size="sm" tilt={-3} />
        <span className="sticker-row__copy">
          <strong>{campaign.title}</strong>
          <em>by {campaign.organizer}</em>
          {campaign.description ? <small className="sticker-home__featured-copy">{campaign.description}</small> : null}
        </span>
        <span className="sticker-home__featured-end">
          <StatusSticker status={campaign.status} tilt={4} />
          <ArrowRight size={18} aria-hidden="true" />
        </span>
      </a>
    </Sticker>
  );
}

function ChoiceRow({ item, index, onCampaign }: { item: ActivityItem; index: number; onCampaign: (campaignId: string) => void }) {
  const handoff = item.actor && item.recipient && (item.kind === "given" || item.kind === "received");
  return (
    <Sticker as="li" tilt={index % 2 ? 1 : -1} delay={Math.min(420, 320 + index * 30)} className="sticker-row sticker-home__choice">
      <span className="sticker-home__faces" aria-hidden="true">
        {item.actor ? <Avatar person={item.actor} size="sm" /> : null}
        {handoff ? <PassArrow className="pass-arrow--xs" /> : null}
        {handoff && item.recipient ? <Avatar person={item.recipient} size="sm" /> : null}
      </span>
      <span className="sticker-row__copy">
        {handoff ? <span className="sticker-home__sentence"><b>{item.actor!.name}</b> gave <b>{item.recipient!.name}</b> their TAKE.</span> : <span className="sticker-home__sentence"><b>{item.message ?? "A new TAKE update is ready."}</b></span>}
        {item.campaign ? (item.campaignId ? <button type="button" onClick={() => onCampaign(item.campaignId!)}>{item.campaign}</button> : <small>{item.campaign}</small>) : null}
      </span>
      <time>{item.time}</time>
    </Sticker>
  );
}

function SectionHead({ id, title, action, onAction }: { id: string; title: string; action: string; onAction: () => void }) {
  return (
    <header className="sticker-home__head">
      <h2 id={id}><PaperLabel size="sm" tilt={-2}>{title}</PaperLabel></h2>
      <button className="sticker-home__link" type="button" onClick={onAction}>{action} <ArrowRight size={14} aria-hidden="true" /></button>
    </header>
  );
}

function HomeEmpty({ title, children, action, onAction }: { title: string; children: ReactNode; action: string; onAction: () => void }) {
  return (
    <Sticker tilt={-0.8} delay={320} className="sticker-home__empty">
      <strong>{title}</strong>
      <p>{children}</p>
      <button className="sticker-home__link" type="button" onClick={onAction}>{action} <ArrowRight size={14} aria-hidden="true" /></button>
    </Sticker>
  );
}

/** The person's first name in big die-cut letters. Long names shrink instead of breaking. */
function NameSticker({ name }: { name: string }) {
  const style = { "--name-chars": Math.max(4, name.length + 1) } as CSSProperties;
  return <Sticker tilt={-2} delay={120} as="span" className="sticker-home__name"><span style={style} className="sticker-home__name-text">{name}.</span></Sticker>;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}
