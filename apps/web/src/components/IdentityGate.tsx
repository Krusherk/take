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
  const label = status === "privy-initializing" ? "PRIVY INITIALIZING" : "PROFILE LOADING";

  return (
    <main className="identity-gate" aria-live="polite">
      <Brand light />
      <section>
        <span className="eyebrow">{isError ? "PROFILE ERROR" : label}</span>
        <h1>{isError ? "We couldn’t load your TAKE identity." : "Finding your TAKE identity."}</h1>
        <p>{isError ? error ?? "The profile service did not respond." : "Your connected identity is being synchronized securely."}</p>
        {isError ? (
          <div className="identity-gate__actions">
            <PrimaryAction onClick={onRetry}>TRY AGAIN</PrimaryAction>
            <SecondaryAction onClick={onSignOut}>LOG OUT</SecondaryAction>
          </div>
        ) : <span className="identity-gate__line" aria-hidden="true" />}
      </section>
    </main>
  );
}
