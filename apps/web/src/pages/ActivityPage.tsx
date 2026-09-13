import { useState } from "react";
import { SocialEmpty } from "../components/ProductState";
import { ActivityRow } from "../components/Social";
import { TakeMascotAccent } from "../components/TakeMascotAccent";
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
    <div className="page-container activity-page">
      <header className="page-intro compact-intro">
        <div><span className="eyebrow">ACTIVITY</span><h1>Your choices, with the people attached.</h1></div>
        <p>This is your confirmed TAKE history. Wallet details stay out of the way until you ask for them.</p>
        <TakeMascotAccent character="blue" className="mascot-intro mascot-intro--activity" />
      </header>

      <div className="activity-toolbar" role="group" aria-label="Filter activity">
        {(["ALL", "GIVEN", "RECEIVED"] as const).map((item) => <button key={item} type="button" className={filter === item ? "is-active" : undefined} onClick={() => setFilter(item)}>{item}</button>)}
        <span>{visible.length} {visible.length === 1 ? "CHOICE" : "CHOICES"}</span>
      </div>

      <section className="activity-feed activity-feed--social" aria-label="Your TAKE activity">
        {visible.length ? visible.map((item) => <ActivityRow key={`${item.id}:${item.kind}`} item={item} detailed onCampaign={(id) => navigate(`/campaign/${id}`)} />) : (
          <SocialEmpty title={filter === "ALL" ? "Your history starts with one choice." : `No TAKES ${filter.toLowerCase()} yet.`} action="EXPLORE CAMPAIGNS" onAction={() => navigate("/explore")}>Give a TAKE or be chosen and the person-to-person story will appear here.</SocialEmpty>
        )}
      </section>
    </div>
  );
}
