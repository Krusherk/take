export const signalDomains = ["BUILDER", "CREATOR", "COMMUNITY", "GRANT", "ACCESS", "OTHER"] as const;
export type SignalDomain = typeof signalDomains[number];
export type OutcomeStatus = "PENDING" | "POSITIVE" | "NEGATIVE" | "INCONCLUSIVE";
export interface SignalPerson { key: string; name: string; avatarUrl: string | null }
export interface EvaluationPlan {
  id: string; campaignId: string; domain: SignalDomain; question: string; criteria: string;
  evaluateAfter: string; evidenceExpected: boolean; createdAt: string; lockedAt: string | null;
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

