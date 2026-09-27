import type { TakePath } from "../hooks/usePathRouter";

const POST_AUTH_DESTINATION_KEY = "take-post-auth-destination";

export type PostAuthDestination = TakePath;

export function rememberPostAuthDestination(destination: PostAuthDestination) {
  window.sessionStorage.setItem(POST_AUTH_DESTINATION_KEY, destination);
}

export function readPostAuthDestination(): PostAuthDestination {
  const destination = window.sessionStorage.getItem(POST_AUTH_DESTINATION_KEY);
  if (destination === "/organize" || destination === "/explore" || destination === "/operator" || /^\/campaign\/[^/]+$/.test(destination ?? "")) return destination as PostAuthDestination;
  return "/home";
}

export function clearPostAuthDestination() {
  window.sessionStorage.removeItem(POST_AUTH_DESTINATION_KEY);
}

export function routeAfterAuthentication(isNewUser?: boolean): TakePath {
  if (isNewUser) {
    window.sessionStorage.setItem("take-onboarding-pending", "true");
    return "/onboarding";
  }

  if (window.sessionStorage.getItem("take-onboarding-pending") === "true") {
    return "/onboarding";
  }

  const destination = readPostAuthDestination();
  clearPostAuthDestination();
  return destination;
}
