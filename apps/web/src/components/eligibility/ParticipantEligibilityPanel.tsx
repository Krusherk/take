import { Check, FileQuestion, LockKeyhole, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TakeApiClient } from "../../lib/takeApi";
import type { EligibilityCategoryScore, EligibilityStackRule, SelectorAssessment } from "../../types/mechanism";
import { PrimaryAction, SecondaryAction } from "../Actions";
import { EligibilityEvidenceSummary, IntegritySummary } from "./EligibilityEvidenceSummary";

type PublicPolicy = {
  requiredTotalPoints: number;
  minimumDistinctCategories: number;
  allowAppeals: boolean;
  integrityScreeningEnabled: boolean;
  categories: Array<{ id: string; label: string; rules: EligibilityStackRule[] }>;
  newcomerPath: { enabled: false } | { enabled: true; title: string; description: string; requiredEvidence: Array<EligibilityStackRule["evidenceType"]> };
};

type MyEligibility = {
  status?: "NOT_ASSESSED";
  locked?: boolean;
  policy: PublicPolicy;
  assessment?: SelectorAssessment;
  submissions?: Array<{ id: string; type: string; targetRuleId: string | null; status: string; createdAt: string }>;
};

export function ParticipantEligibilityPanel({ campaignId, request }: { campaignId: string; request: TakeApiClient["request"] }) {
  const [data, setData] = useState<MyEligibility | null>(null);
  const [formType, setFormType] = useState<"ELIGIBILITY_APPEAL" | "NEWCOMER_APPLICATION" | "INTEGRITY_CLARIFICATION" | null>(null);
  const [ruleId, setRuleId] = useState("");
  const [explanation, setExplanation] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    try { setData(await request<MyEligibility | null>(`/campaigns/${campaignId}/selector-eligibility/me`)); }
    catch { setData(null); }
  }, [campaignId, request]);
  useEffect(() => { void load(); }, [load]);

  const reviewedRules = useMemo(() => data?.policy.categories.flatMap((category) => category.rules).filter((rule) => rule.source === "REVIEWED_SUBMISSION") ?? [], [data]);
  if (!data) return null;
  if (data.status === "NOT_ASSESSED" || !data.assessment) {
    return <section className="participant-eligibility participant-eligibility--not-assessed"><FileQuestion size={22} /><div><span>SELECTOR ELIGIBILITY</span><strong>You are not in this campaign's selector candidate roster.</strong><p>The organizer defines and locks the people who can receive one TAKE before nominations begin.</p></div></section>;
  }

  const assessment = data.assessment;
  const canSubmit = !data.locked;
  const hasConcern = assessment.integrity.status === "REVIEW_RECOMMENDED" || assessment.integrity.status === "HIGH_CONFIDENCE_ISSUE";
  async function submit() {
    if (!formType || !explanation.trim()) return setError("Add a short explanation.");
    const target = reviewedRules.find((rule) => rule.id === ruleId);
    const evidenceType = formType === "ELIGIBILITY_APPEAL" ? target?.evidenceType
      : formType === "NEWCOMER_APPLICATION" && data?.policy.newcomerPath.enabled ? data.policy.newcomerPath.requiredEvidence[0]
        : "WALLET_CONTEXT";
    if (!evidenceType || (formType !== "INTEGRITY_CLARIFICATION" && !url)) return setError("Add the evidence link requested by this campaign.");
    setBusy(true); setError(null);
    try {
      await request(`/campaigns/${campaignId}/selector-eligibility/submissions`, { method: "POST", body: JSON.stringify({ submissionType: formType, targetRuleId: formType === "ELIGIBILITY_APPEAL" ? ruleId : undefined, explanation, evidence: url ? [{ type: evidenceType, url }] : [] }) });
      setSent(true); setFormType(null); setExplanation(""); setUrl(""); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Your evidence could not be submitted."); } finally { setBusy(false); }
  }

  return (
    <section className={`participant-eligibility participant-eligibility--${assessment.status.toLowerCase()}`}>
      <header><div><span className="eyebrow">ELIGIBILITY STATUS</span><h2>{assessment.status === "ELIGIBLE" ? "YOU'RE ELIGIBLE." : assessment.status === "NEEDS_REVIEW" ? "WE NEED MORE INFORMATION." : "YOU'RE NOT CURRENTLY ELIGIBLE."}</h2><p>{assessment.status === "ELIGIBLE" ? "Once this roster is locked, you receive exactly one TAKE. Your score never changes its weight." : `TAKE verified ${assessment.totalPoints} of ${data.policy.requiredTotalPoints} required points. Missing evidence can be reviewed before lock.`}</p></div><span className={`status-chip status-chip--${assessment.status.toLowerCase()}`}>{assessment.status.replaceAll("_", " ")}</span></header>
      <EligibilityEvidenceSummary categories={assessment.categories as EligibilityCategoryScore[]} />
      <IntegritySummary {...assessment.integrity} />
      {data.locked ? <div className="eligibility-locked-note"><LockKeyhole size={18} /><span><strong>Final roster locked.</strong> Ordinary evidence and eligibility changes are closed.</span></div> : null}
      {sent ? <div className="eligibility-submitted"><Check size={18} />Evidence submitted for organizer review.</div> : null}
      {canSubmit && !formType ? <div className="eligibility-form-actions">
        {data.policy.allowAppeals && reviewedRules.length ? <SecondaryAction onClick={() => { setFormType("ELIGIBILITY_APPEAL"); setRuleId(reviewedRules[0]?.id ?? ""); }}>REQUEST EVIDENCE REVIEW</SecondaryAction> : null}
        {data.policy.newcomerPath.enabled && assessment.status !== "ELIGIBLE" ? <PrimaryAction onClick={() => setFormType("NEWCOMER_APPLICATION")}>APPLY AS A NEWCOMER</PrimaryAction> : null}
        {hasConcern ? <SecondaryAction onClick={() => setFormType("INTEGRITY_CLARIFICATION")}><ShieldAlert size={16} />CLARIFY INTEGRITY CONTEXT</SecondaryAction> : null}
      </div> : null}
      {formType ? <div className="eligibility-form">
        <header><span>{formType === "NEWCOMER_APPLICATION" ? "ALTERNATIVE PATH" : formType === "INTEGRITY_CLARIFICATION" ? "INTEGRITY CLARIFICATION" : "EVIDENCE REVIEW"}</span><strong>{formType === "NEWCOMER_APPLICATION" && data.policy.newcomerPath.enabled ? data.policy.newcomerPath.title : "Add missing context"}</strong></header>
        {formType === "ELIGIBILITY_APPEAL" ? <label className="field"><span>DECLARED RULE</span><select value={ruleId} onChange={(event) => setRuleId(event.target.value)}>{reviewedRules.map((rule) => <option value={rule.id} key={rule.id}>{rule.label} (+{rule.points} if verified)</option>)}</select></label> : null}
        <label className="field"><span>EVIDENCE LINK</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/..." /></label>
        <label className="field"><span>SHORT EXPLANATION</span><textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="What should the reviewer verify?" /></label>
        {error ? <p className="form-error">{error}</p> : null}
        <footer><SecondaryAction onClick={() => setFormType(null)}>CANCEL</SecondaryAction><PrimaryAction onClick={() => void submit()} disabled={busy}>{busy ? "SUBMITTING" : "SUBMIT FOR REVIEW"}</PrimaryAction></footer>
      </div> : null}
    </section>
  );
}
