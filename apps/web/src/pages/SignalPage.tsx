import { useState } from "react";
import { PrimaryAction } from "../components/Actions";
import { Avatar } from "../components/Avatar";
import { ProductError, ProductLoading } from "../components/ProductState";
import { RecommendationRow } from "../components/Signal";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useSignal } from "../hooks/useSignal";
import type { TakePath } from "../hooks/usePathRouter";
import { personFromHistoryPerson, personFromMe } from "../lib/currentIdentity";
import type { TakeHistoryEntry } from "../types/identity";
import type { Person } from "../types/product";

export function SignalPage({ navigate }: { navigate: (path: TakePath) => void }) {
  const { data, error, reload } = useSignal();
  const { me, history } = useTakeMe();
  const [domain, setDomain] = useState("ALL");
  const backed = data?.history.filter((item) => domain === "ALL" || item.domain === domain) ?? [];
  const received = history?.received ?? [];
  const featured = received[0] ?? null;
  const self = me ? personFromMe(me) : null;
  const giver = featured ? personFromHistoryPerson(featured.person, `${featured.id}:giver`) : null;

  return <div className="page-container signal-page">
    {error ? <ProductError message={error} onRetry={reload} /> : !data || (me && !history) ? <ProductLoading label="Loading your Signal" /> : (
      <>
        <section className="signal-stage">
          <div className="signal-stage__copy">
            <span className="eyebrow">YOUR SIGNAL</span>
            <h1>{stageTitle(featured, giver, backed.length)}</h1>
            <p>{stageLead(featured, giver, data.counts)}</p>
            {!featured && !backed.length ? <PrimaryAction onClick={() => navigate("/explore")}>GIVE A TAKE</PrimaryAction> : null}
            {featured ? <PrimaryAction onClick={() => navigate(`/campaign/${featured.campaignId}`)}>OPEN {featured.campaignTitle.toUpperCase()}</PrimaryAction> : null}
          </div>
          <div className="signal-stage__scene">
            {featured && self && giver ? (
              <Faceoff from={giver} to={self} caption={`${giver.name} → you`} detail={receivedStatus(featured.status)} />
            ) : (
              <img className="signal-stage__art" src="/assets/take-mascot-handoff-duo.png" alt="" />
            )}
          </div>
        </section>

        {received.length > 1 ? (
          <section className="signal-more" aria-label="Other people who backed you">
            <h2>Also backed you</h2>
            <ol>
              {received.slice(1).map((entry) => {
                const person = personFromHistoryPerson(entry.person, `${entry.id}:giver`);
                return <li key={entry.id}>
                  <Avatar person={person} size="sm" />
                  <div>
                    <strong>{person.name} gave you their TAKE.</strong>
                    <button type="button" onClick={() => navigate(`/campaign/${entry.campaignId}`)}>{entry.campaignTitle}</button>
                  </div>
                </li>;
              })}
            </ol>
          </section>
        ) : null}

        {backed.length ? (
          <section className="signal-history">
            <header>
              <h2>People you backed</h2>
              {data.domains.length > 1 ? <label>Category <select value={domain} onChange={(event) => setDomain(event.target.value)}><option value="ALL">All opportunities</option>{data.domains.map((item) => <option value={item.domain} key={item.domain}>{item.domain.toLowerCase()}</option>)}</select></label> : null}
            </header>
            <ol className="signal-board">{backed.map((item) => <RecommendationRow key={item.id} item={item} navigate={navigate} />)}</ol>
          </section>
        ) : featured ? <p className="signal-next">You have not given a TAKE yet. When you back someone, they show up here too.</p> : null}
      </>
    )}
  </div>;
}

function Faceoff({ from, to, caption, detail }: { from: Person; to: Person; caption: string; detail: string }) {
  return (
    <div className="signal-faceoff">
      <div>
        <Avatar person={from} size="xl" />
        <strong>{from.name}</strong>
        {from.handle ? <small>{from.handle}</small> : null}
      </div>
      <span className="signal-faceoff__pass" aria-hidden="true"><i /></span>
      <div>
        <Avatar person={to} size="xl" />
        <strong>{to.name}</strong>
        <small>You</small>
      </div>
      <p>{caption}</p>
      <small>{detail}</small>
    </div>
  );
}

function stageTitle(featured: TakeHistoryEntry | null, giver: Person | null, backed: number) {
  if (featured && giver && !backed) return `${firstName(giver.name)} backed you.`;
  if (featured && giver && backed) return "Who you backed, and who backed you.";
  if (backed) return "Who did you back, and what happened?";
  return "Your signal starts with a person.";
}

function stageLead(featured: TakeHistoryEntry | null, giver: Person | null, counts: { recommendations: number; evaluated: number }) {
  if (featured && giver) return `${giver.name} gave you their TAKE for ${featured.campaignTitle}. Signal is the story after a recommendation, and it never changes a TAKE’s weight.`;
  if (!counts.recommendations) return "Give one TAKE to someone who should have the spot. The person, and what happened after, lives here.";
  const people = `${counts.recommendations} ${counts.recommendations === 1 ? "person" : "people"}`;
  if (!counts.evaluated) return `You backed ${people}. What happened next is still ahead.`;
  return `You backed ${people}. ${counts.evaluated} ${counts.evaluated === 1 ? "has" : "have"} an outcome.`;
}

function receivedStatus(status: string) {
  if (status === "CONFIRMED") return "Confirmed. Waiting to see what happened.";
  return "Recorded. Waiting for the final word.";
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}
