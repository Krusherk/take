import { HandoffPair } from "../components/Handoff";
import type { Person } from "../types/product";
import type { TakeSubmissionPhase } from "../App";

export function PendingPage({ recipient, currentPerson, phase, transactionHash, nominationId }: { recipient: Person; currentPerson: Person; phase: TakeSubmissionPhase; transactionHash: string | null; nominationId: string | null }) {
  return (
    <div className="state-page pending-page">
      <section className="pending-state" aria-live="polite">
        <span className="eyebrow">GIVING YOUR TAKE</span>
        <h1>To {recipient.name}.</h1>
        <HandoffPair from={currentPerson} to={recipient} active labels={false} />
        <div className="pending-state__progress" aria-hidden="true"><span /></div>
        <p>{phaseCopy(phase)}</p>
        {transactionHash ? <a className="pending-state__receipt" href={`https://testnet.monadexplorer.com/tx/${transactionHash}`} target="_blank" rel="noreferrer">VIEW MONAD TRANSACTION</a> : null}
        {nominationId ? <small>TAKE reference {nominationId.slice(0, 8)}</small> : null}
      </section>
    </div>
  );
}

function phaseCopy(phase: TakeSubmissionPhase) {
  if (phase === "PREPARING") return "Preparing your TAKE…";
  if (phase === "REGISTERING_IDENTITY") return "Registering your TAKE identity on Monad…";
  if (phase === "WAITING_FOR_WALLET") return "Waiting for wallet confirmation…";
  if (phase === "SUBMITTED") return "Confirming on Monad…";
  if (phase === "CONFIRMED_ON_MONAD") return "Transaction confirmed. Recording your TAKE…";
  return "Finalizing your TAKE record…";
}
