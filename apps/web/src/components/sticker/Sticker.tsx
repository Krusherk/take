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

const TICKET_ART = "/assets/sticker/ticket-blank.webp";

/** The words printed on a ticket: a big count, a unit, and the TAKE badge. */
export interface TicketFace {
  count: string;
  unit: string;
  badge?: string | null;
}

/** Real spot and TAKE counts for a campaign, printed on its ticket. */
export function ticketFace(campaign: Partial<Pick<Campaign, "spots" | "nominationLimit">>): TicketFace {
  const spots = campaign.spots ?? 0;
  const takes = campaign.nominationLimit ?? 1;
  const badge = `${takes.toLocaleString("en-US")} ${takes === 1 ? "TAKE" : "TAKES"}`;
  if (!spots) return { count: "1", unit: "OPPORTUNITY", badge };
  return { count: spots.toLocaleString("en-US"), unit: spots === 1 ? "SPOT" : "SPOTS", badge };
}

/**
 * Campaign artwork: a generated blank ticket sticker with the campaign's real
 * spot count and TAKE count printed on it as text.
 */
export function CampaignSticker({ campaign, face, tilt = -4, delay = 0, size = "lg" }: {
  campaign: Pick<Campaign, "title"> & Partial<Pick<Campaign, "spots" | "nominationLimit">>;
  face?: TicketFace;
  tilt?: number;
  delay?: number;
  size?: "sm" | "lg";
}) {
  const printed = face ?? ticketFace(campaign);
  const label = `${campaign.title} ticket: ${printed.count} ${printed.unit.toLowerCase()}${printed.badge ? `, ${printed.badge.toLowerCase()}` : ""}`;
  return (
    <Sticker tilt={tilt} delay={delay} className={`campaign-sticker campaign-sticker--${size}`}>
      <span className="campaign-sticker__face">
        <img src={TICKET_ART} alt={label} width={760} height={516} decoding="async" draggable={false} />
        <span className="campaign-sticker__print" aria-hidden="true" style={{ "--count-chars": printed.count.length } as CSSProperties}>
          <span className="campaign-sticker__count">{printed.count}</span>
          <span className="campaign-sticker__unit">{printed.unit}</span>
        </span>
        <span className={`campaign-sticker__badge${printed.badge ? "" : " campaign-sticker__badge--mark"}`} aria-hidden="true">{(printed.badge ?? "TAKE").split(" ").map((part) => <span key={part}>{part}</span>)}</span>
      </span>
    </Sticker>
  );
}

const MASCOTS = {
  lime: { src: "/assets/sticker/mascot-lime.webp", width: 420, height: 463 },
  star: { src: "/assets/sticker/mascot-star.webp", width: 420, height: 417 },
} as const;

/**
 * A decorative TAKE mascot. Hidden from assistive tech and never tappable,
 * so it can never be the only place a fact is shown.
 */
export function MascotSticker({ kind, tilt = 0, delay = 0, className = "" }: {
  kind: keyof typeof MASCOTS;
  tilt?: number;
  delay?: number;
  className?: string;
}) {
  const art = MASCOTS[kind];
  return (
    <Sticker tilt={tilt} delay={delay} as="span" className={`mascot-sticker mascot-sticker--${kind} ${className}`.trim()}>
      <img src={art.src} alt="" aria-hidden="true" width={art.width} height={art.height} decoding="async" draggable={false} />
    </Sticker>
  );
}
