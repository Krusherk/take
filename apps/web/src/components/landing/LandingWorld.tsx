const howStepAlts = [
  "A community member carries a scarce opportunity into TAKE",
  "A community member celebrates receiving one TAKE to give forward",
  "One community member gives their TAKE to another person",
] as const;

const howStepAssets = [
  "/assets/take-mascot-carry-green.png",
  "/assets/take-mascot-cheer-yellow.png",
  "/assets/take-mascot-handoff-duo.png",
] as const;

interface HowStepArtProps {
  step: 0 | 1 | 2;
}

export function HowStepArt({ step }: HowStepArtProps) {
  return (
    <figure className={`landing-step-art landing-step-art--${step + 1}`}>
      <img src={howStepAssets[step]} alt={howStepAlts[step]} />
      {step === 1 ? <span className="landing-step-art__take" aria-hidden="true">1</span> : null}
    </figure>
  );
}

export function CommunityRoom() {
  return (
    <figure className="landing-community-scene">
      <img
        src="/assets/take-community-room-alpha.png"
        alt="A community of TAKE characters recognizing and lifting one person"
      />
      <figcaption className="landing-community-scene__selected">
        <span aria-hidden="true" />
        Selected by the room
      </figcaption>
      <small className="landing-community-scene__note">PEOPLE SEE PEOPLE</small>
    </figure>
  );
}

export function OpportunityObjects() {
  return (
    <div className="landing-opportunity-world" aria-label="Opportunities communities can allocate with TAKE">
      <div className="landing-opportunity-copy">
        <span className="landing-opportunity-copy__kicker">Illustrative campaigns</span>
        <p>Whatever is scarce, the gesture stays the same: choose someone else.</p>
      </div>

      <ul className="landing-opportunity-props">
        <li className="landing-prop landing-prop--spots">
          <strong>Whitelist spots</strong><span>100 community spots</span>
        </li>
        <li className="landing-prop landing-prop--grant">
          <strong>Creator grants</strong><span>10 grants · $500 each</span>
        </li>
        <li className="landing-prop landing-prop--access">
          <strong>Program access</strong><span>30 cohort places</span>
        </li>
        <li className="landing-prop landing-prop--ticket">
          <strong>Event tickets</strong><span>50 community tickets</span>
        </li>
        <li className="landing-prop landing-prop--scholarship">
          <strong>Scholarships</strong><span>5 awards</span>
        </li>
        <li className="landing-prop landing-prop--product">
          <strong>Limited products</strong><span>25 editions</span>
        </li>
        <li className="landing-prop landing-prop--beta">
          <strong>Beta access</strong><span>100 early spots</span>
        </li>
        <li className="landing-prop landing-prop--game">
          <strong>Game items</strong><span>50 access items</span>
        </li>
        <li className="landing-prop landing-prop--rewards">
          <strong>Community rewards</strong><span>20 contributor rewards</span>
        </li>
      </ul>

      <figure className="landing-opportunity-mascot" aria-hidden="true">
        <img src="/assets/take-mascot-carry-green.png" alt="" />
      </figure>
    </div>
  );
}

export function FooterHandoff() {
  return (
    <figure className="landing-footer-handoff" aria-hidden="true">
      <img src="/assets/take-mascot-handoff-duo.png" alt="" />
      <span>PASS IT FORWARD</span>
      <i />
    </figure>
  );
}
