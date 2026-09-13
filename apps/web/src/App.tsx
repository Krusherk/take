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
import { PendingPage } from "./pages/PendingPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ProfileSetupPage } from "./pages/ProfileSetupPage";
import { RecipientViewPage } from "./pages/RecipientViewPage";
import { SuccessPage } from "./pages/SuccessPage";
import { TakesPage } from "./pages/TakesPage";
import type { Person } from "./types/product";

const SELECTION_KEY = "take-selected-recipient";
const GIVEN_KEY = "take-optimistic-given-campaigns";
const NOTIFICATIONS_READ_KEY = "take-notifications-read";

interface StoredSelection { campaignId: string; person: Person }

interface PreparedNomination {
  nomination: { id: string };
  transaction: { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number };
}

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

function readGivenCampaigns(): string[] {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(GIVEN_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function App() {
  const { path, navigate } = usePathRouter();
  const { ready, authenticated, logout } = usePrivy();
  const { status: identityStatus, me, history, error: identityError, request, refetch, clear } = useTakeMe();
  const { campaigns, refetch: refetchProducts } = useTakeProduct();
  const { sendTransaction } = useSendTransaction();
  const [selection, setSelection] = useState<StoredSelection | null>(readStoredSelection);
  const [optimisticGivenCampaigns, setOptimisticGivenCampaigns] = useState<string[]>(readGivenCampaigns);
  const [notificationsRead, setNotificationsRead] = useState(() => window.sessionStorage.getItem(NOTIFICATIONS_READ_KEY) === "true");
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const routeRef = useRef<HTMLDivElement>(null);
  const currentPerson = useMemo(() => me ? personFromMe(me) : null, [me]);
  const campaignRoute = useMemo(() => parseCampaignPath(path), [path]);
  const inviteId = useMemo(() => parseInvitePath(path), [path]);
  const routeCampaign = useMemo(() => campaignRoute
    ? campaigns.find((campaign) => campaign.id === campaignRoute.campaignId)
      ?? (campaignRoute.campaignId === "monad-creator-round" ? campaigns.find((campaign) => campaign.status === "LIVE") : undefined)
    : undefined, [campaignRoute, campaigns]);
  const selectedRecipient = routeCampaign && selection?.campaignId === routeCampaign.id ? selection.person : null;
  const isPublicPath = path === "/" || path === "/onboarding" || Boolean(inviteId);

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
    if ((campaignRoute.step === "confirm" || campaignRoute.step === "pending" || campaignRoute.step === "success") && !selectedRecipient) {
      navigate(campaignPath(routeCampaign, "/give"), { replace: true });
    }
  }, [campaignRoute, navigate, routeCampaign, selectedRecipient]);

  useEffect(() => {
    if (campaignRoute?.step !== "pending" || !routeCampaign || !selectedRecipient) return;
    const timeout = window.setTimeout(() => {
      setOptimisticGivenCampaigns((current) => {
        const next = current.includes(routeCampaign.id) ? current : [...current, routeCampaign.id];
        window.sessionStorage.setItem(GIVEN_KEY, JSON.stringify(next));
        return next;
      });
      void Promise.all([refetch(), refetchProducts()]);
      navigate(campaignPath(routeCampaign, "/success"), { replace: true });
    }, 2300);
    return () => window.clearTimeout(timeout);
  }, [campaignRoute?.step, navigate, refetch, refetchProducts, routeCampaign, selectedRecipient]);

  function clearAuthenticatedUi() {
    setSelection(null);
    setOptimisticGivenCampaigns([]);
    setNotificationsRead(false);
    setTransactionHash(null);
    setSubmitting(false);
    setSubmissionError(null);
    window.sessionStorage.removeItem(SELECTION_KEY);
    window.sessionStorage.removeItem(GIVEN_KEY);
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
    setSubmitting(true);
    setSubmissionError(null);
    try {
      const prepared = await request<PreparedNomination>(`/campaigns/${campaignId}/nominations/prepare`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), recipient: recipient.recipient }),
      });
      const result = await sendTransaction({
        to: prepared.transaction.to,
        data: prepared.transaction.data,
        value: BigInt(prepared.transaction.value),
        chainId: prepared.transaction.chainId,
      }, { sponsor: true });
      await request(`/campaigns/${campaignId}/nominations/${prepared.nomination.id}/submit`, {
        method: "POST",
        body: JSON.stringify({ transactionHash: result.hash }),
      });
      setTransactionHash(result.hash);
      const campaign = campaigns.find((item) => item.id === campaignId);
      if (campaign) navigate(campaignPath(campaign, "/pending"));
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "Your TAKE could not be given. Please try again.");
      setSubmitting(false);
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
  else if (path === "/takes") page = <TakesPage navigate={navigate} optimisticGivenCampaigns={optimisticGivenCampaigns} optimisticRecipient={selection?.person ?? null} />;
  else if (path === "/profile") page = <ProfilePage navigate={navigate} onLogout={signOut} />;
  else if (inviteId) page = <RecipientViewPage nominationId={inviteId} navigate={navigate} />;
  else if (campaignRoute && routeCampaign) {
    if (campaignRoute.step === "give") page = <GivePage campaignId={routeCampaign.id} selected={selectedRecipient} onSelect={(person) => selectRecipient(person, routeCampaign.id)} navigate={navigate} currentPerson={currentPerson!} />;
    else if (campaignRoute.step === "confirm" && selectedRecipient) page = <ConfirmationPage campaignId={routeCampaign.id} recipient={selectedRecipient} navigate={navigate} onConfirm={() => void submitTake(routeCampaign.id, selectedRecipient)} submitting={submitting} error={submissionError} currentPerson={currentPerson!} />;
    else if (campaignRoute.step === "pending" && selectedRecipient) page = <PendingPage recipient={selectedRecipient} currentPerson={currentPerson!} />;
    else if (campaignRoute.step === "success" && selectedRecipient) page = <SuccessPage campaignId={routeCampaign.id} recipient={selectedRecipient} navigate={navigate} transactionHash={transactionHash} currentPerson={currentPerson!} />;
    else page = <CampaignPage campaignId={routeCampaign.id} navigate={navigate} optimisticGivenCampaigns={optimisticGivenCampaigns} optimisticRecipient={selection?.person ?? null} />;
  } else if (campaignRoute) page = <div className="page-container"><ProductLoading label="Loading campaign" /></div>;
  else page = <ExplorePage navigate={navigate} />;

  const route = <div className="route-frame" key={path} ref={routeRef} tabIndex={-1}>{page}</div>;

  if (path === "/" || path === "/onboarding" || inviteId) {
    if (path === "/onboarding" && (!ready || !authenticated || !currentPerson)) return <IdentityGate status={identityStatus} error={identityError} onRetry={() => void refetch()} onSignOut={() => void signOut()} />;
    return route;
  }

  if (!ready || !authenticated || !currentPerson) return <IdentityGate status={identityStatus} error={identityError} onRetry={() => void refetch()} onSignOut={() => void signOut()} />;

  const unreadCount = notificationsRead ? 0 : Math.min(9, (history?.received.length ?? 0) + campaigns.filter((campaign) => campaign.status === "LIVE").length);
  return <AppShell path={path} navigate={navigate} unreadCount={unreadCount} currentPerson={currentPerson} onLogout={signOut}>{route}</AppShell>;
}
