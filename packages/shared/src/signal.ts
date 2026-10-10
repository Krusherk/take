export const signalDomains = ["BUILDER", "CREATOR", "COMMUNITY", "GRANT", "ACCESS", "OTHER"] as const;
export type SignalDomain = typeof signalDomains[number];
export type OutcomeStatus = "PENDING" | "POSITIVE" | "NEGATIVE" | "INCONCLUSIVE";
export interface SignalPerson { key: string; name: string; avatarUrl: string | null }
export const evaluationTemplates = ["BUILDER_GRANT", "CREATOR_PROGRAM", "NFT_HOLD", "BETA_ACCESS", "EVENT_TICKET", "CUSTOM"] as const;
export type EvaluationTemplateType = typeof evaluationTemplates[number];
/** Template parameters, locked with the plan. NFT_HOLD is checked automatically (balanceOf). */
export interface EvaluationTemplateParams {
  pieces?: number;
  nftContract?: string;
  chainId?: number;
  holdDays?: number;
}
export interface EvaluationTemplate {
  type: EvaluationTemplateType;
  params: EvaluationTemplateParams;
  autoCheckedAt: string | null;
  autoCheckReport: unknown;
}
export interface EvaluationPlan {
  id: string; campaignId: string; domain: SignalDomain; question: string; criteria: string;
  evaluateAfter: string; evidenceExpected: boolean; createdAt: string; lockedAt: string | null;
  template?: EvaluationTemplate | null;
}
export interface RecipientEvaluation {
  status: OutcomeStatus; evidenceUrls: string[]; note: string | null; isPublic: boolean;
  evaluatedAt: string | null; updatedAt: string; evaluator: SignalPerson;
}
export interface SignalCounts {
  recommendations: number; evaluated: number; positive: number; negative: number;
  inconclusive: number; pending: number; notPlanned: number; notSelected: number;
}
export interface SignalRecommendation {
  id: string; giver: SignalPerson; recipient: SignalPerson;
  campaign: { id: string; title: string; resource: string; status: string };
  givenAt: string; domain: SignalDomain | null; plan: EvaluationPlan | null;
  evaluation: RecipientEvaluation | null;
  state: OutcomeStatus | "NOT_PLANNED" | "NOT_SELECTED";
  receivedOpportunity: boolean | null;
}
export interface SignalHistory {
  counts: SignalCounts; domains: Array<{ domain: SignalDomain; counts: SignalCounts }>;
  history: SignalRecommendation[];
}
export interface CampaignAfter {
  campaignId: string; title: string; status: string; resource: string; seats: number;
  plan: EvaluationPlan | null; allocationCommitted: boolean;
  recipients: Array<{ person: SignalPerson; supporters: number; evaluation: RecipientEvaluation | null }>;
  recommendations: Array<{ id: string; giver: SignalPerson; recipient: SignalPerson; givenAt: string }>;
}


/**
 * Backer score (Signal MVP). A giver earns credit only when someone they gave a
 * TAKE to received the opportunity and the team's follow-up check came back
 * POSITIVE. Credit is split across everyone who backed that person, so an
 * early, less obvious pick is worth more. A NEGATIVE check costs a little.
 * Pending, inconclusive, not selected and unplanned picks score 0.
 * The score belongs to the TAKE identity and cannot be transferred.
 */
export const SIGNAL_POSITIVE_POINTS = 10;
export const SIGNAL_NEGATIVE_POINTS = -2;

export interface BackerPick {
  campaignId: string;
  campaignTitle: string;
  recipientName: string;
  state: string;
  backers: number;
}

export interface BackerSignalEntry extends BackerPick { points: number }

export interface BackerSignal {
  score: number;
  reviewedPicks: number;
  positivePicks: number;
  negativePicks: number;
  picks: BackerSignalEntry[];
  note: string;
}

export function scoreBackerPicks(picks: BackerPick[]): BackerSignal {
  const entries = picks.map((pick) => ({
    ...pick,
    points: pick.state === "POSITIVE"
      ? Math.round((SIGNAL_POSITIVE_POINTS / Math.max(1, pick.backers)) * 10) / 10
      : pick.state === "NEGATIVE" ? SIGNAL_NEGATIVE_POINTS : 0
  }));
  const positive = entries.filter((entry) => entry.state === "POSITIVE").length;
  const negative = entries.filter((entry) => entry.state === "NEGATIVE").length;
  const total = Math.max(0, Math.round(entries.reduce((sum, entry) => sum + entry.points, 0) * 10) / 10);
  return {
    score: total,
    reviewedPicks: positive + negative,
    positivePicks: positive,
    negativePicks: negative,
    picks: entries,
    note: positive + negative === 0
      ? "No reviewed picks yet. Signal starts at 0 and grows when people this account backed pass the team's follow-up check."
      : "Credit for backing people who received the opportunity and passed the team's follow-up check, split across everyone who backed them."
  };
}
