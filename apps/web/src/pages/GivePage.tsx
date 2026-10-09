import { ArrowRight, Search, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ProductError, ProductLoading, SocialEmpty } from "../components/ProductState";
import { PersonResult } from "../components/Social";
import { FlowBack, FlowHandoff } from "../components/sticker/FlowParts";
import { MascotSticker, PaperLabel, Sticker } from "../components/sticker/Sticker";
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
    <div className="page-container sticker-page sticker-feed sticker-flow give-page">
      <FlowBack label="Campaign" onClick={() => navigate(campaignPath(campaign) as TakePath)} />
      <section className="sticker-feed__stage" aria-labelledby="people-picker-heading">
        <Sticker tilt={4} className="feed-tag"><span>{campaign.title}</span></Sticker>
        <MascotSticker kind="lime" tilt={8} delay={240} className="sticker-feed__mascot sticker-feed__mascot--lime" />
        <div className="sticker-feed__headline">
          <h1 id="people-picker-heading"><PaperLabel size="lg" tilt={-2} delay={60}>Who gets your TAKE?</PaperLabel></h1>
          <PaperLabel size="sm" tilt={1.5} delay={120}>Pick one person. It can’t be you.</PaperLabel>
        </div>
        <FlowHandoff from={currentPerson} to={selected} label={selected ? `You chose ${selected.name}` : "Choose who gets your TAKE"} />
      </section>

      <Sticker tilt={-0.4} delay={200} className="sticker-flow__card people-picker">
        <label className="sticker-flow__search"><Search size={20} strokeWidth={1.8} aria-hidden="true" /><input type="search" aria-label="Search people" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search by name or @handle" autoFocus /><span>{searching ? "…" : results.length}</span></label>
        <p className="sticker-flow__group"><UsersRound size={16} aria-hidden="true" />{query.trim() ? "Search results" : "People you can choose"}</p>
        <div className="people-results" aria-live="polite" aria-busy={searching}>
          {searching && !results.length ? <ProductLoading label="Finding people" /> : null}
          {searchError ? <ProductError message={searchError} onRetry={() => setQuery((value) => `${value} `)} /> : null}
          {!searching && !searchError && results.length ? results.map((person) => <PersonResult key={person.id} person={person} selected={selected?.id === person.id} onSelect={onSelect} />) : null}
          {!searching && !searchError && !results.length ? <SocialEmpty title={query ? "No person found." : "No other people are available yet."}>Try the full X handle, or come back when more people have joined TAKE.</SocialEmpty> : null}
        </div>
      </Sticker>

      <div className={`sticker-flow__dock${selected ? "" : " sticker-flow__dock--idle"}`} aria-live="polite">
        {selected
          ? <button className="sticker-pill" type="button" onClick={() => navigate(campaignPath(campaign, "/confirm") as TakePath)}><span>Continue with {selected.name}</span><ArrowRight aria-hidden="true" /></button>
          : <PaperLabel size="sm" tilt={-1}>{`Select someone to continue · ends ${campaign.ends}`}</PaperLabel>}
      </div>
    </div>
  );
}
