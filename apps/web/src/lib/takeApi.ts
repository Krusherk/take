export const TAKE_API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

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

export function createTakeApiClient(getAccessToken: GetAccessToken, options: TakeApiClientOptions = {}): TakeApiClient {
  return {
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        options.onUnauthorized?.();
        throw new TakeApiError("Your TAKE session has ended. Sign in again to continue.", 401, "UNAUTHORIZED");
      }

      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${accessToken}`);
      if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const response = await fetch(`${TAKE_API_BASE_URL}${path}`, { ...init, headers });
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
