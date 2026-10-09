import { FlowHandoff } from "../components/sticker/FlowParts";
import { MascotSticker, PaperLabel, Sticker } from "../components/sticker/Sticker";
import type { Person } from "../types/product";
import type { TakeSubmissionPhase } from "../App";

export function PendingPage({ recipient, currentPerson, phase, transactionHash, nominationId, error }: { recipient: Person; currentPerson: Person; phase: TakeSubmissionPhase; transactionHash: string | null; nominationId: string | null; error?: string | null }) {
  return (
    <div className="page-container sticker-page sticker-feed sticker-flow pending-page">
      <section className="sticker-feed__stage" aria-live="polite" aria-labelledby="pending-heading">
        <Sticker tilt={4} className="feed-tag"><span>GIVING YOUR TAKE</span></Sticker>
        <MascotSticker kind="lime" tilt={8} delay={240} className="sticker-feed__mascot sticker-feed__mascot--lime" />
        <div className="sticker-feed__headline">
          <h1 id="pending-heading"><PaperLabel size="lg" tilt={-2} delay={60}>{`To ${recipient.name}.`}</PaperLabel></h1>
        </div>
        <FlowHandoff from={currentPerson} to={recipient} label={`Giving your TAKE to ${recipient.name}`} />
      </section>
      <Sticker tilt={-0.4} delay={200} className="sticker-flow__card sticker-flow__progress-card">
        <div className="sticker-flow__progress" aria-hidden="true"><span /></div>
        <p className="sticker-flow__phase">{phaseCopy(phase)}</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {transactionHash ? <a className="sticker-pill sticker-pill--paper sticker-pill--sm" href={`https://testnet.monadexplorer.com/tx/${transactionHash}`} target="_blank" rel="noreferrer">View Monad transaction</a> : null}
        {nominationId ? <small className="sticker-flow__ref">TAKE reference {nominationId.slice(0, 8)}</small> : null}
      </Sticker>
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
