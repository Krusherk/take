import type { Person } from "../types/product";
import { Avatar } from "./Avatar";

interface HandoffPairProps {
  from: Person;
  to: Person;
  active?: boolean;
  compact?: boolean;
  labels?: boolean;
}

export function HandoffPair({ from, to, active = false, compact = false, labels = true }: HandoffPairProps) {
  return (
    <div className={`handoff-pair${active ? " is-active" : ""}${compact ? " handoff-pair--compact" : ""}`}>
      <div className="handoff-person">
        <Avatar person={from} size={compact ? "sm" : "lg"} />
        {labels ? (
          <span className="handoff-person__label">
            <strong>{from.name}</strong>
            {from.handle ? <small>{from.handle}</small> : null}
          </span>
        ) : null}
      </div>
      <div className="handoff-track" aria-label={`${from.name} gives a TAKE to ${to.name}`}>
        <span className="handoff-track__line" />
        <span className="handoff-track__packet" />
      </div>
      <div className="handoff-person handoff-person--recipient">
        <Avatar person={to} size={compact ? "sm" : "lg"} />
        {labels ? (
          <span className="handoff-person__label">
            <strong>{to.name}</strong>
            {to.handle ? <small>{to.handle}</small> : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function HandoffBackdrop() {
  return (
    <div className="handoff-backdrop" aria-hidden="true">
      <svg viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice">
        <path className="handoff-backdrop__path handoff-backdrop__path--one" d="M-80 520C190 470 270 180 560 212C770 235 810 390 1080 322" />
        <path className="handoff-backdrop__path handoff-backdrop__path--two" d="M-90 586C180 540 312 308 558 322C786 335 842 487 1090 442" />
        <path className="handoff-backdrop__path handoff-backdrop__path--three" d="M-30 260C210 235 334 86 598 112C780 130 894 218 1045 202" />
      </svg>
      <span className="handoff-backdrop__origin" />
      <span className="handoff-backdrop__signal" />
      <span className="handoff-backdrop__destination" />
    </div>
  );
}
