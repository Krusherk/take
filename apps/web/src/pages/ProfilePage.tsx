import { Link2, LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { Avatar } from "../components/Avatar";
import { IdentityConnections } from "../components/IdentityConnections";
import { SocialEmpty } from "../components/ProductState";
import { ActivityRow } from "../components/Social";
import { TakeMascotAccent } from "../components/TakeMascotAccent";
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
  const identitySource = me.socials.twitter.connected ? "X CONNECTED" : "TAKE MEMBER";

  const stats = [
    { label: "TAKES GIVEN", value: me.takes.given },
    { label: "TAKES RECEIVED", value: me.takes.received },
    { label: "CAMPAIGNS", value: campaignCount },
  ];

  async function signOut() {
    setLoggingOut(true);
    try { await onLogout(); } finally { setLoggingOut(false); }
  }

  return (
    <div className="page-container profile-page">
      <header className="profile-hero">
        <TakeMascotAccent character="green" />
        <div className="profile-hero__portrait"><Avatar person={person} size="xl" /><span><i />{identitySource}</span></div>
        <div className="profile-hero__identity">
          <span className="eyebrow">YOUR PROFILE</span>
          <h1>{person.name}</h1>
          {person.handle ? <strong>{person.handle}</strong> : null}
          {me.user.bio ? <p>{me.user.bio}</p> : <p className="profile-hero__source">Profile details follow your connected social identity.</p>}
          <span className="profile-hero__joined">JOINED {formatJoined(me.user.joinedAt)}</span>
        </div>
        <dl className="profile-counts">
          {stats.map((stat) => <div key={stat.label}><dt>{stat.label}</dt><dd>{formatCount(stat.value)}</dd></div>)}
        </dl>
      </header>

      <IdentityConnections me={me} />

      <section className="profile-history">
        <header className="section-heading profile-history__heading">
          <div><span className="eyebrow">YOUR TAKE HISTORY</span><h2>People and choices.</h2></div>
          <div className="history-filters" role="group" aria-label="Filter TAKE history">
            {(["ALL", "GIVEN", "RECEIVED"] as const).map((item) => <button key={item} type="button" className={filter === item ? "is-active" : undefined} onClick={() => setFilter(item)}>{item}</button>)}
          </div>
        </header>
        <div className="profile-history__list">
          {visibleActivity.length ? visibleActivity.map((item) => <ActivityRow key={`${item.id}:${item.kind}`} item={item} detailed onCampaign={(id) => navigate(`/campaign/${id}`)} />) : (
            <SocialEmpty title={filter === "ALL" ? "No TAKE history yet." : `No TAKES ${filter.toLowerCase()} yet.`} action="EXPLORE CAMPAIGNS" onAction={() => navigate("/explore")}>When a confirmed choice happens, the person and campaign will appear here.</SocialEmpty>
          )}
        </div>
      </section>

      <section className="profile-account" id="profile-account" aria-labelledby="account-heading">
        <div><span className="eyebrow">ACCOUNT</span><h2 id="account-heading">Your place in TAKE.</h2><p>Manage the identities that represent you or end this session.</p></div>
        <div className="profile-account__actions">
          <button type="button" onClick={() => document.getElementById("identity-connections")?.scrollIntoView({ behavior: "smooth" })}><Link2 size={19} /><span><strong>Manage connections</strong><small>Social identities and wallets</small></span></button>
          <button type="button" onClick={() => navigate("/home")}><UserRound size={19} /><span><strong>Return home</strong><small>Back to your active opportunities</small></span></button>
          <button className="is-danger" type="button" disabled={loggingOut} onClick={() => void signOut()}><LogOut size={19} /><span><strong>{loggingOut ? "Logging out…" : "Log out"}</strong><small>End this TAKE session</small></span></button>
        </div>
      </section>
    </div>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en", { minimumIntegerDigits: 2, useGrouping: false }).format(value);
}

function formatJoined(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TAKE";
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(date).toUpperCase();
}
