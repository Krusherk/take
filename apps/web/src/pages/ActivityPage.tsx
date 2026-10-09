import { useState } from "react";
import { SocialEmpty } from "../components/ProductState";
import { ActivityRow } from "../components/Social";
import { FeedStage } from "../components/sticker/FeedStage";
import { Sticker } from "../components/sticker/Sticker";
import { useTakeMe } from "../context/TakeIdentityContext";
import type { TakePath } from "../hooks/usePathRouter";
import { activityFromHistory } from "../lib/currentIdentity";

type ActivityFilter = "ALL" | "GIVEN" | "RECEIVED";

export function ActivityPage({ navigate }: { navigate: (path: TakePath) => void }) {
  const { me, history } = useTakeMe();
  const [filter, setFilter] = useState<ActivityFilter>("ALL");
  if (!me || !history) return null;
  const activity = activityFromHistory(me, history);
  const visible = activity.filter((item) => filter === "ALL" || item.kind === filter.toLowerCase());

  return (
    <div className="page-container sticker-page sticker-feed activity-page">
      <FeedStage tag="ACTIVITY" title="Your choices, with the people attached." lead="This is your confirmed TAKE history. Wallet details stay out of the way until you ask for them." mascot="star" titleId="activity-title" />

      <div className="sticker-feed__tools">
        <div className="sticker-filters" role="group" aria-label="Filter activity">
          {(["ALL", "GIVEN", "RECEIVED"] as const).map((item) => <button key={item} type="button" className={filter === item ? "is-active" : undefined} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}
        </div>
        <span className="sticker-feed__count">{visible.length} {visible.length === 1 ? "CHOICE" : "CHOICES"}</span>
      </div>

      <section className="sticker-feed__list activity-feed--social" aria-label="Your TAKE activity">
        {visible.length ? (
          <ol>
            {visible.map((item, index) => (
              <Sticker as="li" key={`${item.id}:${item.kind}`} tilt={index % 2 ? 0.6 : -0.6} delay={Math.min(420, 200 + index * 40)} className="sticker-feed__item">
                <ActivityRow item={item} detailed onCampaign={(id) => navigate(`/campaign/${id}`)} />
              </Sticker>
            ))}
          </ol>
        ) : (
          <SocialEmpty title={filter === "ALL" ? "Your history starts with one choice." : `No TAKES ${filter.toLowerCase()} yet.`} action="EXPLORE CAMPAIGNS" onAction={() => navigate("/explore")}>Give a TAKE or be chosen and the person-to-person story will appear here.</SocialEmpty>
        )}
      </section>
    </div>
  );
}
