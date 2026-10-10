import { useCallback, useEffect, useState, type FormEvent } from "react";
import { signalDomains, type CampaignAfter, type EvaluationPlan, type EvaluationTemplateParams, type EvaluationTemplateType, type SignalDomain } from "../../../../packages/shared/src/signal";
import { EVALUATION_TEMPLATES, chainName, evaluationDate, templatePreset } from "../lib/evaluationTemplates";
import { WheelDateTimePicker, roundTo, toLocal, parseLocal } from "./organize/WheelDateTimePicker";
import type { TakeApiClient } from "../lib/takeApi";
import { PrimaryAction, SecondaryAction } from "./Actions";
import { SignalPersonLabel, signalDate } from "./Signal";
import { daysUntil, isReviewed, lowerFirst, TeamReviewResult } from "./SignalAfter";

type Request = TakeApiClient["request"];
const message = (error: unknown) => error instanceof Error ? error.message : "This action could not be completed.";

export function EvaluationPlanEditor({ campaignId, status, request, endTime }: { campaignId: string; status: string; request: Request; endTime?: string | null }) {
  const [plan, setPlan] = useState<EvaluationPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [domain, setDomain] = useState<SignalDomain>("OTHER");
  const [question, setQuestion] = useState("");
  const [criteria, setCriteria] = useState("");
  const campaignEnd = endTime ? new Date(endTime) : null;
  const baseEnd = campaignEnd ?? roundTo(new Date(Date.now() + 60 * 60 * 1000), 5);
  const [afterDays, setAfterDays] = useState("30");
  const [mintLocal, setMintLocal] = useState(() => toLocal(roundTo(baseEnd, 5)));
  const [date, setDate] = useState(() => toLocal(roundTo(evaluationDate(baseEnd, 30, campaignEnd), 5)));
  const [evidenceExpected, setEvidenceExpected] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [template, setTemplate] = useState<EvaluationTemplateType>("CUSTOM");
  const [pieces, setPieces] = useState("3");
  const [holdDays, setHoldDays] = useState("30");
  const [nftContract, setNftContract] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [chains, setChains] = useState<number[]>([]);
  useEffect(() => {
    if (template !== "NFT_HOLD" || chains.length) return;
    const controller = new AbortController();
    void request<{ chainIds: number[] }>("/evaluation-chains", { signal: controller.signal })
      .then((data) => { setChains(data.chainIds); setChainId((current) => current ?? data.chainIds[0] ?? null); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [template, chains.length, request]);
  function recompute(next: { template?: EvaluationTemplateType; afterDays?: string; holdDays?: string; mintLocal?: string }) {
    const type = next.template ?? template;
    const nft = type === "NFT_HOLD";
    const base = nft ? parseLocal(next.mintLocal ?? mintLocal) ?? baseEnd : baseEnd;
    const days = Number(nft ? next.holdDays ?? holdDays : next.afterDays ?? afterDays) || 0;
    setDate(toLocal(roundTo(evaluationDate(base, days, campaignEnd), 5)));
  }
  function pickTemplate(next: EvaluationTemplateType) {
    setTemplate(next);
    recompute({ template: next });
    const preset = templatePreset(next, { pieces: Number(pieces) || 3, holdDays: Number(holdDays) || 30 });
    setDomain(preset.domain);
    setQuestion(preset.question);
    setCriteria(preset.criteria);
    setEvidenceExpected(preset.evidenceExpected);
  }
  function templateParams(): EvaluationTemplateParams {
    if (template === "CREATOR_PROGRAM") return { pieces: Number(pieces) || 1 };
    if (template === "NFT_HOLD") return { nftContract: nftContract.trim(), chainId: chainId ?? undefined, holdDays: Number(holdDays) || undefined };
    return {};
  }
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
        method: "POST", body: JSON.stringify({ domain, question, criteria, evaluateAfter: new Date(date).toISOString(), evidenceExpected,
          ...(template !== "CUSTOM" ? { template: { type: template, params: templateParams() } } : {}) })
      });
      setPlan(result);
    } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  return <details className="signal-control"><summary>Check after the TAKE · {plan ? `locked, from ${signalDate(plan.evaluateAfter)}` : status !== "DRAFT" ? "none scheduled" : "optional"}</summary>
    <p>The question checked after the spot is given, and when. It is locked before publication and never changes who gets a TAKE or a spot.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {plan ? <div className="signal-plan"><span className="eyebrow">LOCKED {signalDate(plan.lockedAt ?? plan.createdAt)}</span><h3>{plan.question}</h3><p>{plan.criteria}</p><p>{plan.template ? `${EVALUATION_TEMPLATES[plan.template.type].label} · ` : ""}{plan.domain.toLowerCase()} · Evaluate from {signalDate(plan.evaluateAfter)}</p>
      {plan.template?.type === "NFT_HOLD" ? <p className="signal-plan__auto">Automatic check: TAKE reads balanceOf for each recipient’s wallet on {chainName(plan.template.params.chainId)} (contract {plan.template.params.nftContract}) on the check date and records Yes/No with the read as evidence. The team can override with a note.{plan.template.autoCheckedAt ? ` Checked ${signalDate(plan.template.autoCheckedAt)}.` : ""}</p> : null}<small>{plan.evidenceExpected ? "Evidence required." : "Evidence optional."} Criteria cannot be changed.</small></div>
      : status !== "DRAFT" ? <p>No check was scheduled before this campaign was published. A check can't be added afterwards, so the question can't change once people have given.</p>
        : loaded ? <form className="signal-form" onSubmit={(event) => void save(event)}>
          <fieldset className="signal-templates"><legend>OPPORTUNITY TYPE</legend>
            {(Object.keys(EVALUATION_TEMPLATES) as EvaluationTemplateType[]).map((type) => <label key={type} className={`signal-template${template === type ? " is-active" : ""}`}>
              <input type="radio" name="evaluation-template" value={type} checked={template === type} onChange={() => pickTemplate(type)} />
              <strong>{EVALUATION_TEMPLATES[type].label}</strong><small>{EVALUATION_TEMPLATES[type].hint}</small>
            </label>)}
          </fieldset>
          {template === "CREATOR_PROGRAM" ? <label className="field"><span>PIECES TO PUBLISH</span><input inputMode="numeric" value={pieces} onChange={(event) => { setPieces(event.target.value.replace(/\D/g, "")); setQuestion(templatePreset("CREATOR_PROGRAM", { pieces: Number(event.target.value) || 1 }).question); }} /></label> : null}
          {template === "NFT_HOLD" ? <>
            <label className="field"><span>NFT CONTRACT ADDRESS</span><input required pattern="0x[0-9a-fA-F]{40}" value={nftContract} onChange={(event) => setNftContract(event.target.value.trim())} placeholder="0x…" /></label>
            <label className="field"><span>CHAIN</span><select required value={chainId ?? ""} onChange={(event) => setChainId(Number(event.target.value))}>{chains.length ? chains.map((id) => <option key={id} value={id}>{chainName(id)}</option>) : <option value="">No chain configured yet</option>}</select></label>
            <label className="field"><span>DAYS AFTER MINT</span><input inputMode="numeric" value={holdDays} onChange={(event) => { const value = event.target.value.replace(/\D/g, ""); setHoldDays(value); recompute({ holdDays: value }); setQuestion(templatePreset("NFT_HOLD", { holdDays: Number(event.target.value) || 1 }).question); }} /></label>
            <WheelDateTimePicker label="Mint date" value={mintLocal} onChange={(value) => { setMintLocal(value); recompute({ mintLocal: value }); }} />
            <p className="signal-note">The check date below is the mint date plus these days. On that date TAKE reads <code>balanceOf(recipient wallet)</code> over RPC and records Yes or No automatically, with the read as evidence.</p>
          </> : null}
          <label className="field"><span>CATEGORY</span><select value={domain} onChange={(event) => setDomain(event.target.value as SignalDomain)}>{signalDomains.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field"><span>WHAT WILL YOU EVALUATE?</span><input required minLength={5} maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What should happen after this opportunity?" /></label>
          <label className="field"><span>ORIGINAL CRITERIA</span><textarea required minLength={10} maxLength={5000} value={criteria} onChange={(event) => setCriteria(event.target.value)} placeholder="Describe what positive, negative, and inconclusive would mean for this opportunity." /></label>
          {template !== "NFT_HOLD" ? <label className="field"><span>DAYS AFTER THE CAMPAIGN ENDS</span><input inputMode="numeric" value={afterDays} onChange={(event) => { const value = event.target.value.replace(/\D/g, ""); setAfterDays(value); recompute({ afterDays: value }); }} /></label> : null}
          <WheelDateTimePicker label="Evaluate from" value={date} onChange={setDate} days={730}
            hint={campaignEnd ? `Campaign ends ${signalDate(campaignEnd.toISOString())}. The check can't be before that.` : "Pick a time after the campaign ends."} />
          <label className="signal-checkbox"><input type="checkbox" checked={evidenceExpected} onChange={(event) => setEvidenceExpected(event.target.checked)} />Require evidence for recorded outcomes</label>
          <label className="signal-checkbox"><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I understand these criteria will be locked and cannot be rewritten.</label>
          <PrimaryAction type="submit" disabled={busy || !confirmed || (template === "NFT_HOLD" && (!chainId || !/^0x[0-9a-fA-F]{40}$/.test(nftContract)))}>{busy ? "SAVING…" : "SAVE & LOCK CRITERIA"}</PrimaryAction>
        </form> : !error ? <p role="status">Loading evaluation plan…</p> : null}
  </details>;
}

export function reviewDue(evaluateAfter: string, now = Date.now()) {
  const days = daysUntil(evaluateAfter, now);
  if (days <= 0) return "Review due now";
  if (days === 1) return "Review due tomorrow";
  return `Review due in ${days} days`;
}

/** The campaign team's review queue: finalized campaigns that have a check. */
export function OperatorEvaluations({ request }: { request: Request }) {
  const [campaigns, setCampaigns] = useState<CampaignAfter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setError(null);
    try { setCampaigns(await request<CampaignAfter[]>("/operator/evaluations")); }
    catch (caught) { setError(message(caught)); }
  }, [request]);
  useEffect(() => { void refresh(); }, [refresh]);
  return <section className="signal-operator team-review-queue"><header><div><span className="eyebrow">TEAM REVIEW</span><h2>Record what happened.</h2></div><SecondaryAction onClick={() => void refresh()}>REFRESH</SecondaryAction></header>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    {!campaigns ? !error ? <p role="status">Loading reviews…</p> : null
      : !campaigns.length ? <p>No finalized campaign has a scheduled check yet.</p>
        : campaigns.map((campaign) => <TeamReviewPanel key={campaign.campaignId} data={campaign} request={request} onSaved={refresh} />)}
  </section>;
}

/** Loads one campaign's check for its team (organizer or TAKE operator). */
export function TeamReview({ campaignId, request }: { campaignId: string; request: Request }) {
  const [data, setData] = useState<CampaignAfter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setData(await request<CampaignAfter>(`/campaigns/${campaignId}/after`)); }
    catch (caught) { setError(message(caught)); }
  }, [campaignId, request]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <p role="alert" className="form-error">{error}</p>;
  if (!data) return <p role="status">Loading the team review…</p>;
  if (!data.plan) return <section className="team-review team-review--none"><span className="team-review__tag">TEAM REVIEW</span><p>No check was scheduled for this campaign, so there is nothing to review.</p></section>;
  return <TeamReviewPanel data={data} request={request} onSaved={load} />;
}

export function TeamReviewPanel({ data, request, onSaved }: { data: CampaignAfter; request: Request; onSaved: () => Promise<void> }) {
  const plan = data.plan!;
  const due = Date.parse(plan.evaluateAfter) <= Date.now();
  const finalized = data.status === "FINALIZED";
  return <section className="team-review" aria-label={`Team review for ${data.title}`}>
    <header>
      <span className="team-review__tag">TEAM REVIEW · {data.title}</span>
      <h3>The team checks on {signalDate(plan.evaluateAfter)}: {lowerFirst(plan.question)}</h3>
      <span className={`team-review__due${due ? " is-due" : ""}`}>{reviewDue(plan.evaluateAfter)}</span>
    </header>
    <details><summary>What counts as yes, no, unclear</summary><p>{plan.criteria}</p><small>{plan.evidenceExpected ? "A link is required for Yes, No, or Unclear." : "A link is optional."} Locked {signalDate(plan.lockedAt ?? plan.createdAt)}.</small></details>
    {!finalized ? <p className="team-review__wait">Review opens once the result is committed onchain and the check date arrives.</p>
      : !data.allocationCommitted ? <p className="team-review__wait">The committed result is not available, so review is blocked.</p>
        : !data.recipients.length ? <p className="team-review__wait">Nobody received the spot, so there is no one to review.</p>
          : <ul className="team-review__people">{data.recipients.map((recipient) => <TeamReviewRow key={`${data.campaignId}:${recipient.person.key}`} campaign={data} recipient={recipient} due={due} request={request} onSaved={onSaved} />)}</ul>}
    <small className="team-review__who">Only the organizer and TAKE operators can record this. It doesn't change who got the spot.</small>
  </section>;
}

const OUTCOMES = [{ value: "POSITIVE", label: "Yes" }, { value: "NEGATIVE", label: "No" }, { value: "INCONCLUSIVE", label: "Unclear" }] as const;

function TeamReviewRow({ campaign, recipient, due, request, onSaved }: { campaign: CampaignAfter; recipient: CampaignAfter["recipients"][number]; due: boolean; request: Request; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(recipient.evaluation?.status === "PENDING" ? "" : recipient.evaluation?.status ?? "");
  const [urls, setUrls] = useState(recipient.evaluation?.evidenceUrls.join("\n") ?? "");
  const [note, setNote] = useState(recipient.evaluation?.note ?? "");
  const [isPublic, setIsPublic] = useState(recipient.evaluation?.isPublic ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewed = isReviewed(recipient.evaluation);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!status) { setError("Choose Yes, No, or Unclear."); return; }
    setBusy(true); setError(null);
    try {
      await request(`/operator/campaigns/${campaign.campaignId}/evaluations`, { method: "POST", body: JSON.stringify({ recipientKey: recipient.person.key, status, evidenceUrls: urls.split(/\n/).map((url) => url.trim()).filter(Boolean), note, isPublic }) });
      await onSaved(); setOpen(false);
    } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  return <li className="team-review__row">
    <div className="team-review__person"><SignalPersonLabel person={recipient.person} />{reviewed ? <TeamReviewResult evaluation={recipient.evaluation!} /> : <span className="signal-status signal-status--pending">Not reviewed yet</span>}</div>
    {!open ? <SecondaryAction disabled={!due} onClick={() => setOpen(true)}>{!due ? reviewDue(campaign.plan!.evaluateAfter) : reviewed ? "Change review" : "Record review"}</SecondaryAction>
      : <form className="signal-form team-review__form" onSubmit={(event) => void save(event)}>
        <div className="team-review__choices" role="radiogroup" aria-label={`Did it happen for ${recipient.person.name}?`}>
          {OUTCOMES.map((choice) => <button key={choice.value} type="button" role="radio" aria-checked={status === choice.value} className={status === choice.value ? "is-selected" : ""} onClick={() => setStatus(choice.value)}>{choice.label}</button>)}
        </div>
        <label className="field"><span>Short note</span><textarea required minLength={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Shipped v1 on Oct 30." /></label>
        <label className="field"><span>Link{campaign.plan?.evidenceExpected ? "" : " (optional)"}, one per line</span><textarea required={campaign.plan?.evidenceExpected} value={urls} onChange={(event) => setUrls(event.target.value)} placeholder="https://" /></label>
        <label className="signal-checkbox"><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />Show the note and link to everyone. Leave private eligibility or integrity details out.</label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="signal-form__actions"><SecondaryAction type="button" onClick={() => setOpen(false)} disabled={busy}>Cancel</SecondaryAction><PrimaryAction type="submit" disabled={busy}>{busy ? "Saving…" : "Save review"}</PrimaryAction></div>
      </form>}
  </li>;
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
