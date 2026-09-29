import { useState } from "react";
import { useSignal } from "../hooks/useSignal";
import type { TakePath } from "../hooks/usePathRouter";
import { RecommendationRow } from "../components/Signal";
import { ProductError, ProductLoading, SocialEmpty } from "../components/ProductState";

export function SignalPage({ navigate }: { navigate: (path: TakePath) => void }) {
  const { data, error, reload } = useSignal();
  const [domain, setDomain] = useState("ALL");
  return <div className="page-container signal-page">
    <header className="signal-intro"><span className="eyebrow">YOUR SIGNAL</span><h1>WHO DID YOU BACK,<br />AND WHAT HAPPENED?</h1><p>Every TAKE is a recommendation. Signal tracks what happened after.</p></header>
    {error ? <ProductError message={error} onRetry={reload} /> : !data ? <ProductLoading label="Loading your Signal" /> : <>
      <dl className="signal-counts">{[
        ["Recommendations", data.counts.recommendations], ["Evaluated", data.counts.evaluated],
        ["Positive outcomes", data.counts.positive], ["Awaiting evaluation", data.counts.pending]
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="signal-context">History, not a score. Signal never changes your TAKE’s weight.</p>
      {!data.counts.evaluated ? <p>No recommendations have been evaluated yet.</p> : <p>{data.counts.negative} negative · {data.counts.inconclusive} inconclusive. Outcomes are assessed against each campaign’s own criteria.</p>}
      {data.counts.pending ? <p>{data.counts.pending} of your recommendations {data.counts.pending === 1 ? "is" : "are"} waiting for post-campaign evaluation.</p> : null}
      {data.counts.notPlanned ? <p>{data.counts.notPlanned} recommendations have no evaluation plan. They are not counted as pending.</p> : null}
      <section className="signal-history"><header><h2>People you backed</h2>{data.domains.length ? <label>Category <select value={domain} onChange={(event) => setDomain(event.target.value)}><option value="ALL">All opportunities</option>{data.domains.map((item) => <option value={item.domain} key={item.domain}>{item.domain.toLowerCase()} · {item.counts.recommendations}</option>)}</select></label> : null}</header>
        {data.history.length ? <ol>{data.history.filter((item) => domain === "ALL" || item.domain === domain).map((item) => <RecommendationRow key={item.id} item={item} navigate={navigate} />)}</ol>
          : <SocialEmpty title="Your first recommendation starts with a person." action="EXPLORE OPPORTUNITIES" onAction={() => navigate("/explore")}>Give your TAKE in a campaign. Once it is canonically confirmed, the person and opportunity will appear here. Outcomes only appear when someone actually evaluates them.</SocialEmpty>}
      </section>
    </>}
  </div>;
}
