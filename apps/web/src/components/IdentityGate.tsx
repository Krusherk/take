import { PrimaryAction, SecondaryAction } from "./Actions";
import { Brand } from "./Brand";
import type { TakeIdentityStatus } from "../context/TakeIdentityContext";

interface IdentityGateProps {
  status: TakeIdentityStatus;
  error: string | null;
  onRetry: () => void;
  onSignOut: () => void;
}

export function IdentityGate({ status, error, onRetry, onSignOut }: IdentityGateProps) {
  const isError = status === "profile-error";
  const label = status === "privy-initializing" ? "SIGNING YOU IN" : "OPENING YOUR TAKE";

  return (
    <main className="identity-gate" aria-live="polite">
      <Brand light />
      <section>
        <span className="eyebrow">{isError ? "PROFILE ERROR" : label}</span>
        <h1>{isError ? "We couldn’t load your TAKE identity." : "Finding your TAKE identity."}</h1>
        <p>{isError ? error ?? "The profile service did not respond." : "Connecting to TAKE. This should only take a moment."}</p>
        {isError ? (
          <div className="identity-gate__actions">
            <PrimaryAction onClick={onRetry}>TRY AGAIN</PrimaryAction>
            <SecondaryAction onClick={onSignOut}>LOG OUT</SecondaryAction>
          </div>
        ) : <span className="take-loader__dots identity-gate__dots" aria-hidden="true"><i /><i /><i /></span>}
      </section>
    </main>
  );
}
