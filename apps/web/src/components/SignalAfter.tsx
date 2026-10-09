import type { RecipientEvaluation, SignalRecommendation } from "../../../../packages/shared/src/signal";

const DAY = 24 * 60 * 60 * 1000;
export const shortDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));

export function daysUntil(value: string, now = Date.now()) {
  return Math.ceil((Date.parse(value) - now) / DAY);
}
export function countdown(value: string, now = Date.now()) {
  const days = daysUntil(value, now);
  if (days <= 0) return "due now";
  if (days === 1) return "in 1 day";
  return `in ${days} days`;
}
/** "Did they ship?" → "did they ship?" for "The team checks on Nov 1: did they ship?" */
export function lowerFirst(text: string) {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}
export function reviewWord(status: RecipientEvaluation["status"]) {
  return status === "POSITIVE" ? "Yes" : status === "NEGATIVE" ? "No" : status === "INCONCLUSIVE" ? "Unclear" : "Not reviewed";
}
export function isReviewed(evaluation: RecipientEvaluation | null | undefined): evaluation is RecipientEvaluation {
  return Boolean(evaluation && evaluation.status !== "PENDING");
}

type StepState = "done" | "now" | "off" | "todo";
type Step = { key: string; label: string; detail: string; state: StepState };

/** Given → Chosen → Team check → Outcome, from real Signal data only. */
export function afterSteps(item: SignalRecommendation, now = Date.now()): Step[] {
  const chosen: Step = item.receivedOpportunity === true ? { key: "chosen", label: "Chosen", detail: "got the spot", state: "done" }
    : item.receivedOpportunity === false ? { key: "chosen", label: "Not chosen", detail: "this time", state: "off" }
      : { key: "chosen", label: "Chosen?", detail: "after close", state: "now" };
  const due = item.plan ? Date.parse(item.plan.evaluateAfter) <= now : false;
  const reviewed = isReviewed(item.evaluation);
  const check: Step = !item.plan ? { key: "check", label: "Team check", detail: "not scheduled", state: "off" }
    : { key: "check", label: "Team check", detail: due || reviewed ? shortDate(item.plan.evaluateAfter) : `${shortDate(item.plan.evaluateAfter)} · ${countdown(item.plan.evaluateAfter, now)}`,
      state: due || reviewed ? "done" : item.receivedOpportunity === false ? "off" : item.receivedOpportunity ? "now" : "todo" };
  const outcome: Step = reviewed
    ? { key: "outcome", label: reviewWord(item.evaluation!.status), detail: "team review", state: "done" }
    : { key: "outcome", label: "Outcome", detail: item.plan && item.receivedOpportunity !== false ? "not yet" : "—", state: !item.plan || item.receivedOpportunity === false ? "off" : due ? "now" : "todo" };
  return [{ key: "given", label: "Given", detail: shortDate(item.givenAt), state: "done" }, chosen, check, outcome];
}

export function AfterTimeline({ item, now }: { item: SignalRecommendation; now?: number }) {
  const steps = afterSteps(item, now);
  const done = steps.filter((step) => step.state === "done").length;
  return <div className="after-track">
    <div className="after-track__bar" role="progressbar" aria-label="After the TAKE" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-valuetext={steps.map((step) => `${step.label}: ${step.detail}`).join(", ")}>
      <span style={{ width: `${Math.max(8, ((done - 0.5) / (steps.length - 1)) * 100)}%` }} />
    </div>
    <ol className="after-track__steps">
      {steps.map((step) => <li key={step.key} className={`after-track__step after-track__step--${step.state}`}><i aria-hidden="true" /><strong>{step.label}</strong><small>{step.detail}</small></li>)}
    </ol>
  </div>;
}

/** The team's recorded outcome, as everyone sees it. */
export function TeamReviewResult({ evaluation }: { evaluation: RecipientEvaluation }) {
  return <div className={`team-result team-result--${evaluation.status.toLowerCase()}`}>
    <p><strong>Team review: {reviewWord(evaluation.status)}</strong>{evaluation.note ? <> — {evaluation.note}</> : "."}</p>
    {evaluation.evidenceUrls.length ? <p className="team-result__links">{evaluation.evidenceUrls.map((url, index) => <a href={url} key={url} target="_blank" rel="noopener noreferrer">{evaluation.evidenceUrls.length > 1 ? `Link ${index + 1}` : "Link"} ↗</a>)}</p> : null}
    <small>{evaluation.evaluatedAt ? `Reviewed ${shortDate(evaluation.evaluatedAt)} by ${evaluation.evaluator.name}.` : null}{!evaluation.isPublic ? " The team kept its notes private." : ""}</small>
  </div>;
}
