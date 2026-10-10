import { useEffect, useState } from "react";
import type { BackerSignal, CampaignAfter, RecipientEvaluation, SignalPerson, SignalRecommendation } from "../../../../packages/shared/src/signal";
import { AfterTimeline, countdown, isReviewed, lowerFirst, shortDate, TeamReviewResult } from "./SignalAfter";
import { TAKE_API_BASE_URL } from "../lib/takeApi";
import { useSignal } from "../hooks/useSignal";
import type { TakePath } from "../hooks/usePathRouter";

export function signalDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
export function SignalPersonLabel({ person }: { person: SignalPerson }) {
  return <span className="signal-person">{person.avatarUrl ? <img src={person.avatarUrl} alt="" loading="lazy" /> : <span className="signal-person__initial" aria-hidden="true">{person.name.slice(0, 1)}</span>}<strong>{person.name}</strong></span>;
}
export function SignalOutcome({ evaluation, fallback = "Not reviewed yet" }: { evaluation: RecipientEvaluation | null; fallback?: string }) {
  if (isReviewed(evaluation)) return <TeamReviewResult evaluation={evaluation} />;
  return <div className="signal-outcome"><span className="signal-status signal-status--pending">{fallback}</span></div>;
}

export function RecommendationRow({ item, navigate }: { item: SignalRecommendation; navigate: (path: TakePath) => void }) {
  return <li className="signal-card">
    <div className="signal-card__people">
      <SignalPersonLabel person={item.giver} />
      <span aria-hidden="true">→</span>
      <SignalPersonLabel person={item.recipient} />
    </div>
    <a className="signal-campaign-link" href={`/campaign/${item.campaign.id}`} onClick={(event) => { event.preventDefault(); navigate(`/campaign/${item.campaign.id}`); }}>{item.campaign.title}</a>
    <AfterTimeline item={item} />
    <p className="signal-card__story">{outcomeSentence(item)}</p>
    <small>Given <time dateTime={item.givenAt}>{signalDate(item.givenAt)}</time>{item.domain ? ` · ${item.domain.toLowerCase()}` : ""} · {item.campaign.resource}</small>
    {!item.plan && item.state !== "NOT_SELECTED" ? <div className="signal-card__unplanned">
      <p>A check is the question an organizer locks in before anyone gives, like “In 30 days: did they ship?”. Then TAKE records what happened. This campaign didn't set one, and it can't be added later.</p>
      <a href="/organize" onClick={(event) => { event.preventDefault(); navigate("/organize"); }}>Schedule a check in your next campaign →</a>
    </div> : null}
    {isReviewed(item.evaluation) ? <TeamReviewResult evaluation={item.evaluation} /> : null}
    {item.plan ? <details><summary>What the team checks</summary><strong>{item.plan.question}</strong><p>{item.plan.criteria}</p><small>Locked {signalDate(item.plan.lockedAt ?? item.plan.createdAt)}. It can't be changed.</small></details> : null}
  </li>;
}

function outcomeSentence(item: SignalRecommendation) {
  if (item.state === "NOT_SELECTED") return "They did not receive this one.";
  if (item.state === "NOT_PLANNED") return item.receivedOpportunity ? "They received the spot. No check was scheduled." : item.receivedOpportunity === false ? "They did not receive this one." : "Results come after the campaign closes.";
  if (isReviewed(item.evaluation)) return "They received the spot. The team has reviewed it.";
  if (item.plan && item.receivedOpportunity === null) return `Results after close. If they get the spot, the team checks on ${shortDate(item.plan.evaluateAfter)}: ${lowerFirst(item.plan.question)}`;
  if (item.plan) return `The team checks on ${shortDate(item.plan.evaluateAfter)}: ${lowerFirst(item.plan.question)}`;
  return "Waiting to see what happened.";
}
/** Public backer score for a handle or wallet. Not transferable. */
export function useBackerScore(ref: string | null | undefined) {
  const [score, setScore] = useState<BackerSignal | null>(null);
  useEffect(() => {
    const clean = ref?.replace(/^@/, "").trim();
    if (!clean) return;
    const controller = new AbortController();
    void fetch(`${TAKE_API_BASE_URL}/signal/${encodeURIComponent(clean)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<BackerSignal> : null)
      .then((value) => { if (!controller.signal.aborted) setScore(value); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [ref]);
  return score;
}
export function BackerScore({ score }: { score: BackerSignal | null }) {
  if (!score) return null;
  return <div className="profile-signal__score" aria-label={`Signal score ${score.score}`}>
    <strong>{score.score}</strong>
    <span>Signal score · {score.reviewedPicks} reviewed {score.reviewedPicks === 1 ? "pick" : "picks"}</span>
    <small>{score.note}</small>
  </div>;
}
export function ProfileSignal({ navigate, handle }: { navigate: (path: TakePath) => void; handle?: string | null }) {
  const { data, error, reload } = useSignal();
  const score = useBackerScore(handle);
  return <section className="profile-signal"><div><span className="eyebrow">SIGNAL</span><h2>Who you backed.</h2>
    <BackerScore score={score} />
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
    {data.plan ? <section className="campaign-evaluation"><span className="eyebrow">AFTER THE CAMPAIGN</span><h3>{data.plan.question}</h3><p>{data.plan.criteria}</p><p>The team checks on {signalDate(data.plan.evaluateAfter)} ({countdown(data.plan.evaluateAfter)}) · {data.plan.domain.toLowerCase()}</p><small>Criteria locked {signalDate(data.plan.lockedAt ?? data.plan.createdAt)}. {data.plan.evidenceExpected ? "Evidence is required." : "Evidence is optional."}</small>
      {data.recipients.map((recipient) => <article key={recipient.person.key}><strong>{recipient.person.name}</strong><SignalOutcome evaluation={recipient.evaluation} /></article>)}
    </section> : null}
    {data.recommendations.length ? <details className="signal-edges"><summary>Who backed whom</summary><ul>{data.recommendations.map((edge) => <li key={edge.id}><span>{edge.giver.name} → <strong>{edge.recipient.name}</strong></span><time dateTime={edge.givenAt}>{signalDate(edge.givenAt)}</time></li>)}</ul></details> : null}
  </section>;
}
