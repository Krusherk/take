import { useState } from "react";
import { Avatar } from "../components/Avatar";
import { ProductError, ProductLoading } from "../components/ProductState";
import { RecommendationRow } from "../components/Signal";
import { EmptySlotSticker, FaceSticker, PaperLabel, PassArrow, Sticker } from "../components/sticker/Sticker";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useSignal } from "../hooks/useSignal";
import type { TakePath } from "../hooks/usePathRouter";
import { personFromHistoryPerson, personFromMe } from "../lib/currentIdentity";

export function SignalPage({ navigate }: { navigate: (path: TakePath) => void }) {
  const { data, error, reload } = useSignal();
  const { me, history } = useTakeMe();
  const [domain, setDomain] = useState("ALL");
  const backed = data?.history.filter((item) => domain === "ALL" || item.domain === domain) ?? [];
  const received = history?.received ?? [];
  const featured = received[0] ?? null;
  const self = me ? personFromMe(me) : null;
  const giver = featured ? personFromHistoryPerson(featured.person, `${featured.id}:giver`) : null;

  return <div className="page-container sticker-page sticker-signal">
    {error ? <ProductError message={error} onRetry={reload} /> : !data || (me && !history) ? <ProductLoading label="Loading your Signal" /> : (
      <>
        <section className="sticker-signal__stage" aria-labelledby="signal-title">
          <Sticker tilt={4} className="signal-tag"><span>YOUR SIGNAL</span></Sticker>
          {featured && giver ? (
            <>
              <div className="sticker-signal__headline">
                <h1 id="signal-title"><PaperLabel size="lg" tilt={-2} delay={60}>{giver.name} backed you.</PaperLabel></h1>
                <PaperLabel size="sm" tilt={1.5} delay={120}>for {featured.campaignTitle}</PaperLabel>
              </div>
              <div className="sticker-signal__faces" role="group" aria-label={`${giver.name} gave you their TAKE`}>
                <FaceSticker person={giver} label={giver.name} sublabel={giver.handle || undefined} tilt={-4} delay={160} />
                <PassArrow />
                {self ? <FaceSticker person={self} label={self.name} sublabel="you" tilt={4} delay={220} /> : <EmptySlotSticker label="you" tilt={4} delay={220} />}
              </div>
              <PaperLabel size="sm" tilt={-1} delay={280}>{giver.name} → you</PaperLabel>
              <p className="sticker-signal__status">{receivedStatus(featured.status)}</p>
              <Sticker tilt={-1.5} delay={320} className="sticker-cta">
                <button className="sticker-pill" type="button" onClick={() => navigate(`/campaign/${featured.campaignId}`)}>Open {featured.campaignTitle}</button>
              </Sticker>
            </>
          ) : (
            <>
              <div className="sticker-signal__headline">
                <h1 id="signal-title"><PaperLabel size="lg" tilt={-2} delay={60}>Nobody has backed you yet.</PaperLabel></h1>
                <PaperLabel size="sm" tilt={1.5} delay={120}>{emptyLead(data.counts.recommendations)}</PaperLabel>
              </div>
              <div className="sticker-signal__faces" role="group" aria-label="No one has given you a TAKE yet">
                <EmptySlotSticker label="someone" tilt={-4} delay={160} />
                <PassArrow />
                {self ? <FaceSticker person={self} label={self.name} sublabel="you" tilt={4} delay={220} /> : <EmptySlotSticker label="you" tilt={4} delay={220} />}
              </div>
              <p className="sticker-signal__status">When someone gives you their TAKE, they land here.</p>
              <Sticker tilt={-1.5} delay={300} className="sticker-cta">
                <button className="sticker-pill" type="button" onClick={() => navigate("/explore")}>{data.counts.recommendations ? "Explore campaigns" : "Give a TAKE"}</button>
              </Sticker>
            </>
          )}
        </section>

        {received.length > 1 ? (
          <section className="sticker-signal__more" aria-label="Other people who backed you">
            <h2><PaperLabel size="sm" tilt={-2}>Also backed you</PaperLabel></h2>
            <ol>
              {received.slice(1).map((entry, index) => {
                const person = personFromHistoryPerson(entry.person, `${entry.id}:giver`);
                return <Sticker as="li" key={entry.id} tilt={index % 2 ? 1 : -1} delay={Math.min(360, 340 + index * 30)} className="sticker-row sticker-row--person">
                  <Avatar person={person} size="sm" />
                  <div>
                    <strong>{person.name} gave you their TAKE.</strong>
                    <button type="button" onClick={() => navigate(`/campaign/${entry.campaignId}`)}>{entry.campaignTitle}</button>
                  </div>
                </Sticker>;
              })}
            </ol>
          </section>
        ) : null}

        {backed.length ? (
          <section className="signal-history sticker-signal__history">
            <header>
              <h2><PaperLabel size="sm" tilt={1.5}>People you backed</PaperLabel></h2>
              {data.domains.length > 1 ? <label>Category <select value={domain} onChange={(event) => setDomain(event.target.value)}><option value="ALL">All opportunities</option>{data.domains.map((item) => <option value={item.domain} key={item.domain}>{item.domain.toLowerCase()}</option>)}</select></label> : null}
            </header>
            <ol className="signal-board">{backed.map((item) => <RecommendationRow key={item.id} item={item} navigate={navigate} />)}</ol>
          </section>
        ) : featured ? <p className="sticker-note">You have not given a TAKE yet. When you back someone, they show up here too.</p> : null}
      </>
    )}
  </div>;
}

function emptyLead(recommendations: number) {
  if (!recommendations) return "Give one TAKE to someone who should have the spot.";
  return `You backed ${recommendations} ${recommendations === 1 ? "person" : "people"}. They are below.`;
}

function receivedStatus(status: string) {
  if (status === "CONFIRMED") return "Confirmed. Waiting to see what happened.";
  return "Recorded. Waiting for the final word.";
}
