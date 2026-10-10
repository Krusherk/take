/**
 * A sandbox campaign is open to everyone: open giver and recipient eligibility
 * with no locked lists or mechanism. Its results are for trying TAKE only, so
 * they never count toward Signal or the landing page proof section.
 */
export function isSandboxCampaign(campaign: { nominatorEligibilityMode: string; mechanismConfigId?: string | null }) {
  return !campaign.mechanismConfigId
    && (campaign.nominatorEligibilityMode === "OPEN_REGISTERED" || campaign.nominatorEligibilityMode === "EXTERNAL_ALLOWED");
}

export const SANDBOX_ELIGIBILITY_DESCRIPTION = "Sandbox: open to everyone. Any TAKE member can give one TAKE to any other member. Results don't count.";
