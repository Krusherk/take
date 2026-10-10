import type { EvaluationTemplateType, SignalDomain } from "../../../../packages/shared/src/signal";

export const EVALUATION_TEMPLATES: Record<EvaluationTemplateType, { label: string; hint: string }> = {
  BUILDER_GRANT: { label: "Builder grant", hint: "Did they ship? Repo or demo link." },
  CREATOR_PROGRAM: { label: "Creator program", hint: "Did they publish N pieces? Links." },
  NFT_HOLD: { label: "Whitelist / NFT", hint: "Still holding N days after mint? Checked automatically onchain." },
  BETA_ACCESS: { label: "Beta access", hint: "Did they use the app or give feedback?" },
  EVENT_TICKET: { label: "Event ticket", hint: "Did they attend?" },
  CUSTOM: { label: "Custom", hint: "Write your own question." }
};

const CHAIN_NAMES: Record<number, string> = { 10143: "Monad testnet", 143: "Monad mainnet", 1: "Ethereum", 8453: "Base", 10: "Optimism", 42161: "Arbitrum", 137: "Polygon" };
export function chainName(id: number | undefined) {
  return id ? CHAIN_NAMES[id] ?? `chain ${id}` : "the declared chain";
}

export function templatePreset(type: EvaluationTemplateType, options: { pieces?: number; holdDays?: number } = {}): {
  domain: SignalDomain; question: string; criteria: string; evidenceExpected: boolean;
} {
  switch (type) {
    case "BUILDER_GRANT":
      return { domain: "BUILDER", question: "Did they ship?", evidenceExpected: true,
        criteria: "Positive: a public repo or live demo shows the funded work shipped by the check date. Negative: nothing shipped. Inconclusive: work exists but can't be verified (private repo, broken demo). Evidence: repo or demo link." };
    case "CREATOR_PROGRAM": {
      const pieces = options.pieces ?? 3;
      return { domain: "CREATOR", question: `Did they publish ${pieces} ${pieces === 1 ? "piece" : "pieces"}?`, evidenceExpected: true,
        criteria: `Positive: ${pieces} or more public pieces published for the program by the check date. Negative: none. Inconclusive: some, but fewer than ${pieces}. Evidence: links to each piece.` };
    }
    case "NFT_HOLD": {
      const days = options.holdDays ?? 30;
      return { domain: "ACCESS", question: `Did they still hold the NFT ${days} days after mint?`, evidenceExpected: false,
        criteria: `Objective: on the check date TAKE reads balanceOf(recipient wallet) on the NFT contract. Positive: balance of 1 or more on any linked wallet. Negative: balance 0 on every linked wallet. Inconclusive: no linked wallet or the read failed. The team can override with a note.` };
    }
    case "BETA_ACCESS":
      return { domain: "ACCESS", question: "Did they use the app or give feedback?", evidenceExpected: true,
        criteria: "Positive: product logs or a feedback link show they used the beta. Negative: never used it. Inconclusive: no reliable record. Evidence: feedback link or usage screenshot." };
    case "EVENT_TICKET":
      return { domain: "COMMUNITY", question: "Did they attend?", evidenceExpected: true,
        criteria: "Positive: check-in record or POAP shows they attended. Negative: no-show. Inconclusive: no check-in data. Evidence: check-in list or POAP link." };
    default:
      return { domain: "OTHER", question: "", criteria: "", evidenceExpected: true };
  }
}

/** The check date: a base time (campaign end, or the NFT mint) plus N days, never before the campaign end. */
export function evaluationDate(base: Date, days: number, campaignEnd?: Date | null) {
  const date = new Date(base.getTime() + Math.max(0, days) * 24 * 60 * 60 * 1000);
  return campaignEnd && date < campaignEnd ? new Date(campaignEnd) : date;
}
