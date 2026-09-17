import { ArrowLeft, Search, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PrimaryAction } from "../components/Actions";
import { Avatar } from "../components/Avatar";
import { ProductError, ProductLoading, SocialEmpty } from "../components/ProductState";
import { PersonResult } from "../components/Social";
import { TakeMascotAccent } from "../components/TakeMascotAccent";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { campaignPath, personFromApi } from "../lib/productData";
import type { ApiPerson, Person } from "../types/product";

interface GivePageProps {
  campaignId: string;
  selected: Person | null;
  onSelect: (person: Person) => void;
  navigate: (path: TakePath) => void;
  currentPerson: Person;
}

export function GivePage({ campaignId, selected, onSelect, navigate, currentPerson }: GivePageProps) {
  const { request } = useTakeMe();
  const { campaigns, peoplePreview, status: productStatus } = useTakeProduct();
  const campaign = campaigns.find((item) => item.id === campaignId);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>(peoplePreview);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchVersion = useRef(0);

  useEffect(() => {
    const normalized = query.trim().replace(/^@/, "");
    const experimentRecipients = campaign?.experiment?.version === "TAKE_EXPERIMENT_V0";
    if (!normalized && !experimentRecipients) {
      searchVersion.current += 1;
      setResults(peoplePreview);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const version = ++searchVersion.current;
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const response = experimentRecipients
          ? await request<{ recipients: ApiPerson[] }>(`/campaigns/${encodeURIComponent(campaignId)}/recipients?query=${encodeURIComponent(normalized)}`)
          : await request<{ people: ApiPerson[] }>(`/people?query=${encodeURIComponent(normalized)}&limit=16`);
        if (version !== searchVersion.current) return;
        const people = "recipients" in response ? response.recipients : response.people;
        setResults(people.map(personFromApi));
      } catch (caught) {
        if (version !== searchVersion.current) return;
        setSearchError(caught instanceof Error ? caught.message : "TAKE could not search people.");
      } finally {
        if (version === searchVersion.current) setSearching(false);
      }
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [campaign?.experiment?.version, campaignId, peoplePreview, query, request]);

  if (productStatus === "loading" || productStatus === "idle") return <div className="page-container"><ProductLoading label="Opening people search" /></div>;
  if (!campaign) return <div className="page-container"><ProductError message="This campaign is not available." onRetry={() => navigate("/explore")} /></div>;

  return (
    <div className="page-container give-page">
      <button className="back-link" type="button" onClick={() => navigate(campaignPath(campaign) as TakePath)}><ArrowLeft size={17} />CAMPAIGN</button>
      <div className="give-layout">
        <section className="people-picker" aria-labelledby="people-picker-heading">
          <header className="people-picker__heading"><span className="eyebrow">{campaign.title}</span><h1 id="people-picker-heading">Who gets your TAKE?</h1><p>Find the person who should get this opportunity. It can’t be you.</p></header>

          <label className="people-search"><Search size={21} strokeWidth={1.7} /><input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search by name or @handle" autoFocus /><span>{searching ? "…" : results.length.toString().padStart(2, "0")}</span></label>
          <div className="people-group-heading"><span><UsersRound size={18} />{query.trim() ? "SEARCH RESULTS" : "PEOPLE ON TAKE"}</span><small>REAL TAKE IDENTITIES</small></div>
          <div className="people-results" aria-live="polite" aria-busy={searching}>
            {searching && !results.length ? <ProductLoading label="Finding people" /> : null}
            {searchError ? <ProductError message={searchError} onRetry={() => setQuery((value) => `${value} `)} /> : null}
            {!searching && !searchError && results.length ? results.map((person) => <PersonResult key={person.id} person={person} selected={selected?.id === person.id} onSelect={onSelect} />) : null}
            {!searching && !searchError && !results.length ? <SocialEmpty title={query ? "No person found." : "No other people are available yet."}>Try the full X handle, or return when more identities have joined TAKE.</SocialEmpty> : null}
          </div>
        </section>

        <aside className={`selection-dock${selected ? " has-selection" : ""}`} aria-live="polite">
          <TakeMascotAccent character={selected ? "purple" : "green"} className="mascot-selection" />
          <div className="selection-dock__take"><span className="eyebrow">YOUR TAKE</span><strong>01</strong><span>AVAILABLE</span></div>
          {selected ? (
            <><div className="selection-dock__person"><span className="selection-dock__marker">YOU CHOSE</span><Avatar person={selected} size="lg" /><strong>{selected.name}</strong>{selected.handle ? <small>{selected.handle}</small> : null}<p>{selected.joined ? "A TAKE member." : "Connected through X. They can join after you choose them."}</p></div><PrimaryAction full onClick={() => navigate(campaignPath(campaign, "/confirm") as TakePath)}>CONTINUE WITH {selected.name.toUpperCase()}</PrimaryAction></>
          ) : (
            <div className="selection-dock__empty"><Avatar person={currentPerson} size="sm" /><p>Select someone to continue.</p><span>ENDS {campaign.ends}</span></div>
          )}
        </aside>
      </div>
    </div>
  );
}
