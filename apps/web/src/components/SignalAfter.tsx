import { useState } from "react";
import type { SignalCallEntry, SignalCallValue, SignalRecommendation } from "../../../../packages/shared/src/signal";

const DAY = 24 * 60 * 60 * 1000;
const shortDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));

export function countdown(value: string, now = Date.now()) {
  const days = Math.ceil((Date.parse(value) - now) / DAY);
  if (days <= 0) return "due now";
  if (days === 1) return "in 1 day";
  return `in ${days} days`;
}

type StepState = "done" | "now" | "off" | "todo";
type Step = { key: string; label: string; detail: string; state: StepState };

/** Given → Chosen → Check scheduled → Outcome recorded, from real Signal data only. */
export function afterSteps(item: SignalRecommendation, now = Date.now()): Step[] {
  const chosen: Step = item.receivedOpportunity === true ? { key: "chosen", label: "Chosen", detail: "got the spot", state: "done" }
    : item.receivedOpportunity === false ? { key: "chosen", label: "Not chosen", detail: "this time", state: "off" }
      : { key: "chosen", label: "Chosen?", detail: "after close", state: "now" };
  const due = item.plan ? Date.parse(item.plan.evaluateAfter) <= now : false;
  const check: Step = !item.plan ? { key: "check", label: "Check", detail: "not scheduled", state: "off" }
    : { key: "check", label: due ? "Check due" : "Check", detail: due ? shortDate(item.plan.evaluateAfter) : `${shortDate(item.plan.evaluateAfter)} · ${countdown(item.plan.evaluateAfter, now)}`,
      state: due ? "done" : item.receivedOpportunity === false ? "off" : item.receivedOpportunity ? "now" : "todo" };
  const status = item.evaluation?.status;
  const outcome: Step = status && status !== "PENDING"
    ? { key: "outcome", label: status === "POSITIVE" ? "It worked out" : status === "NEGATIVE" ? "It didn't" : "Unclear", detail: "recorded", state: "done" }
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

const CHOICES: Array<{ value: SignalCallValue; label: string }> = [
  { value: "YES", label: "Yes" },
  { value: "UNSURE", label: "Not sure" },
  { value: "NO", label: "No" },
];

export function CallIt({ item, entry, onCall }: { item: SignalRecommendation; entry: SignalCallEntry | null; onCall: (call: SignalCallValue) => Promise<void> }) {
  const [busy, setBusy] = useState<SignalCallValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!item.plan) return null;
  const open = entry ? entry.open : item.receivedOpportunity !== false && Date.parse(item.plan.evaluateAfter) > Date.now();
  const mine = entry?.mine ?? null;
  async function choose(value: SignalCallValue) {
    setBusy(value); setError(null);
    try { await onCall(value); } catch (caught) { setError(caught instanceof Error ? caught.message : "Your call could not be saved."); } finally { setBusy(null); }
  }
  return <section className="call-it" aria-label={`Your call on ${item.recipient.name}`}>
    <header><span className="call-it__tag">CALL IT</span><strong>{item.plan.question}</strong></header>
    {open ? <div className="call-it__choices" role="group" aria-label="Your call">
      {CHOICES.map((choice) => <button key={choice.value} type="button" aria-pressed={mine === choice.value} className={mine === choice.value ? "is-mine" : ""} disabled={busy !== null} onClick={() => void choose(choice.value)}>{busy === choice.value ? "Saving…" : choice.label}</button>)}
    </div> : <p className="call-it__closed">{mine ? `You called “${CHOICES.find((choice) => choice.value === mine)?.label}”.` : "Calls are closed."}</p>}
    {entry?.split ? <CallSplit split={entry.split} name={item.recipient.name} /> : <small>{open ? "What others called shows after the results are committed." : null}</small>}
    {error ? <p className="call-it__error" role="alert">{error}</p> : null}
    <small className="call-it__note">Just a call. No money, no points, and it doesn't change who gets the spot. You can change it until the check{entry?.closesAt ? ` on ${shortDate(entry.closesAt)}` : ""}.</small>
  </section>;
}

export function CallSplit({ split, name }: { split: NonNullable<SignalCallEntry["split"]>; name: string }) {
  if (!split.total) return <small>Nobody who backed {name} has made a call yet.</small>;
  const pct = (value: number) => `${Math.round((value / split.total) * 100)}%`;
  return <div className="call-split">
    <div className="call-split__bar" role="img" aria-label={`People who backed ${name}: ${split.yes} yes, ${split.unsure} not sure, ${split.no} no`}>
      {split.yes ? <span className="call-split__yes" style={{ width: pct(split.yes) }} /> : null}
      {split.unsure ? <span className="call-split__unsure" style={{ width: pct(split.unsure) }} /> : null}
      {split.no ? <span className="call-split__no" style={{ width: pct(split.no) }} /> : null}
    </div>
    <p><span>{split.yes} yes</span><span>{split.unsure} not sure</span><span>{split.no} no</span><span>{split.total} {split.total === 1 ? "call" : "calls"} from people who backed {name}</span></p>
  </div>;
}
