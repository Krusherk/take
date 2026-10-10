// Vercel redirects double-slash paths before API CORS headers can be applied.
export const TAKE_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").trim().replace(/\/+$/, "");

export class TakeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "TakeApiError";
  }
}

type GetAccessToken = () => Promise<string | null>;

export interface TakeApiClient {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}

interface TakeApiClientOptions {
  onUnauthorized?: () => void;
}

/** A read that gets no answer in this long is abandoned and tried once more. */
export const READ_TIMEOUT_MS = 8_000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

class ReadTimeout extends Error {
  constructor() { super("TAKE’s server is taking too long to respond. Please try again shortly."); this.name = "ReadTimeout"; }
}

/** fetch with a deadline that also honours the caller's own abort signal. */
async function fetchWithDeadline(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const outer = init.signal;
  const onAbort = () => controller.abort(outer?.reason);
  outer?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (caught) {
    if (timedOut) throw new ReadTimeout();
    throw caught;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}

export function createTakeApiClient(getAccessToken: GetAccessToken, options: TakeApiClientOptions = {}): TakeApiClient {
  return {
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      init.signal?.throwIfAborted();
      const accessToken = await getAccessToken();
      init.signal?.throwIfAborted();
      if (!accessToken) {
        options.onUnauthorized?.();
        throw new TakeApiError("Your TAKE session has ended. Sign in again to continue.", 401, "UNAUTHORIZED");
      }

      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${accessToken}`);
      if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      // Reads get a deadline and one quiet retry: a single stuck or cold server instance
      // should cost seconds, not the platform's 60-second limit. Writes are never retried.
      const isRead = !init.method || init.method.toUpperCase() === "GET";
      const url = `${TAKE_API_BASE_URL}${path}`;
      let response: Response;
      if (!isRead) response = await fetch(url, { ...init, headers });
      else {
        try {
          response = await fetchWithDeadline(url, { ...init, headers }, READ_TIMEOUT_MS);
          if (RETRYABLE_STATUS.has(response.status)) throw new ReadTimeout();
        } catch (caught) {
          init.signal?.throwIfAborted();
          if (!(caught instanceof ReadTimeout || caught instanceof TypeError)) throw caught;
          response = await fetchWithDeadline(url, { ...init, headers }, READ_TIMEOUT_MS);
        }
      }
      if (!response.ok) {
        if (response.status === 401) options.onUnauthorized?.();
        const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
        throw new TakeApiError(
          payload?.message ?? payload?.error ?? `TAKE request failed (${response.status})`,
          response.status,
          payload?.error,
        );
      }

      if (response.status === 204) {
        return undefined as T;
      }
      return response.json() as Promise<T>;
    },
  };
}
