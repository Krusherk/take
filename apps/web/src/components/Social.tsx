import { ArrowRight, CalendarClock, Check, Sparkles } from "lucide-react";
import type { ActivityItem, Person } from "../types/product";
import { Avatar } from "./Avatar";

interface PersonResultProps {
  person: Person;
  selected?: boolean;
  onSelect: (person: Person) => void;
}

export function PersonResult({ person, selected = false, onSelect }: PersonResultProps) {
  return (
    <button
      className={`person-result${selected ? " is-selected" : ""}`}
      type="button"
      onClick={() => onSelect(person)}
      aria-pressed={selected}
    >
      <Avatar person={person} size="md" />
      <span className="person-result__identity">
        <strong>{person.name}</strong>
        {person.handle ? <small>{person.handle}</small> : <small>No public handle</small>}
      </span>
      <span className="person-result__context">{person.relationship ?? (person.joined ? "TAKE member" : "External")}</span>
      <span className="person-result__select" aria-hidden="true">
        {selected ? <><Check size={16} strokeWidth={2.2} /><span>SELECTED</span></> : <><span>SELECT</span><ArrowRight size={15} /></>}
      </span>
    </button>
  );
}

function ActivityVisual({ item }: { item: ActivityItem }) {
  if (item.actor && item.recipient && (item.kind === "given" || item.kind === "received")) {
    return (
      <span className="activity-handoff" aria-hidden="true">
        <Avatar person={item.actor} size="sm" />
        <span className="activity-handoff__line"><i /></span>
        <Avatar person={item.recipient} size="sm" />
      </span>
    );
  }
  if (item.actor) return <Avatar person={item.actor} size="sm" />;
  if (item.kind === "deadline") return <span className="activity-icon"><CalendarClock size={20} strokeWidth={1.7} /></span>;
  return <span className="activity-icon"><Sparkles size={20} strokeWidth={1.7} /></span>;
}

function ActivitySentence({ item }: { item: ActivityItem }) {
  if (item.actor && item.recipient && (item.kind === "given" || item.kind === "received")) {
    return <p><strong>{item.actor.name}</strong> gave <strong>{item.recipient.name}</strong> their TAKE.</p>;
  }
  return <p><strong>{item.message ?? "A new TAKE update is ready."}</strong></p>;
}

export function ActivityRow({ item, detailed = false, onCampaign }: { item: ActivityItem; detailed?: boolean; onCampaign?: (campaignId: string) => void }) {
  return (
    <article className={`activity-row activity-row--${item.kind}${item.unread ? " is-unread" : ""}${detailed ? " activity-row--detailed" : ""}`}>
      <ActivityVisual item={item} />
      <div className="activity-row__copy">
        <ActivitySentence item={item} />
        {item.campaign ? (
          item.campaignId && onCampaign
            ? <button type="button" onClick={() => onCampaign(item.campaignId!)}>{item.campaign}</button>
            : <span>{item.campaign}</span>
        ) : null}
      </div>
      <time>{item.time}</time>
    </article>
  );
}
