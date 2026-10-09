import { CampaignSticker, PaperLabel, PassArrow, Sticker } from "../sticker/Sticker";

/**
 * The objects floating on the landing sky: the ticket, the two mascots, and the
 * hand-off every TAKE makes (you, then someone else). Decorative, never tappable, and laid out beside (desktop) or
 * below (phone) the actions so nothing ever covers a button.
 */
export function LandingSkyStickers() {
  return (
    <div className="landing-sky__art">
      <div className="landing-sky__ticket" aria-hidden="true">
        <CampaignSticker campaign={{ title: "One TAKE" }} face={{ count: "1", unit: "TAKE", badge: "GIVE" }} tilt={-9} delay={360} />
      </div>

      <div className="mascot-sticker landing-sky__mascot landing-sky__mascot--lime" aria-hidden="true">
        <Sticker tilt={6} delay={460}>
          <img src="/assets/sticker/mascot-lime.webp" alt="" width="420" height="463" decoding="async" draggable={false} />
        </Sticker>
      </div>

      <div className="mascot-sticker landing-sky__mascot landing-sky__mascot--star" aria-hidden="true">
        <Sticker tilt={-8} delay={540}>
          <img src="/assets/sticker/mascot-star.webp" alt="" width="420" height="417" decoding="async" draggable={false} />
        </Sticker>
      </div>

      <p className="landing-sky__example" aria-label="You give your TAKE to someone else">
        <PaperLabel size="sm" tilt={-4} delay={620}>you</PaperLabel>
        <PassArrow className="landing-sky__arrow" />
        <PaperLabel size="sm" tilt={3} delay={680}>someone else</PaperLabel>
      </p>
    </div>
  );
}
