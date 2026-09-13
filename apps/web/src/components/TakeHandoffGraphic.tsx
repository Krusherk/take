import type { CampaignVisual, Person } from "../types/product";
import { Avatar } from "./Avatar";

export type TakeHandoffState = "available" | "given" | "anonymous";

export interface TakeHandoffGraphicProps {
  state: TakeHandoffState;
  giver?: Person | null;
  recipient?: Person | null;
  participants?: Person[];
  accent?: CampaignVisual;
  compact?: boolean;
  className?: string;
}

export function TakeHandoffGraphic({
  state,
  giver,
  recipient,
  participants = [],
  accent = "violet",
  compact = false,
  className = "",
}: TakeHandoffGraphicProps) {
  const resolvedGiver = state !== "anonymous" ? giver ?? null : null;
  const resolvedRecipient = state === "given" ? recipient ?? null : null;
  const description = handoffDescription(state, resolvedGiver, resolvedRecipient);

  return (
    <div
      className={`campaign-art take-handoff take-handoff--${accent}${compact ? " take-handoff--compact" : ""}${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={description}
    >
      <span className="take-handoff__grid" aria-hidden="true" />
      <svg className="take-handoff__traces" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path className="take-handoff__trace take-handoff__trace--one" d="M 7 31 C 28 14, 68 17, 93 38" />
        <path className="take-handoff__trace take-handoff__trace--two" d="M 7 73 C 34 88, 72 78, 93 61" />
        {!compact ? <path className="take-handoff__trace take-handoff__trace--three" d="M 15 17 C 38 31, 62 72, 87 84" /> : null}
      </svg>

      <div className="take-handoff__rail" aria-hidden="true">
        <i className="take-handoff__anchor take-handoff__anchor--start" />
        <span className="take-handoff__direction" />
        <span className="take-handoff__chip"><i /></span>
        <i className="take-handoff__anchor take-handoff__anchor--end" />
      </div>

      <div className="take-handoff__endpoint take-handoff__endpoint--giver" aria-hidden="true">
        {resolvedGiver ? (
          <Avatar person={resolvedGiver} size={compact ? "sm" : "lg"} />
        ) : participants.length ? (
          <span className="take-handoff__community-stack">
            {participants.slice(0, 3).map((person) => <Avatar key={person.id} person={person} size="xs" />)}
          </span>
        ) : (
          <span className="take-handoff__community-mark"><i /><i /><i /></span>
        )}
        {!compact ? <span className="take-handoff__caption">{resolvedGiver ? shortIdentity(resolvedGiver) : "COMMUNITY"}</span> : null}
      </div>

      <div className="take-handoff__endpoint take-handoff__endpoint--recipient" aria-hidden="true">
        {resolvedRecipient ? (
          <Avatar person={resolvedRecipient} size={compact ? "sm" : "lg"} />
        ) : (
          <span className={`take-handoff__open-target${state === "given" ? " is-given" : ""}`}><i /></span>
        )}
        {!compact ? <span className="take-handoff__caption">{resolvedRecipient ? shortIdentity(resolvedRecipient) : state === "given" ? "GIVEN" : "WHO?"}</span> : null}
      </div>

      {!compact ? <span className="take-handoff__unit" aria-hidden="true">ONE TAKE</span> : null}
    </div>
  );
}

function shortIdentity(person: Person): string {
  if (person.handle) return person.handle;
  return person.name.trim().split(/\s+/)[0] ?? person.name;
}

function handoffDescription(state: TakeHandoffState, giver: Person | null, recipient: Person | null): string {
  if (state === "given" && giver && recipient) return `${giver.name} gave their TAKE to ${recipient.name}`;
  if (state === "given" && giver) return `${giver.name} has given their TAKE`;
  if (state === "given") return "A community TAKE has been given";
  if (state === "available" && giver) return `${giver.name} has one TAKE available to give to someone else`;
  return "A community TAKE waiting to be given to someone";
}
