import { useCallback, useEffect, useState } from "react";
import { useTakeMe } from "../context/TakeIdentityContext";
import type { SignalCallEntry, SignalCallValue, SignalCalls } from "../../../../packages/shared/src/signal";

/**
 * Calls are an optional layer on Signal. If the endpoint is missing or the
 * table has not been migrated yet, `available` stays false and the UI hides it.
 */
export function useSignalCalls() {
  const { request } = useTakeMe();
  const [calls, setCalls] = useState<SignalCallEntry[]>([]);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void request<SignalCalls>("/me/signal/calls", { signal: controller.signal })
      .then((result) => { setCalls(Array.isArray(result?.calls) ? result.calls : []); setAvailable(Array.isArray(result?.calls)); })
      .catch(() => { if (!controller.signal.aborted) setAvailable(false); });
    return () => controller.abort();
  }, [request]);
  const make = useCallback(async (campaignId: string, recipientKey: string, call: SignalCallValue) => {
    const updated = await request<SignalCallEntry | null>(`/campaigns/${campaignId}/calls`, { method: "POST", body: JSON.stringify({ recipientKey, call }) });
    setCalls((current) => {
      const next = updated ?? { campaignId, recipientKey, mine: call, open: true, closesAt: null, split: null };
      const index = current.findIndex((entry) => entry.campaignId === campaignId && entry.recipientKey.toLowerCase() === recipientKey.toLowerCase());
      return index < 0 ? [...current, next] : current.map((entry, at) => at === index ? next : entry);
    });
  }, [request]);
  const find = useCallback((campaignId: string, recipientKey: string) =>
    calls.find((entry) => entry.campaignId === campaignId && entry.recipientKey.toLowerCase() === recipientKey.toLowerCase()) ?? null, [calls]);
  return { available, find, make };
}
