import { Check, CircleAlert, Copy, ExternalLink, RefreshCw, Wallet } from "lucide-react";
import { useSendTransaction, useUser, useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PrimaryAction, SecondaryAction } from "../components/Actions";
import { ProductError, ProductLoading, SocialEmpty } from "../components/ProductState";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import { campaignFromApi } from "../lib/productData";
import type { ApiCampaign, Campaign } from "../types/product";
import type { CampaignMechanismView, SelectorEligibilityView } from "../types/mechanism";

type LifecycleAction = "PUBLISH" | "ACTIVATE" | "CLOSE" | "FINALIZE";
type OperatorRequest = { id: string; status: string; organizationName: string; title: string; description: string; resourceName: string; seatCount: number; startTime: string; endTime: string; provisionedCampaignId: string | null };
type Roster = { id: string; name: string; status: string; members: Array<{ id: string }> };
type RecipientContext = { snapshotId: string | null; status?: string; recipients: Array<{ canonicalRecipientKey: string; displayName: string }> };
type ExperimentView = { id: string; status: string };
type AllocationRun = { id: string; status: string; resultHash: string | null; completedAt: string | null };
type LifecycleIntent = {
  id: string; action: LifecycleAction; status: string; requiredFromAddress: string | null; transactionHash: string | null;
  onchainCampaignId: string | null; errorCode: string | null; errorMessage: string | null;
  transaction: { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number };
};
type NextActionKey = "ORGANIZER_SETUP" | "LOCK_SELECTORS" | "CHOOSE_RECIPIENTS" | "PREPARE_MECHANISM" | "BUILD_SNAPSHOTS" | "RATE_RECIPIENTS" | "PREREGISTER" | "LOCK_MECHANISM" | "LOCK_PROTOCOL" | "APPROVE" | "PUBLISH" | "ACTIVATE" | "WAIT" | "CLOSE" | "ALLOCATE" | "FINALIZE" | "COMPLETE" | "PENDING";
type NextAction = { key: NextActionKey; state: string; title: string; detail: string; blocker?: string };

export function OperatorPage() {
  const { me, request } = useTakeMe();
  const { campaigns, refetch: refetchCampaigns } = useTakeProduct();
  const { sendTransaction } = useSendTransaction();
  const { refreshUser } = useUser();
  const { wallets: connectedWallets, ready: walletsReady } = useWallets();
  const [operator, setOperator] = useState<boolean | null>(null);
  const [requests, setRequests] = useState<OperatorRequest[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [eligibility, setEligibility] = useState<SelectorEligibilityView | null>(null);
  const [mechanism, setMechanism] = useState<CampaignMechanismView | null>(null);
  const [experiment, setExperiment] = useState<ExperimentView | null>(null);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [recipientRosterId, setRecipientRosterId] = useState("");
  const [mode, setMode] = useState<"DISJOINT_SELECTOR_RECIPIENT" | "OVERLAPPING">("DISJOINT_SELECTOR_RECIPIENT");
  const [recipientContext, setRecipientContext] = useState<RecipientContext>({ snapshotId: null, recipients: [] });
  const [ratings, setRatings] = useState<Record<string, number | undefined>>({});
  const [intents, setIntents] = useState<LifecycleIntent[]>([]);
  const [allocation, setAllocation] = useState<AllocationRun | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshingWallet, setRefreshingWallet] = useState(false);
  const [walletRefreshAttempted, setWalletRefreshAttempted] = useState(false);
  const [walletCheckTimedOut, setWalletCheckTimedOut] = useState(false);
  const primaryWallet = me?.wallets.find((wallet) => wallet.primary && wallet.embedded)?.address ?? me?.wallets.find((wallet) => wallet.embedded)?.address ?? null;
  const authorityWallet = campaign?.onchain?.authorityWalletAddress ?? primaryWallet;
  const connectedAuthorityWallet = connectedWallets.find((wallet) =>
    wallet.walletClientType === "privy" && wallet.address.toLowerCase() === authorityWallet?.toLowerCase()
  );
  const walletAvailable = walletsReady && Boolean(connectedAuthorityWallet);

  useEffect(() => {
    if (walletsReady) { setWalletCheckTimedOut(false); return; }
    const timer = window.setTimeout(() => setWalletCheckTimedOut(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [walletsReady]);

  const loadRoot = useCallback(async () => {
    setError(null);
    try {
      const access = await request<{ operator: boolean }>("/operator/me");
      setOperator(access.operator);
      if (!access.operator) return;
      setRequests(await request<OperatorRequest[]>("/operator/campaign-requests"));
      await refetchCampaigns();
    } catch (caught) { setError(errorMessage(caught)); }
  }, [refetchCampaigns, request]);

  const loadCampaign = useCallback(async (id: string) => {
    if (!id) return;
    setError(null);
    const results = await Promise.allSettled([
      request<ApiCampaign>(`/campaigns/${id}`),
      request<SelectorEligibilityView | null>(`/campaigns/${id}/selector-eligibility`),
      request<CampaignMechanismView>(`/campaigns/${id}/mechanism`),
      request<Roster[]>(`/operator/campaigns/${id}/rosters`),
      request<LifecycleIntent[]>(`/operator/campaigns/${id}/lifecycle-intents`),
      request<RecipientContext>(`/operator/campaigns/${id}/recipient-context`),
      request<ExperimentView>(`/campaigns/${id}/experiment-v0`),
      request<AllocationRun | null>(`/operator/campaigns/${id}/allocation-runs/latest`),
    ]);
    const sourceCampaign = value(results[0], null);
    setCampaign(sourceCampaign ? campaignFromApi(sourceCampaign) : null);
    setEligibility(value(results[1], null));
    setMechanism(value(results[2], null));
    setRosters(value(results[3], []));
    setIntents(value(results[4], []));
    const context = value(results[5], { snapshotId: null, recipients: [] });
    setRecipientContext(context);
    setExperiment(value(results[6], null));
    setAllocation(value(results[7], null));
    setRatings((current) => Object.fromEntries(context.recipients.map((person) => [person.canonicalRecipientKey, current[person.canonicalRecipientKey]])));
  }, [request]);

  useEffect(() => { void loadRoot(); }, [loadRoot]);
  useEffect(() => { if (!campaignId && campaigns.length) setCampaignId(campaigns[0]!.id); }, [campaignId, campaigns]);
  useEffect(() => { setCampaign(null); setRecipientRosterId(""); if (campaignId) void loadCampaign(campaignId); }, [campaignId, loadCampaign]);
  const pendingIntent = intents.find((intent) => ["WAITING_FOR_WALLET", "SUBMITTED", "CONFIRMING", "INDEXING"].includes(intent.status));
  useEffect(() => {
    if (!campaignId || !pendingIntent) return;
    const timer = window.setInterval(() => void loadCampaign(campaignId), 3_000);
    return () => window.clearInterval(timer);
  }, [campaignId, loadCampaign, pendingIntent]);

  async function refresh() { await Promise.all([loadRoot(), campaignId ? loadCampaign(campaignId) : Promise.resolve()]); }
  async function run(label: string, operation: () => Promise<unknown>) {
    setBusy(label); setError(null);
    try { await operation(); await refresh(); } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(null); }
  }
  async function provision(id: string) {
    await run(`provision:${id}`, async () => {
      const result = await request<{ campaign: { id: string } }>(`/operator/campaign-requests/${id}/provision`, { method: "POST", body: "{}" });
      setCampaignId(result.campaign.id);
    });
  }
  async function prepareProtocol() {
    if (!campaign || !mechanism?.snapshots?.length || recipientContext.recipients.length === 0) throw new Error("Build both eligibility snapshots first.");
    if (recipientContext.recipients.some((person) => ratings[person.canonicalRecipientKey] === undefined)) throw new Error("Rate every rostered recipient before preregistration.");
    const giver = mechanism.snapshots.find((item) => item.audience === "NOMINATOR");
    const recipient = mechanism.snapshots.find((item) => item.audience === "RECIPIENT");
    if (!giver || !recipient) throw new Error("Both snapshots are required.");
    const observedAt = new Date(Math.min(Date.now(), new Date(campaign.startsAt).getTime() - 60_000)).toISOString();
    await request(`/operator/campaigns/${campaign.id}/experiment-v0`, { method: "POST", body: JSON.stringify({
      variant: mode === "DISJOINT_SELECTOR_RECIPIENT" ? "DISJOINT" : "OVERLAPPING",
      giverSnapshotId: giver.id, recipientSnapshotId: recipient.id, popularityProxy: "ORGANIZER_FAMILIARITY",
      popularityObservations: recipientContext.recipients.map((person) => ({ canonicalRecipientKey: person.canonicalRecipientKey, value: ratings[person.canonicalRecipientKey], observedAt, provenance: { source: "ORGANIZER_PERCEPTION", scale: "TAKE_V0_FIXED_0_3", collectedBy: "TAKE_OPERATOR" } })),
    }) });
  }
  async function lifecycle(action: LifecycleAction) {
    if (!campaign) return;
    if (!walletAvailable) throw new Error(walletsReady
      ? "Your existing TAKE wallet is linked, but Privy has not connected it in this browser. Use Retry wallet connection below. Do not create a new wallet."
      : "Your TAKE wallet is still loading. Wait for the wallet check before continuing.");
    const intent = await request<LifecycleIntent>(`/operator/campaigns/${campaign.id}/lifecycle/${action.toLowerCase()}/prepare`, { method: "POST", body: JSON.stringify(action === "FINALIZE" ? { allocationRunId: allocation?.id } : {}) });
    if (intent.transactionHash) return;
    const signer = intent.requiredFromAddress ?? primaryWallet;
    if (!signer) throw new Error("The designated operator embedded wallet is unavailable. Finish TAKE wallet onboarding before this action.");
    if (intent.requiredFromAddress && primaryWallet?.toLowerCase() !== intent.requiredFromAddress.toLowerCase()) throw new Error(`Use the campaign authority wallet ${intent.requiredFromAddress}.`);
    const sent = await sendTransaction({ to: intent.transaction.to, data: intent.transaction.data, value: BigInt(intent.transaction.value), chainId: intent.transaction.chainId }, { address: signer, sponsor: import.meta.env.VITE_PRIVY_SPONSOR_TRANSACTIONS === "true" });
    await request(`/operator/campaigns/${campaign.id}/lifecycle-intents/${intent.id}/submit`, { method: "POST", body: JSON.stringify({ transactionHash: sent.hash, fromAddress: signer }) });
  }
  async function copyWallet() {
    const address = authorityWallet;
    if (!address) return;
    await navigator.clipboard.writeText(address); setCopied(true); window.setTimeout(() => setCopied(false), 1_500);
  }
  async function retryWalletConnection() {
    setRefreshingWallet(true);
    setWalletRefreshAttempted(true);
    setError(null);
    try { await refreshUser(); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setRefreshingWallet(false); }
  }

  if (operator === null && !error) return <div className="page-container"><ProductLoading label="Checking TAKE operator access" /></div>;
  if (operator === false) return <div className="page-container"><ProductError message="This account is not on the TAKE operator allowlist." onRetry={() => void loadRoot()} /></div>;
  const readiness = getReadiness(campaign, eligibility, mechanism, experiment, allocation);
  const newRequests = requests.filter((item) => item.status === "SUBMITTED");
  const next = getNextAction({ campaign, eligibility, mechanism, experiment, allocation, recipientRosterId, recipientContext, ratings, pendingIntent });
  const actions: Partial<Record<NextActionKey, () => Promise<unknown>>> = campaign ? {
    LOCK_SELECTORS: () => request(`/campaigns/${campaign.id}/selector-eligibility/lock`, { method: "POST", body: "{}" }),
    PREPARE_MECHANISM: () => request(`/campaigns/${campaign.id}/selector-eligibility/prepare-mechanism`, { method: "POST", body: JSON.stringify({ recipientAllowlistId: recipientRosterId, selectorRecipientMode: mode }) }),
    BUILD_SNAPSHOTS: () => request(`/campaigns/${campaign.id}/evidence-snapshots`, { method: "POST", body: "{}" }),
    PREREGISTER: prepareProtocol,
    LOCK_MECHANISM: () => request(`/campaigns/${campaign.id}/mechanism/lock`, { method: "POST", body: "{}" }),
    LOCK_PROTOCOL: () => request(`/campaigns/${campaign.id}/experiment-v0/lock`, { method: "POST", body: "{}" }),
    APPROVE: () => request(`/operator/campaigns/${campaign.id}/approve-launch`, { method: "POST", body: "{}" }),
    PUBLISH: () => lifecycle("PUBLISH"), ACTIVATE: () => lifecycle("ACTIVATE"), CLOSE: () => lifecycle("CLOSE"),
    ALLOCATE: () => request(`/campaigns/${campaign.id}/allocation-runs`, { method: "POST", body: "{}" }),
    FINALIZE: () => lifecycle("FINALIZE"),
  } : {};
  if (pendingIntent?.status === "WAITING_FOR_WALLET") actions.PENDING = () => lifecycle(pendingIntent.action);

  return <div className="page-container operator-page">
    <header className="page-intro"><div><span className="eyebrow">TAKE OPERATOR</span><h1>Launch and run campaigns.</h1></div><p>The organizer defines the opportunity and the real people in scope. TAKE checks which of them qualify to give one TAKE. A giver chooses a recipient; the operator does not choose a winner.</p></header>
    {error ? <div className="organize-error" role="alert"><CircleAlert size={17} />{error}</div> : null}
    {newRequests.length ? <section className="operator-requests"><header><span className="eyebrow">CAMPAIGN REQUESTS</span><h2>Ready for setup</h2></header>
      {newRequests.map((item) => <article key={item.id}><div><strong>{item.title}</strong><p>{item.organizationName} · {item.resourceName} · {item.seatCount} spots</p></div><PrimaryAction onClick={() => void provision(item.id)} disabled={busy === `provision:${item.id}`}>{busy === `provision:${item.id}` ? "PROVISIONING" : "START SETUP"}</PrimaryAction></article>)}
    </section> : null}
    <section className="operator-control">
      <div className="operator-control-head"><label className="field"><span>MANAGED CAMPAIGN</span><select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="">Choose a campaign</option>{campaigns.map((item) => <option key={item.id} value={item.id}>{item.title} · {humanStatus(item.sourceStatus)}</option>)}</select></label><SecondaryAction onClick={() => void refresh()} disabled={busy !== null}><RefreshCw size={16} />REFRESH</SecondaryAction></div>
      {!campaignId && !campaigns.length ? <SocialEmpty title="No managed campaigns yet.">Provision a submitted organizer request to create the first offchain campaign.</SocialEmpty> : null}
      {campaignId && !campaign ? <ProductLoading label="Loading campaign readiness" /> : null}
      {campaign ? <>
        <div className="operator-campaign-summary"><div><span className="eyebrow">{productState(campaign, mechanism)}</span><h2>{campaign.title}</h2><p>{campaign.resource} · {campaign.spots} spots · {campaign.organizer}</p><p>{eligibility?.counts.eligible ?? 0} qualified to give one TAKE · {recipientContext.recipients.length} can receive it</p></div><span className="operator-state">{productState(campaign, mechanism)}</span></div>
        <section className="operator-next-action" aria-labelledby="operator-next-title">
          <div><span className="eyebrow">NEXT ACTION</span><h2 id="operator-next-title">{next.title}</h2><p>{next.detail}</p></div>
          {next.blocker ? <div className="operator-blocker"><CircleAlert size={18} /><span>{next.blocker}</span></div> : null}
          {next.key === "ORGANIZER_SETUP" ? <a className="operator-next-link" href="/organize">OPEN ORGANIZER SETUP</a> : null}
          {next.key === "CHOOSE_RECIPIENTS" || next.key === "PREPARE_MECHANISM" ? <RosterControls rosters={rosters} selectorAllowlistId={eligibility?.finalAllowlistId ?? null} recipientRosterId={recipientRosterId} mode={mode} onRosterChange={setRecipientRosterId} onModeChange={setMode} /> : null}
          {next.key === "RATE_RECIPIENTS" || next.key === "PREREGISTER" ? <RecipientRatings recipients={recipientContext.recipients} ratings={ratings} onChange={(key, score) => setRatings((current) => ({ ...current, [key]: score }))} /> : null}
          {actions[next.key] ? <PrimaryAction onClick={() => void run(next.key, actions[next.key]!)} disabled={busy !== null || Boolean(next.blocker) || (requiresWallet(next.key) && !walletAvailable)}>{busy === next.key ? "WORKING…" : next.key === "PENDING" ? "CONTINUE TO WALLET" : actionLabel(next.key)}</PrimaryAction> : null}
          {next.key === "WAIT" || next.key === "PENDING" ? <SecondaryAction onClick={() => void refresh()} disabled={busy !== null}><RefreshCw size={16} />CHECK STATUS</SecondaryAction> : null}
        </section>
        <section className="operator-wallet-panel"><div><Wallet size={20} /><div><span>CAMPAIGN AUTHORITY WALLET</span><strong>{authorityWallet ?? "No embedded wallet"}</strong><p>{walletAvailable ? "Your existing Privy wallet is connected. Continuing will open a transaction for you to review and approve." : !walletsReady && !walletCheckTimedOut ? "Checking the existing wallet in this browser…" : "Your X login is recognized, but its Privy wallet is not connected here. No transaction has been sent. Do not create a new wallet; this campaign must use the address above."}</p></div></div>{authorityWallet ? <SecondaryAction onClick={() => void copyWallet()}><Copy size={15} />{copied ? "COPIED" : "COPY WALLET"}</SecondaryAction> : null}{!walletAvailable && (walletsReady || walletCheckTimedOut) ? <SecondaryAction onClick={() => void retryWalletConnection()} disabled={refreshingWallet}>{refreshingWallet ? "CHECKING WALLET…" : "RETRY WALLET CONNECTION"}</SecondaryAction> : null}{walletRefreshAttempted && !walletAvailable && !refreshingWallet ? <p role="alert">Still unavailable? Sign out and sign back in with the same X account. If the embedded wallet still fails to load here, open TAKE in a regular browser. Do not create another wallet.</p> : null}<span className="gas-status">{import.meta.env.VITE_PRIVY_SPONSOR_TRANSACTIONS === "true" ? "GAS SPONSORSHIP CONFIGURED" : "TESTNET MON REQUIRED"}</span></section>
        <details className="operator-advanced"><summary>Launch checklist · {readiness.filter((item) => item.ready).length}/{readiness.length} complete</summary><section className="operator-readiness"><header><div><span className="eyebrow">READINESS</span><h2>What is ready</h2></div><span>{readiness.filter((item) => item.ready).length}/{readiness.length}</span></header><div>{readiness.map((item) => <div className={item.ready ? "is-ready" : ""} key={item.label}>{item.ready ? <Check size={16} /> : <span className="readiness-dot" />}<span>{item.label}</span><small>{item.detail}</small></div>)}</div></section></details>
        <details className="operator-advanced"><summary>Advanced workflow and Monad audit</summary><div className="operator-steps">
          <OperatorStep title="Selector eligibility" state={eligibility?.status ?? "NOT CONFIGURED"}>Eligible selectors: {eligibility?.counts.eligible ?? 0}</OperatorStep>
          <OperatorStep title="Campaign mechanism" state={mechanism?.status ?? "NOT PREPARED"}>Snapshots: {mechanism?.snapshots?.length ?? 0}/2</OperatorStep>
          <OperatorStep title="Experiment protocol" state={experiment?.status ?? "NOT PREPARED"}>Rules become immutable when locked.</OperatorStep>
          <OperatorStep title="Monad lifecycle" state={campaign.sourceStatus}><dl className="operator-authority"><div><dt>NETWORK</dt><dd>Monad testnet</dd></div><div><dt>MANAGER</dt><dd>{campaign.onchain?.managerContractAddress ?? "Configured at publication"}</dd></div><div><dt>ONCHAIN CAMPAIGN</dt><dd>{campaign.onchain?.campaignId ?? "Not published"}</dd></div></dl>{intents.length ? intents.map((intent) => <article className="operator-intent" key={intent.id}><Check size={16} /><strong>{intent.action}</strong><span>{humanStatus(intent.status)}</span>{intent.transactionHash ? <a href={`https://testnet.monadexplorer.com/tx/${intent.transactionHash}`} target="_blank" rel="noreferrer">VIEW TX <ExternalLink size={13} /></a> : null}{intent.errorMessage ? <small>{intent.errorMessage}</small> : null}</article>) : <p>No Monad lifecycle transactions yet.</p>}</OperatorStep>
        </div></details>
      </> : null}
    </section>
  </div>;
}

function RosterControls({ rosters, selectorAllowlistId, recipientRosterId, mode, onRosterChange, onModeChange }: { rosters: Roster[]; selectorAllowlistId: string | null; recipientRosterId: string; mode: "DISJOINT_SELECTOR_RECIPIENT" | "OVERLAPPING"; onRosterChange: (value: string) => void; onModeChange: (value: "DISJOINT_SELECTOR_RECIPIENT" | "OVERLAPPING") => void }) {
  const options = rosters.filter((item) => item.id !== selectorAllowlistId);
  return <div className="operator-next-fields"><label className="field"><span>RECIPIENT ROSTER</span><select value={recipientRosterId} onChange={(event) => onRosterChange(event.target.value)}><option value="">Choose a real recipient roster</option>{options.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.members.length} people</option>)}</select></label><label className="field"><span>POPULATION DESIGN</span><select value={mode} onChange={(event) => onModeChange(event.target.value as typeof mode)}><option value="DISJOINT_SELECTOR_RECIPIENT">People choosing cannot receive</option><option value="OVERLAPPING">People choosing may receive</option></select></label>{!options.length ? <p className="operator-inline-empty">No recipient roster exists yet. The organizer must add real TAKE identities before this step can continue.</p> : null}</div>;
}
function RecipientRatings({ recipients, ratings, onChange }: { recipients: RecipientContext["recipients"]; ratings: Record<string, number | undefined>; onChange: (key: string, score: number) => void }) {
  return <div className="operator-ratings"><p>Organizer familiarity is research-only. It never affects eligibility, ordering, TAKE weight, or allocation.</p>{recipients.map((person) => <label key={person.canonicalRecipientKey}><span>{person.displayName}</span><select value={ratings[person.canonicalRecipientKey] ?? ""} onChange={(event) => onChange(person.canonicalRecipientKey, Number(event.target.value))}><option value="">Choose 0–3</option><option value="0">0 · not recognized</option><option value="1">1 · minimally visible</option><option value="2">2 · moderately visible</option><option value="3">3 · highly visible</option></select></label>)}</div>;
}
function OperatorStep({ title, state, children }: { title: string; state: string; children: ReactNode }) { return <section className="operator-step"><header><strong>{title}</strong><span>{humanStatus(state)}</span></header><div>{children}</div></section>; }

function getNextAction(input: { campaign: Campaign | null; eligibility: SelectorEligibilityView | null; mechanism: CampaignMechanismView | null; experiment: ExperimentView | null; allocation: AllocationRun | null; recipientRosterId: string; recipientContext: RecipientContext; ratings: Record<string, number | undefined>; pendingIntent?: LifecycleIntent }): NextAction {
  const { campaign, eligibility, mechanism, experiment, allocation, recipientRosterId, recipientContext, ratings, pendingIntent } = input;
  if (!campaign) return { key: "WAIT", state: "WAITING", title: "Choose a campaign", detail: "Select a managed campaign to inspect its readiness." };
  if (pendingIntent) return { key: "PENDING", state: pendingIntent.status, title: pendingIntent.status === "WAITING_FOR_WALLET" ? `${humanStatus(pendingIntent.action)} is ready for wallet approval` : `${humanStatus(pendingIntent.action)} is in progress`, detail: lifecycleProgress(pendingIntent), blocker: pendingIntent.errorMessage ?? undefined };
  if (!eligibility || ["DRAFT", "EVALUATING"].includes(eligibility.status)) return { key: "ORGANIZER_SETUP", state: "ORGANIZER ACTION", title: "Finish selector eligibility", detail: "The organizer must configure the policy, evaluate real selectors, and resolve reviews before TAKE can lock the roster." };
  if (eligibility.status === "REVIEW") return { key: "LOCK_SELECTORS", state: "READY", title: "Lock the selector roster", detail: `${eligibility.counts.eligible} eligible selectors will each receive exactly one TAKE.`, blocker: eligibility.counts.needsReview > 0 ? `${eligibility.counts.needsReview} selector review${eligibility.counts.needsReview === 1 ? " is" : "s are"} still unresolved.` : undefined };
  if (!mechanism?.config) return { key: recipientRosterId ? "PREPARE_MECHANISM" : "CHOOSE_RECIPIENTS", state: "NEEDS RECIPIENTS", title: recipientRosterId ? "Prepare campaign rules" : "Choose the recipient roster", detail: "Select the real people who may receive this opportunity. For serious pilots, keep selectors and recipients disjoint.", blocker: recipientRosterId ? undefined : "Choose a recipient roster to continue." };
  const snapshotsReady = mechanism.snapshots?.length === 2 && mechanism.snapshots.every((item) => item.status === "READY" || item.status === "LOCKED");
  if (!snapshotsReady) return { key: "BUILD_SNAPSHOTS", state: "READY", title: "Prepare eligibility snapshots", detail: "TAKE will build selector and recipient membership proofs from the final rosters." };
  if (!experiment) {
    if (!recipientContext.recipients.length) return { key: "RATE_RECIPIENTS", state: "BLOCKED", title: "Recipient snapshot is empty", detail: "TAKE cannot preregister a campaign without real eligible recipients.", blocker: "Return to organizer setup and add real recipients to the selected roster." };
    const unrated = recipientContext.recipients.filter((person) => ratings[person.canonicalRecipientKey] === undefined).length;
    return { key: unrated ? "RATE_RECIPIENTS" : "PREREGISTER", state: unrated ? "NEEDS CONTEXT" : "READY", title: unrated ? "Complete recipient context" : "Preregister the campaign protocol", detail: "This research context is recorded before launch and cannot influence allocation.", blocker: unrated ? `${unrated} recipient${unrated === 1 ? " needs" : "s need"} a 0–3 organizer-familiarity value.` : undefined };
  }
  if (mechanism.status !== "LOCKED") return { key: "LOCK_MECHANISM", state: "READY", title: "Lock campaign rules", detail: "This freezes the one-TAKE rule, rosters, seat count, and allocation baseline." };
  if (experiment.status !== "LOCKED") return { key: "LOCK_PROTOCOL", state: "READY", title: "Lock the experiment protocol", detail: "This freezes the information policy and preregistered context." };
  if (!campaign.launchApproved) return { key: "APPROVE", state: "READY FOR LAUNCH", title: "Approve launch", detail: "All required artifacts are locked. Confirm that TAKE may publish this campaign to Monad." };
  if (campaign.sourceStatus === "DRAFT") return { key: "PUBLISH", state: "APPROVED", title: "Publish to Monad", detail: "The designated TAKE operator wallet will create the campaign on the existing Monad testnet manager." };
  if (campaign.sourceStatus === "CREATED") return { key: "ACTIVATE", state: "PUBLISHED", title: "Activate nominations", detail: "The campaign exists on Monad. Activate it so eligible participants can give their TAKE." };
  if (campaign.sourceStatus === "ACTIVE") return Date.now() >= new Date(campaign.endsAt).getTime() ? { key: "CLOSE", state: "READY", title: "Close nominations", detail: "The campaign end time has passed. Close it on Monad before allocation." } : { key: "WAIT", state: "ACTIVE", title: "Campaign is active", detail: `Nominations close ${campaign.ends}. TAKE totals remain hidden until finalization.` };
  if (["CLOSED", "ALLOCATING"].includes(campaign.sourceStatus) && !allocation) return { key: "ALLOCATE", state: "READY", title: "Run the experimental allocation", detail: "Use finalized canonical TAKEs and the frozen campaign rules to calculate recipients." };
  if (allocation && allocation.status !== "COMPLETED" && campaign.sourceStatus !== "FINALIZED") return { key: "WAIT", state: allocation.status, title: "Allocation is processing", detail: "Refresh once the canonical result artifact is complete." };
  if (campaign.sourceStatus !== "FINALIZED" && allocation?.status === "COMPLETED") return { key: "FINALIZE", state: "ALLOCATION READY", title: "Finalize the result", detail: "Commit the completed result hash through the campaign authority wallet." };
  return { key: "COMPLETE", state: "FINALIZED", title: "Campaign complete", detail: "The final recipients and Monad audit trail are ready to show." };
}

function getReadiness(campaign: Campaign | null, eligibility: SelectorEligibilityView | null, mechanism: CampaignMechanismView | null, experiment: ExperimentView | null, allocation: AllocationRun | null) {
  const snapshots = mechanism?.snapshots ?? [];
  return [
    { label: "Givers checked and locked", ready: eligibility?.status === "LOCKED", detail: eligibility ? `${eligibility.counts.eligible} qualified` : "Not configured" },
    { label: "Recipients prepared", ready: Boolean(mechanism?.config), detail: mechanism?.config ? "Campaign rules prepared" : "Organizer action needed" },
    { label: "Eligibility snapshots ready", ready: snapshots.length === 2 && snapshots.every((item) => item.status === "READY" || item.status === "LOCKED"), detail: `${snapshots.length}/2 snapshots` },
    { label: "Campaign rules locked", ready: mechanism?.status === "LOCKED", detail: humanStatus(mechanism?.status ?? "Not locked") },
    { label: "Experiment protocol locked", ready: experiment?.status === "LOCKED", detail: humanStatus(experiment?.status ?? "Not prepared") },
    { label: "Launch approved", ready: Boolean(campaign?.launchApproved), detail: campaign?.launchApproved ? "Approved by TAKE" : "Operator approval needed" },
    { label: "Published on Monad", ready: Boolean(campaign?.onchain?.published), detail: campaign?.onchain?.campaignId ? `Campaign ${campaign.onchain.campaignId}` : "Offchain only" },
    { label: "Allocation complete", ready: campaign?.sourceStatus === "FINALIZED" || allocation?.status === "COMPLETED", detail: allocation ? humanStatus(allocation.status) : "After campaign close" },
  ];
}
function lifecycleProgress(intent: LifecycleIntent) {
  if (intent.status === "WAITING_FOR_WALLET") return "No transaction has been sent. Continue to open the prepared Monad transaction for your approval; TAKE will reuse this same request.";
  if (intent.status === "SUBMITTED") return "Transaction submitted. TAKE is waiting for Monad confirmation.";
  if (intent.status === "CONFIRMING") return "Monad is confirming the transaction.";
  if (intent.status === "INDEXING") return "Transaction confirmed. TAKE is recording the matching contract event.";
  return humanStatus(intent.status);
}
function requiresWallet(key: NextActionKey) {
  return ["PUBLISH", "ACTIVATE", "CLOSE", "FINALIZE", "PENDING"].includes(key);
}
function actionLabel(key: NextActionKey) {
  const labels: Partial<Record<NextActionKey, string>> = { LOCK_SELECTORS: "LOCK SELECTOR ROSTER", PREPARE_MECHANISM: "PREPARE CAMPAIGN RULES", BUILD_SNAPSHOTS: "PREPARE SNAPSHOTS", PREREGISTER: "PREREGISTER PROTOCOL", LOCK_MECHANISM: "LOCK CAMPAIGN RULES", LOCK_PROTOCOL: "LOCK PROTOCOL", APPROVE: "APPROVE LAUNCH", PUBLISH: "PUBLISH TO MONAD", ACTIVATE: "ACTIVATE CAMPAIGN", CLOSE: "CLOSE CAMPAIGN", ALLOCATE: "RUN ALLOCATION", FINALIZE: "FINALIZE RESULT" };
  return labels[key] ?? humanStatus(key);
}
function value<T>(result: PromiseSettledResult<T>, fallback: T): T { return result.status === "fulfilled" ? result.value : fallback; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "TAKE could not complete this operator action."; }
function humanStatus(value: string) { return value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (character) => character.toUpperCase()); }
function productState(campaign: Campaign, mechanism: CampaignMechanismView | null) {
  if (campaign.sourceStatus === "FINALIZED") return "FINALIZED";
  if (campaign.sourceStatus === "CLOSED" || campaign.sourceStatus === "ALLOCATING") return "RESULTS PROCESSING";
  if (campaign.sourceStatus === "ACTIVE") return "ACTIVE";
  if (campaign.sourceStatus === "CREATED") return "PUBLISHED ON MONAD";
  if (campaign.launchApproved) return "READY FOR LAUNCH";
  if (mechanism?.status === "LOCKED") return "RULES LOCKED";
  return "OFFCHAIN DRAFT";
}
