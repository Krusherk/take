import { ArrowLeft } from "lucide-react";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { Avatar } from "../components/Avatar";
import { CampaignSticker, EmptySlotSticker, FaceSticker, MascotSticker, PaperLabel, PassArrow, StatusSticker, Sticker } from "../components/sticker/Sticker";
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

  if (!campaign && (publicLoading || status === "loading")) return <div className="page-container sticker-page sticker-detail"><ProductLoading label="Loading campaign" /></div>;
  if (!campaign && (publicError || status === "error")) return <div className="page-container sticker-page sticker-detail"><ProductError message={publicError ?? error ?? "This campaign could not be loaded."} onRetry={() => void refetch()} /></div>;
  if (!campaign) return <div className="page-container sticker-page sticker-detail"><ProductError message="This campaign does not exist or is no longer available." onRetry={() => navigate("/explore")} /></div>;

  if (!isParticipantCampaign(campaign)) {
    return (
      <div className="page-container sticker-page sticker-detail campaign-prelaunch-page">
        <BackSticker label="Organize" onClick={() => navigate("/organize")} />
        <section className="sticker-campaign sticker-detail__hero" aria-labelledby="campaign-title">
          <div className="sticker-campaign__art">
            <CampaignSticker campaign={campaign} tilt={-4} />
            <span className="sticker-campaign__status">
              <Sticker tilt={-7} delay={140} as="span" className="status-sticker status-sticker--closed"><span>{campaign.sourceStatus === "DRAFT" ? "DRAFT" : campaign.sourceStatus.replaceAll("_", " ")}</span></Sticker>
            </span>
            <MascotSticker kind="star" tilt={-8} delay={200} className="sticker-campaign__mascot" />
          </div>
          <div className="sticker-campaign__title">
            <h1 id="campaign-title"><PaperLabel size="lg" tilt={3} delay={90}>{campaign.title}</PaperLabel></h1>
            <PaperLabel size="sm" tilt={-2} delay={150}>by {campaign.organizer}</PaperLabel>
          </div>
          {campaign.description ? <PaperLabel size="md" tilt={1} delay={200} className="sticker-campaign__copy">{campaign.description}</PaperLabel> : null}
        </section>
        <Sticker tilt={-0.6} delay={240} className="sticker-detail__card campaign-prelaunch">
          <span className="sticker-detail__eyebrow">{campaign.sourceStatus === "DRAFT" ? "OFFCHAIN DRAFT" : campaign.sourceStatus.replaceAll("_", " ")}</span>
          <dl className="sticker-detail__facts">
            <div><dt>Opportunity</dt><dd>{campaign.resource}</dd></div>
            <div><dt>Organizer</dt><dd>{campaign.organizer}</dd></div>
            <div><dt>Monad</dt><dd>Not published</dd></div>
            <div><dt>Nominations</dt><dd>Not open</dd></div>
          </dl>
          <p className="sticker-detail__muted">This is an organizer preview, not a participant campaign. Finish eligibility and both rosters, then a TAKE operator must lock, publish, and activate it before anyone receives a TAKE.</p>
        </Sticker>
        <Sticker tilt={-1.5} delay={300} className="sticker-cta">
          <button className="sticker-pill" type="button" onClick={() => navigate("/organize")}>Continue campaign setup</button>
        </Sticker>
      </div>
    );
  }

  const given = (campaign.viewer?.usedTakes ?? 0) > 0 || optimisticGivenCampaigns.includes(campaign.id);
  const available = !given && Boolean(campaign.viewer?.canParticipate) && (campaign.viewer?.availableTakes ?? 0) > 0 && campaign.status === "LIVE";
  const givenEntry = history?.given.find((entry) => entry.campaignId === campaign.id);
  const givenPerson = givenEntry?.person ? personFromHistoryPerson(givenEntry.person, `${givenEntry.id}:recipient`) : optimisticRecipient;
  const currentPerson = me ? personFromMe(me) : null;
  const takeState = !hasTakeIdentity && !given ? "SIGN IN" : given ? "GIVEN" : available ? "READY" : campaign.status === "UPCOMING" ? "OPENS LATER" : campaign.sourceStatus === "CREATED" ? "NOT OPEN" : campaign.status === "CLOSED" ? "CLOSED" : "NOT IN THIS ROUND";

  return (
    <div className="page-container sticker-page sticker-detail campaign-page">
      <BackSticker label="Explore" onClick={() => navigate("/explore")} />

      <section className="sticker-campaign sticker-detail__hero" aria-labelledby="campaign-title">
        <div className="sticker-campaign__art">
          <CampaignSticker campaign={campaign} tilt={-4} />
          <span className="sticker-campaign__status"><StatusSticker status={campaign.status} tilt={-7} delay={140} /></span>
          <MascotSticker kind="lime" tilt={-8} delay={200} className="sticker-campaign__mascot" />
        </div>

        <div className="sticker-campaign__title">
          <h1 id="campaign-title"><PaperLabel size="lg" tilt={3} delay={90}>{campaign.title}</PaperLabel></h1>
          <PaperLabel size="sm" tilt={-2} delay={150}>by {campaign.organizer}</PaperLabel>
        </div>

        {currentPerson ? (
          <div className="sticker-campaign__handoff" role="group" aria-label={given && givenPerson ? `You gave your TAKE to ${givenPerson.name}` : "Your TAKE"}>
            <FaceSticker person={currentPerson} size="sm" tilt={-6} delay={180} label="you" />
            <PassArrow className="pass-arrow--sm" />
            {given && givenPerson
              ? <FaceSticker person={givenPerson} size="sm" tilt={5} delay={230} label={givenPerson.name} sublabel={givenPerson.handle || undefined} />
              : <EmptySlotSticker size="sm" tilt={5} delay={230} label={given ? "given" : "someone else"} />}
          </div>
        ) : null}

      </section>

      <section className={`sticker-detail__take${given ? " is-given" : ""}`} aria-labelledby="campaign-take-title">
        <Sticker tilt={4} delay={280} as="span" className="feed-tag sticker-detail__tag"><span>YOUR TAKE · {takeState}</span></Sticker>
        <h2 id="campaign-take-title"><PaperLabel size="md" tilt={-1.5} delay={300}>{!hasTakeIdentity && !given ? "Sign in to see your TAKE." : takeHeadline(campaign, available, given, givenPerson)}</PaperLabel></h2>
        {!given || !givenPerson ? <p className="sticker-note">{!hasTakeIdentity && !given ? "TAKE checks this campaign’s giver list for your account." : takeBody(campaign, available, given)}</p> : null}
        {!given && campaign.viewer?.eligibility?.reasons.length ? campaign.viewer.eligibility.reasons.map((reason) => (
          <p key={reason.reasonCode} className="sticker-note">{reason.explanation}</p>
        )) : null}
        {peoplePreview.length && available ? (
          <div className="sticker-detail__people" role="group" aria-label="People you can choose">
            {peoplePreview.slice(0, 3).map((person, index) => (
              <Sticker key={person.id} as="span" tilt={index % 2 ? 2 : -2} delay={320 + index * 40} className="sticker-detail__person"><Avatar person={person} size="xs" />{person.name}</Sticker>
            ))}
          </div>
        ) : null}
        <Sticker tilt={-1.5} delay={340} className="sticker-cta">
          {given
            ? <button className="sticker-pill" type="button" onClick={() => navigate("/takes")}>View your choice</button>
            : available
              ? <button className="sticker-pill" type="button" onClick={() => navigate(campaignPath(campaign, "/give") as TakePath)}>Give your TAKE</button>
              : !hasTakeIdentity
                ? <button className="sticker-pill" type="button" onClick={() => { rememberPostAuthDestination(campaignPath(campaign) as TakePath); login(); }}>Sign in to see if you can give</button>
                : campaign.sourceStatus === "CREATED"
                  ? <button className="sticker-pill" type="button" onClick={() => void refetch()}>Check if nominations are open</button>
                  : <button className="sticker-pill" type="button" onClick={() => navigate("/explore")}>See other campaigns</button>}
        </Sticker>
      </section>

      <section className="sticker-detail__about" aria-label="About this campaign">
        <PaperLabel size="sm" tilt={-1.5} delay={220} className="sticker-campaign__meta">{campaignFactLine(campaign)}</PaperLabel>
        {campaign.description ? <PaperLabel size="md" tilt={1} delay={260} className="sticker-campaign__copy sticker-detail__copy">{campaign.description}</PaperLabel> : null}
      </section>

      {campaign.sourceStatus === "FINALIZED" ? <div className="sticker-detail__panel"><CampaignAfterSection campaignId={campaign.id} /></div> : null}

      <Sticker tilt={-0.6} delay={380} className="sticker-detail__card">
        <h2 className="sticker-detail__eyebrow">How a TAKE works here</h2>
        <ul className="sticker-detail__points">
          <li><strong>Who can give</strong><span>{giverRule(campaign.nominatorEligibilityMode)}. {campaign.nominationLimit === 1 ? "Each of them has one TAKE." : `Each of them has up to ${campaign.nominationLimit} TAKEs.`}</span></li>
          <li><strong>Who can receive</strong><span>{recipientRule(campaign.recipientEligibilityMode)}. They can be chosen whether or not they already use TAKE.</span></li>
          <li><strong>What you can see</strong><span>{campaign.nominationVisibilityMode === "PUBLIC" ? "The record is public." : "Choices stay private until the campaign closes."} The final recipients are published at the end, and the result stays verifiable.</span></li>
        </ul>
      </Sticker>

      {hasTakeIdentity ? <div className="sticker-detail__panel"><ParticipantEligibilityPanel campaignId={campaign.id} request={request} /></div> : null}

      <Sticker tilt={0.5} delay={420} className="sticker-detail__card sticker-detail__audit">
        <details className="campaign-onchain-audit">
          <summary>Onchain record</summary>
          <dl className="sticker-detail__facts">
            <div><dt>State</dt><dd>{campaign.onchain?.published ? "Published on Monad" : "Offchain"}</dd></div>
            <div><dt>Network</dt><dd>{campaign.onchain?.network ?? "Monad testnet"}</dd></div>
            <div><dt>Manager</dt><dd>{campaign.onchain?.managerContractAddress ?? "Not published"}</dd></div>
            <div><dt>Campaign ID</dt><dd>{campaign.onchain?.campaignId ?? "Not assigned"}</dd></div>
            <div><dt>Authority</dt><dd>{campaign.onchain?.authorityWalletAddress ?? "Not assigned"}</dd></div>
          </dl>
          {Object.entries(campaign.onchain?.lifecycle ?? {}).map(([action, item]) => <p key={action} className="sticker-detail__tx"><strong>{action.toUpperCase()}</strong> {item.status.replaceAll("_", " ")}{item.transactionHash ? <a href={`https://testnet.monadexplorer.com/tx/${item.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a> : null}</p>)}
        </details>
      </Sticker>
    </div>
  );
}

function BackSticker({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Sticker tilt={-2} className="sticker-detail__back">
      <button type="button" onClick={onClick}><ArrowLeft size={16} aria-hidden="true" />{label}</button>
    </Sticker>
  );
}

function campaignFactLine(campaign: Campaign) {
  const when = campaign.status === "UPCOMING" ? `opens ${campaign.starts}` : campaign.status === "CLOSED" ? `ended ${campaign.ends}` : `ends ${campaign.ends}`;
  const crowd = campaign.participants === null ? "participation hidden until close" : `${campaign.participants.toLocaleString("en-US")} participating`;
  return `${campaign.resource} · ${when} · ${crowd}`;
}

function takeHeadline(campaign: Campaign, available: boolean, given: boolean, recipient: Person | null) {
  if (given) return recipient ? `You gave your TAKE to ${recipient.name}.` : "Your TAKE is in.";
  if (available) return "You have one TAKE.";
  if (campaign.sourceStatus === "CREATED") return "Nominations are not open yet.";
  if (campaign.status === "UPCOMING") return `This opens ${campaign.starts}.`;
  if (campaign.status === "CLOSED") return "This campaign has closed.";
  return "You can’t give in this one.";
}

function takeBody(campaign: Campaign, available: boolean, given: boolean) {
  if (given) return "Your choice is recorded on Monad.";
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
