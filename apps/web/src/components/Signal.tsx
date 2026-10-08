import { useEffect, useState } from "react";
import type { CampaignAfter, RecipientEvaluation, SignalPerson, SignalRecommendation } from "../../../../packages/shared/src/signal";
import { TAKE_API_BASE_URL } from "../lib/takeApi";
import { useSignal } from "../hooks/useSignal";
import type { TakePath } from "../hooks/usePathRouter";

export function signalDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
export function SignalPersonLabel({ person }: { person: SignalPerson }) {
  return <span className="signal-person">{person.avatarUrl ? <img src={person.avatarUrl} alt="" loading="lazy" /> : <span className="signal-person__initial" aria-hidden="true">{person.name.slice(0, 1)}</span>}<strong>{person.name}</strong></span>;
}
export function SignalOutcome({ evaluation, fallback = "Awaiting evaluation" }: { evaluation: RecipientEvaluation | null; fallback?: string }) {
  return <div className="signal-outcome">
    <span className={`signal-status signal-status--${evaluation?.status.toLowerCase() ?? "pending"}`}>{evaluation?.status === "PENDING" || !evaluation ? fallback : evaluation.status.toLowerCase()}</span>
    {evaluation?.note ? <p>{evaluation.note}</p> : null}
    {evaluation && !evaluation.isPublic ? <small>Supporting notes and evidence are private.</small> : null}
    {evaluation?.evidenceUrls.map((url, index) => <a href={url} key={url} target="_blank" rel="noopener noreferrer">Evidence{evaluation.evidenceUrls.length > 1 ? ` ${index + 1}` : ""} ↗</a>)}
    {evaluation?.evaluatedAt ? <small>Evaluated {signalDate(evaluation.evaluatedAt)} by {evaluation.evaluator.name}</small> : null}
  </div>;
}
export function RecommendationRow({ item, navigate }: { item: SignalRecommendation; navigate: (path: TakePath) => void }) {
  return <li className="signal-card">
    <div className="signal-card__people">
      <SignalPersonLabel person={item.giver} />
      <span aria-hidden="true">→</span>
      <SignalPersonLabel person={item.recipient} />
    </div>
    <a className="signal-campaign-link" href={`/campaign/${item.campaign.id}`} onClick={(event) => { event.preventDefault(); navigate(`/campaign/${item.campaign.id}`); }}>{item.campaign.title}</a>
    <p className="signal-card__story">{outcomeSentence(item)}</p>
    <small>Given <time dateTime={item.givenAt}>{signalDate(item.givenAt)}</time>{item.domain ? ` · ${item.domain.toLowerCase()}` : ""} · {item.campaign.resource}</small>
    {item.evaluation?.evidenceUrls.map((url, index) => <a href={url} key={url} target="_blank" rel="noopener noreferrer">Evidence{item.evaluation && item.evaluation.evidenceUrls.length > 1 ? ` ${index + 1}` : ""} ↗</a>)}
    {item.evaluation?.evaluatedAt ? <small>Checked {signalDate(item.evaluation.evaluatedAt)} by {item.evaluation.evaluator.name}</small> : null}
    {item.evaluation && !item.evaluation.isPublic ? <small>Supporting notes stay private.</small> : null}
    {item.plan ? <details><summary>What will be checked</summary><strong>{item.plan.question}</strong><p>{item.plan.criteria}</p><small>Locked {signalDate(item.plan.lockedAt ?? item.plan.createdAt)}</small></details> : null}
  </li>;
}

function outcomeSentence(item: SignalRecommendation) {
  if (item.receivedOpportunity) return "They received the spot.";
  if (item.state === "NOT_SELECTED") return "They did not receive this one.";
  if (item.state === "NOT_PLANNED") return "Nothing is scheduled to check what happened after.";
  const note = item.evaluation?.note?.trim();
  if (item.evaluation?.status === "POSITIVE") return note || "It worked out.";
  if (item.evaluation?.status === "NEGATIVE") return note || "It did not work out.";
  if (item.evaluation?.status === "INCONCLUSIVE") return note || "The outcome was inconclusive.";
  if (item.plan) return `Someone checks what happened after ${signalDate(item.plan.evaluateAfter)}.`;
  return "Waiting to see what happened.";
}
export function ProfileSignal({ navigate }: { navigate: (path: TakePath) => void }) {
  const { data, error, reload } = useSignal();
  return <section className="profile-signal"><div><span className="eyebrow">SIGNAL</span><h2>Who you backed.</h2>
    {data ? <p>{data.counts.recommendations ? `You backed ${data.counts.recommendations} ${data.counts.recommendations === 1 ? "person" : "people"}.` : "You have not backed anyone yet."}</p>
      : error ? <button type="button" onClick={reload}>Couldn’t load Signal. Retry</button> : <p role="status">Loading your recommendation history…</p>}</div>
    <a href="/signal" onClick={(event) => { event.preventDefault(); navigate("/signal"); }}>VIEW YOUR SIGNAL →</a>
  </section>;
}
export function CampaignAfterSection({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<CampaignAfter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(null);
    void fetch(`${TAKE_API_BASE_URL}/campaigns/${campaignId}/after`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("The finalized result could not be loaded.");
      return response.json() as Promise<CampaignAfter>;
    }).then(setData).catch((caught) => { if (!controller.signal.aborted) setError(caught.message); });
    return () => controller.abort();
  }, [campaignId, revision]);
  if (error) return <p role="alert">{error} <button type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button></p>;
  if (!data) return <p role="status">Loading the finalized opportunity…</p>;
  return <section className="campaign-after">
    <header><span className="eyebrow">{data.seats} {data.seats === 1 ? "SPOT" : "SPOTS"}</span><h2>Received by</h2><p>{data.resource}</p></header>
    {!data.allocationCommitted ? <p>The committed recipient list is not available yet.</p> : !data.recipients.length ? <p>No recipients were selected by the committed allocation.</p> : <ul className="signal-recipients">{data.recipients.map((recipient) => <li key={recipient.person.key}><SignalPersonLabel person={recipient.person} /><span>Backed by {recipient.supporters} community {recipient.supporters === 1 ? "member" : "members"}</span></li>)}</ul>}
    {data.plan ? <section className="campaign-evaluation"><span className="eyebrow">AFTER THE CAMPAIGN</span><h3>{data.plan.question}</h3><p>{data.plan.criteria}</p><p>Evaluation from {signalDate(data.plan.evaluateAfter)} · {data.plan.domain.toLowerCase()}</p><small>Criteria locked {signalDate(data.plan.lockedAt ?? data.plan.createdAt)}. {data.plan.evidenceExpected ? "Evidence is required." : "Evidence is optional."}</small>
      {data.recipients.map((recipient) => <article key={recipient.person.key}><strong>{recipient.person.name}</strong><SignalOutcome evaluation={recipient.evaluation} /></article>)}
    </section> : null}
    {data.recommendations.length ? <details className="signal-edges"><summary>Who backed whom</summary><ul>{data.recommendations.map((edge) => <li key={edge.id}><span>{edge.giver.name} → <strong>{edge.recipient.name}</strong></span><time dateTime={edge.givenAt}>{signalDate(edge.givenAt)}</time></li>)}</ul></details> : null}
  </section>;
}
