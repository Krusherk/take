import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ProductError, ProductLoading } from "../components/ProductState";
import { CampaignSticker, EmptySlotSticker, FaceSticker, PaperLabel, PassArrow, StatusSticker, Sticker } from "../components/sticker/Sticker";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { personFromHistoryPerson, personFromMe } from "../lib/currentIdentity";
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
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return campaigns.filter((campaign) => {
      if (!isParticipantCampaign(campaign)) return false;
      const matchesFilter = filter === "ALL" || campaign.status === filter;
      const matchesQuery = !normalized || `${campaign.title} ${campaign.organizer} ${campaign.resource}`.toLowerCase().includes(normalized);
      return matchesFilter && matchesQuery;
    });
  }, [campaigns, filter, query]);
  const featured = useMemo(() => pickFeatured(visible), [visible]);
  const others = featured ? visible.filter((campaign) => campaign.id !== featured.id) : [];

  return (
    <div className="page-container sticker-page sticker-explore">
      <h1 className="sticker-sr-only">Explore opportunities</h1>
      <div className="sticker-tools">
        <label className="sticker-search"><Search size={18} strokeWidth={2} aria-hidden="true" /><input aria-label="Search campaigns" placeholder="Search opportunities" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
        <div className="sticker-filters" role="group" aria-label="Filter campaigns">
          {(["ALL", "LIVE", "UPCOMING", "CLOSED"] as const).map((item) => <button key={item} className={filter === item ? "is-active" : undefined} aria-pressed={filter === item} type="button" onClick={() => setFilter(item)}>{item}</button>)}
        </div>
      </div>

      {status === "loading" || status === "idle" ? <ProductLoading label="Loading opportunities" /> : null}
      {status === "error" ? <ProductError message={error ?? "Campaigns are unavailable."} onRetry={() => void refetch()} /> : null}
      {status === "ready" ? (
        featured ? (
          <>
            <FeaturedCampaign key={featured.id} campaign={featured} currentPerson={currentPerson} recipient={historyRecipient(history?.given.find((entry) => entry.campaignId === featured.id))} navigate={navigate} />
            {others.length ? (
              <section className="sticker-more" aria-label="More campaigns">
                <h2><PaperLabel size="sm" tilt={-2}>More opportunities</PaperLabel></h2>
                <ul>
                  {others.map((campaign, index) => <CampaignStickerRow key={campaign.id} campaign={campaign} index={index} navigate={navigate} />)}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <section className="sticker-empty" aria-label="Campaigns">
            <EmptySlotSticker tilt={-5} />
            <h2><PaperLabel size="lg" tilt={-2} delay={60}>{emptyTitle(filter, query)}</PaperLabel></h2>
            <PaperLabel size="sm" tilt={1.5} delay={120}>{emptyBody(filter, query)}</PaperLabel>
            {query ? null : <Sticker tilt={-1} delay={180} className="sticker-cta"><button className="sticker-pill" type="button" onClick={() => navigate("/organize")}>Create a campaign</button></Sticker>}
          </section>
        )
      ) : null}
    </div>
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
  const spots = campaign.spots ? `${campaign.spots.toLocaleString("en-US")} ${campaign.spots === 1 ? "spot" : "spots"}` : campaign.resourceName;

  return (
    <article className="sticker-campaign" aria-labelledby={`campaign-${campaign.id}-title`}>
      <a className="sticker-campaign__art" href={detail} aria-label={`Open ${campaign.title}`} onClick={(event) => { event.preventDefault(); navigate(detail); }}>
        <CampaignSticker campaign={campaign} tilt={-4} />
        <span className="sticker-campaign__status"><StatusSticker status={campaign.status} tilt={-7} delay={140} /></span>
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

      <PaperLabel size="sm" tilt={-1.5} delay={220} className="sticker-campaign__meta">{spots} · {timing}</PaperLabel>
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

function CampaignStickerRow({ campaign, index, navigate }: { campaign: Campaign; index: number; navigate: (path: TakePath) => void }) {
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

function canGive(campaign: Campaign) {
  return campaign.status === "LIVE"
    && (campaign.viewer?.usedTakes ?? 0) === 0
    && Boolean(campaign.viewer?.canParticipate)
    && (campaign.viewer?.availableTakes ?? 0) > 0;
}

/** Lead with a live campaign the viewer can give in, then any live one, then the first match. */
function pickFeatured(campaigns: Campaign[]): Campaign | null {
  return campaigns.find(canGive) ?? campaigns.find((campaign) => campaign.status === "LIVE") ?? campaigns[0] ?? null;
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
