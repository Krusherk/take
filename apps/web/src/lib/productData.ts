import type { ApiCampaign, ApiPerson, Campaign, CampaignState, CampaignVisual, Person } from "../types/product";

const dateFormatter = new Intl.DateTimeFormat("en", { day: "2-digit", month: "short" });

export function campaignFromApi(source: ApiCampaign): Campaign {
  const organizer = source.organization?.name ?? "Independent organizer";
  const resourceName = source.resource?.name ?? "Opportunity";
  const spots = source.resource?.quantity ?? 0;

  return {
    id: source.id,
    organizationId: source.organization?.id ?? null,
    title: source.title,
    description: source.description,
    organizer,
    organizerMark: organizer.trim().slice(0, 1).toUpperCase() || "T",
    status: campaignState(source),
    sourceStatus: source.status,
    resource: resourceLabel(spots, resourceName),
    resourceName,
    spots,
    participants: source.participantCount,
    experiment: source.experiment ?? null,
    launchApproved: source.launchApproved,
    signups: source.signups ?? null,
    eligibilityDescription: source.eligibilityDescription,
    onchain: source.onchain,
    startsAt: source.startTime,
    endsAt: source.endTime,
    starts: formatCampaignDate(source.startTime),
    ends: formatCampaignDate(source.endTime),
    nominationLimit: source.nominationLimit,
    nominationVisibilityMode: source.nominationVisibilityMode,
    nominatorEligibilityMode: source.nominatorEligibilityMode,
    recipientEligibilityMode: source.recipientEligibilityMode,
    sandbox: source.sandbox === true,
    viewer: source.viewer,
    visual: visualForCampaign(source.title),
  };
}

export function personFromApi(source: ApiPerson): Person {
  const providerId = source.recipient.type === "take_identity"
    ? source.recipient.takeIdentityId
    : source.recipient.externalIdentityId;
  return {
    id: providerId,
    name: source.displayName,
    handle: source.username ? `@${source.username.replace(/^@/, "")}` : "",
    avatarUrl: source.avatarUrl,
    joined: source.joined,
    relationship: source.joined ? "TAKE member" : "External identity",
    recipient: source.recipient,
  };
}

export function campaignPath(campaign: Pick<Campaign, "id">, suffix = ""): `/campaign/${string}` {
  return `/campaign/${campaign.id}${suffix}`;
}

export function isParticipantCampaign(campaign: Pick<Campaign, "sourceStatus" | "onchain">): boolean {
  return Boolean(
    campaign.onchain?.published
    && ["CREATED", "ACTIVE", "CLOSED", "ALLOCATING", "FINALIZED"].includes(campaign.sourceStatus)
  );
}

export type CampaignRouteStep = "detail" | "give" | "confirm" | "pending" | "success";

export function parseCampaignPath(path: string): { campaignId: string; step: CampaignRouteStep } | null {
  const match = path.match(/^\/campaign\/([^/]+)(?:\/(give|confirm|pending|success))?$/);
  if (!match?.[1]) return null;
  return { campaignId: match[1], step: (match[2] as CampaignRouteStep | undefined) ?? "detail" };
}

export function parseInvitePath(path: string): string | null {
  return path.match(/^\/invite\/([^/]+)$/)?.[1] ?? null;
}

export function formatCampaignDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "DATE TBA" : dateFormatter.format(date).toUpperCase();
}

function campaignState(source: ApiCampaign): CampaignState {
  const now = Date.now();
  const starts = Date.parse(source.startTime);
  const ends = Date.parse(source.endTime);
  if (source.status === "CLOSED" || (Number.isFinite(ends) && ends <= now)) return "CLOSED";
  if (source.status === "ACTIVE" && (!Number.isFinite(starts) || starts <= now)) return "LIVE";
  return "UPCOMING";
}

function resourceLabel(quantity: number, name: string): string {
  if (!quantity) return name;
  const normalized = quantity === 1 ? name.replace(/s$/i, "") : name;
  return `${quantity.toLocaleString("en-US")} ${normalized.toLowerCase()}`;
}

function visualForCampaign(title: string): CampaignVisual {
  const normalized = title.toLowerCase();
  if (normalized.includes("monad") || normalized.includes("creator")) return "violet";
  if (normalized.includes("builder") || normalized.includes("residency")) return "cyan";
  return "coral";
}
