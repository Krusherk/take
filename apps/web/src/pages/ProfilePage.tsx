import { Home, Link2, LogOut } from "lucide-react";
import { useState } from "react";
import { Avatar } from "../components/Avatar";
import { IdentityConnections } from "../components/IdentityConnections";
import { SocialEmpty } from "../components/ProductState";
import { ProfileSignal } from "../components/Signal";
import { ActivityRow } from "../components/Social";
import { MascotSticker, PaperLabel, Sticker } from "../components/sticker/Sticker";
import { useTakeMe } from "../context/TakeIdentityContext";
import type { TakePath } from "../hooks/usePathRouter";
import { activityFromHistory, personFromMe } from "../lib/currentIdentity";

type HistoryFilter = "ALL" | "GIVEN" | "RECEIVED";

export function ProfilePage({ navigate, onLogout }: { navigate: (path: TakePath) => void; onLogout: () => Promise<void> }) {
  const { me, history } = useTakeMe();
  const [filter, setFilter] = useState<HistoryFilter>("ALL");
  const [loggingOut, setLoggingOut] = useState(false);
  if (!me || !history) return null;

  const person = personFromMe(me);
  const allActivity = activityFromHistory(me, history);
  const visibleActivity = allActivity.filter((item) => filter === "ALL" || item.kind === filter.toLowerCase());
  const campaignCount = new Set([...history.given, ...history.received].map((entry) => entry.campaignId)).size;
  const subline = [person.handle, `joined ${formatJoined(me.user.joinedAt)}`].filter(Boolean).join(" · ");

  const stats = [
    { label: "given", value: me.takes.given },
    { label: "received", value: me.takes.received },
    { label: campaignCount === 1 ? "campaign" : "campaigns", value: campaignCount },
  ];

  async function signOut() {
    setLoggingOut(true);
    try { await onLogout(); } finally { setLoggingOut(false); }
  }

  return (
    <div className="page-container sticker-page sticker-feed profile-sticker">
      <section className="sticker-feed__stage profile-sticker__stage" aria-labelledby="profile-title">
        <Sticker tilt={4} className="feed-tag"><span>YOUR PROFILE</span></Sticker>
        <MascotSticker kind="star" tilt={-10} delay={240} className="sticker-feed__mascot sticker-feed__mascot--star" />
        <Sticker tilt={-4} delay={40} className="profile-sticker__avatar"><Avatar person={person} size="xl" /></Sticker>
        <div className="sticker-feed__headline profile-sticker__headline">
          <h1 id="profile-title"><PaperLabel size="lg" tilt={-2} delay={60}>{person.name}</PaperLabel></h1>
          <PaperLabel size="sm" tilt={1.5} delay={120}>{subline}</PaperLabel>
        </div>
        <ul className="profile-sticker__stats" aria-label="Your TAKE counts">
          {stats.map((stat, index) => (
            <Sticker as="li" key={stat.label} tilt={[-3, 2, -1.5][index]!} delay={160 + index * 60} className="profile-sticker__stat">
              <strong>{stat.value.toLocaleString("en-US")}</strong><span>{stat.label}</span>
            </Sticker>
          ))}
        </ul>
      </section>

      <Sticker tilt={-0.6} delay={260} className="profile-sticker__card">
        <IdentityConnections me={me} />
      </Sticker>

      <Sticker tilt={0.5} delay={300} className="profile-sticker__card">
        <ProfileSignal navigate={navigate} />
      </Sticker>

      <section className="sticker-feed__list profile-sticker__history" aria-labelledby="profile-history-title">
        <h2 id="profile-history-title" className="sticker-feed__heading"><PaperLabel size="sm" tilt={-2}>Given and received</PaperLabel></h2>
        <div className="sticker-feed__tools">
          <div className="sticker-filters" role="group" aria-label="Filter TAKE history">
            {(["ALL", "GIVEN", "RECEIVED"] as const).map((item) => <button key={item} type="button" className={filter === item ? "is-active" : undefined} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}
          </div>
        </div>
        {visibleActivity.length ? (
          <ol>
            {visibleActivity.map((item, index) => (
              <Sticker as="li" key={`${item.id}:${item.kind}`} tilt={index % 2 ? 0.6 : -0.6} delay={Math.min(460, 300 + index * 40)} className="sticker-feed__item">
                <ActivityRow item={item} detailed onCampaign={(id) => navigate(`/campaign/${id}`)} />
              </Sticker>
            ))}
          </ol>
        ) : (
          <SocialEmpty title={filter === "ALL" ? "No TAKE history yet." : `No TAKES ${filter.toLowerCase()} yet.`} action="EXPLORE CAMPAIGNS" onAction={() => navigate("/explore")}>When you give or receive a TAKE, the person and campaign show up here.</SocialEmpty>
        )}
      </section>

      <section className="profile-sticker__account" id="profile-account" aria-label="Account">
        <button className="sticker-pill sticker-pill--paper sticker-pill--sm" type="button" onClick={() => document.getElementById("identity-connections")?.scrollIntoView({ behavior: "smooth" })}><Link2 size={16} aria-hidden="true" />Connections</button>
        <button className="sticker-pill sticker-pill--paper sticker-pill--sm" type="button" onClick={() => navigate("/home")}><Home size={16} aria-hidden="true" />Home</button>
        <button className="sticker-pill sticker-pill--sm profile-sticker__logout" type="button" disabled={loggingOut} onClick={() => void signOut()}><LogOut size={16} aria-hidden="true" />{loggingOut ? "Logging out…" : "Log out"}</button>
      </section>
    </div>
  );
}

function formatJoined(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TAKE";
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(date);
}
