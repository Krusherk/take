import { ArrowRight } from "lucide-react";
import { CommunityRoom, FooterHandoff, HowStepArt, OpportunityObjects } from "./LandingWorld";

interface LandingProductSectionsProps {
  onStartCampaign: () => void;
  onExplore: () => void;
}

const principles = [
  ["One eligible person = one TAKE", "Follower count, wallet balance, and reach do not multiply a participant’s choice."],
  ["No self-claiming", "Your TAKE must go to another person."],
  ["Rules before results", "Eligibility and campaign rules are published before participation."],
  ["Social first", "People appear as identities, names, avatars, and communities — not raw wallet addresses."],
  ["Verifiable underneath", "Campaign commitments and outcomes can be audited without making crypto the interface."],
] as const;

export function LandingProductSections({ onStartCampaign, onExplore }: LandingProductSectionsProps) {
  return (
    <>
      <section className="landing-section landing-problem" aria-labelledby="problem-heading">
        <span className="landing-section__label">The problem</span>
        <div className="landing-section__heading landing-problem__heading">
          <h2 id="problem-heading">Opportunities shouldn’t always go to the loudest person in the room.</h2>
          <p>Grants, whitelist spots, event tickets, creator programs and community opportunities often reach people who are already visible, already connected, or simply arrived first.</p>
        </div>
        <div className="landing-choice-contrast">
          <div className="landing-choice-contrast__usual">
            <span>WHO USUALLY GETS PICKED</span>
            <ul><li>Influencers</li><li>Insiders</li><li>Fastest click</li><li>Largest audience</li></ul>
          </div>
          <div className="landing-choice-contrast__turn" aria-hidden="true"><i /><strong>OR</strong><i /></div>
          <div className="landing-choice-contrast__take">
            <span>WITH TAKE</span>
            <strong>Someone another person chose.</strong>
            <p>TAKE gives the community a different way to decide.</p>
            <img src="/assets/take-mascot-signal-blue.png" alt="" />
          </div>
        </div>
      </section>

      <section id="how-it-works" className="landing-section landing-how" aria-labelledby="how-heading">
        <span className="landing-section__label">How TAKE works</span>
        <div className="landing-section__heading">
          <h2 id="how-heading">One TAKE.<br />One other person.</h2>
          <p>The organizer sets the rules. Every eligible participant gets one choice they can only use for somebody else.</p>
        </div>
        <ol className="landing-steps">
          <li><HowStepArt step={0} /><span>01</span><strong>Put up the opportunity.</strong><p>The organizer defines the resource, number of recipients, eligibility, and campaign rules.</p></li>
          <li><HowStepArt step={1} /><span>02</span><strong>Everyone eligible gets one TAKE.</strong><p>Exactly one per campaign. You cannot use it on yourself.</p></li>
          <li><HowStepArt step={2} /><span>03</span><strong>The community chooses.</strong><p>People nominate people. TAKE applies the published rules to produce an auditable allocation.</p></li>
        </ol>
      </section>

      <div className="landing-pass-strip" aria-hidden="true"><div>
        <span>ONE ELIGIBLE PERSON</span><i /><span>ONE TAKE</span><i /><span>ONE OTHER PERSON</span><i />
        <span>ONE ELIGIBLE PERSON</span><i /><span>ONE TAKE</span><i /><span>ONE OTHER PERSON</span><i />
      </div></div>

      <section className="landing-community-band" aria-labelledby="community-heading">
        <div className="landing-section landing-community">
          <div className="landing-community__copy">
            <span className="landing-section__label">The product rule</span>
            <h2 id="community-heading">The organization sets the rules. The community chooses the people.</h2>
            <p>TAKE does not claim to know who objectively deserves an opportunity. It gives a community an equal way to express who they believe should receive it.</p>
            <small>PEOPLE CHOOSING PEOPLE</small>
          </div>
          <CommunityRoom />
        </div>
      </section>

      <section id="use-cases" className="landing-section landing-use-cases" aria-labelledby="uses-heading">
        <span className="landing-section__label">Use cases</span>
        <div className="landing-use-cases__content">
          <h2 id="uses-heading">What can a community give?</h2>
          <OpportunityObjects />
        </div>
      </section>

      <section id="why-take" className="landing-section landing-why" aria-labelledby="why-heading">
        <span className="landing-section__label">Why TAKE</span>
        <div className="landing-why__lead">
          <h2 id="why-heading">Not another popularity vote.</h2>
          <p>TAKE does not pretend popularity disappears. It makes sure visibility, wealth, follower count, and wallet balance do not give a participant more nomination power.</p>
        </div>
        <strong className="landing-why__statement">Your reach doesn’t make your TAKE worth more.</strong>
        <div className="landing-principles">
          {principles.map(([title, copy], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{copy}</p></article>)}
        </div>
      </section>

      <section className="landing-trust-band" aria-labelledby="trust-heading">
        <div className="landing-section landing-trust">
          <div className="landing-trust__lead">
            <span className="landing-section__label">Built to be harder to game</span>
            <h2 id="trust-heading">When something has value, people will try to game it.</h2>
            <p>TAKE keeps identity and eligibility, behavior, and allocation separate. Campaign rules can be locked before participation begins.</p>
          </div>
          <div className="landing-trust__layers" aria-label="TAKE trust layers">
            <article><span>01</span><strong>Identity / eligibility</strong><p>Who is allowed to participate?</p></article>
            <article><span>02</span><strong>Behavior</strong><p>Are nominations repeatedly coordinated or manipulated?</p></article>
            <article><span>03</span><strong>Allocation</strong><p>How do valid nominations become final recipients?</p></article>
          </div>
          <div className="landing-trust__truth">
            <img src="/assets/take-mascot-selected-purple.png" alt="" />
            <div><strong>Being part of the same community isn’t fraud.</strong><p>As TAKE’s history grows, repeated reciprocity, rings, and coordinated behavior can create evidence for review. Genuine relationships do not secretly turn one TAKE into a fraction.</p></div>
          </div>
        </div>
      </section>

      <section className="landing-section landing-sides" aria-label="TAKE for organizers and participants">
        <article className="landing-side landing-side--organizer">
          <span className="landing-section__label">For organizers</span>
          <h2>You set the opportunity. The community helps choose the people.</h2>
          <p>Define the resource, number of recipients, eligibility, cutoff, and allocation rules. Then invite the community to participate.</p>
          <button className="landing-cta landing-cta--primary" type="button" onClick={onStartCampaign}><span>Start a campaign</span><ArrowRight aria-hidden="true" /></button>
          <img src="/assets/take-mascot-carry-green.png" alt="" />
        </article>
        <article className="landing-side landing-side--participant">
          <span className="landing-section__label">For participants</span>
          <h2>You have one TAKE. Who deserves it?</h2>
          <p>You do not claim a spot. You choose someone else. They do not need to have joined TAKE before they can be seen.</p>
          <button className="landing-cta landing-cta--secondary" type="button" onClick={onExplore}><span>Explore campaigns</span><ArrowRight aria-hidden="true" /></button>
          <img src="/assets/take-mascot-selected-purple.png" alt="" />
        </article>
      </section>

      <section id="about" className="landing-vision-band" aria-labelledby="vision-heading">
        <div className="landing-section landing-vision">
          <span className="landing-section__label">The long view</span>
          <h2 id="vision-heading">People <i>→</i> people <i>→</i> opportunities.</h2>
          <div className="landing-vision__body"><p>Likes show attention. Follows show interest. TAKE shows who someone chose when they had one scarce opportunity to give.</p><p>Over time, TAKE can become a social allocation graph around real opportunities — not a public reputation score.</p></div>
          <figure><img src="/assets/take-mascot-handoff-duo.png" alt="Two TAKE community members passing one TAKE forward" /></figure>
          <div className="landing-about">
            <span>ABOUT TAKE</span>
            <p>TAKE began with a simple question: why do scarce opportunities so often reach people who already have the most visibility?</p>
            <p>We are testing a different model built around people choosing people, while researching popularity, Sybils, and coordination without punishing genuine communities.</p>
          </div>
        </div>
      </section>

      <footer className="landing-footer landing-footer--final">
        <div className="landing-footer__wordmark" aria-hidden="true">TAKE<span>.</span></div>
        <div className="landing-footer__copy">
          <span className="landing-section__label">One choice. Give it forward.</span>
          <h2>Who would you give your TAKE to?</h2>
          <p>Create an opportunity. Give the community one choice. See who they choose.</p>
          <div className="landing-footer__actions"><button type="button" onClick={onStartCampaign}>Start a campaign <ArrowRight size={18} aria-hidden="true" /></button><button className="is-secondary" type="button" onClick={onExplore}>Explore campaigns</button></div>
        </div>
        <FooterHandoff />
      </footer>
    </>
  );
}
