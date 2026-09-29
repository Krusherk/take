import { useCallback, useEffect, useState } from "react";
import { useTakeMe } from "../context/TakeIdentityContext";
import type { SignalHistory } from "../../../../packages/shared/src/signal";

export function useSignal() {
  const { request } = useTakeMe();
  const [data, setData] = useState<SignalHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    void request<SignalHistory>("/me/signal", { signal: controller.signal }).then(setData).catch((caught) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Signal could not be loaded.");
    });
    return () => controller.abort();
  }, [request, revision]);
  return { data, error, reload };
}
