import { useCallback, useEffect, useState, type FormEvent } from "react";
import { signalDomains, type CampaignAfter, type EvaluationPlan, type SignalDomain } from "../../../../packages/shared/src/signal";
import type { TakeApiClient } from "../lib/takeApi";
import { PrimaryAction, SecondaryAction } from "./Actions";
import { SignalOutcome, SignalPersonLabel, signalDate } from "./Signal";

type Request = TakeApiClient["request"];
const message = (error: unknown) => error instanceof Error ? error.message : "This action could not be completed.";

export function EvaluationPlanEditor({ campaignId, status, request }: { campaignId: string; status: string; request: Request }) {
  const [plan, setPlan] = useState<EvaluationPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [domain, setDomain] = useState<SignalDomain>("OTHER");
  const [question, setQuestion] = useState("");
  const [criteria, setCriteria] = useState("");
  const [date, setDate] = useState("");
  const [evidenceExpected, setEvidenceExpected] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void request<CampaignAfter>(`/campaigns/${campaignId}/after`, { signal: controller.signal })
      .then((data) => { setPlan(data.plan); setLoaded(true); })
      .catch((caught) => { if (!controller.signal.aborted) setError(message(caught)); });
    return () => controller.abort();
  }, [campaignId, request]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) return;
    setBusy(true); setError(null);
    try {
      const result = await request<EvaluationPlan>(`/campaigns/${campaignId}/evaluation-plan`, {
        method: "POST", body: JSON.stringify({ domain, question, criteria, evaluateAfter: new Date(date).toISOString(), evidenceExpected })
      });
      setPlan(result);
    } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  return <details className="signal-control"><summary>Post-campaign evaluation · {plan ? "criteria locked" : "optional"}</summary>
    <p>What should we learn after this opportunity? Define it before publication. This never changes who gets a TAKE or a spot.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {plan ? <div className="signal-plan"><span className="eyebrow">LOCKED {signalDate(plan.lockedAt ?? plan.createdAt)}</span><h3>{plan.question}</h3><p>{plan.criteria}</p><p>{plan.domain.toLowerCase()} · Evaluate from {signalDate(plan.evaluateAfter)}</p><small>{plan.evidenceExpected ? "Evidence required." : "Evidence optional."} Criteria cannot be changed.</small></div>
      : status !== "DRAFT" ? <p>No evaluation plan was locked before publication. Outcomes cannot be added retroactively.</p>
        : loaded ? <form className="signal-form" onSubmit={(event) => void save(event)}>
          <label className="field"><span>CATEGORY</span><select value={domain} onChange={(event) => setDomain(event.target.value as SignalDomain)}>{signalDomains.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field"><span>WHAT WILL YOU EVALUATE?</span><input required minLength={5} maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What should happen after this opportunity?" /></label>
          <label className="field"><span>ORIGINAL CRITERIA</span><textarea required minLength={10} maxLength={5000} value={criteria} onChange={(event) => setCriteria(event.target.value)} placeholder="Describe what positive, negative, and inconclusive would mean for this opportunity." /></label>
          <label className="field"><span>EVALUATE FROM (YOUR LOCAL TIME)</span><input required type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="signal-checkbox"><input type="checkbox" checked={evidenceExpected} onChange={(event) => setEvidenceExpected(event.target.checked)} />Require evidence for recorded outcomes</label>
          <label className="signal-checkbox"><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I understand these criteria will be locked and cannot be rewritten.</label>
          <PrimaryAction type="submit" disabled={busy || !confirmed}>{busy ? "SAVING…" : "SAVE & LOCK CRITERIA"}</PrimaryAction>
        </form> : !error ? <p role="status">Loading evaluation plan…</p> : null}
  </details>;
}

export function OperatorEvaluations({ request }: { request: Request }) {
  const [campaigns, setCampaigns] = useState<CampaignAfter[] | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setError(null);
    try { setCampaigns(await request<CampaignAfter[]>("/operator/evaluations")); }
    catch (caught) { setError(message(caught)); }
  }, [request]);
  useEffect(() => { void refresh(); }, [refresh]);
  const campaign = campaigns?.find((item) => item.campaignId === selected);
  return <section className="signal-operator"><header><div><span className="eyebrow">POST-CAMPAIGN SIGNAL</span><h2>Evaluate what happened.</h2></div><SecondaryAction onClick={() => void refresh()}>REFRESH</SecondaryAction></header>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    {!campaigns ? !error ? <p role="status">Loading evaluation queue…</p> : null : !campaigns.length ? <p>No finalized campaigns with evaluation plans yet.</p> : <>
      <label className="field"><span>CAMPAIGN TO EVALUATE</span><select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Choose a campaign</option>{campaigns.map((item) => {
        const pending = item.recipients.filter((recipient) => !recipient.evaluation || recipient.evaluation.status === "PENDING").length;
        const due = item.plan && Date.parse(item.plan.evaluateAfter) <= Date.now();
        return <option value={item.campaignId} key={item.campaignId}>{item.title} · {pending ? `${pending} ${due ? "due" : "awaiting date"}` : "evaluated"}</option>;
      })}</select></label>
      {campaign?.plan ? <div className="signal-plan"><span className="eyebrow">LOCKED CRITERIA</span><h3>{campaign.plan.question}</h3><p>{campaign.plan.criteria}</p><p>Evaluate from {signalDate(campaign.plan.evaluateAfter)} · {campaign.plan.evidenceExpected ? "Evidence required" : "Evidence optional"}</p>
        {!campaign.allocationCommitted ? <p>The finalized allocation record is not available. Evaluation is blocked.</p> : campaign.recipients.map((recipient) => <EvaluationEditor key={`${campaign.campaignId}:${recipient.person.key}`} campaign={campaign} recipient={recipient} request={request} onSaved={refresh} />)}
      </div> : null}
    </>}
  </section>;
}

function EvaluationEditor({ campaign, recipient, request, onSaved }: { campaign: CampaignAfter; recipient: CampaignAfter["recipients"][number]; request: Request; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(recipient.evaluation?.status === "PENDING" ? "" : recipient.evaluation?.status ?? "");
  const [urls, setUrls] = useState(recipient.evaluation?.evidenceUrls.join("\n") ?? "");
  const [note, setNote] = useState(recipient.evaluation?.note ?? "");
  const [isPublic, setIsPublic] = useState(recipient.evaluation?.isPublic ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const due = Boolean(campaign.plan && Date.parse(campaign.plan.evaluateAfter) <= Date.now());
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await request(`/operator/campaigns/${campaign.campaignId}/evaluations`, { method: "POST", body: JSON.stringify({ recipientKey: recipient.person.key, status, evidenceUrls: urls.split(/\n/).map((url) => url.trim()).filter(Boolean), note, isPublic }) });
      await onSaved(); setOpen(false);
    } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  return <article className="signal-evaluation-editor"><SignalPersonLabel person={recipient.person} /><SignalOutcome evaluation={recipient.evaluation} />
    {!open ? <SecondaryAction disabled={!due} onClick={() => setOpen(true)}>{due ? recipient.evaluation ? "UPDATE EVALUATION" : "RECORD OUTCOME" : "EVALUATION NOT DUE YET"}</SecondaryAction>
      : <form className="signal-form" onSubmit={(event) => void save(event)}>
        <label className="field"><span>OUTCOME AGAINST THE ORIGINAL CRITERIA</span><select required value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Choose outcome</option><option value="POSITIVE">Positive</option><option value="NEGATIVE">Negative</option><option value="INCONCLUSIVE">Inconclusive</option></select></label>
        <label className="field"><span>EVIDENCE URLS (HTTPS, ONE PER LINE, UP TO FIVE)</span><textarea required={campaign.plan?.evidenceExpected} value={urls} onChange={(event) => setUrls(event.target.value)} /></label>
        <label className="field"><span>WHAT HAPPENED?</span><textarea required minLength={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <label className="signal-checkbox"><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />Make this note and its evidence links public. Do not include private eligibility or integrity evidence.</label>
        <small>The outcome, evaluation date, and evaluator are visible. This does not change the allocation.</small>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="signal-form__actions"><SecondaryAction type="button" onClick={() => setOpen(false)} disabled={busy}>CANCEL</SecondaryAction><PrimaryAction type="submit" disabled={busy}>{busy ? "SAVING…" : "SAVE EVALUATION"}</PrimaryAction></div>
      </form>}
  </article>;
}

type Observation = { id: string; signalType: string; status: string; evidence: unknown; limitation: string | null; createdAt: string };
export function IntegrityObservations({ campaignId, request }: { campaignId: string; request: Request }) {
  const [data, setData] = useState<{ snapshot: null | { id: string; edgeCutoffBlock: string; signals: Observation[] } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setData(await request(`/operator/campaigns/${campaignId}/integrity-observations`)); }
    catch (caught) { setError(message(caught)); }
  }, [campaignId, request]);
  useEffect(() => { void load(); }, [load]);
  const signals = data?.snapshot?.signals ?? [];
  return <details className="signal-control integrity-observations"><summary>Integrity observations</summary>
    <p>Social closeness is context. Repeated advantageous coordination requires corroborating evidence. These observations do not change allocation.</p>
    <SecondaryAction onClick={() => void load()}>REFRESH OBSERVATIONS</SecondaryAction>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Loading existing observations…</p> : <>
      {!data.snapshot ? <p>NO DATA · No graph observations have been recorded for this campaign.</p> : <small>Recorded snapshot through block {data.snapshot.edgeCutoffBlock}. This is not a live fraud verdict.</small>}
      <ul className="integrity-observation-list">{[["DIRECT_RECIPROCITY", "Reciprocity"], ["SHORT_CYCLE", "Short nomination cycles"], ["TEMPORAL_BURST", "Timing bursts"], ["REPEATED_CO_NOMINATION", "Repeated co-nomination"]].map(([key, label]) => {
        const available = signals.filter((item) => item.signalType === key && item.status !== "NOT_RUN");
        return <li key={key}><strong>{label}</strong><span>{available.length ? `${available.length} recorded observation${available.length === 1 ? "" : "s"}` : key === "REPEATED_CO_NOMINATION" || !data.snapshot ? "NO DATA" : "No observations recorded in this snapshot"}</span></li>;
      })}</ul>
      {signals.map((item) => <details key={item.id}><summary>{item.signalType.replaceAll("_", " ")} · {item.status === "NOT_RUN" ? "NO DATA" : item.status.replaceAll("_", " ")}</summary>{item.limitation ? <p>{item.limitation}</p> : null}<small>Recorded {signalDate(item.createdAt)}</small><pre>{JSON.stringify(item.evidence, null, 2)}</pre></details>)}
    </>}
  </details>;
}
