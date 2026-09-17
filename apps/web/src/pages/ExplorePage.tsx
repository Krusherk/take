import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { CampaignRow } from "../components/Campaign";
import { ProductError, ProductLoading, SocialEmpty } from "../components/ProductState";
import { TakeMascotAccent } from "../components/TakeMascotAccent";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { personFromHistoryPerson, personFromMe } from "../lib/currentIdentity";
import { isParticipantCampaign } from "../lib/productData";
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
      <header className="page-intro index-intro">
        <div><span className="eyebrow">EXPLORE</span><h1>Pass an opportunity to someone who belongs there.</h1></div>
        <label className="index-search"><Search size={20} strokeWidth={1.7} /><input aria-label="Search campaigns" placeholder="Search opportunities" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
        <TakeMascotAccent character="green" className="mascot-intro mascot-intro--explore" />
      </header>

      <div className="index-filters" role="group" aria-label="Filter campaigns">
        {(["ALL", "LIVE", "UPCOMING", "CLOSED"] as const).map((item) => <button key={item} className={filter === item ? "is-active" : undefined} type="button" onClick={() => setFilter(item)}>{item}</button>)}
        <span>{visible.length} {visible.length === 1 ? "OPPORTUNITY" : "OPPORTUNITIES"}</span>
      </div>

      {status === "loading" || status === "idle" ? <ProductLoading label="Loading opportunities" /> : null}
      {status === "error" ? <ProductError message={error ?? "Campaigns are unavailable."} onRetry={() => void refetch()} /> : null}
      {status === "ready" ? (
        <section className="campaign-index" aria-label="Campaigns">
          {visible.length ? visible.map((campaign, index) => (
            <div className="campaign-index__item" key={campaign.id}>
              <span className="campaign-index__number">{String(index + 1).padStart(2, "0")}</span>
              <CampaignRow
                campaign={campaign}
                navigate={navigate}
                featured={index === 0 && filter === "ALL" && !query}
                giver={currentPerson}
                recipient={historyRecipient(history?.given.find((entry) => entry.campaignId === campaign.id))}
              />
            </div>
          )) : <SocialEmpty title="No opportunities found.">Try another name or campaign state.</SocialEmpty>}
        </section>
      ) : null}
    </div>
  );
}

function historyRecipient(entry: TakeHistoryEntry | undefined): Person | null {
  return entry?.person ? personFromHistoryPerson(entry.person, `${entry.id}:recipient`) : null;
}
