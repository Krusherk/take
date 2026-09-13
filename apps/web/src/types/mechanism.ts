export interface TakeOrganizationMembership {
  id: string;
  name: string;
  slug: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  joinedAt: string;
}

export interface MechanismSnapshotSummary {
  id: string;
  audience: "NOMINATOR" | "RECIPIENT";
  status: "EVALUATING" | "READY" | "LOCKED" | "FAILED";
  root: string | null;
  snapshotHash: string;
  candidateCount: number;
  eligibleCount: number;
  cutoffAt: string | null;
  lockedAt: string | null;
}

export interface CampaignMechanismView {
  campaignId: string;
  manager: { address: string | null; version: "LEGACY_V1" | "V2" };
  mechanismVersion: string;
  assuranceLevel: "LOW_ASSURANCE" | "PROTECTED";
  warning: string | null;
  config: Record<string, unknown> | null;
  configHash: string | null;
  status: string;
  lockedAt?: string | null;
  snapshots?: MechanismSnapshotSummary[];
}

export interface SnapshotDetail extends MechanismSnapshotSummary {
  providerErrors?: {
    unknownCount?: number;
    providerErrors?: Array<{ code: string; count: number }>;
  };
}

export interface DiscordIntegrationView {
  configured: boolean;
  integrations: Array<{
    id: string;
    organizationId: string;
    guildId: string;
    guildName: string;
    status: string;
    installedAt: string | null;
    lastHealthCheckAt: string | null;
    lastErrorCode: string | null;
  }>;
}
