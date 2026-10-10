import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { campaignFromApi, personFromApi } from "../lib/productData";
import type { ApiCampaign, ApiPerson, Campaign, Person } from "../types/product";
import { useTakeMe } from "./TakeIdentityContext";
import { readSessionCache, writeSessionCache } from "../lib/sessionCache";

type ProductStatus = "idle" | "loading" | "ready" | "error";

interface TakeProductContextValue {
  status: ProductStatus;
  campaigns: Campaign[];
  peoplePreview: Person[];
  error: string | null;
  /** True while cached campaigns are shown and fresh ones are on the way. */
  refreshing: boolean;
  refetch: () => Promise<void>;
}

const TakeProductContext = createContext<TakeProductContextValue | null>(null);

export function TakeProductProvider({ children }: { children: ReactNode }) {
  // Campaigns only need a signed-in session, not the /me profile, so they load in
  // parallel with /me and /me/history instead of after them.
  const { status: identityStatus, sessionId, provisional, request } = useTakeMe();
  const signedIn = Boolean(sessionId) && identityStatus !== "profile-error" && identityStatus !== "unauthenticated";
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [peoplePreview, setPeoplePreview] = useState<Person[]>([]);
  const [status, setStatus] = useState<ProductStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const version = useRef(0);
  const shownFor = useRef<string | null>(null);
  const loaded = useRef(false);

  // Show this person's last campaigns at once (stale-while-revalidate); /campaigns refreshes them.
  useEffect(() => {
    if (!sessionId || shownFor.current === sessionId) return;
    shownFor.current = sessionId;
    const cache = readSessionCache(sessionId);
    if (cache?.campaigns) {
      setCampaigns(cache.campaigns.map(campaignFromApi));
      setPeoplePreview((cache.people ?? []).map(personFromApi));
      setStatus("ready");
      loaded.current = true;
    }
  }, [sessionId]);

  const load = useCallback(async () => {
    if (!signedIn || !sessionId) return;
    const requestVersion = ++version.current;
    const hasData = Boolean(readSessionCache(sessionId)?.campaigns) || loaded.current;
    if (hasData) setRefreshing(true); else setStatus("loading");
    setError(null);
    try {
      const [campaignResponse, peopleResponse] = await Promise.all([
        request<ApiCampaign[]>("/campaigns"),
        // The people preview is a nicety: never let it hold up or fail the campaign list.
        request<{ people: ApiPerson[] }>("/people?limit=6").catch(() => null),
      ]);
      if (requestVersion !== version.current) return;
      setCampaigns(campaignResponse.map(campaignFromApi));
      if (peopleResponse) setPeoplePreview(peopleResponse.people.map(personFromApi));
      setStatus("ready");
      loaded.current = true;
      writeSessionCache(sessionId, { campaigns: campaignResponse, ...(peopleResponse ? { people: peopleResponse.people } : {}) });
    } catch (caught) {
      if (requestVersion !== version.current) return;
      const message = caught instanceof Error ? caught.message : "TAKE could not load campaigns.";
      setError(message);
      // Keep what is on screen if this was only a refresh.
      if (!hasData) { setCampaigns([]); setPeoplePreview([]); setStatus("error"); }
    } finally {
      if (requestVersion === version.current) setRefreshing(false);
    }
  }, [signedIn, sessionId, request]);

  useEffect(() => {
    if (!signedIn) {
      version.current += 1;
      shownFor.current = null;
      loaded.current = false;
      setCampaigns([]);
      setPeoplePreview([]);
      setStatus("idle");
      setError(null);
      setRefreshing(false);
      return;
    }
    // A cached view waits for Privy before asking the API (a token is needed anyway).
    if (provisional) return;
    void load();
  }, [load, signedIn, sessionId, provisional]);

  const value = useMemo<TakeProductContextValue>(() => ({
    status,
    campaigns,
    peoplePreview,
    error,
    refreshing,
    refetch: load,
  }), [campaigns, error, load, peoplePreview, refreshing, status]);

  return <TakeProductContext.Provider value={value}>{children}</TakeProductContext.Provider>;
}

export function useTakeProduct(): TakeProductContextValue {
  const value = useContext(TakeProductContext);
  if (!value) throw new Error("useTakeProduct must be used inside TakeProductProvider");
  return value;
}
