import { ArrowRight, Share2 } from "lucide-react";
import { ProductError } from "../components/ProductState";
import { FlowHandoff } from "../components/sticker/FlowParts";
import { MascotSticker, PaperLabel, Sticker } from "../components/sticker/Sticker";
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
    <div className="page-container sticker-page sticker-feed sticker-flow success-page">
      <section className="sticker-feed__stage" aria-labelledby="success-heading">
        <Sticker tilt={4} className="feed-tag"><span>GIVEN</span></Sticker>
        <MascotSticker kind="star" tilt={-10} delay={240} className="sticker-feed__mascot sticker-feed__mascot--star" />
        <div className="sticker-feed__headline">
          <h1 id="success-heading"><PaperLabel size="lg" tilt={-2} delay={60}>{`You gave ${recipient.name} your TAKE.`}</PaperLabel></h1>
          <PaperLabel size="sm" tilt={1.5} delay={120}>{`It’s recorded on Monad for ${campaign.title}. ${recipient.name} sees it in TAKE.`}</PaperLabel>
        </div>
        <FlowHandoff from={currentPerson} to={recipient} label={`You gave your TAKE to ${recipient.name}`} />
      </section>
      <div className="sticker-flow__dock sticker-flow__dock--two">
        <button className="sticker-pill" type="button" onClick={() => navigate(campaignPath(campaign) as TakePath)}><span>View campaign</span><ArrowRight aria-hidden="true" /></button>
        <button className="sticker-pill sticker-pill--paper sticker-pill--sm" type="button" onClick={() => void share()}><Share2 size={16} aria-hidden="true" />Share</button>
        {transactionHash ? <a className="sticker-pill sticker-pill--paper sticker-pill--sm" href={`https://testnet.monadexplorer.com/tx/${transactionHash}`} target="_blank" rel="noreferrer">View receipt</a> : null}
      </div>
    </div>
  );
}
