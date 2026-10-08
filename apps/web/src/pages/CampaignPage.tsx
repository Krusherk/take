import { ArrowLeft } from "lucide-react";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { PrimaryAction, SecondaryAction } from "../components/Actions";
import { Avatar } from "../components/Avatar";
import { CampaignArtwork, CampaignStatus } from "../components/Campaign";
import { ProductError, ProductLoading } from "../components/ProductState";
import { ParticipantEligibilityPanel } from "../components/eligibility/ParticipantEligibilityPanel";
import { CampaignAfterSection } from "../components/Signal";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import { TAKE_API_BASE_URL } from "../lib/takeApi";
import type { TakePath } from "../hooks/usePathRouter";
import { personFromHistoryPerson, personFromMe } from "../lib/currentIdentity";
import { rememberPostAuthDestination, routeAfterAuthentication } from "../lib/authDestination";
import { campaignFromApi, campaignPath, isParticipantCampaign } from "../lib/productData";
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
  const campaign = campaigns.find((item) => item.id === campaignId) ?? publicCampaign;

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

  if (!isParticipantCampaign(campaign)) {
    return (
      <div className="page-container campaign-page campaign-prelaunch-page">
        <button className="back-link" type="button" onClick={() => navigate("/organize")}><ArrowLeft size={17} />ORGANIZE</button>
        <section className="campaign-prelaunch">
          <div>
            <span className="eyebrow">{campaign.sourceStatus === "DRAFT" ? "OFFCHAIN DRAFT" : campaign.sourceStatus.replaceAll("_", " ")}</span>
            <h1>{campaign.title}</h1>
            <p>{campaign.description}</p>
          </div>
          <dl>
            <div><dt>OPPORTUNITY</dt><dd>{campaign.resource}</dd></div>
            <div><dt>ORGANIZER</dt><dd>{campaign.organizer}</dd></div>
            <div><dt>MONAD</dt><dd>Not published</dd></div>
            <div><dt>NOMINATIONS</dt><dd>Not open</dd></div>
          </dl>
          <p className="campaign-prelaunch__note">This is an organizer preview, not a participant campaign. Finish eligibility and both rosters, then a TAKE operator must lock, publish, and activate it before anyone receives a TAKE.</p>
          <PrimaryAction onClick={() => navigate("/organize")}>CONTINUE CAMPAIGN SETUP</PrimaryAction>
        </section>
      </div>
    );
  }

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
          <p className="campaign-hero__facts">{campaignFactLine(campaign)}</p>
        </div>
        <CampaignArtwork campaign={campaign} giver={given ? currentPerson : available ? currentPerson : null} recipient={givenPerson} />
      </header>

      {campaign.sourceStatus === "FINALIZED" ? <CampaignAfterSection campaignId={campaign.id} /> : null}

      <div className="campaign-body">
        <section className="campaign-story">
          <span className="eyebrow">HOW A TAKE WORKS HERE</span>
          <h2>{campaign.resource}</h2>
          <ul className="campaign-story__points">
            <li><strong>Who can give</strong><span>{giverRule(campaign.nominatorEligibilityMode)}. {campaign.nominationLimit === 1 ? "Each of them has one TAKE." : `Each of them has up to ${campaign.nominationLimit} TAKEs.`}</span></li>
            <li><strong>Who can receive</strong><span>{recipientRule(campaign.recipientEligibilityMode)}. They can be chosen whether or not they already use TAKE.</span></li>
            <li><strong>What you can see</strong><span>{campaign.nominationVisibilityMode === "PUBLIC" ? "The record is public." : "Choices stay private until the campaign closes."} The final recipients are published at the end, and the result stays verifiable.</span></li>
          </ul>
        </section>

        <aside className={`campaign-take-panel${given ? " is-given" : ""}`}>
          <div className="campaign-take-panel__heading"><span className="eyebrow">YOUR TAKE</span><span className="live-signal"><i />{given ? "GIVEN" : available ? "READY" : campaign.status === "UPCOMING" ? "OPENS LATER" : campaign.sourceStatus === "CREATED" ? "NOT OPEN" : "NOT IN THIS ROUND"}</span></div>
          {given && givenPerson ? (
            <div className="campaign-take-panel__recipient"><Avatar person={givenPerson} size="lg" /><span>GIVEN TO</span><strong>{givenPerson.name}</strong>{givenPerson.handle ? <small>{givenPerson.handle}</small> : null}</div>
          ) : (
            <div className="campaign-take-panel__note">
              <strong>{takeHeadline(campaign, available, given)}</strong>
              <p>{takeBody(campaign, available)}</p>
              {!given && campaign.viewer?.eligibility?.reasons.length ? campaign.viewer.eligibility.reasons.map((reason) => (
                <p key={reason.reasonCode}>{reason.explanation}</p>
              )) : null}
            </div>
          )}
          {peoplePreview.length && available ? <div className="campaign-take-panel__people"><span>PEOPLE YOU CAN CHOOSE</span><div>{peoplePreview.slice(0, 3).map((person) => <span key={person.id} className="mini-person"><Avatar person={person} size="xs" />{person.name}</span>)}</div></div> : null}
          {given ? <SecondaryAction full onClick={() => navigate("/takes")}>VIEW YOUR CHOICE</SecondaryAction> : available ? <PrimaryAction full onClick={() => navigate(campaignPath(campaign, "/give") as TakePath)}>GIVE YOUR TAKE</PrimaryAction> : !hasTakeIdentity ? <PrimaryAction full onClick={() => { rememberPostAuthDestination(campaignPath(campaign) as TakePath); login(); }}>SIGN IN TO SEE IF YOU CAN GIVE</PrimaryAction> : campaign.sourceStatus === "CREATED" ? <SecondaryAction full onClick={() => void refetch()}>CHECK IF NOMINATIONS ARE OPEN</SecondaryAction> : <SecondaryAction full onClick={() => navigate("/explore")}>SEE OTHER CAMPAIGNS</SecondaryAction>}
        </aside>
      </div>

      {hasTakeIdentity ? <ParticipantEligibilityPanel campaignId={campaign.id} request={request} /> : null}

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

function campaignFactLine(campaign: Campaign) {
  const spots = campaign.spots === 1 ? "1 spot" : `${campaign.spots.toLocaleString("en-US")} spots`;
  const when = campaign.status === "UPCOMING" ? `Opens ${campaign.starts}` : `Ends ${campaign.ends}`;
  const crowd = campaign.participants === null ? "Participation hidden until close" : `${campaign.participants.toLocaleString("en-US")} participating`;
  return `${campaign.resource} · ${spots} · ${when} · ${crowd}`;
}

function takeHeadline(campaign: Campaign, available: boolean, given: boolean) {
  if (given) return "Your TAKE is in.";
  if (available) return "You have one TAKE.";
  if (campaign.sourceStatus === "CREATED") return "Nominations are not open yet.";
  if (campaign.status === "UPCOMING") return `This opens ${campaign.starts}.`;
  if (campaign.status === "CLOSED") return "This campaign has closed.";
  return "You can’t give in this one.";
}

function takeBody(campaign: Campaign, available: boolean) {
  if (available) return "Choose one person. You cannot choose yourself.";
  if (campaign.sourceStatus === "CREATED") return "It is on Monad. You can give a TAKE after nominations open.";
  if (campaign.status === "UPCOMING") return "Come back when it opens.";
  if (campaign.status === "CLOSED") return "The chance to give a TAKE has passed.";
  return "The organizer chose who could give before nominations opened.";
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
