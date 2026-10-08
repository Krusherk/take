import { useState } from "react";
import { useSignal } from "../hooks/useSignal";
import type { TakePath } from "../hooks/usePathRouter";
import { RecommendationRow } from "../components/Signal";
import { ProductError, ProductLoading, SocialEmpty } from "../components/ProductState";

export function SignalPage({ navigate }: { navigate: (path: TakePath) => void }) {
  const { data, error, reload } = useSignal();
  const [domain, setDomain] = useState("ALL");
  const visible = data?.history.filter((item) => domain === "ALL" || item.domain === domain) ?? [];
  return <div className="page-container signal-page">
    <header className="signal-intro"><span className="eyebrow">YOUR SIGNAL</span><h1>Who did you back, and what happened?</h1><p>{data ? signalLead(data.counts) : "Every TAKE is a recommendation. This is what happened after."}</p><p className="signal-context">History, not a score. Signal never changes your TAKE’s weight.</p></header>
    {error ? <ProductError message={error} onRetry={reload} /> : !data ? <ProductLoading label="Loading your Signal" /> : (
      <section className="signal-history"><header><h2>People you backed</h2>{data.domains.length > 1 ? <label>Category <select value={domain} onChange={(event) => setDomain(event.target.value)}><option value="ALL">All opportunities</option>{data.domains.map((item) => <option value={item.domain} key={item.domain}>{item.domain.toLowerCase()}</option>)}</select></label> : null}</header>
        {visible.length ? <ol className="signal-board">{visible.map((item) => <RecommendationRow key={item.id} item={item} navigate={navigate} />)}</ol>
          : <SocialEmpty title="Your first recommendation starts with a person." action="EXPLORE OPPORTUNITIES" onAction={() => navigate("/explore")}>Give a TAKE to someone. Once it is confirmed, they show up here.</SocialEmpty>}
      </section>
    )}
  </div>;
}

function signalLead(counts: { recommendations: number; evaluated: number }) {
  if (!counts.recommendations) return "Every TAKE is a recommendation. This is what happened after.";
  const people = `${counts.recommendations} ${counts.recommendations === 1 ? "person" : "people"}`;
  if (!counts.evaluated) return `You backed ${people}. What happened next is still ahead.`;
  return `You backed ${people}. ${counts.evaluated} ${counts.evaluated === 1 ? "has" : "have"} an outcome.`;
}
