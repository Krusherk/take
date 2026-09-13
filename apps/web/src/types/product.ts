export type RecipientDescriptor =
  | { type: "take_identity"; takeIdentityId: string }
  | {
      type: "external_identity";
      externalIdentityId: string;
    };

export interface Person {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  bio?: string;
  relationship?: string;
  joined: boolean;
  recipient: RecipientDescriptor;
}

export type CampaignState = "LIVE" | "UPCOMING" | "CLOSED";
export type CampaignVisual = "violet" | "cyan" | "coral";

export interface CampaignViewerState {
  usedTakes: number;
  availableTakes: number;
  canParticipate: boolean;
  eligibility: {
    status:
      | "LEGACY_UNCHECKED"
      | "CHECKING_ELIGIBILITY"
      | "ELIGIBLE"
      | "NOT_ELIGIBLE"
      | "EVIDENCE_UNAVAILABLE";
    locked: boolean;
    reasons: Array<{ reasonCode: string; explanation: string }>;
  } | null;
}

export interface Campaign {
  id: string;
  organizationId: string | null;
  title: string;
  description: string;
  organizer: string;
  organizerMark: string;
  status: CampaignState;
  sourceStatus: string;
  resource: string;
  resourceName: string;
  spots: number;
  participants: number | null;
  startsAt: string;
  endsAt: string;
  starts: string;
  ends: string;
  nominationLimit: number;
  nominationVisibilityMode: string;
  nominatorEligibilityMode: string;
  recipientEligibilityMode: string;
  viewer: CampaignViewerState | null;
  visual: CampaignVisual;
  experiment?: {
    id: string;
    version: string;
    variant: string;
    status: string;
    activeNominationDataHidden: boolean;
  } | null;
}

export type ActivityKind = "given" | "received" | "campaign" | "deadline" | "result" | "joined";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  actor?: Person;
  recipient?: Person;
  campaign?: string;
  campaignId?: string;
  message?: string;
  time: string;
  unread?: boolean;
  sortTime?: number;
}

export interface ApiCampaign {
  id: string;
  organization: { id: string; name: string; slug: string } | null;
  status: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  nominationLimit: number;
  nominationVisibilityMode: string;
  nominatorEligibilityMode: string;
  recipientEligibilityMode: string;
  resource: {
    id: string;
    type: string;
    name: string;
    description: string | null;
    quantity: number;
  } | null;
  participantCount: number | null;
  experiment?: {
    id: string;
    version: string;
    variant: string;
    status: string;
    activeNominationDataHidden: boolean;
  } | null;
  viewer: CampaignViewerState | null;
}

export interface ApiPerson {
  recipient: RecipientDescriptor;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  joined: boolean;
}
