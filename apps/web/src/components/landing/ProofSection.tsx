import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { TAKE_API_BASE_URL } from "../../lib/takeApi";
import { PaperLabel, Sticker } from "../sticker/Sticker";

export interface ProofCampaign {
  id: string;
  title: string;
  organizationName: string | null;
  resource: string;
  spots: number;
  eligibleGivers: number | null;
  givers: number;
  recipientsNominated: number;
  participationRate: number | null;
  winners: Array<{ name: string; supporters: number; check: string | null }>;
  resultHash: string | null;
  resultTransactionHash: string | null;
  finalizedAt: string | null;
  teamCheck: { question: string; evaluateAfter: string; positive: number; negative: number; inconclusive: number; pending: number } | null;
}

const CHECK_WORD: Record<string, string> = { POSITIVE: "yes", NEGATIVE: "no", INCONCLUSIVE: "unclear" };

/** Reads finished campaigns once the section is near the viewport, so the landing stays light. */
function useProof(ref: RefObject<HTMLElement | null>) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; campaigns: ProofCampaign[] }>({ status: "idle", campaigns: [] });
  useEffect(() => {
    const element = ref.current;
    if (!element || state.status !== "idle") return;
    const start = () => {
      setState({ status: "loading", campaigns: [] });
      fetch(`${TAKE_API_BASE_URL}/proof/campaigns`)
        .then((response) => response.ok ? response.json() as Promise<{ campaigns: ProofCampaign[] }> : Promise.reject(new Error(String(response.status))))
        .then((data) => setState({ status: "ready", campaigns: data.campaigns }))
        .catch(() => setState({ status: "error", campaigns: [] }));
    };
    if (typeof IntersectionObserver === "undefined") { start(); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); start(); }
    }, { rootMargin: "600px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, state.status]);
  return state;
}

export function ProofSection({ id = "proof" }: { id?: string }) {
  const ref = useRef<HTMLElement>(null);
  const { status, campaigns } = useProof(ref);
  return (
    <section ref={ref} id={id} className="ls-section ls-proof" aria-labelledby={`${id}-heading`}>
      <PaperLabel size="sm" tilt={-2} className="ls-kicker">proof</PaperLabel>
      <h2 id={`${id}-heading`} className="ls-strip">
        <Sticker tilt={-2} as="span" className="ls-strip__line ls-strip__line--paper"><span>Campaigns run</span></Sticker>
        <Sticker tilt={1.5} delay={80} as="span" className="ls-strip__line ls-strip__line--ink"><span>on TAKE.</span></Sticker>
      </h2>
      {status === "ready" && campaigns.length ? (
        <ul className="ls-proof__list">
          {campaigns.map((campaign, index) => <ProofCard key={campaign.id} campaign={campaign} tilt={index % 2 ? 1 : -1} />)}
        </ul>
      ) : status === "ready" || status === "error" ? (
        <PaperLabel size="md" tilt={1} className="ls-note">
          {status === "error" ? "Couldn’t reach the TAKE API just now. " : ""}First campaigns running now. Finished ones show up here with their givers, winners and the Monad transaction that committed the result.
        </PaperLabel>
      ) : (
        <div className="ls-proof__placeholder" aria-hidden="true" />
      )}
    </section>
  );
}

function ProofCard({ campaign, tilt }: { campaign: ProofCampaign; tilt: number }) {
  const rate = campaign.participationRate === null ? null : Math.round(campaign.participationRate * 100);
  const check = campaign.teamCheck;
  return (
    <Sticker as="li" tilt={tilt} className="ls-proof__card">
      <div className="ls-proof__inner">
      <strong className="ls-proof__title">{campaign.title}</strong>
      <small className="ls-proof__meta">{[campaign.organizationName, campaign.resource].filter(Boolean).join(" · ")}</small>
      <dl className="ls-proof__stats">
        <div><dt>gave</dt><dd>{campaign.givers}{campaign.eligibleGivers !== null ? <span>/{campaign.eligibleGivers}</span> : null}</dd></div>
        {rate !== null ? <div><dt>participation</dt><dd>{rate}%</dd></div> : null}
        <div><dt>people backed</dt><dd>{campaign.recipientsNominated}</dd></div>
        <div><dt>spots</dt><dd>{campaign.spots}</dd></div>
      </dl>
      {campaign.winners.length ? (
        <p className="ls-proof__winners"><b>Got the spot:</b> {campaign.winners.map((winner) => `${winner.name} (${winner.supporters} ${winner.supporters === 1 ? "TAKE" : "TAKEs"}${winner.check ? `, check: ${CHECK_WORD[winner.check] ?? winner.check.toLowerCase()}` : ""})`).join(", ")}</p>
      ) : null}
      {check ? (
        <p className="ls-proof__check"><b>Team check:</b> “{check.question}” {check.positive + check.negative + check.inconclusive
          ? `${check.positive} yes · ${check.negative} no${check.inconclusive ? ` · ${check.inconclusive} unclear` : ""}${check.pending ? ` · ${check.pending} pending` : ""}`
          : `due ${new Date(check.evaluateAfter).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}</p>
      ) : <p className="ls-proof__check">No check after the TAKE was scheduled.</p>}
      {campaign.resultTransactionHash ? (
        <a className="ls-proof__tx" href={`https://testnet.monadexplorer.com/tx/${campaign.resultTransactionHash}`} target="_blank" rel="noreferrer">
          Result on Monad <ExternalLink size={13} aria-hidden="true" />
        </a>
      ) : campaign.resultHash ? <small className="ls-proof__meta">Result hash {campaign.resultHash.slice(0, 10)}…</small> : null}
      </div>
    </Sticker>
  );
}
