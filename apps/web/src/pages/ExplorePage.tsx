import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ProductError, ProductLoading } from "../components/ProductState";
import { CampaignStickerRow } from "../components/sticker/CampaignStickerRow";
import { CampaignSticker, EmptySlotSticker, FaceSticker, MascotSticker, PaperLabel, PassArrow, StatusSticker, Sticker } from "../components/sticker/Sticker";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { personFromHistoryPerson, personFromMe } from "../lib/currentIdentity";
import { rankClosed, rankLive, rankUpcoming } from "../lib/campaignOrder";
import { campaignPath, isParticipantCampaign } from "../lib/productData";
import type { TakeHistoryEntry } from "../types/identity";
import type { Campaign, CampaignState, Person } from "../types/product";

type Filter = "ALL" | CampaignState;

export function ExplorePage({ navigate }: { navigate: (path: TakePath) => void }) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const { campaigns, status, error, refetch } = useTakeProduct();
  const { me, history } = useTakeMe();
  const currentPerson = me ? personFromMe(me) : null;
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return campaigns.filter((campaign) => {
      if (!isParticipantCampaign(campaign)) return false;
      const matchesFilter = filter === "ALL" || campaign.status === filter;
      const matchesQuery = !normalized || `${campaign.title} ${campaign.organizer} ${campaign.resource}`.toLowerCase().includes(normalized);
      return matchesFilter && matchesQuery;
    });
  }, [campaigns, filter, query]);
  // Every live campaign is listed: ones you can give in first, then ending soonest.
  const live = useMemo(() => rankLive(matches), [matches]);
  const upcoming = useMemo(() => rankUpcoming(matches), [matches]);
  const closed = useMemo(() => rankClosed(matches), [matches]);
  const [featured, ...moreLive] = live;
  const nothing = !live.length && !upcoming.length && !closed.length;

  return (
    <div className="page-container sticker-page sticker-explore">
      <h1 className="sticker-sr-only">Explore opportunities</h1>
      <div className="sticker-tools">
        <label className="sticker-search"><Search size={18} strokeWidth={2} aria-hidden="true" /><input aria-label="Search campaigns" placeholder="Search opportunities" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
        <div className="sticker-filters" role="group" aria-label="Filter campaigns">
          {(["ALL", "LIVE", "UPCOMING", "CLOSED"] as const).map((item) => <button key={item} className={filter === item ? "is-active" : undefined} aria-pressed={filter === item} type="button" onClick={() => setFilter(item)}>{item}</button>)}
        </div>
      </div>

      {status === "loading" || status === "idle" ? <ProductLoading label="Finding open TAKEs" /> : null}
      {status === "error" ? <ProductError message={error ?? "Campaigns are unavailable."} onRetry={() => void refetch()} /> : null}
      {status === "ready" ? (
        nothing ? (
          <section className="sticker-empty" aria-label="Campaigns">
            <EmptySlotSticker tilt={-5} />
            <h2><PaperLabel size="lg" tilt={-2} delay={60}>{emptyTitle(filter, query)}</PaperLabel></h2>
            <PaperLabel size="sm" tilt={1.5} delay={120}>{emptyBody(filter, query)}</PaperLabel>
            {query ? null : <Sticker tilt={-1} delay={180} className="sticker-cta"><button className="sticker-pill" type="button" onClick={() => navigate("/organize")}>Create a campaign</button></Sticker>}
          </section>
        ) : (
          <>
            {featured ? (
              <section className="sticker-explore__section sticker-explore__live" aria-labelledby="explore-live">
                <h2 id="explore-live"><PaperLabel size="sm" tilt={-2}>{live.length} live now</PaperLabel></h2>
                <FeaturedCampaign key={featured.id} campaign={featured} currentPerson={currentPerson} recipient={historyRecipient(history?.given.find((entry) => entry.campaignId === featured.id))} navigate={navigate} />
                {moreLive.length ? (
                  <ul className="sticker-explore__list" aria-label="More live campaigns">
                    {moreLive.map((campaign, index) => <CampaignStickerRow key={campaign.id} campaign={campaign} index={index} navigate={navigate} />)}
                  </ul>
                ) : null}
              </section>
            ) : filter === "ALL" && !query ? (
              <p className="sticker-explore__none"><PaperLabel size="sm" tilt={-1.5}>Nothing is live right now.</PaperLabel></p>
            ) : null}
            <CampaignSection id="explore-upcoming" title="Opening soon" campaigns={upcoming} navigate={navigate} />
            <CampaignSection id="explore-closed" title="Closed" campaigns={closed} navigate={navigate} />
          </>
        )
      ) : null}
    </div>
  );
}

function CampaignSection({ id, title, campaigns, navigate }: { id: string; title: string; campaigns: Campaign[]; navigate: (path: TakePath) => void }) {
  if (!campaigns.length) return null;
  return (
    <section className="sticker-more sticker-explore__section" aria-labelledby={id}>
      <h2 id={id}><PaperLabel size="sm" tilt={-2}>{title} · {campaigns.length}</PaperLabel></h2>
      <ul>
        {campaigns.map((campaign, index) => <CampaignStickerRow key={campaign.id} campaign={campaign} index={index} navigate={navigate} />)}
      </ul>
    </section>
  );
}

function FeaturedCampaign({ campaign, currentPerson, recipient, navigate }: {
  campaign: Campaign;
  currentPerson: Person | null;
  recipient: Person | null;
  navigate: (path: TakePath) => void;
}) {
  const detail = campaignPath(campaign) as TakePath;
  const given = (campaign.viewer?.usedTakes ?? 0) > 0;
  const available = canGive(campaign);
  const timing = campaign.status === "UPCOMING" ? `opens ${titleDate(campaign.starts)}` : campaign.status === "CLOSED" ? `ended ${titleDate(campaign.ends)}` : `ends ${titleDate(campaign.ends)}`;

  return (
    <article className="sticker-campaign" aria-labelledby={`campaign-${campaign.id}-title`}>
      <a className="sticker-campaign__art" href={detail} aria-label={`Open ${campaign.title}`} onClick={(event) => { event.preventDefault(); navigate(detail); }}>
        <CampaignSticker campaign={campaign} tilt={-4} />
        <span className="sticker-campaign__status"><StatusSticker status={campaign.status} tilt={-7} delay={140} /></span>
        <MascotSticker kind="lime" tilt={-8} delay={200} className="sticker-campaign__mascot" />
      </a>

      <div className="sticker-campaign__title">
        <h2 id={`campaign-${campaign.id}-title`}><PaperLabel size="lg" tilt={3} delay={90}>{campaign.title}</PaperLabel></h2>
        <PaperLabel size="sm" tilt={-2} delay={150}>by {campaign.organizer}</PaperLabel>
      </div>

      {currentPerson ? (
        <div className="sticker-campaign__handoff" role="group" aria-label={given && recipient ? `You gave your TAKE to ${recipient.name}` : "Your TAKE"}>
          <FaceSticker person={currentPerson} size="sm" tilt={-6} delay={180} label="you" />
          <PassArrow className="pass-arrow--sm" />
          {given && recipient
            ? <FaceSticker person={recipient} size="sm" tilt={5} delay={230} label={recipient.name} />
            : <EmptySlotSticker size="sm" tilt={5} delay={230} label={given ? "given" : "someone else"} />}
        </div>
      ) : null}

      <PaperLabel size="sm" tilt={-1.5} delay={220} className="sticker-campaign__meta">{campaign.resource} · {timing}</PaperLabel>
      {campaign.description ? <PaperLabel size="md" tilt={1} delay={260} className="sticker-campaign__copy">{campaign.description}</PaperLabel> : null}

      <Sticker tilt={-1.5} delay={300} className="sticker-cta">
        {available
          ? <button className="sticker-pill" type="button" onClick={() => navigate(campaignPath(campaign, "/give") as TakePath)}>Give your TAKE</button>
          : <button className="sticker-pill" type="button" onClick={() => navigate(detail)}>Open {campaign.title}</button>}
      </Sticker>
      {!available ? <p className="sticker-note">{viewerNote(campaign, given, recipient)}</p> : null}
    </article>
  );
}

function canGive(campaign: Campaign) {
  return campaign.status === "LIVE"
    && (campaign.viewer?.usedTakes ?? 0) === 0
    && Boolean(campaign.viewer?.canParticipate)
    && (campaign.viewer?.availableTakes ?? 0) > 0;
}

function viewerNote(campaign: Campaign, given: boolean, recipient: Person | null) {
  if (given) return recipient ? `You gave your TAKE to ${recipient.name}.` : "Your TAKE is in.";
  if (campaign.status === "UPCOMING") return `Nominations open ${titleDate(campaign.starts)}.`;
  if (campaign.status === "CLOSED") return "The chance to give a TAKE has passed.";
  if (campaign.sourceStatus === "CREATED") return "It is on Monad. You can give after nominations open.";
  return "You are not on the list of people who can give in this one.";
}

/** "13 OCT" → "Oct 13". Anything unexpected is shown as-is. */
function titleDate(value: string) {
  const match = value.match(/^(\d{1,2}) ([A-Z]{3})$/);
  if (!match) return value;
  const [, day, month] = match;
  return `${month!.charAt(0)}${month!.slice(1).toLowerCase()} ${Number(day)}`;
}

function historyRecipient(entry: TakeHistoryEntry | undefined): Person | null {
  return entry?.person ? personFromHistoryPerson(entry.person, `${entry.id}:recipient`) : null;
}

function emptyTitle(filter: Filter, query: string) {
  if (query.trim()) return "No opportunities found.";
  if (filter === "LIVE") return "No live campaign yet.";
  if (filter === "UPCOMING") return "Nothing is scheduled.";
  if (filter === "CLOSED") return "No closed campaigns.";
  return "No opportunities yet.";
}

function emptyBody(filter: Filter, query: string) {
  if (query.trim()) return "Try another name or campaign state.";
  if (filter === "LIVE" || filter === "ALL") return "A campaign shows up here after you publish it on Monad and open nominations.";
  return "Create a campaign from Organize when you are ready.";
}
