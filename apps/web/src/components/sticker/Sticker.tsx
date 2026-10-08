import type { CSSProperties, ReactNode } from "react";
import type { Campaign, Person } from "../../types/product";
import { Avatar } from "../Avatar";

type StickerStyle = CSSProperties & { "--tilt"?: string; "--delay"?: string };

/**
 * A die-cut sticker that settles into place. The settle animation only touches
 * transform and opacity, so the sticker stays tappable the whole time.
 */
export function Sticker({ children, tilt = 0, delay = 0, className = "", as: Tag = "div" }: {
  children: ReactNode;
  tilt?: number;
  delay?: number;
  className?: string;
  as?: "div" | "span" | "li";
}) {
  const style: StickerStyle = { "--tilt": `${tilt}deg`, "--delay": `${delay}ms` };
  return <Tag className={`sticker ${className}`.trim()} style={style}>{children}</Tag>;
}

/** A torn strip of paper with label-maker text. */
export function PaperLabel({ children, tilt = 0, delay = 0, size = "md", className = "" }: {
  children: ReactNode;
  tilt?: number;
  delay?: number;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <Sticker tilt={tilt} delay={delay} as="span" className={`paper-label paper-label--${size} ${className}`.trim()}>
      <span className="paper-label__paper">{children}</span>
    </Sticker>
  );
}

/** A small die-cut status sticker. LIVE is the one lime sticker on the page. */
export function StatusSticker({ status, tilt = -6, delay = 0 }: { status: Campaign["status"]; tilt?: number; delay?: number }) {
  return (
    <Sticker tilt={tilt} delay={delay} as="span" className={`status-sticker status-sticker--${status.toLowerCase()}`}>
      <span>{status}</span>
    </Sticker>
  );
}

/** Chunky hand-cut arrow used for "someone → someone". */
export function PassArrow({ className = "" }: { className?: string }) {
  return (
    <svg className={`pass-arrow ${className}`.trim()} viewBox="0 0 96 64" aria-hidden="true" focusable="false">
      <path
        d="M6 26.5c10-.8 24-1.4 38-1.2l.6-14.6c.1-3 3.5-4.5 5.8-2.6l36.4 21.6c2.2 1.4 2.2 4.6 0 6L50.6 57.6c-2.4 1.8-5.8.2-5.8-2.8l-.3-14.1c-13.7.4-27.6.9-38 1.6-3 .2-5.4-2.2-5.4-5.2v-5.4c0-2.7 2.1-5 4.9-5.2Z"
        fill="#ffffff"
        stroke="#ffffff"
        strokeWidth="9"
        strokeLinejoin="round"
      />
      <path
        d="M6 26.5c10-.8 24-1.4 38-1.2l.6-14.6c.1-3 3.5-4.5 5.8-2.6l36.4 21.6c2.2 1.4 2.2 4.6 0 6L50.6 57.6c-2.4 1.8-5.8.2-5.8-2.8l-.3-14.1c-13.7.4-27.6.9-38 1.6-3 .2-5.4-2.2-5.4-5.2v-5.4c0-2.7 2.1-5 4.9-5.2Z"
        fill="#11110f"
      />
    </svg>
  );
}

/** A real person's existing avatar, cut out as a round sticker with a name label. */
export function FaceSticker({ person, label, sublabel, tilt = 0, delay = 0, size = "lg" }: {
  person: Person;
  label?: string;
  sublabel?: string;
  tilt?: number;
  delay?: number;
  size?: "sm" | "lg";
}) {
  return (
    <div className={`face-sticker face-sticker--${size}`}>
      <Sticker tilt={tilt} delay={delay} className="face-sticker__cut">
        <Avatar person={person} size={size === "lg" ? "hero" : "md"} />
      </Sticker>
      {label ? <PaperLabel size={size === "lg" ? "md" : "xs"} tilt={-tilt / 2 - 1.5} delay={delay + 70}>{label}</PaperLabel> : null}
      {sublabel ? <PaperLabel size="xs" tilt={tilt / 2 + 1} delay={delay + 120} className="face-sticker__sub">{sublabel}</PaperLabel> : null}
    </div>
  );
}

/** An empty slot that is honest about not having a person yet. Not a face. */
export function EmptySlotSticker({ label, tilt = 0, delay = 0, size = "lg" }: { label?: string; tilt?: number; delay?: number; size?: "sm" | "lg" }) {
  return (
    <div className={`face-sticker face-sticker--${size}`}>
      <Sticker tilt={tilt} delay={delay} className="face-sticker__cut face-sticker__cut--empty">
        <span aria-hidden="true">?</span>
      </Sticker>
      {label ? <PaperLabel size={size === "lg" ? "md" : "xs"} tilt={1.5} delay={delay + 70}>{label}</PaperLabel> : null}
    </div>
  );
}

const palettes: Record<Campaign["visual"], { sky: string; ink: string; ticket: string; ray: string }> = {
  violet: { sky: "#8f86ff", ink: "#221c5c", ticket: "#fffdf6", ray: "#b4adff" },
  cyan: { sky: "#59c7d3", ink: "#123a3f", ticket: "#fffdf6", ray: "#8fdde5" },
  coral: { sky: "#ff8d73", ink: "#4a2219", ticket: "#fffdf6", ray: "#ffb39f" },
};

/**
 * Original campaign artwork for campaigns without an image: a ticket for the
 * opportunity, the organizer's mark, and the single TAKE token.
 */
export function CampaignSticker({ campaign, tilt = -4, delay = 0, size = "lg" }: {
  campaign: Pick<Campaign, "visual" | "organizerMark" | "spots" | "resourceName" | "title">;
  tilt?: number;
  delay?: number;
  size?: "sm" | "lg";
}) {
  const palette = palettes[campaign.visual] ?? palettes.coral;
  const spots = campaign.spots > 0 ? campaign.spots.toLocaleString("en-US") : "?";
  const unit = campaign.spots === 1 ? "SPOT" : "SPOTS";
  return (
    <Sticker tilt={tilt} delay={delay} className={`campaign-sticker campaign-sticker--${size}`}>
      <svg viewBox="0 0 320 220" role="img" aria-label={`${campaign.title} artwork`} focusable="false">
        <rect width="320" height="220" rx="16" fill={palette.sky} />
        <g stroke={palette.ray} strokeWidth="14" strokeLinecap="round" opacity=".75">
          <path d="M160 110 L20 -20" /><path d="M160 110 L160 -40" /><path d="M160 110 L300 -20" />
          <path d="M160 110 L340 110" /><path d="M160 110 L300 240" /><path d="M160 110 L20 240" /><path d="M160 110 L-20 110" />
        </g>
        <g transform="rotate(-7 160 112)">
          <path
            d="M74 62h172a10 10 0 0 1 10 10v20a18 18 0 0 0 0 36v20a10 10 0 0 1-10 10H74a10 10 0 0 1-10-10v-20a18 18 0 0 0 0-36V72a10 10 0 0 1 10-10Z"
            fill={palette.ticket}
            stroke={palette.ink}
            strokeWidth="4"
          />
          <path d="M196 70v80" stroke={palette.ink} strokeWidth="3" strokeDasharray="6 7" />
          <text x="130" y="122" textAnchor="middle" fill={palette.ink} fontFamily="Inter Tight, Inter, sans-serif" fontSize="52" fontWeight="900" letterSpacing="-2">{spots}</text>
          <text x="130" y="144" textAnchor="middle" fill={palette.ink} fontFamily="IBM Plex Mono, monospace" fontSize="13" fontWeight="500" letterSpacing="2">{unit}</text>
          <circle cx="226" cy="110" r="19" fill={palette.ink} />
          <text x="226" y="117" textAnchor="middle" fill={palette.ticket} fontFamily="Inter Tight, Inter, sans-serif" fontSize="20" fontWeight="800">{campaign.organizerMark}</text>
        </g>
        <g transform="translate(276 44) rotate(12)">
          <circle r="27" fill="#c6ff31" stroke="#11110f" strokeWidth="4" />
          <text y="-2" textAnchor="middle" fill="#11110f" fontFamily="Inter Tight, Inter, sans-serif" fontSize="17" fontWeight="900">1</text>
          <text y="13" textAnchor="middle" fill="#11110f" fontFamily="IBM Plex Mono, monospace" fontSize="9" fontWeight="500" letterSpacing="1">TAKE</text>
        </g>
      </svg>
    </Sticker>
  );
}
