import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { PrimaryAction, SecondaryAction } from "../components/Actions";
import { Avatar } from "../components/Avatar";
import { CampaignArtwork, CampaignFacts, CampaignStatus, eligibilityLabel } from "../components/Campaign";
import { ProductError, ProductLoading } from "../components/ProductState";
import { TakeMascotAccent } from "../components/TakeMascotAccent";
import { ParticipantEligibilityPanel } from "../components/eligibility/ParticipantEligibilityPanel";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import { TAKE_API_BASE_URL } from "../lib/takeApi";
import type { TakePath } from "../hooks/usePathRouter";
import { personFromHistoryPerson, personFromMe } from "../lib/currentIdentity";
import { rememberPostAuthDestination, routeAfterAuthentication } from "../lib/authDestination";
import { campaignFromApi, campaignPath } from "../lib/productData";
import type { ApiCampaign, Campaign, Person } from "../types/product";

export function CampaignPage({ campaignId, navigate, optimisticGivenCampaigns, optimisticRecipient }: { campaignId: string; navigate: (path: TakePath) => void; optimisticGivenCampaigns: string[]; optimisticRecipient: Person | null }) {
  const { campaigns, peoplePreview, status, error, refetch } = useTakeProduct();
  const { history, me, request } = useTakeMe();
  const { authenticated } = usePrivy();
  const hasTakeIdentity = authenticated && Boolean(me);
  const [publicCampaign, setPublicCampaign] = useState<Campaign | null>(null);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicError, setPublicError] = useState<string | null>(null);
  const { login } = useLogin({ onComplete: ({ isNewUser }) => navigate(routeAfterAuthentication(isNewUser)) });
  const campaign = campaigns.find((item) => item.id === campaignId) ?? publicCampaign ?? (campaignId === "monad-creator-round" ? campaigns.find((item) => item.status === "LIVE") : undefined);

  useEffect(() => {
    if (campaigns.some((item) => item.id === campaignId)) return;
    let active = true;
    setPublicLoading(true);
    setPublicError(null);
    void fetch(`${TAKE_API_BASE_URL}/campaigns/${encodeURIComponent(campaignId)}`).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 404 ? "This campaign is not available." : "This campaign could not be loaded.");
      return response.json() as Promise<ApiCampaign>;
    }).then((source) => {
      if (active) setPublicCampaign(campaignFromApi(source));
    }).catch((caught) => {
      if (active) setPublicError(caught instanceof Error ? caught.message : "This campaign could not be loaded.");
    }).finally(() => { if (active) setPublicLoading(false); });
    return () => { active = false; };
  }, [campaignId, campaigns]);

  if (!campaign && (publicLoading || status === "loading")) return <div className="page-container"><ProductLoading label="Loading campaign" /></div>;
  if (!campaign && (publicError || status === "error")) return <div className="page-container"><ProductError message={publicError ?? error ?? "This campaign could not be loaded."} onRetry={() => void refetch()} /></div>;
  if (!campaign) return <div className="page-container"><ProductError message="This campaign does not exist or is no longer available." onRetry={() => navigate("/explore")} /></div>;

  const given = (campaign.viewer?.usedTakes ?? 0) > 0 || optimisticGivenCampaigns.includes(campaign.id);
  const available = !given && Boolean(campaign.viewer?.canParticipate) && (campaign.viewer?.availableTakes ?? 0) > 0 && campaign.status === "LIVE";
  const givenEntry = history?.given.find((entry) => entry.campaignId === campaign.id);
  const givenPerson = givenEntry?.person ? personFromHistoryPerson(givenEntry.person, `${givenEntry.id}:recipient`) : optimisticRecipient;
  const currentPerson = me ? personFromMe(me) : null;

  return (
    <div className="page-container campaign-page">
      <button className="back-link" type="button" onClick={() => navigate("/explore")}><ArrowLeft size={17} />EXPLORE</button>

      <header className={`campaign-hero campaign-hero--${campaign.visual}`}>
        <div className="campaign-hero__copy">
          <div className="campaign-hero__meta"><CampaignStatus status={campaign.status} /><span>BY {campaign.organizer.toUpperCase()}</span></div>
          <h1>{campaign.title}</h1>
          <p>{campaign.description}</p>
          <div className="campaign-community"><span className="campaign-community__mark">{campaign.organizerMark}</span><div><small>ORGANIZER</small><strong>{campaign.organizer}</strong></div><span>{campaign.participants === null ? "Participation hidden until close" : `${campaign.participants.toLocaleString("en-US")} people participating`}</span></div>
        </div>
        <CampaignArtwork campaign={campaign} giver={currentPerson} recipient={givenPerson} />
      </header>

      <CampaignFacts campaign={campaign} takeGiven={given} />

      {hasTakeIdentity ? <ParticipantEligibilityPanel campaignId={campaign.id} request={request} /> : null}

      <div className="campaign-body">
        <section className="campaign-about">
          <div><span className="eyebrow">THE OPPORTUNITY</span><h2>{campaign.resource}</h2><p>{campaign.description} {campaign.resourceName} recipients are published when the campaign closes.</p></div>
          <div className="campaign-rules">
            <article><span>WHO CAN GIVE</span><strong>{giverRule(campaign.nominatorEligibilityMode)}</strong><p>{campaign.nominationLimit === 1 ? "Exactly one TAKE per eligible person." : `Up to ${campaign.nominationLimit} TAKEs per eligible person.`}</p></article>
            <article><span>WHO CAN RECEIVE</span><strong>{recipientRule(campaign.recipientEligibilityMode)}</strong><p>People can be chosen whether or not they already use TAKE.</p></article>
            <article><span>VISIBILITY</span><strong>{campaign.nominationVisibilityMode === "PUBLIC" ? "Public record" : "Private until close"}</strong><p>The confirmed result remains verifiable.</p></article>
          </div>
        </section>

        <aside className={`campaign-take-panel${given ? " is-given" : ""}`}>
          <TakeMascotAccent character={given ? "purple" : "green"} className="mascot-panel" />
          <div className="campaign-take-panel__heading"><span className="eyebrow">YOUR TAKE</span><span className="live-signal"><i />{given ? "GIVEN" : available ? "AVAILABLE" : campaign.status === "UPCOMING" ? "UPCOMING" : eligibilityLabel(campaign)}</span></div>
          {given && givenPerson ? (
            <div className="campaign-take-panel__recipient"><Avatar person={givenPerson} size="lg" /><span>GIVEN TO</span><strong>{givenPerson.name}</strong>{givenPerson.handle ? <small>{givenPerson.handle}</small> : null}</div>
          ) : (
            <div className="campaign-take-panel__number"><strong>{available ? "01" : "—"}</strong><p>{available ? "Choose one person. You cannot choose yourself." : campaign.status === "UPCOMING" ? `This campaign opens ${campaign.starts}.` : "You do not have an available TAKE in this campaign."}</p></div>
          )}
          {!given && campaign.viewer?.eligibility?.reasons.length ? (
            <div className="campaign-eligibility" aria-live="polite">
              {campaign.viewer.eligibility.reasons.map((reason) => (
                <p key={reason.reasonCode}>{reason.explanation}</p>
              ))}
            </div>
          ) : null}
          {peoplePreview.length && available ? <div className="campaign-take-panel__people"><span>PEOPLE ON TAKE</span><div>{peoplePreview.slice(0, 3).map((person) => <span key={person.id} className="mini-person"><Avatar person={person} size="xs" />{person.name}</span>)}</div></div> : null}
          {given ? <SecondaryAction full onClick={() => navigate("/takes")}>VIEW YOUR CHOICE</SecondaryAction> : available ? <PrimaryAction full onClick={() => navigate(campaignPath(campaign, "/give") as TakePath)}>GIVE YOUR TAKE</PrimaryAction> : !hasTakeIdentity ? <PrimaryAction full onClick={() => { rememberPostAuthDestination(campaignPath(campaign) as TakePath); login(); }}>SIGN IN TO CHECK ELIGIBILITY</PrimaryAction> : <SecondaryAction full onClick={() => navigate("/explore")}>EXPLORE OTHERS</SecondaryAction>}
          <span className="campaign-take-panel__assurance"><ShieldCheck size={16} />{given ? "Your choice is recorded." : "Blockchain details stay underneath."}</span>
        </aside>
      </div>

      <details className="campaign-onchain-audit">
        <summary>ONCHAIN / AUDIT</summary>
        <dl>
          <div><dt>STATE</dt><dd>{campaign.onchain?.published ? "PUBLISHED ON MONAD" : "OFFCHAIN"}</dd></div>
          <div><dt>NETWORK</dt><dd>{campaign.onchain?.network ?? "Monad testnet"}</dd></div>
          <div><dt>MANAGER</dt><dd>{campaign.onchain?.managerContractAddress ?? "Not published"}</dd></div>
          <div><dt>CAMPAIGN ID</dt><dd>{campaign.onchain?.campaignId ?? "Not assigned"}</dd></div>
          <div><dt>AUTHORITY</dt><dd>{campaign.onchain?.authorityWalletAddress ?? "Not assigned"}</dd></div>
        </dl>
        {Object.entries(campaign.onchain?.lifecycle ?? {}).map(([action, item]) => <p key={action}><strong>{action.toUpperCase()}</strong> {item.status.replaceAll("_", " ")}{item.transactionHash ? <a href={`https://testnet.monadexplorer.com/tx/${item.transactionHash}`} target="_blank" rel="noreferrer"> VIEW TRANSACTION</a> : null}</p>)}
      </details>
    </div>
  );
}

function giverRule(mode: string): string {
  if (mode === "OPEN_REGISTERED") return "Registered TAKE members";
  if (mode === "MERKLE_ALLOWLIST") return "Campaign allowlist";
  return "Organizer-approved participants";
}

function recipientRule(mode: string): string {
  if (mode === "EXTERNAL_ALLOWED") return "Anyone with a social identity";
  if (mode === "OPEN_REGISTERED") return "TAKE members";
  return "Campaign-approved people";
}
