import { ArrowRight, Check, Copy, LockKeyhole, Wallet } from "lucide-react";
import { useState } from "react";
import { ProductError } from "../components/ProductState";
import { FlowBack, FlowHandoff } from "../components/sticker/FlowParts";
import { MascotSticker, PaperLabel, Sticker } from "../components/sticker/Sticker";
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
  const [copyError, setCopyError] = useState(false);
  const campaign = campaigns.find((item) => item.id === campaignId);
  if (!campaign) return <div className="page-container"><ProductError message="This campaign is not available." onRetry={() => navigate("/explore")} /></div>;

  async function copyWalletAddress() {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopyError(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  const back = () => navigate(campaignPath(campaign, "/give") as TakePath);
  return (
    <div className="page-container sticker-page sticker-feed sticker-flow confirmation-page">
      <FlowBack label="Change person" onClick={back} />
      <section className="sticker-feed__stage" aria-labelledby="confirm-heading">
        <Sticker tilt={4} className="feed-tag"><span>REVIEW</span></Sticker>
        <MascotSticker kind="star" tilt={-10} delay={240} className="sticker-feed__mascot sticker-feed__mascot--star" />
        <div className="sticker-feed__headline">
          <h1 id="confirm-heading"><PaperLabel size="lg" tilt={-2} delay={60}>{`Give your TAKE to ${recipient.name}?`}</PaperLabel></h1>
          <PaperLabel size="sm" tilt={1.5} delay={120}>You can’t change it after you sign. It goes on Monad as a public transaction.</PaperLabel>
        </div>
        <FlowHandoff from={currentPerson} to={recipient} label={`You are giving your TAKE to ${recipient.name}`} />
      </section>

      <Sticker tilt={-0.4} delay={200} className="sticker-flow__card">
        <dl className="sticker-flow__facts"><div><dt>Campaign</dt><dd>{campaign.title}</dd></div><div><dt>Opportunity</dt><dd>{campaign.resource}</dd></div><div><dt>Recipient</dt><dd>{recipient.name}{recipient.handle ? ` · ${recipient.handle}` : ""}</dd></div></dl>
        <p className="sticker-flow__note"><LockKeyhole size={17} aria-hidden="true" /><span><strong>One TAKE in this campaign.</strong> You won’t get another.</span></p>
        {import.meta.env.VITE_PRIVY_SPONSOR_TRANSACTIONS !== "true" ? (
          <div className="sticker-flow__gas">
            <p><Wallet size={17} aria-hidden="true" /><span><strong>Your TAKE wallet needs Monad testnet MON for gas.</strong> TAKE doesn’t pay gas yet.</span></p>
            <code title={walletAddress ?? undefined}>{walletAddress ?? "Wallet unavailable"}</code>
            {copyError ? <small role="alert">Could not copy automatically. Select the address above and copy it.</small> : null}
            {walletAddress ? <button className="sticker-pill sticker-pill--paper sticker-pill--sm" type="button" onClick={() => void copyWalletAddress()} aria-label="Copy embedded wallet address">{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}<span>{copied ? "Copied" : "Copy wallet"}</span></button> : null}
          </div>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </Sticker>

      <div className="sticker-flow__dock sticker-flow__dock--two">
        <button className="sticker-pill" type="button" onClick={onConfirm} disabled={submitting}><span>{submitting ? "Preparing…" : `Give to ${recipient.name}`}</span><ArrowRight aria-hidden="true" /></button>
        <button className="sticker-pill sticker-pill--paper sticker-pill--sm" type="button" onClick={back}>Go back</button>
      </div>
    </div>
  );
}
