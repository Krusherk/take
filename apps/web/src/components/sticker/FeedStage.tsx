import type { ReactNode } from "react";
import { MascotSticker, PaperLabel, Sticker } from "./Sticker";

/**
 * The sticker header shared by Notifications, Your Takes, and Activity:
 * a lime tag, a mascot, the page line on torn paper, and an optional action.
 */
export function FeedStage({ tag, title, lead, mascot, titleId, children }: {
  tag: string;
  title: string;
  lead?: string;
  mascot: "lime" | "star";
  titleId: string;
  children?: ReactNode;
}) {
  return (
    <section className="sticker-feed__stage" aria-labelledby={titleId}>
      <Sticker tilt={4} className="feed-tag"><span>{tag}</span></Sticker>
      <MascotSticker kind={mascot} tilt={mascot === "star" ? -10 : 8} delay={240} className={`sticker-feed__mascot sticker-feed__mascot--${mascot}`} />
      <div className="sticker-feed__headline">
        <h1 id={titleId}><PaperLabel size="lg" tilt={-2} delay={60}>{title}</PaperLabel></h1>
        {lead ? <PaperLabel size="sm" tilt={1.5} delay={120}>{lead}</PaperLabel> : null}
      </div>
      {children}
    </section>
  );
}
