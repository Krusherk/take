import { TAKE_API_BASE_URL } from "./takeApi";
import type { ApiCampaign } from "../types/product";

// One signed-out read per campaign per page load. main.tsx starts it before the
// campaign screen's code has even downloaded, so the two load in parallel.
const reads = new Map<string, Promise<ApiCampaign>>();

export function readPublicCampaign(campaignId: string): Promise<ApiCampaign> {
  let read = reads.get(campaignId);
  if (!read) {
    read = fetch(`${TAKE_API_BASE_URL}/campaigns/${encodeURIComponent(campaignId)}`).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 404 ? "This campaign is not available." : "This campaign could not be loaded.");
      return response.json() as Promise<ApiCampaign>;
    });
    reads.set(campaignId, read);
    // A failed read can be retried on the next visit.
    read.catch(() => { if (reads.get(campaignId) === read) reads.delete(campaignId); });
  }
  return read;
}

/** Start reading the campaign in the URL, if any. Safe to call more than once. */
export function prefetchCampaignFromLocation(pathname = window.location.pathname) {
  const match = /^\/campaign\/([^/]+)\/?$/.exec(pathname);
  if (match?.[1]) void readPublicCampaign(decodeURIComponent(match[1])).catch(() => undefined);
}
