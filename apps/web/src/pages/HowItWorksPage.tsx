import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { CampaignSticker, MascotSticker, PaperLabel, PassArrow, Sticker } from "../components/sticker/Sticker";
import { ProofSection } from "../components/landing/ProofSection";
import type { Navigate } from "../hooks/usePathRouter";
import "../landing-sections.css";
import "./how-it-works.css";

function Beat({ n, kicker, title, children, tilt, art }: { n: number; kicker: string; title: string; children: ReactNode; tilt: number; art?: ReactNode }) {
  return (
    <Sticker as="li" tilt={tilt} className="hiw-beat">
      <span className="ls-step__num" aria-hidden="true">{n}</span>
      <div className="hiw-beat__inner">
        <span className="hiw-beat__kicker">{kicker}</span>
        {art ? <div className="hiw-beat__art">{art}</div> : null}
        <strong>{title}</strong>
        <div className="hiw-beat__body">{children}</div>
      </div>
    </Sticker>
  );
}

function Name({ children, tilt, tone = "paper" }: { children: ReactNode; tilt: number; tone?: "paper" | "lime" | "ink" }) {
  return <Sticker as="span" tilt={tilt} className={`hiw-name hiw-name--${tone}`}><span>{children}</span></Sticker>;
}

/** The whole mechanism in short, honest beats, for judges and first-time organizers. */
export function HowItWorksPage({ navigate, signedIn }: { navigate: Navigate; signedIn: boolean }) {
  useEffect(() => { document.title = "How TAKE works"; window.scrollTo(0, 0); }, []);
  return (
    <div className="app-shell app-shell--sky app-shell--public">
      <main className="page-container sticker-page hiw">
        <nav className="hiw-top">
          <button type="button" className="sticker-pill sticker-pill--paper sticker-pill--sm" onClick={() => navigate(signedIn ? "/home" : "/")}>
            <ArrowLeft size={16} aria-hidden="true" />TAKE
          </button>
        </nav>

        <header className="hiw-hero">
          <PaperLabel size="sm" tilt={-3} className="ls-kicker">how TAKE works</PaperLabel>
          <h1 className="ls-strip">
            <Sticker tilt={-2} as="span" className="ls-strip__line ls-strip__line--paper"><span>You have one TAKE.</span></Sticker>
            <Sticker tilt={1.5} delay={80} as="span" className="ls-strip__line ls-strip__line--ink"><span>Who deserves it?</span></Sticker>
          </h1>
          <div className="hiw-graph" role="img" aria-label="Kubo gives their TAKE to Sarah for a creator program spot: person to person to opportunity">
            <Name tilt={-5}>Kubo</Name>
            <PassArrow className="hiw-graph__arrow" />
            <Name tilt={4} tone="lime">Sarah</Name>
            <PassArrow className="hiw-graph__arrow" />
            <div className="hiw-graph__ticket"><CampaignSticker campaign={{ title: "Creator program", spots: 5 }} tilt={-4} size="lg" /></div>
          </div>
          <PaperLabel size="md" tilt={1} className="ls-note">person → person → opportunity. That edge, recorded on Monad, is the thing TAKE is built around.</PaperLabel>
        </header>

        <ol className="hiw-beats">
          <Beat n={1} tilt={-1.2} kicker="the problem" title="Scarce spots get handed out badly.">
            <p>Grants, whitelist spots, beta seats, creator programs, tickets. Usually judged in private, farmed for engagement, first-come-first-served, or won by whoever already has the most attention.</p>
          </Beat>
          <Beat n={2} tilt={1} kicker="who decides what" title="The organization decides the rules. The community decides the people.">
            <p>The organizer sets what’s given, how many spots, who can give, who can receive, and when it starts and ends. The people on the giver list choose who gets it.</p>
          </Beat>
          <Beat n={3} tilt={-0.8} kicker="the TAKE" title="One TAKE each. Never yourself."
            art={<div className="hiw-beat__pass" aria-hidden="true"><MascotSticker kind="lime" tilt={-6} className="ls-step__mascot" /><PassArrow className="ls-step__arrow" /><MascotSticker kind="star" tilt={8} className="ls-step__mascot" /></div>}>
            <p>Every eligible giver gets exactly one TAKE and must give it to someone else on the recipient list. No points to farm, no buying extra votes, no self-claiming.</p>
          </Beat>
          <Beat n={4} tilt={1.3} kicker="eligibility ≠ power" title="Reach doesn’t add votes.">
            <p>Eligibility asks “does this person meet the campaign’s rules?” (join link, member list, X account age, allowlists, Discord roles when configured). Once two people are eligible, both get one TAKE. 100k followers = 1 TAKE. 12 followers = 1 TAKE.</p>
          </Beat>
          <Beat n={5} tilt={-1} kicker="locked first" title="Rules are locked onchain before anyone gives.">
            <p>When sign-ups close, TAKE locks the giver and recipient lists and writes the rules hash to the TakeCampaignManager contract on Monad (<code>createCampaign</code>), then opens nominations (<code>activateCampaign</code>). Anyone can rebuild the hash from the public artifact with <code>pnpm verify:rules</code>.</p>
          </Beat>
          <Beat n={6} tilt={0.9} kicker="giving is a transaction" title="giveTake → TakeGiven">
            <p>The giver’s wallet signs <code>giveTake</code> on Monad. The contract rejects a second TAKE, a TAKE to yourself, and anyone outside the locked lists. TAKE shows <b>TAKE GIVEN</b> only after the transaction confirms, the <code>TakeGiven</code> event is read, and it becomes a valid nomination edge.</p>
          </Beat>
          <Beat n={7} tilt={-1.1} kicker="the result" title="Close → allocate → finalize.">
            <p>After the end time a scheduled job closes the campaign, runs the locked allocation (one unit of support per valid giver), and commits the result hash on Monad (<code>finalizeAllocation</code>). The organizer can’t quietly change it afterwards.</p>
          </Beat>
          <Beat n={8} tilt={1} kicker="after the TAKE" title="Did the recommendation hold up?">
            <p>Before publishing, the team can lock one check for the opportunity type. It never changes who got a spot; it shows whether the people the community backed followed through.</p>
            <ul className="hiw-templates">
              <li><b>Builder grant</b> Did they ship? (repo / demo)</li>
              <li><b>Creator program</b> Did they publish N pieces?</li>
              <li><b>Whitelist / NFT</b> Still holding N days after mint? Checked automatically: TAKE reads <code>balanceOf</code> onchain.</li>
              <li><b>Beta access</b> Did they use it or give feedback?</li>
              <li><b>Event ticket</b> Did they attend?</li>
            </ul>
          </Beat>
          <Beat n={9} tilt={-0.9} kicker="what we don’t claim" title="Honest limits.">
            <ul className="hiw-limits">
              <li><b>Popularity.</b> Equal power doesn’t mean equal attention. Well-known people may still get more TAKEs.</li>
              <li><b>Sybil resistance.</b> Persistent identities make fake participation harder; they don’t prove one human = one account.</li>
              <li><b>Coordination.</b> Repeated reciprocal nominations and cycles are observed as evidence, not used to secretly change anyone’s TAKE.</li>
            </ul>
          </Beat>
        </ol>

        <EvidenceStack />

        <ProofSection id="hiw-proof" />

        <div className="hiw-cta">
          <Sticker tilt={-1} className="sticker-cta">
            <button className="sticker-pill landing-sky__primary" type="button" onClick={() => navigate(signedIn ? "/explore" : "/")}>
              <span>{signedIn ? "Explore campaigns" : "Try TAKE"}</span><ArrowRight aria-hidden="true" />
            </button>
          </Sticker>
        </div>
      </main>
    </div>
  );
}

const EVIDENCE = [
  "Join link / sign-ups",
  "Allowlists & member lists (X or wallet)",
  "X account age",
  "Monad wallet / onchain activity",
  "Discord join date & roles",
  "GitHub / building history",
  "Manual evidence review",
  "Newcomer path",
  "Appeals",
];
const INTEGRITY = ["Mutual TAKEs", "Short cycles", "Timing bursts", "Coalitions", "Timing sync across groups", "Cross-campaign coordination"];

/** Eligibility evidence as a sticker stack with the campaign's threshold line. */
function EvidenceStack() {
  return (
    <section className="hiw-elig" aria-labelledby="elig-heading">
      <PaperLabel size="sm" tilt={2} className="ls-kicker">eligibility & anti-gaming</PaperLabel>
      <h2 id="elig-heading" className="ls-strip">
        <Sticker tilt={-2} as="span" className="ls-strip__line ls-strip__line--paper"><span>Evidence opens the gate.</span></Sticker>
        <Sticker tilt={1.5} delay={80} as="span" className="ls-strip__line ls-strip__line--ink"><span>It never adds votes.</span></Sticker>
      </h2>
      <div className="hiw-stack" role="group" aria-label="Eligibility evidence stack">
        <p className="hiw-stack__intro">The evidence TAKE’s eligibility engine is built around. Each campaign picks what counts.</p>
        <ol className="hiw-stack__layers">
          {EVIDENCE.map((item, index) => (
            <Sticker as="li" key={item} tilt={[-1.5, 1, -0.6, 1.4, -1.1, 0.7, -1.3, 0.9, -0.5][index]!} className="hiw-layer">
              <span className="hiw-layer__row"><b>{item}</b></span>
            </Sticker>
          ))}
        </ol>
        <div className="hiw-threshold" aria-hidden="true"><span>campaign threshold</span></div>
        <div className="hiw-stack__result">
          <Sticker tilt={-3} as="span" className="hiw-name hiw-name--lime"><span>eligible = 1 TAKE</span></Sticker>
          <small>Same one TAKE whether you clear the line by a little or a lot. No evidence? TAKE shows <b>NO DATA</b>, not an invented score. Established history counts over activity created to farm.</small>
        </div>
      </div>

      <div className="hiw-integrity">
        <strong>Integrity is separate from eligibility and allocation.</strong>
        <p>Operators see these on the nomination graph to investigate. They never secretly change anyone’s TAKE.</p>
        <ul>{INTEGRITY.map((item) => <li key={item}>{item}</li>)}</ul>
        <PaperLabel size="md" tilt={-1} className="ls-note">Social closeness is context. Repeated advantageous coordination is evidence.</PaperLabel>
        <p>Rules and rosters are locked onchain before anyone gives. The contract blocks giving to yourself, giving twice, and givers who aren’t on the locked list.</p>
      </div>
    </section>
  );
}
