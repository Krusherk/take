// The last signed-in view, kept on this device so a returning visitor sees their
// TAKE straight away while Privy starts and the API answers (stale-while-revalidate).
// Keyed by the Privy user id; anything for a different user, or older than a week,
// is ignored. Cleared on sign-out.
import type { TakeHistory, TakeMe } from "../types/identity";
import type { ApiCampaign, ApiPerson } from "../types/product";

const KEY = "take:last-session:v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionCache {
  privyUserId: string;
  savedAt: number;
  me?: TakeMe;
  history?: TakeHistory;
  campaigns?: ApiCampaign[];
  people?: ApiPerson[];
}

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

/** The cached view; pass a user id to require that user. */
export function readSessionCache(privyUserId?: string | null): SessionCache | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as SessionCache;
    if (!value?.privyUserId || Date.now() - value.savedAt > MAX_AGE_MS) return null;
    if (privyUserId && value.privyUserId !== privyUserId) return null;
    return value;
  } catch { return null; }
}

export function writeSessionCache(privyUserId: string, patch: Omit<Partial<SessionCache>, "privyUserId" | "savedAt">) {
  try {
    const current = readSessionCache(privyUserId) ?? { privyUserId, savedAt: Date.now() };
    storage()?.setItem(KEY, JSON.stringify({ ...current, ...patch, privyUserId, savedAt: Date.now() }));
  } catch { /* full or blocked storage: the app still works, just without the instant view */ }
}

export function clearSessionCache() {
  try { storage()?.removeItem(KEY); } catch { /* ignore */ }
}
