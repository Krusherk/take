import { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useSendTransaction } from "@privy-io/react-auth";
import { AppShell } from "./components/AppShell";
import { IdentityGate } from "./components/IdentityGate";
import { ProductLoading } from "./components/ProductState";
import { useTakeMe } from "./context/TakeIdentityContext";
import { useTakeProduct } from "./context/TakeProductContext";
import { usePathRouter } from "./hooks/usePathRouter";
import { personFromMe } from "./lib/currentIdentity";
import { campaignPath, parseCampaignPath, parseInvitePath } from "./lib/productData";
import { ActivityPage } from "./pages/ActivityPage";
import { CampaignPage } from "./pages/CampaignPage";
import { ConfirmationPage } from "./pages/ConfirmationPage";
import { ExplorePage } from "./pages/ExplorePage";
import { GivePage } from "./pages/GivePage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { OrganizePage } from "./pages/OrganizePage";
import { OperatorPage } from "./pages/OperatorPage";
import { PendingPage } from "./pages/PendingPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ProfileSetupPage } from "./pages/ProfileSetupPage";
import { RecipientViewPage } from "./pages/RecipientViewPage";
import { SuccessPage } from "./pages/SuccessPage";
import { TakesPage } from "./pages/TakesPage";
import type { Person } from "./types/product";

const SELECTION_KEY = "take-selected-recipient";
const NOTIFICATIONS_READ_KEY = "take-notifications-read";

interface StoredSelection { campaignId: string; person: Person }

interface PreparedNomination {
  nomination: { id: string };
  transaction: { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number };
}

interface RegistrationStatus {
  registered: boolean;
  walletAuthorized: boolean;
  walletAddress: string;
  limitation?: string;
  transaction: null | { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number };
}

interface NominationStatus {
  id: string;
  status: string;
  transactionHash: string | null;
  failureReason: string | null;
  chainConfirmed: boolean;
  canonical: boolean;
}

export type TakeSubmissionPhase = "PREPARING" | "REGISTERING_IDENTITY" | "WAITING_FOR_WALLET" | "SUBMITTED" | "CONFIRMED_ON_MONAD" | "RECORDING";

function readStoredSelection(): StoredSelection | null {
  try {
    const value = window.sessionStorage.getItem(SELECTION_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as StoredSelection;
    return parsed?.campaignId && parsed.person?.id && parsed.person?.recipient ? parsed : null;
  } catch {
    return null;
  }
}

export function App() {
  const { path, navigate } = usePathRouter();
  const { ready, authenticated, logout } = usePrivy();
  const { status: identityStatus, me, history, error: identityError, request, refetch, clear } = useTakeMe();
  const { campaigns, refetch: refetchProducts } = useTakeProduct();
  const { sendTransaction } = useSendTransaction();
  const [selection, setSelection] = useState<StoredSelection | null>(readStoredSelection);
  const [optimisticGivenCampaigns, setOptimisticGivenCampaigns] = useState<string[]>([]);
  const [notificationsRead, setNotificationsRead] = useState(() => window.sessionStorage.getItem(NOTIFICATIONS_READ_KEY) === "true");
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionPhase, setSubmissionPhase] = useState<TakeSubmissionPhase>("PREPARING");
  const [nominationId, setNominationId] = useState<string | null>(null);
  const routeRef = useRef<HTMLDivElement>(null);
  const currentPerson = useMemo(() => me ? personFromMe(me) : null, [me]);
  const participantWallet = me?.wallets.find((wallet) => wallet.primary && wallet.embedded)?.address
    ?? me?.wallets.find((wallet) => wallet.embedded)?.address
    ?? null;
  const campaignRoute = useMemo(() => parseCampaignPath(path), [path]);
  const inviteId = useMemo(() => parseInvitePath(path), [path]);
  const routeCampaign = useMemo(() => campaignRoute
    ? campaigns.find((campaign) => campaign.id === campaignRoute.campaignId)
      ?? (campaignRoute.campaignId === "monad-creator-round" ? campaigns.find((campaign) => campaign.status === "LIVE") : undefined)
    : undefined, [campaignRoute, campaigns]);
  const selectedRecipient = routeCampaign && selection?.campaignId === routeCampaign.id ? selection.person : null;
  const publicCampaignDetail = campaignRoute?.step === "detail";
  const isPublicPath = path === "/" || path === "/onboarding" || Boolean(inviteId) || publicCampaignDetail;

  useEffect(() => {
    const title = path === "/" ? "TAKE · Give the spot to someone else" : path === "/notifications" ? "Notifications · TAKE" : path === "/activity" ? "Activity · TAKE" : campaignRoute?.step === "success" && selectedRecipient ? `You gave ${selectedRecipient.name} your TAKE` : "TAKE · Give the opportunity forward";
    document.title = title;
    routeRef.current?.focus({ preventScroll: true });
  }, [campaignRoute?.step, path, selectedRecipient]);

  useEffect(() => {
    if (ready && !authenticated && !isPublicPath) navigate("/", { replace: true });
  }, [authenticated, isPublicPath, navigate, ready]);

  useEffect(() => {
    if (!campaignRoute || !routeCampaign) return;
    if (
      (campaignRoute.step === "give" || campaignRoute.step === "confirm")
      && (routeCampaign.status !== "LIVE" || routeCampaign.sourceStatus !== "ACTIVE")
    ) {
      navigate(campaignPath(routeCampaign), { replace: true });
      return;
    }
    if ((campaignRoute.step === "confirm" || campaignRoute.step === "pending" || campaignRoute.step === "success") && !selectedRecipient) {
      navigate(campaignPath(routeCampaign, "/give"), { replace: true });
    }
  }, [campaignRoute, navigate, routeCampaign, selectedRecipient]);

  function clearAuthenticatedUi() {
    setSelection(null);
    setOptimisticGivenCampaigns([]);
    setNotificationsRead(false);
    setTransactionHash(null);
    setSubmitting(false);
    setSubmissionError(null);
    setSubmissionPhase("PREPARING");
    setNominationId(null);
    window.sessionStorage.removeItem(SELECTION_KEY);
    window.sessionStorage.removeItem(NOTIFICATIONS_READ_KEY);
    window.sessionStorage.removeItem("take-onboarding-pending");
  }

  async function signOut() {
    clear();
    clearAuthenticatedUi();
    try {
      await logout();
      navigate("/", { replace: true });
    } catch (error) {
      await refetch();
      throw error;
    }
  }

  function selectRecipient(person: Person, campaignId: string) {
    const next = { person, campaignId };
    setSelection(next);
    window.sessionStorage.setItem(SELECTION_KEY, JSON.stringify(next));
  }

  async function submitTake(campaignId: string, recipient: Person) {
    const activeCampaign = campaigns.find((item) => item.id === campaignId);
    if (!activeCampaign || activeCampaign.status !== "LIVE" || activeCampaign.sourceStatus !== "ACTIVE") {
      setSubmissionError("This campaign is not active yet. Return after TAKE publishes and activates it on Monad.");
      setSubmitting(false);
      if (activeCampaign) navigate(campaignPath(activeCampaign), { replace: true });
      return;
    }
    setSubmitting(true);
    setSubmissionError(null);
    try {
      setSubmissionPhase("PREPARING");
      let registration = await request<RegistrationStatus>("/me/registration/status");
      if (!registration.walletAuthorized) {
        if (!registration.transaction) throw new Error(registration.limitation ?? "Your TAKE wallet is not authorized for this campaign manager.");
        setSubmissionPhase("REGISTERING_IDENTITY");
        await sendTransaction({
          to: registration.transaction.to,
          data: registration.transaction.data,
          value: BigInt(registration.transaction.value),
          chainId: registration.transaction.chainId,
        }, { address: registration.walletAddress, sponsor: import.meta.env.VITE_PRIVY_SPONSOR_TRANSACTIONS === "true" });
        registration = await pollRegistration(request);
      }
      const prepared = await request<PreparedNomination>(`/campaigns/${campaignId}/nominations/prepare`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), recipient: recipient.recipient }),
      });
      setNominationId(prepared.nomination.id);
      setSubmissionPhase("WAITING_FOR_WALLET");
      const result = await sendTransaction({
        to: prepared.transaction.to,
        data: prepared.transaction.data,
        value: BigInt(prepared.transaction.value),
        chainId: prepared.transaction.chainId,
      }, { address: registration.walletAddress, sponsor: import.meta.env.VITE_PRIVY_SPONSOR_TRANSACTIONS === "true" });
      setTransactionHash(result.hash);
      setSubmissionPhase("SUBMITTED");
      const campaign = campaigns.find((item) => item.id === campaignId);
      if (campaign) navigate(campaignPath(campaign, "/pending"));
      await submitNominationWithRetry(request, campaignId, prepared.nomination.id, result.hash, registration.walletAddress);
      const final = await pollNomination(request, campaignId, prepared.nomination.id, (status) => {
        setSubmissionPhase(status.chainConfirmed ? "CONFIRMED_ON_MONAD" : "SUBMITTED");
      });
      if (!final.canonical) throw new Error(final.failureReason ?? "TAKE could not finalize the canonical nomination edge.");
      setSubmissionPhase("RECORDING");
      setOptimisticGivenCampaigns((current) => current.includes(campaignId) ? current : [...current, campaignId]);
      await Promise.all([refetch(), refetchProducts()]);
      if (campaign) navigate(campaignPath(campaign, "/success"), { replace: true });
    } catch (error) {
      setSubmissionError(submissionErrorMessage(error, participantWallet));
      setSubmitting(false);
      const campaign = campaigns.find((item) => item.id === campaignId);
      if (campaign && campaignRoute?.step === "pending") navigate(campaignPath(campaign, "/confirm"), { replace: true });
    }
  }

  let page;
  if (path === "/") page = <LoginPage navigate={navigate} />;
  else if (path === "/onboarding") page = <ProfileSetupPage navigate={navigate} />;
  else if (path === "/home") page = <HomePage navigate={navigate} currentPerson={currentPerson!} optimisticGivenCampaigns={optimisticGivenCampaigns} optimisticRecipient={selection?.person ?? null} />;
  else if (path === "/explore") page = <ExplorePage navigate={navigate} />;
  else if (path === "/activity") page = <ActivityPage navigate={navigate} />;
  else if (path === "/notifications") page = <NotificationsPage navigate={navigate} read={notificationsRead} onMarkRead={() => { setNotificationsRead(true); window.sessionStorage.setItem(NOTIFICATIONS_READ_KEY, "true"); }} />;
  else if (path === "/organize") page = <OrganizePage navigate={navigate} />;
  else if (path === "/operator") page = <OperatorPage />;
  else if (path === "/takes") page = <TakesPage navigate={navigate} optimisticGivenCampaigns={optimisticGivenCampaigns} optimisticRecipient={selection?.person ?? null} />;
  else if (path === "/profile") page = <ProfilePage navigate={navigate} onLogout={signOut} />;
  else if (inviteId) page = <RecipientViewPage nominationId={inviteId} navigate={navigate} />;
  else if (campaignRoute?.step === "detail") page = <CampaignPage campaignId={campaignRoute.campaignId} navigate={navigate} optimisticGivenCampaigns={optimisticGivenCampaigns} optimisticRecipient={selection?.person ?? null} />;
  else if (campaignRoute && routeCampaign) {
    if (campaignRoute.step === "give") page = <GivePage campaignId={routeCampaign.id} selected={selectedRecipient} onSelect={(person) => selectRecipient(person, routeCampaign.id)} navigate={navigate} currentPerson={currentPerson!} />;
    else if (campaignRoute.step === "confirm" && selectedRecipient) page = <ConfirmationPage campaignId={routeCampaign.id} recipient={selectedRecipient} navigate={navigate} onConfirm={() => void submitTake(routeCampaign.id, selectedRecipient)} submitting={submitting} error={submissionError} currentPerson={currentPerson!} walletAddress={participantWallet} />;
    else if (campaignRoute.step === "pending" && selectedRecipient) page = <PendingPage recipient={selectedRecipient} currentPerson={currentPerson!} phase={submissionPhase} transactionHash={transactionHash} nominationId={nominationId} />;
    else if (campaignRoute.step === "success" && selectedRecipient) page = <SuccessPage campaignId={routeCampaign.id} recipient={selectedRecipient} navigate={navigate} transactionHash={transactionHash} currentPerson={currentPerson!} />;
    else page = <CampaignPage campaignId={routeCampaign.id} navigate={navigate} optimisticGivenCampaigns={optimisticGivenCampaigns} optimisticRecipient={selection?.person ?? null} />;
  } else if (campaignRoute) page = <div className="page-container"><ProductLoading label="Loading campaign" /></div>;
  else page = <ExplorePage navigate={navigate} />;

  const route = <div className="route-frame" key={path} ref={routeRef} tabIndex={-1}>{page}</div>;

  if (path === "/" || path === "/onboarding" || inviteId || (publicCampaignDetail && !currentPerson)) {
    if (path === "/onboarding" && (!ready || !authenticated || !currentPerson)) return <IdentityGate status={identityStatus} error={identityError} onRetry={() => void refetch()} onSignOut={() => void signOut()} />;
    return route;
  }

  if (!ready || !authenticated || !currentPerson) return <IdentityGate status={identityStatus} error={identityError} onRetry={() => void refetch()} onSignOut={() => void signOut()} />;

  const unreadCount = notificationsRead ? 0 : Math.min(9, (history?.received.length ?? 0) + campaigns.filter((campaign) => campaign.status === "LIVE").length);
  return <AppShell path={path} navigate={navigate} unreadCount={unreadCount} currentPerson={currentPerson} onLogout={signOut}>{route}</AppShell>;
}

async function pollRegistration(request: ReturnType<typeof useTakeMe>["request"]): Promise<RegistrationStatus> {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await delay(2_000);
    const status = await request<RegistrationStatus>("/me/registration/status");
    if (status.walletAuthorized) return status;
  }
  throw new Error("Identity registration is still confirming on Monad. Please retry shortly.");
}

async function pollNomination(
  request: ReturnType<typeof useTakeMe>["request"],
  campaignId: string,
  nominationId: string,
  onStatus: (status: NominationStatus) => void,
): Promise<NominationStatus> {
  let latest: NominationStatus | null = null;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    latest = await request<NominationStatus>(`/campaigns/${campaignId}/nominations/${nominationId}`);
    onStatus(latest);
    if (latest.canonical) return latest;
    if (latest.status === "FAILED") throw new Error(latest.failureReason ?? "The TAKE transaction could not be recorded.");
    await delay(2_000);
  }
  if (latest?.chainConfirmed) throw new Error("Transaction confirmed on Monad, but indexing is delayed. Your TAKE is not lost; check this campaign again shortly.");
  throw new Error("Monad confirmation is taking longer than expected. Check the transaction before trying again.");
}

function delay(ms: number) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }

async function submitNominationWithRetry(
  request: ReturnType<typeof useTakeMe>["request"],
  campaignId: string,
  nominationId: string,
  transactionHash: string,
  fromAddress: string,
) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      return await request(`/campaigns/${campaignId}/nominations/${nominationId}/submit`, {
        method: "POST",
        body: JSON.stringify({ transactionHash, fromAddress }),
      });
    } catch (caught) {
      const code = typeof caught === "object" && caught && "code" in caught ? String(caught.code) : "";
      if (code !== "TRANSACTION_NOT_FOUND" || attempt === 14) throw caught;
      await delay(2_000);
    }
  }
}

function submissionErrorMessage(error: unknown, walletAddress: string | null) {
  const message = error instanceof Error ? error.message : "Your TAKE could not be given. Please try again.";
  if (/insufficient funds|insufficient balance|gas funds|not enough.*gas/i.test(message)) {
    return `This TAKE wallet needs Monad testnet MON before it can submit: ${walletAddress ?? "wallet unavailable"}. Fund it, then try again.`;
  }
  if (/user rejected|rejected by user|denied transaction/i.test(message)) return "You cancelled the wallet request. Your TAKE has not been used.";
  return message;
}
