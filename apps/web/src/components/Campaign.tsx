import { ArrowRight } from "lucide-react";
import { campaignPath } from "../lib/productData";
import type { TakePath } from "../hooks/usePathRouter";
import type { Campaign, Person } from "../types/product";
import { Avatar } from "./Avatar";
import { TakeHandoffGraphic, type TakeHandoffState } from "./TakeHandoffGraphic";

export function CampaignStatus({ status }: { status: Campaign["status"] }) {
  return <span className={`campaign-status campaign-status--${status.toLowerCase()}`}><span aria-hidden="true" />{status}</span>;
}

export function CampaignArtwork({ campaign, giver, recipient, participants, compact = false }: {
  campaign: Campaign;
  giver?: Person | null;
  recipient?: Person | null;
  participants?: Person[];
  compact?: boolean;
}) {
  return (
    <TakeHandoffGraphic
      state={handoffState(campaign)}
      giver={giver}
      recipient={recipient}
      participants={participants}
      accent={campaign.visual}
      compact={compact}
    />
  );
}

export function AvatarStack({ people, label }: { people: Person[]; label: string }) {
  return (
    <div className="avatar-stack" aria-label={label}>
      {people.length ? (
        <span className="avatar-stack__faces" aria-hidden="true">
          {people.slice(0, 4).map((person) => <Avatar key={person.id} person={person} size="xs" />)}
        </span>
      ) : null}
      <span>{label}</span>
    </div>
  );
}

interface CampaignRowProps {
  campaign: Campaign;
  navigate: (path: TakePath) => void;
  featured?: boolean;
  giver?: Person | null;
  recipient?: Person | null;
  participants?: Person[];
}

export function CampaignRow({ campaign, navigate, featured = false, giver, recipient, participants }: CampaignRowProps) {
  const destination = campaignPath(campaign) as TakePath;
  const takeState = campaign.viewer
    ? campaign.viewer.usedTakes > 0
      ? "TAKE GIVEN"
      : campaign.viewer.canParticipate && campaign.viewer.availableTakes > 0
        ? "TAKE AVAILABLE"
        : eligibilityLabel(campaign)
    : null;

  return (
    <a className={`campaign-row campaign-row--${campaign.visual}${featured ? " campaign-row--featured" : ""}`} href={destination} onClick={(event) => {
      event.preventDefault();
      navigate(destination);
    }}>
      {featured ? <CampaignArtwork campaign={campaign} giver={giver} recipient={recipient} participants={participants} compact /> : <span className="campaign-row__organizer">{campaign.organizerMark}</span>}
      <span className="campaign-row__identity">
        <CampaignStatus status={campaign.status} />
        <strong>{campaign.title}</strong>
        <small>by {campaign.organizer}</small>
      </span>
      <span className="campaign-row__resource">
        <small>OPPORTUNITY</small>
        <strong>{campaign.resource}</strong>
        <em>{campaign.participants === null ? "Participation hidden" : `${campaign.participants.toLocaleString("en-US")} participating`}</em>
      </span>
      <span className="campaign-row__timing">
        <small>{campaign.status === "UPCOMING" ? "OPENS" : "ENDS"}</small>
        <strong>{campaign.status === "UPCOMING" ? campaign.starts : campaign.ends}</strong>
        {takeState ? <em>{takeState}</em> : null}
      </span>
      <span className="campaign-row__arrow" aria-hidden="true"><ArrowRight size={19} strokeWidth={1.7} /></span>
    </a>
  );
}

function handoffState(campaign: Campaign): TakeHandoffState {
  if ((campaign.viewer?.usedTakes ?? 0) > 0) return "given";
  if (campaign.viewer?.canParticipate && (campaign.viewer.availableTakes ?? 0) > 0) return "available";
  return "anonymous";
}

export function CampaignFacts({ campaign, takeGiven = false }: { campaign: Campaign; takeGiven?: boolean }) {
  const viewerState = takeGiven || (campaign.viewer?.usedTakes ?? 0) > 0
    ? "GIVEN"
    : campaign.viewer?.canParticipate && (campaign.viewer.availableTakes ?? 0) > 0
      ? "AVAILABLE"
      : campaign.status === "UPCOMING" ? "UPCOMING" : eligibilityLabel(campaign);
  const facts = [
    { label: "SPOTS", value: campaign.spots ? campaign.spots.toLocaleString("en-US") : "TBA" },
    { label: "PARTICIPATING", value: campaign.participants === null ? "HIDDEN" : campaign.participants.toLocaleString("en-US") },
    { label: campaign.status === "UPCOMING" ? "OPENS" : "ENDS", value: campaign.status === "UPCOMING" ? campaign.starts : campaign.ends },
    { label: "YOUR TAKE", value: viewerState },
  ];
  return <dl className="campaign-facts">{facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>;
}

export function eligibilityLabel(campaign: Campaign): string {
  switch (campaign.viewer?.eligibility?.status) {
    case "CHECKING_ELIGIBILITY": return "CHECKING ELIGIBILITY";
    case "EVIDENCE_UNAVAILABLE": return "EVIDENCE UNAVAILABLE";
    case "LEGACY_UNCHECKED": return "LEGACY CAMPAIGN";
    case "ELIGIBLE": return campaign.viewer.eligibility.locked ? "ELIGIBILITY LOCKED" : "ELIGIBLE";
    default: return "NOT ELIGIBLE";
  }
}
