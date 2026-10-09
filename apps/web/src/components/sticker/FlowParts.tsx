import { ArrowLeft } from "lucide-react";
import type { Person } from "../../types/product";
import { EmptySlotSticker, FaceSticker, PassArrow, Sticker } from "./Sticker";

/** Back button as a small paper sticker, same as the campaign page. */
export function FlowBack({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Sticker tilt={-2} className="sticker-detail__back sticker-flow__back">
      <button type="button" onClick={onClick}><ArrowLeft size={16} aria-hidden="true" />{label}</button>
    </Sticker>
  );
}

/** The hand-off every TAKE makes: one face, an arrow, the other face (or an empty slot). */
export function FlowHandoff({ from, to, fromLabel = "you", toLabel, emptyLabel = "someone else", label }: {
  from: Person;
  to: Person | null;
  fromLabel?: string;
  toLabel?: string;
  emptyLabel?: string;
  label: string;
}) {
  return (
    <div className="sticker-campaign__handoff sticker-flow__handoff" role="group" aria-label={label}>
      <FaceSticker person={from} size="sm" tilt={-6} delay={180} label={fromLabel} />
      <PassArrow className="pass-arrow--sm" />
      {to
        ? <FaceSticker person={to} size="sm" tilt={5} delay={230} label={toLabel ?? to.name} sublabel={to.handle || undefined} />
        : <EmptySlotSticker size="sm" tilt={5} delay={230} label={emptyLabel} />}
    </div>
  );
}
