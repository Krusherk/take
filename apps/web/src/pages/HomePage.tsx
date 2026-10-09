import { ArrowRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { ProductError, ProductLoading } from "../components/ProductState";
import { CampaignStickerRow } from "../components/sticker/CampaignStickerRow";
import { CampaignSticker, EmptySlotSticker, FaceSticker, MascotSticker, PaperLabel, PassArrow, Sticker, type TicketFace } from "../components/sticker/Sticker";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { activityFromHistory, personFromHistoryPerson } from "../lib/currentIdentity";
import { gaveTake, holdsTake, rankLive } from "../lib/campaignOrder";
import { campaignPath } from "../lib/productData";
import type { ActivityItem, Campaign, Person } from "../types/product";

interface HomePageProps {
  navigate: (path: TakePath) => void;
  currentPerson: Person;
  optimisticGivenCampaigns: string[];
  optimisticRecipient: Person | null;
}

const LIVE_ON_HOME = 4;

export function HomePage({ navigate, currentPerson, optimisticGivenCampaigns, optimisticRecipient }: HomePageProps) {
  const { history, me } = useTakeMe();
  const { campaigns, status, error, refetch } = useTakeProduct();
  // Every live campaign, ones the person can give in first, then ending soonest.
  const live = rankLive(campaigns, optimisticGivenCampaigns);
  const held = live.filter((campaign) => holdsTake(campaign, optimisticGivenCampaigns));
  const givenLive = live.filter((campaign) => gaveTake(campaign, optimisticGivenCampaigns));
  const visibleActivity = me && history ? activityFromHistory(me, history).slice(0, 4) : [];
  const recipientFor = (campaign: Campaign) => {
    const entry = history?.given.find((item) => item.campaignId === campaign.id);
    return entry?.person ? personFromHistoryPerson(entry.person, `${entry.id}:recipient`) : optimisticRecipient;
  };

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
          {held.length === 1
            ? <OneTake campaign={held[0]!} isGiven={false} recipient={null} currentPerson={currentPerson} navigate={navigate} />
            : held.length > 1
              ? <ManyTakes campaigns={held} navigate={navigate} />
              : givenLive.length === 1
                ? <OneTake campaign={givenLive[0]!} isGiven recipient={recipientFor(givenLive[0]!)} currentPerson={currentPerson} navigate={navigate} />
                : <NoTake liveCount={live.length} givenCount={givenLive.length} navigate={navigate} />}

          <div className="sticker-home__board">
            <section className="sticker-home__section" id="campaigns" aria-labelledby="home-live">
              <SectionHead id="home-live" title={live.length ? `Live now · ${live.length}` : "Live now"} action={live.length > LIVE_ON_HOME ? `Explore all ${live.length}` : "Explore all"} onAction={() => navigate("/explore")} />
              {live.length ? (
                <ul className="sticker-home__list">{live.slice(0, LIVE_ON_HOME).map((campaign, index) => <CampaignStickerRow key={campaign.id} campaign={campaign} index={index} navigate={navigate} />)}</ul>
              ) : (
                <p className="sticker-home__aside">Live campaigns will be listed here. Drafts stay in Organize until TAKE publishes them to Monad.</p>
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

function HeroArt({ campaign, face, state, navigate }: {
  campaign?: Campaign;
  face?: TicketFace;
  state: { label: string; tone: "live" | "upcoming" | "closed" };
  navigate: (path: TakePath) => void;
}) {
  return (
    <div className="sticker-home__art">
      {campaign ? (
        <a className="sticker-home__ticket" href={campaignPath(campaign)} aria-label={`Open ${campaign.title}`} onClick={(event) => { event.preventDefault(); navigate(campaignPath(campaign) as TakePath); }}>
          <CampaignSticker campaign={campaign} tilt={-5} delay={140} />
        </a>
      ) : (
        <span className="sticker-home__ticket sticker-home__ticket--idle"><CampaignSticker campaign={{ title: "TAKE" }} face={face} tilt={-5} delay={140} /></span>
      )}
      <span className="sticker-home__state">
        <Sticker tilt={-8} delay={220} as="span" className={`status-sticker status-sticker--${state.tone}`}><span>{state.label}</span></Sticker>
      </span>
      <MascotSticker kind="lime" tilt={-9} delay={300} className="sticker-home__mascot" />
    </div>
  );
}

/** One TAKE: give it, or see who you chose. */
function OneTake({ campaign, isGiven, recipient, currentPerson, navigate }: {
  campaign: Campaign;
  isGiven: boolean;
  recipient: Person | null;
  currentPerson: Person;
  navigate: (path: TakePath) => void;
}) {
  return (
    <section className={`sticker-home__take sticker-home__take--${isGiven ? "given" : "available"}`} aria-labelledby="home-your-take">
      <HeroArt campaign={campaign} state={isGiven ? { label: "GIVEN", tone: "upcoming" } : { label: "YOUR TAKE", tone: "live" }} navigate={navigate} />
      <h2 id="home-your-take"><PaperLabel size="lg" tilt={2} delay={160}>{isGiven ? "Your TAKE is given." : "You have one TAKE."}</PaperLabel></h2>
      <PaperLabel size="sm" tilt={-1.5} delay={200} className="sticker-home__meta">
        {campaign.title} · {campaign.resource} · ends {campaign.ends}
      </PaperLabel>
      <div className="sticker-home__handoff" role="group" aria-label={isGiven && recipient ? `You gave your TAKE to ${recipient.name}` : "Your TAKE"}>
        <FaceSticker person={currentPerson} size="sm" tilt={-6} delay={230} label="you" />
        <PassArrow className="pass-arrow--sm" />
        {isGiven && recipient
          ? <FaceSticker person={recipient} size="sm" tilt={5} delay={270} label={recipient.name} />
          : <EmptySlotSticker size="sm" tilt={5} delay={270} label={isGiven ? "given" : "someone else"} />}
      </div>
      <Sticker tilt={-1.5} delay={320} className="sticker-cta">
        {isGiven
          ? <button className="sticker-pill" type="button" onClick={() => navigate("/takes")}>View your choice</button>
          : <button className="sticker-pill" type="button" onClick={() => navigate(campaignPath(campaign, "/give") as TakePath)}>Give your TAKE</button>}
      </Sticker>
      {isGiven ? null : <p className="sticker-note">One person. One choice. You cannot give it to yourself.</p>}
    </section>
  );
}

/** Several TAKEs, one per live campaign, each with its own give action. */
function ManyTakes({ campaigns, navigate }: { campaigns: Campaign[]; navigate: (path: TakePath) => void }) {
  const count = campaigns.length;
  return (
    <section className="sticker-home__take sticker-home__take--many" aria-labelledby="home-your-take">
      <HeroArt face={{ count: String(count), unit: "TAKES", badge: null }} state={{ label: "YOUR TAKES", tone: "live" }} navigate={navigate} />
      <h2 id="home-your-take"><PaperLabel size="lg" tilt={2} delay={160}>You have {count} TAKEs.</PaperLabel></h2>
      <p className="sticker-note">One in each campaign. Each one goes to someone else.</p>
      <ul className="sticker-home__takes" aria-label="Your TAKEs">
        {campaigns.map((campaign, index) => {
          const detail = campaignPath(campaign) as TakePath;
          return (
            <Sticker as="li" key={campaign.id} tilt={index % 2 ? 1 : -1} delay={Math.min(420, 260 + index * 40)} className="sticker-home__take-card">
              <a href={detail} className="sticker-home__take-card-open" onClick={(event) => { event.preventDefault(); navigate(detail); }}>
                <CampaignSticker campaign={campaign} size="sm" tilt={0} />
                <span className="sticker-row__copy">
                  <strong>{campaign.title}</strong>
                  <em>by {campaign.organizer}</em>
                  <small>{campaign.resource} · Ends {campaign.ends}</small>
                </span>
              </a>
              <button className="sticker-pill sticker-pill--sm" type="button" aria-label={`Give your TAKE in ${campaign.title}`} onClick={() => navigate(campaignPath(campaign, "/give") as TakePath)}>Give</button>
            </Sticker>
          );
        })}
      </ul>
    </section>
  );
}

/** No TAKE to give: say what is live in general, never single out one campaign. */
function NoTake({ liveCount, givenCount, navigate }: { liveCount: number; givenCount: number; navigate: (path: TakePath) => void }) {
  const headline = givenCount > 1
    ? `You gave ${givenCount} TAKEs.`
    : liveCount === 0
      ? "Nothing is live right now."
      : liveCount === 1 ? "1 campaign is live." : `${liveCount} campaigns are live.`;
  const note = givenCount > 1
    ? `Your choices are recorded. ${liveCount === 1 ? "1 campaign is" : `${liveCount} campaigns are`} live right now.`
    : liveCount === 0
      ? "Campaigns show up here once they open on Monad."
      : "You don’t hold a TAKE in any of them. Follow along, or start your own.";
  return (
    <section className={`sticker-home__take sticker-home__take--${liveCount ? "watching" : "none"}`} aria-labelledby="home-your-take">
      <HeroArt
        face={{ count: String(givenCount > 1 ? givenCount : liveCount), unit: givenCount > 1 ? "GIVEN" : "LIVE", badge: null }}
        state={givenCount > 1 ? { label: "GIVEN", tone: "upcoming" } : liveCount ? { label: "NO TAKE YET", tone: "closed" } : { label: "NONE LIVE", tone: "closed" }}
        navigate={navigate}
      />
      <h2 id="home-your-take"><PaperLabel size="lg" tilt={2} delay={160}>{headline}</PaperLabel></h2>
      <p className="sticker-note">{note}</p>
      <Sticker tilt={-1.5} delay={320} className="sticker-cta">
        {givenCount > 1
          ? <button className="sticker-pill" type="button" onClick={() => navigate("/takes")}>View your choices</button>
          : <button className="sticker-pill" type="button" onClick={() => navigate("/explore")}>{liveCount ? "Explore live campaigns" : "Explore campaigns"}</button>}
      </Sticker>
      {liveCount === 0 ? <button className="sticker-home__link" type="button" onClick={() => navigate("/organize")}>Organize a campaign <ArrowRight size={14} aria-hidden="true" /></button> : null}
    </section>
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
