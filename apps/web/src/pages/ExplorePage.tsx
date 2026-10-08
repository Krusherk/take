import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { CampaignArtwork, CampaignStatus } from "../components/Campaign";
import { ProductError, ProductLoading, SocialEmpty } from "../components/ProductState";
import { TakeMascotAccent } from "../components/TakeMascotAccent";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { personFromHistoryPerson, personFromMe } from "../lib/currentIdentity";
import { campaignPath, isParticipantCampaign } from "../lib/productData";
import type { TakeHistoryEntry } from "../types/identity";
import type { Person } from "../types/product";
import type { CampaignState } from "../types/product";

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

  return (
    <div className="page-container index-page">
      <header className="page-intro explore-intro">
        <div>
          <span className="eyebrow">EXPLORE</span>
          <h1>Pass an opportunity to someone who belongs there.</h1>
        </div>
        <TakeMascotAccent character="green" className="mascot-intro mascot-intro--explore" />
      </header>

      <div className="explore-tools">
        <label className="index-search explore-search"><Search size={20} strokeWidth={1.7} /><input aria-label="Search campaigns" placeholder="Search opportunities" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
        <div className="index-filters" role="group" aria-label="Filter campaigns">
          {(["ALL", "LIVE", "UPCOMING", "CLOSED"] as const).map((item) => <button key={item} className={filter === item ? "is-active" : undefined} type="button" onClick={() => setFilter(item)}>{item === "ALL" ? "ALL" : item}</button>)}
        </div>
      </div>

      {status === "loading" || status === "idle" ? <ProductLoading label="Loading opportunities" /> : null}
      {status === "error" ? <ProductError message={error ?? "Campaigns are unavailable."} onRetry={() => void refetch()} /> : null}
      {status === "ready" ? (
        <section className="explore-board" aria-label="Campaigns">
          {visible.length ? visible.map((campaign) => {
            const recipient = historyRecipient(history?.given.find((entry) => entry.campaignId === campaign.id));
            const destination = campaignPath(campaign) as TakePath;
            const given = (campaign.viewer?.usedTakes ?? 0) > 0;
            return (
              <a className="explore-card" href={destination} key={campaign.id} onClick={(event) => { event.preventDefault(); navigate(destination); }}>
                <CampaignArtwork campaign={campaign} giver={given ? currentPerson : null} recipient={given ? recipient : null} compact />
                <span className="explore-card__copy">
                  <CampaignStatus status={campaign.status} />
                  <strong>{campaign.title}</strong>
                  <em>by {campaign.organizer}</em>
                  <span>{campaign.description}</span>
                  <small>{campaign.resource} · {campaign.status === "UPCOMING" ? `Opens ${campaign.starts}` : `Ends ${campaign.ends}`}{given && recipient ? ` · Given to ${recipient.name}` : given ? " · TAKE given" : ""}</small>
                </span>
              </a>
            );
          }) : <SocialEmpty title={emptyTitle(filter, query)} action={query ? undefined : "Create a campaign"} onAction={query ? undefined : () => navigate("/organize")}>{emptyBody(filter, query)}</SocialEmpty>}
        </section>
      ) : null}
    </div>
  );
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
