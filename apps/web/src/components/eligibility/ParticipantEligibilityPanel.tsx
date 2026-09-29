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
  newcomerPath: { enabled: false } | { enabled: true; title: string; description: string; requiredEvidence: Array<NonNullable<EligibilityStackRule["evidenceType"]>> };
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
  const [newcomerLinks, setNewcomerLinks] = useState<Record<string, string>>({});
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
    return <section className="participant-eligibility participant-eligibility--not-assessed"><FileQuestion size={22} /><div><span>ELIGIBILITY</span><strong>You are not in this campaign's candidate group.</strong><p>The organizer defines who can qualify to give a TAKE before nominations begin.</p>{data.policy.newcomerPath.enabled ? <p>This campaign has an alternative qualification path: {data.policy.newcomerPath.title}. It is available to assessed candidates before the roster locks.</p> : null}</div></section>;
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
    const evidence = formType === "NEWCOMER_APPLICATION" && data?.policy.newcomerPath.enabled
      ? data.policy.newcomerPath.requiredEvidence.map((type) => ({ type, url: newcomerLinks[type]?.trim() ?? "" }))
      : url && evidenceType ? [{ type: evidenceType, url }] : [];
    if (!evidenceType || (formType !== "INTEGRITY_CLARIFICATION" && (!evidence.length || evidence.some((item) => !item.url)))) return setError("Add every evidence link requested by this campaign.");
    setBusy(true); setError(null);
    try {
      await request(`/campaigns/${campaignId}/selector-eligibility/submissions`, { method: "POST", body: JSON.stringify({ submissionType: formType, targetRuleId: formType === "ELIGIBILITY_APPEAL" ? ruleId : undefined, explanation, evidence }) });
      setSent(true); setFormType(null); setExplanation(""); setUrl(""); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Your evidence could not be submitted."); } finally { setBusy(false); }
  }

  return (
    <section className={`participant-eligibility participant-eligibility--${assessment.status.toLowerCase()}`}>
      <header><div><span className="eyebrow">ELIGIBILITY STATUS</span><h2>{assessment.status === "ELIGIBLE" ? "YOU'RE ELIGIBLE." : assessment.status === "NEEDS_REVIEW" ? "WE NEED MORE INFORMATION." : "YOU'RE NOT CURRENTLY ELIGIBLE."}</h2><p>{assessment.status === "ELIGIBLE" ? "One eligible person. One TAKE. Choose somebody else when the campaign is active." : "Some of this campaign’s evidence requirements have not been verified. See the declared rules and available paths below."}</p></div><span className={`status-chip status-chip--${assessment.status.toLowerCase()}`}>{assessment.status.replaceAll("_", " ")}</span></header>
      <ul className="eligibility-verified">{assessment.categories.flatMap((category) => category.rules).filter((rule) => rule.status === "VERIFIED").map((rule) => <li key={rule.ruleId}><Check size={16} />{rule.label}</li>)}</ul>
      <details className="participant-eligibility__evidence"><summary>View eligibility details</summary><p>Evidence determines eligibility, never the weight of your TAKE.</p><EligibilityEvidenceSummary categories={assessment.categories as EligibilityCategoryScore[]} /></details>
      <details className="participant-eligibility__evidence"><summary>Integrity context · separate from eligibility</summary><IntegritySummary {...assessment.integrity} /></details>
      {data.locked && assessment.status !== "ELIGIBLE" ? <div className="eligibility-locked-note"><LockKeyhole size={18} /><span><strong>Final roster locked.</strong> Ordinary evidence and eligibility changes are closed.</span></div> : null}
      {sent ? <div className="eligibility-submitted"><Check size={18} />Evidence submitted for organizer review.</div> : null}
      {canSubmit && !formType ? <div className="eligibility-form-actions">
        {data.policy.allowAppeals && reviewedRules.length ? <div className="eligibility-path-copy"><p>Think an eligibility decision is wrong? Appeal against one of this campaign’s reviewable rules.</p><SecondaryAction onClick={() => { setFormType("ELIGIBILITY_APPEAL"); setRuleId(reviewedRules[0]?.id ?? ""); }}>APPEAL A SPECIFIC RULE</SecondaryAction></div> : null}
        {data.policy.newcomerPath.enabled && assessment.status !== "ELIGIBLE" ? <div className="eligibility-path-copy"><p>Missing one of the normal evidence paths?</p><PrimaryAction onClick={() => setFormType("NEWCOMER_APPLICATION")}>REVIEW ALTERNATIVE PATH</PrimaryAction></div> : null}
        {hasConcern ? <SecondaryAction onClick={() => setFormType("INTEGRITY_CLARIFICATION")}><ShieldAlert size={16} />CLARIFY INTEGRITY CONTEXT</SecondaryAction> : null}
      </div> : null}
      {formType ? <div className="eligibility-form">
        <header><span>{formType === "NEWCOMER_APPLICATION" ? "ALTERNATIVE PATH" : formType === "INTEGRITY_CLARIFICATION" ? "INTEGRITY CLARIFICATION" : "EVIDENCE REVIEW"}</span><strong>{formType === "NEWCOMER_APPLICATION" && data.policy.newcomerPath.enabled ? data.policy.newcomerPath.title : "Add missing context"}</strong></header>
        {formType === "NEWCOMER_APPLICATION" && data.policy.newcomerPath.enabled ? <p>{data.policy.newcomerPath.description}</p> : null}
        {formType === "ELIGIBILITY_APPEAL" ? <label className="field"><span>DECLARED RULE</span><select value={ruleId} onChange={(event) => setRuleId(event.target.value)}>{reviewedRules.map((rule) => <option value={rule.id} key={rule.id}>{rule.label} (+{rule.points} if verified)</option>)}</select></label> : null}
        {formType === "NEWCOMER_APPLICATION" && data.policy.newcomerPath.enabled ? data.policy.newcomerPath.requiredEvidence.map((type) => <label className="field" key={type}><span>{type.replaceAll("_", " ")} · EVIDENCE LINK</span><input type="url" value={newcomerLinks[type] ?? ""} onChange={(event) => setNewcomerLinks((current) => ({ ...current, [type]: event.target.value }))} placeholder="https://…" /></label>) : <label className="field"><span>EVIDENCE LINK</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label>}
        <label className="field"><span>SHORT EXPLANATION</span><textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="What should the reviewer verify?" /></label>
        {error ? <p className="form-error">{error}</p> : null}
        <footer><SecondaryAction onClick={() => setFormType(null)}>CANCEL</SecondaryAction><PrimaryAction onClick={() => void submit()} disabled={busy}>{busy ? "SUBMITTING" : "SUBMIT FOR REVIEW"}</PrimaryAction></footer>
      </div> : null}
      {data.submissions?.length ? <details><summary>Your review submissions</summary><ul className="eligibility-submission-history">{data.submissions.map((submission) => <li key={submission.id}>{submission.type.replaceAll("_", " ")} · <strong>{submission.status.replaceAll("_", " ")}</strong>{submission.targetRuleId ? ` · ${data.policy.categories.flatMap((category) => category.rules).find((rule) => rule.id === submission.targetRuleId)?.label ?? "Declared rule"}` : ""}</li>)}</ul></details> : null}
    </section>
  );
}
