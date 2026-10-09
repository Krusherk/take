import { ArrowRight, Heart, Megaphone, Repeat2, UserPlus, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { CampaignSticker, MascotSticker, PaperLabel, PassArrow, Sticker } from "../sticker/Sticker";

interface LandingStickerSectionsProps {
  onStartCampaign: () => void;
  onExplore: () => void;
}

/** A section headline as torn paper strips, the same language as the hero. */
function Strip({ id, lines }: { id: string; lines: [string, string?] }) {
  const [first, second] = lines;
  return (
    <h2 id={id} className="ls-strip">
      <Sticker tilt={-2} as="span" className="ls-strip__line ls-strip__line--paper"><span>{first}</span></Sticker>
      {second ? <Sticker tilt={1.5} delay={80} as="span" className="ls-strip__line ls-strip__line--ink"><span>{second}</span></Sticker> : null}
    </h2>
  );
}

function Chip({ icon, children, tilt, delay = 0 }: { icon?: ReactNode; children: ReactNode; tilt: number; delay?: number }) {
  return <Sticker as="li" tilt={tilt} delay={delay} className="ls-chip">{icon}{children}</Sticker>;
}

const GIVEABLES = ["grants", "hackathon tickets", "builder spots", "allowlist spots", "creator programs", "mentorship"] as const;

/**
 * Everything below the hero on the signed-out page, told as stickers on the
 * sky: the problem, how it works, what you can give, why it is hard to game,
 * and the same sign-in actions as the hero.
 */
export function LandingStickerSections({ onStartCampaign, onExplore }: LandingStickerSectionsProps) {
  return (
    <div className="ls">
      <section className="ls-section ls-problem" aria-labelledby="problem-heading">
        <PaperLabel size="sm" tilt={-3} className="ls-kicker">the problem</PaperLabel>
        <Strip id="problem-heading" lines={["Likes are endless.", "A TAKE is one."]} />
        <div className="ls-problem__board">
          <ul className="ls-problem__noise" aria-label="What social apps count">
            <Chip tilt={-6} icon={<Heart aria-hidden="true" />}>2.4k likes</Chip>
            <Chip tilt={4} delay={60} icon={<UserPlus aria-hidden="true" />}>+ follow</Chip>
            <Chip tilt={-3} delay={120} icon={<Repeat2 aria-hidden="true" />}>repost</Chip>
            <Chip tilt={7} delay={180} icon={<Heart aria-hidden="true" />}>like</Chip>
          </ul>
          <PassArrow className="ls-problem__arrow" />
          <div className="ls-problem__one">
            <CampaignSticker campaign={{ title: "One TAKE" }} face={{ count: "1", unit: "TAKE", badge: "GIVE" }} tilt={-6} />
          </div>
        </div>
        <PaperLabel size="md" tilt={1} className="ls-note">Anyone can tap like. You get one TAKE, and it has to go to someone else.</PaperLabel>
      </section>

      <section id="how-it-works" className="ls-section ls-how" aria-labelledby="how-heading">
        <PaperLabel size="sm" tilt={2} className="ls-kicker">how it works</PaperLabel>
        <Strip id="how-heading" lines={["One TAKE.", "Pass it on."]} />
        <ol className="ls-steps">
          <Sticker as="li" tilt={-2} className="ls-step">
            <span className="ls-step__num" aria-hidden="true">1</span>
            <div className="ls-step__art"><CampaignSticker campaign={{ title: "Your TAKE" }} face={{ count: "1", unit: "TAKE", badge: null }} tilt={-6} /></div>
            <strong>You get one TAKE.</strong>
            <small>One per campaign.</small>
          </Sticker>
          <Sticker as="li" tilt={1.5} delay={80} className="ls-step">
            <span className="ls-step__num" aria-hidden="true">2</span>
            <div className="ls-step__art ls-step__art--pass" aria-hidden="true">
              <MascotSticker kind="lime" tilt={-6} className="ls-step__mascot" />
              <PassArrow className="ls-step__arrow" />
              <MascotSticker kind="star" tilt={8} className="ls-step__mascot" />
            </div>
            <strong>Give it to someone.</strong>
            <small>Never yourself.</small>
          </Sticker>
          <Sticker as="li" tilt={-1} delay={160} className="ls-step">
            <span className="ls-step__num" aria-hidden="true">3</span>
            <div className="ls-step__art ls-step__art--chosen" aria-hidden="true">
              <MascotSticker kind="star" tilt={-4} className="ls-step__mascot ls-step__mascot--big" />
              <Sticker tilt={-10} as="span" className="status-sticker status-sticker--live ls-step__badge"><span>CHOSEN</span></Sticker>
            </div>
            <strong>See who gets chosen.</strong>
            <small>Public and checkable.</small>
          </Sticker>
        </ol>
      </section>

      <section id="use-cases" className="ls-section ls-give" aria-labelledby="give-heading">
        <PaperLabel size="sm" tilt={-2} className="ls-kicker">what you can give</PaperLabel>
        <Strip id="give-heading" lines={["Any scarce spot."]} />
        <ul className="ls-give__cloud" aria-label="Things a community can give with TAKE">
          {GIVEABLES.map((item, index) => <Chip key={item} tilt={[-5, 4, -2, 6, -4, 3][index]!} delay={index * 50}>{item}</Chip>)}
        </ul>
      </section>

      <section id="why-take" className="ls-section ls-fair" aria-labelledby="fair-heading">
        <PaperLabel size="sm" tilt={2} className="ls-kicker">why it’s hard to game</PaperLabel>
        <Strip id="fair-heading" lines={["Reach doesn’t", "add power."]} />
        <ul className="ls-fair__rows">
          <FairRow tilt={-1.5} icon={<Megaphone aria-hidden="true" />} who="100k followers" sign="=" gets="1 TAKE" />
          <FairRow tilt={1.2} delay={80} icon={<UserPlus aria-hidden="true" />} who="12 followers" sign="=" gets="1 TAKE" />
          <FairRow tilt={-1} delay={160} icon={<Wallet aria-hidden="true" />} who="a full wallet" sign="=" gets="1 TAKE" />
        </ul>
        <PaperLabel size="md" tilt={-1} className="ls-note">Rules are locked before anyone gives. Nobody can claim their own spot.</PaperLabel>
      </section>

      <section id="about" className="ls-section ls-final" aria-labelledby="final-heading">
        <div className="ls-final__art" aria-hidden="true">
          <MascotSticker kind="lime" tilt={-8} className="ls-final__mascot ls-final__mascot--lime" />
          <MascotSticker kind="star" tilt={10} delay={120} className="ls-final__mascot ls-final__mascot--star" />
        </div>
        <Strip id="final-heading" lines={["Who would you", "give your TAKE to?"]} />
        <PaperLabel size="sm" tilt={1.5} className="ls-kicker">people choose people</PaperLabel>
        <div className="ls-final__actions">
          <Sticker tilt={-1} className="sticker-cta">
            <button className="sticker-pill landing-sky__primary" type="button" onClick={onStartCampaign}>
              <span>Start a campaign</span><ArrowRight aria-hidden="true" />
            </button>
          </Sticker>
          <Sticker tilt={1.5} delay={60} className="landing-sky__secondary-wrap">
            <button className="landing-sky__secondary" type="button" onClick={onExplore}>Explore campaigns</button>
          </Sticker>
        </div>
      </section>

      <footer className="ls-footer">
        <img src="/assets/sticker/logo.webp" alt="" width="243" height="240" loading="lazy" decoding="async" draggable={false} />
        <span>TAKE · people choose people · on Monad</span>
      </footer>
    </div>
  );
}

function FairRow({ icon, who, sign, gets, tilt, delay = 0 }: { icon: ReactNode; who: string; sign: string; gets: string; tilt: number; delay?: number }) {
  return (
    <Sticker as="li" tilt={tilt} delay={delay} className="ls-fair__row">
      <span className="ls-fair__who">{icon}{who}</span>
      <span className="ls-fair__sign" aria-hidden="true">{sign}</span>
      <span className="ls-fair__gets"><span className="sr-equals">equals </span>{gets}</span>
    </Sticker>
  );
}
