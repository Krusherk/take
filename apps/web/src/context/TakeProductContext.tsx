import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { campaignFromApi, personFromApi } from "../lib/productData";
import type { ApiCampaign, ApiPerson, Campaign, Person } from "../types/product";
import { useTakeMe } from "./TakeIdentityContext";

type ProductStatus = "idle" | "loading" | "ready" | "error";

interface TakeProductContextValue {
  status: ProductStatus;
  campaigns: Campaign[];
  peoplePreview: Person[];
  error: string | null;
  refetch: () => Promise<void>;
}

const TakeProductContext = createContext<TakeProductContextValue | null>(null);

export function TakeProductProvider({ children }: { children: ReactNode }) {
  const { status: identityStatus, me, request } = useTakeMe();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [peoplePreview, setPeoplePreview] = useState<Person[]>([]);
  const [status, setStatus] = useState<ProductStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);

  const load = useCallback(async () => {
    if (identityStatus !== "ready" || !me) return;
    const requestVersion = ++version.current;
    setStatus("loading");
    setError(null);
    try {
      const [campaignResponse, peopleResponse] = await Promise.all([
        request<ApiCampaign[]>("/campaigns"),
        request<{ people: ApiPerson[] }>("/people?limit=6"),
      ]);
      if (requestVersion !== version.current) return;
      setCampaigns(campaignResponse.map(campaignFromApi));
      setPeoplePreview(peopleResponse.people.map(personFromApi));
      setStatus("ready");
    } catch (caught) {
      if (requestVersion !== version.current) return;
      setCampaigns([]);
      setPeoplePreview([]);
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "TAKE could not load campaigns.");
    }
  }, [identityStatus, me, request]);

  useEffect(() => {
    if (identityStatus !== "ready" || !me) {
      version.current += 1;
      setCampaigns([]);
      setPeoplePreview([]);
      setStatus("idle");
      setError(null);
      return;
    }
    void load();
  }, [identityStatus, load, me]);

  const value = useMemo<TakeProductContextValue>(() => ({
    status,
    campaigns,
    peoplePreview,
    error,
    refetch: load,
  }), [campaigns, error, load, peoplePreview, status]);

  return <TakeProductContext.Provider value={value}>{children}</TakeProductContext.Provider>;
}

export function useTakeProduct(): TakeProductContextValue {
  const value = useContext(TakeProductContext);
  if (!value) throw new Error("useTakeProduct must be used inside TakeProductProvider");
  return value;
}
