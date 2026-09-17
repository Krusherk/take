import { useCallback, useEffect, useState } from "react";

export type TakePath =
  | "/"
  | "/onboarding"
  | "/home"
  | "/explore"
  | "/activity"
  | "/notifications"
  | "/organize"
  | "/operator"
  | "/takes"
  | "/profile"
  | `/campaign/${string}`
  | `/invite/${string}`;

export type Navigate = (nextPath: TakePath, options?: { replace?: boolean }) => void;

const validPaths = new Set<TakePath>([
  "/",
  "/onboarding",
  "/home",
  "/explore",
  "/activity",
  "/notifications",
  "/organize",
  "/operator",
  "/takes",
  "/profile",
]);

const legacyPaths: Record<string, TakePath> = {
  "/campaign": "/explore",
  "/campaign/give": "/explore",
  "/campaign/confirm": "/explore",
  "/campaign/pending": "/explore",
  "/campaign/success": "/explore",
  "/campaign/take": "/explore",
  "/received": "/takes",
};

function readPath(): TakePath {
  const candidate = window.location.pathname.replace(/\/$/, "") || "/";
  if (legacyPaths[candidate]) return legacyPaths[candidate]!;
  if (validPaths.has(candidate as TakePath)) return candidate as TakePath;
  if (/^\/campaign\/[^/]+(?:\/(?:give|confirm|pending|success))?$/.test(candidate)) return candidate as TakePath;
  if (/^\/invite\/[^/]+$/.test(candidate)) return candidate as TakePath;
  return "/";
}

export function usePathRouter() {
  const [path, setPath] = useState<TakePath>(readPath);

  useEffect(() => {
    const normalized = readPath();
    if (window.location.pathname !== normalized) {
      window.history.replaceState(null, "", normalized);
    }

    const handlePopState = () => setPath(readPath());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [path]);

  const navigate = useCallback(
    (nextPath: TakePath, options?: { replace?: boolean }) => {
      if (nextPath === path) {
        return;
      }

      window.history[options?.replace ? "replaceState" : "pushState"](null, "", nextPath);
      setPath(nextPath);
    },
    [path],
  );

  return { path, navigate };
}
