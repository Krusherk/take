import { ArrowLeft, Check, Copy, LockKeyhole, Wallet } from "lucide-react";
import { useState } from "react";
import { PrimaryAction, SecondaryAction } from "../components/Actions";
import { Avatar } from "../components/Avatar";
import { HandoffPair } from "../components/Handoff";
import { ProductError } from "../components/ProductState";
import { TakeMascotAccent } from "../components/TakeMascotAccent";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { campaignPath } from "../lib/productData";
import type { Person } from "../types/product";

interface ConfirmationPageProps {
  campaignId: string;
  recipient: Person;
  navigate: (path: TakePath) => void;
  onConfirm: () => void;
  submitting: boolean;
  error: string | null;
  currentPerson: Person;
  walletAddress: string | null;
}

export function ConfirmationPage({ campaignId, recipient, navigate, onConfirm, submitting, error, currentPerson, walletAddress }: ConfirmationPageProps) {
  const { campaigns } = useTakeProduct();
  const [copied, setCopied] = useState(false);
  const campaign = campaigns.find((item) => item.id === campaignId) ?? (campaignId === "monad-creator-round" ? campaigns.find((item) => item.status === "LIVE") : undefined);
  if (!campaign) return <div className="page-container"><ProductError message="This campaign is not available." onRetry={() => navigate("/explore")} /></div>;

  return (
    <div className="page-container confirmation-page">
      <button className="back-link" type="button" onClick={() => navigate(campaignPath(campaign, "/give") as TakePath)}><ArrowLeft size={17} />CHANGE PERSON</button>
      <section className="commitment">
        <header className="commitment__heading">
          <span className="eyebrow">REVIEW YOUR CHOICE</span>
          <div className="commitment__recipient"><Avatar person={recipient} size="lg" /><div><span>YOU’RE GIVING YOUR TAKE TO</span><strong>{recipient.name}</strong>{recipient.handle ? <small>{recipient.handle}</small> : null}</div></div>
          <h1>Make this person count.</h1>
          <p>This is a person-to-person choice. Check it once, then commit it.</p>
        </header>

        <div className="commitment__handoff"><TakeMascotAccent character="handoff" className="mascot-confirmation" /><HandoffPair from={currentPerson} to={recipient} /></div>
        <dl className="commitment__facts"><div><dt>CAMPAIGN</dt><dd>{campaign.title}</dd></div><div><dt>OPPORTUNITY</dt><dd>{campaign.resource}</dd></div><div><dt>RECIPIENT</dt><dd>{recipient.name}{recipient.handle ? ` · ${recipient.handle}` : ""}</dd></div></dl>
        <div className="commitment__notice"><LockKeyhole size={19} strokeWidth={1.7} /><div><strong>This choice can’t be changed.</strong><span>You won’t have another TAKE in this campaign.</span></div></div>
        {import.meta.env.VITE_PRIVY_SPONSOR_TRANSACTIONS !== "true" ? <div className="pilot-gas-notice"><Wallet size={19} /><div><strong>Your TAKE wallet needs Monad testnet MON.</strong><span>This pilot does not currently sponsor gas. Fund this embedded wallet before confirming.</span><code>{walletAddress ?? "Wallet unavailable"}</code></div>{walletAddress ? <button type="button" onClick={() => { void navigator.clipboard.writeText(walletAddress); setCopied(true); window.setTimeout(() => setCopied(false), 1_500); }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "COPIED" : "COPY WALLET"}</button> : null}</div> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="commitment__actions"><PrimaryAction full onClick={onConfirm} disabled={submitting}>{submitting ? "PREPARING…" : `GIVE TO ${recipient.name.toUpperCase()}`}</PrimaryAction><SecondaryAction full arrow="back" onClick={() => navigate(campaignPath(campaign, "/give") as TakePath)}>GO BACK</SecondaryAction></div>
      </section>
    </div>
  );
}
