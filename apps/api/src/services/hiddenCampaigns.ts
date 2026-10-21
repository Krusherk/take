/**
 * Campaigns kept off public lists (/campaigns, /proof/campaigns) without touching their data.
 * Their own page (/campaigns/:id) still loads, and TAKE operators still see them in lists.
 *
 * Default: "TAKE Demo", which closed on 2026-10-13 but never finalized and sits in ALLOCATING.
 * Override with HIDDEN_CAMPAIGN_IDS (comma-separated); set it to "none" to hide nothing.
 */
export const DEFAULT_HIDDEN_CAMPAIGN_IDS = ["30e8b781-9143-4b84-8905-eadf13b92029"] as const;

export function parseHiddenCampaignIds(value: unknown): string[] {
  if (value === undefined || value === null) return [...DEFAULT_HIDDEN_CAMPAIGN_IDS];
  const raw = String(value).trim();
  if (raw.toLowerCase() === "none") return [];
  if (!raw) return [...DEFAULT_HIDDEN_CAMPAIGN_IDS];
  return [...new Set(raw.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
}

export function withoutHiddenCampaigns<T extends { id: string }>(campaigns: T[], hiddenIds: readonly string[]): T[] {
  if (!hiddenIds.length) return campaigns;
  const hidden = new Set(hiddenIds.map((id) => id.toLowerCase()));
  return campaigns.filter((campaign) => !hidden.has(campaign.id.toLowerCase()));
}
