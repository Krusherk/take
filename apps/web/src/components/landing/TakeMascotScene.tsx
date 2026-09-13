import { MousePointer2 } from "lucide-react";

const avatarColors = ["coral", "mint", "blue", "lavender", "yellow"] as const;

export function TakeMascotScene() {
  return (
    <div className="mascot-scene" aria-label="A TAKE community lifts and celebrates a selected member">
      <div className="mascot-scene__spotlight" aria-hidden="true" />
      <span className="mascot-spark mascot-spark--one" aria-hidden="true">✦</span>
      <span className="mascot-spark mascot-spark--two" aria-hidden="true">✦</span>

      <img
        className="mascot-scene__art"
        src="/assets/take-mascot-community.png"
        alt="Colorful TAKE characters passing an opportunity forward and lifting the selected person"
        width="1448"
        height="1086"
      />

      <div className="mascot-product mascot-product--selected">Selected</div>

      <div className="mascot-product mascot-product--nominate">
        <strong>Nominate</strong>
        <MousePointer2 className="mascot-product__cursor" size={46} fill="currentColor" aria-hidden="true" />
      </div>

      <div className="mascot-product mascot-product--spots">
        <div><strong>100</strong><span>spots</span></div>
        <div className="mascot-participants" aria-label="Community participants">
          {avatarColors.map((color) => (
            <span key={color} className={`mascot-avatar mascot-avatar--${color}`} aria-hidden="true"><i /><i /></span>
          ))}
          <span className="mascot-participants__more">+3</span>
        </div>
      </div>

      <div className="mascot-product mascot-product--support">You got this!</div>
    </div>
  );
}
