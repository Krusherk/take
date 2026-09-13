import { HandoffPair } from "../components/Handoff";
import type { Person } from "../types/product";

export function PendingPage({ recipient, currentPerson }: { recipient: Person; currentPerson: Person }) {
  return (
    <div className="state-page pending-page">
      <section className="pending-state" aria-live="polite">
        <span className="eyebrow">GIVING YOUR TAKE</span>
        <h1>To {recipient.name}.</h1>
        <HandoffPair from={currentPerson} to={recipient} active labels={false} />
        <div className="pending-state__progress" aria-hidden="true"><span /></div>
        <p>Confirming on Monad</p>
      </section>
    </div>
  );
}
