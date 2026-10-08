import { PaperLabel, PassArrow, Sticker } from "../sticker/Sticker";

/**
 * The objects floating on the landing sky: the ticket, the two mascots, and one
 * example hand-off. Decorative, never tappable, and laid out beside (desktop) or
 * below (phone) the actions so nothing ever covers a button.
 */
export function LandingSkyStickers() {
  return (
    <div className="landing-sky__art">
      <div className="landing-sky__ticket" aria-hidden="true">
        <Sticker tilt={-9} delay={360}>
          <img src="/assets/sticker/ticket.webp" alt="" width="760" height="516" decoding="async" draggable={false} />
        </Sticker>
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

      <p className="landing-sky__example" aria-label="For example, Kubo gives their TAKE to Sarah">
        <PaperLabel size="sm" tilt={-4} delay={620}>kubo</PaperLabel>
        <PassArrow className="landing-sky__arrow" />
        <PaperLabel size="sm" tilt={3} delay={680}>sarah</PaperLabel>
      </p>
    </div>
  );
}
