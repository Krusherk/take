export type OrganizePhase = "SIGNUPS" | "LIVE" | "SCHEDULED" | "SIGN_TO_OPEN" | "SIGN_TO_PUBLISH" | "ENDED" | "SETUP";

export function organizePhase(campaign: {
  sourceStatus: string;
  launchApproved?: boolean;
  signups?: { status: string } | null;
  startsAt: string;
  endsAt: string;
}, now = Date.now()): OrganizePhase {
  const start = Date.parse(campaign.startsAt);
  const end = Date.parse(campaign.endsAt);
  const ended = Number.isFinite(end) && end <= now;
  if (["FINALIZED", "CLOSED", "ALLOCATING"].includes(campaign.sourceStatus) || ended) return "ENDED";
  if (campaign.sourceStatus === "ACTIVE") return !Number.isFinite(start) || start <= now ? "LIVE" : "SCHEDULED";
  if (campaign.sourceStatus === "CREATED") return Number.isFinite(start) && start > now ? "SCHEDULED" : "SIGN_TO_OPEN";
  if (campaign.sourceStatus === "DRAFT" && campaign.signups && campaign.signups.status !== "CLOSED") return "SIGNUPS";
  if (campaign.sourceStatus === "DRAFT" && campaign.launchApproved) return "SIGN_TO_PUBLISH";
  return "SETUP";
}

export function organizePhaseLabel(phase: OrganizePhase): string {
  switch (phase) {
    case "SIGNUPS": return "Sign-ups";
    case "LIVE": return "Live in Explore";
    case "SCHEDULED": return "Scheduled";
    case "SIGN_TO_OPEN": return "Sign to open";
    case "SIGN_TO_PUBLISH": return "Ready to sign";
    case "ENDED": return "Ended";
    case "SETUP": return "Draft";
  }
}

const phaseRank: Record<OrganizePhase, number> = {
  SIGNUPS: 0,
  SIGN_TO_PUBLISH: 0,
  SIGN_TO_OPEN: 1,
  LIVE: 2,
  SCHEDULED: 3,
  SETUP: 4,
  ENDED: 5
};

export function preferredCampaignId<T extends Parameters<typeof organizePhase>[0] & { id: string }>(campaigns: T[]): string | null {
  const ranked = [...campaigns].sort((left, right) => phaseRank[organizePhase(left)] - phaseRank[organizePhase(right)]);
  return ranked[0]?.id ?? null;
}
