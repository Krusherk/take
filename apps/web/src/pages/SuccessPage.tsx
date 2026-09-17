import { Share2 } from "lucide-react";
import { PrimaryAction, SecondaryAction, TextAction } from "../components/Actions";
import { Avatar } from "../components/Avatar";
import { HandoffPair } from "../components/Handoff";
import { ProductError } from "../components/ProductState";
import { TakeMascotAccent } from "../components/TakeMascotAccent";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { campaignPath } from "../lib/productData";
import type { Person } from "../types/product";

interface SuccessPageProps {
  campaignId: string;
  recipient: Person;
  navigate: (path: TakePath) => void;
  transactionHash: string | null;
  currentPerson: Person;
}

export function SuccessPage({ campaignId, recipient, navigate, transactionHash, currentPerson }: SuccessPageProps) {
  const { campaigns } = useTakeProduct();
  const campaign = campaigns.find((item) => item.id === campaignId);
  if (!campaign) return <div className="page-container"><ProductError message="This campaign is not available." onRetry={() => navigate("/explore")} /></div>;
  const campaignTitle = campaign.title;

  async function share() {
    const shareData = { title: "I gave my TAKE", text: `I gave ${recipient.name} my TAKE for ${campaignTitle}.`, url: window.location.href };
    if (navigator.share) { await navigator.share(shareData).catch(() => undefined); return; }
    await navigator.clipboard?.writeText(`${shareData.text} ${shareData.url}`);
  }

  return (
    <div className="state-page success-page">
      <section className="success-state">
        <TakeMascotAccent character="yellow" />
        <div className="success-state__portrait"><span className="success-ring" aria-hidden="true" /><Avatar person={recipient} size="hero" /><span className="success-state__given">GIVEN</span></div>
        <header><span className="eyebrow">YOUR CHOICE IS RECORDED</span><h1>You gave <em>{recipient.name}</em> your TAKE.</h1>{recipient.handle ? <strong>{recipient.handle}</strong> : null}<p>{recipient.name} can now see that you chose them for {campaign.title}.</p></header>
        <HandoffPair from={currentPerson} to={recipient} compact labels={false} />
        <div className="success-state__campaign"><span>CAMPAIGN</span><strong>{campaign.title}</strong></div>
        <div className="success-state__actions"><PrimaryAction onClick={() => navigate(campaignPath(campaign) as TakePath)}>VIEW CAMPAIGN</PrimaryAction><SecondaryAction onClick={() => void share()}><span className="provider-label"><Share2 size={17} />SHARE</span></SecondaryAction></div>
        {transactionHash ? <TextAction arrow="up" onClick={() => window.open(`https://testnet.monadscan.com/tx/${transactionHash}`, "_blank", "noopener,noreferrer")}>VIEW RECEIPT</TextAction> : <span className="success-state__confirmation">CONFIRMED ON MONAD</span>}
      </section>
    </div>
  );
}
