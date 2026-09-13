export const CampaignStatus = {
  DRAFT: "DRAFT",
  CREATED: "CREATED",
  ACTIVE: "ACTIVE",
  CLOSED: "CLOSED",
  ALLOCATING: "ALLOCATING",
  FINALIZED: "FINALIZED",
  CANCELLED: "CANCELLED"
} as const;

export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

export const EligibilityMode = {
  OPEN_REGISTERED: "OPEN_REGISTERED",
  MERKLE_ALLOWLIST: "MERKLE_ALLOWLIST",
  ORGANIZER_APPROVED: "ORGANIZER_APPROVED",
  EXTERNAL_ALLOWED: "EXTERNAL_ALLOWED"
} as const;

export type EligibilityMode = (typeof EligibilityMode)[keyof typeof EligibilityMode];

export const NominationVisibilityMode = {
  PUBLIC: "PUBLIC",
  SEALED: "SEALED"
} as const;

export type NominationVisibilityMode =
  (typeof NominationVisibilityMode)[keyof typeof NominationVisibilityMode];

export const NominationStatus = {
  PREPARING: "PREPARING",
  AWAITING_SIGNATURE: "AWAITING_SIGNATURE",
  SUBMITTED: "SUBMITTED",
  CHAIN_CONFIRMED: "CHAIN_CONFIRMED",
  INDEXING_DELAYED: "INDEXING_DELAYED",
  CONFIRMED: "CONFIRMED",
  FAILED: "FAILED"
} as const;

export type NominationStatus = (typeof NominationStatus)[keyof typeof NominationStatus];

export const OrganizationRole = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MEMBER: "MEMBER"
} as const;

export type OrganizationRole = (typeof OrganizationRole)[keyof typeof OrganizationRole];

export const AllocationRunStatus = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  FINALIZED: "FINALIZED"
} as const;

export type AllocationRunStatus =
  (typeof AllocationRunStatus)[keyof typeof AllocationRunStatus];
