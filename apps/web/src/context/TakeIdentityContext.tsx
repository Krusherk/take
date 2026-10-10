import { privyNeededNow, usePrivy } from "../lib/privy";
import { clearSessionCache, readSessionCache, writeSessionCache } from "../lib/sessionCache";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createTakeApiClient, type TakeApiClient } from "../lib/takeApi";
import type { TakeHistory, TakeMe } from "../types/identity";

export type TakeIdentityStatus = "privy-initializing" | "unauthenticated" | "profile-loading" | "ready" | "profile-error";

interface IdentitySnapshot {
  privyUserId: string;
  me: TakeMe;
  history: TakeHistory;
  /** From this device's last visit, shown until Privy and /me confirm it. */
  cached?: boolean;
}

/** A returning visitor with a Privy session: start from their last view. */
function cachedSnapshot(): IdentitySnapshot | null {
  if (typeof window === "undefined" || !privyNeededNow()) return null;
  const cache = readSessionCache();
  return cache?.me && cache.history ? { privyUserId: cache.privyUserId, me: cache.me, history: cache.history, cached: true } : null;
}

interface TakeIdentityContextValue {
  status: TakeIdentityStatus;
  /** The signed-in Privy user while authenticated, before /me resolves. Lets other data load in parallel. */
  sessionId: string | null;
  /** True while the shown identity is this device's cached copy and Privy is still starting. */
  provisional: boolean;
  me: TakeMe | null;
  history: TakeHistory | null;
  error: string | null;
  refreshing: boolean;
  request: TakeApiClient["request"];
  refetch: () => Promise<void>;
  clear: () => void;
}

const TakeIdentityContext = createContext<TakeIdentityContextValue | null>(null);

export function TakeIdentityProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const [snapshot, setSnapshot] = useState<IdentitySnapshot | null>(() => ready ? null : cachedSnapshot());
  const [status, setStatus] = useState<TakeIdentityStatus>(ready ? "unauthenticated" : "privy-initializing");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requestVersion = useRef(0);
  const identityRequest = useRef<AbortController | null>(null);
  const handleUnauthorized = useCallback(() => {
    clearSessionCache();
    requestVersion.current += 1;
    setSnapshot(null);
    setRefreshing(false);
    setStatus("profile-error");
    setError("Your TAKE session has ended. Log out and sign in again.");
  }, []);
  const client = useMemo(
    () => createTakeApiClient(getAccessToken, { onUnauthorized: handleUnauthorized }),
    [getAccessToken, handleUnauthorized],
  );
  const currentPrivyUserId = user?.id ?? null;
  const activeSnapshot = snapshot && (currentPrivyUserId
    ? snapshot.privyUserId === currentPrivyUserId
    : !ready && snapshot.cached) ? snapshot : null;
  const provisional = Boolean(activeSnapshot?.cached && !(ready && authenticated));

  const loadIdentity = useCallback(async (privyUserId: string, preserveExisting: boolean) => {
    const version = ++requestVersion.current;
    identityRequest.current?.abort();
    const controller = new AbortController();
    identityRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(new Error(
      "TAKE’s server is taking too long to respond. Please try again shortly."
    )), 20_000);
    const cancelled = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    });
    if (!preserveExisting) {
      setStatus("profile-loading");
      setError(null);
    } else {
      setRefreshing(true);
    }

    try {
      const [me, history] = await Promise.race([
        Promise.all([
          client.request<TakeMe>("/me", { signal: controller.signal }),
          client.request<TakeHistory>("/me/history", { signal: controller.signal }),
        ]),
        cancelled,
      ]);
      if (version !== requestVersion.current) return;
      setSnapshot({ privyUserId, me, history });
      writeSessionCache(privyUserId, { me, history });
      setStatus("ready");
      setError(null);
    } catch (caught) {
      if (version !== requestVersion.current) return;
      if (!preserveExisting) {
        setSnapshot(null);
        setStatus("profile-error");
      }
      setError(caught instanceof TypeError
        ? "TAKE couldn’t reach its server. Please try again shortly."
        : caught instanceof Error ? caught.message : "TAKE could not load your profile.");
    } finally {
      window.clearTimeout(timeout);
      controller.abort();
      if (identityRequest.current === controller) identityRequest.current = null;
      if (version === requestVersion.current) {
        setRefreshing(false);
      }
    }
  }, [client]);

  useEffect(() => {
    requestVersion.current += 1;
    identityRequest.current?.abort();
    setRefreshing(false);

    if (!ready) {
      setStatus("privy-initializing");
      // Keep this device's cached view on screen while Privy starts.
      setSnapshot((current) => current?.cached ? current : null);
      setError(null);
      return;
    }
    if (!authenticated || !currentPrivyUserId) {
      setStatus("unauthenticated");
      setSnapshot(null);
      setError(null);
      clearSessionCache();
      return;
    }

    // Same person as the cached view: refresh it in place instead of blanking the screen.
    const keep = snapshot?.privyUserId === currentPrivyUserId;
    if (!keep) setSnapshot(null);
    void loadIdentity(currentPrivyUserId, keep);
    return () => {
      requestVersion.current += 1;
      identityRequest.current?.abort();
    };
    // Only sign-in changes restart this; the cached snapshot is read, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, currentPrivyUserId, loadIdentity, ready]);

  const refetch = useCallback(async () => {
    if (!ready || !authenticated || !currentPrivyUserId) return;
    await loadIdentity(currentPrivyUserId, Boolean(activeSnapshot));
  }, [activeSnapshot, authenticated, currentPrivyUserId, loadIdentity, ready]);

  const clear = useCallback(() => {
    clearSessionCache();
    requestVersion.current += 1;
    identityRequest.current?.abort();
    setSnapshot(null);
    setError(null);
    setRefreshing(false);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo<TakeIdentityContextValue>(() => ({
    status: activeSnapshot ? "ready" : status,
    sessionId: ready && authenticated ? currentPrivyUserId : provisional ? activeSnapshot!.privyUserId : null,
    provisional,
    me: activeSnapshot?.me ?? null,
    history: activeSnapshot?.history ?? null,
    error,
    refreshing,
    request: client.request,
    refetch,
    clear,
  }), [activeSnapshot, authenticated, clear, client.request, currentPrivyUserId, error, provisional, ready, refetch, refreshing, status]);

  return <TakeIdentityContext.Provider value={value}>{children}</TakeIdentityContext.Provider>;
}

export function useTakeMe(): TakeIdentityContextValue {
  const value = useContext(TakeIdentityContext);
  if (!value) {
    throw new Error("useTakeMe must be used inside TakeIdentityProvider");
  }
  return value;
}
