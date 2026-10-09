import { useSendTransaction, useUser, useWallets } from "../lib/privy";
import { Copy, ExternalLink, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TakeApiClient } from "../lib/takeApi";
import type { OrganizePhase } from "../lib/organizePhase";
import { PrimaryAction, SecondaryAction } from "./Actions";
import { useTakeMe } from "../context/TakeIdentityContext";

type SignPhase = Extract<OrganizePhase, "SIGN_TO_PUBLISH" | "SIGN_TO_OPEN">;
type LifecycleAction = "PUBLISH" | "ACTIVATE";
type Intent = {
  id: string;
  action: LifecycleAction | string;
  status: string;
  requiredFromAddress: string | null;
  transactionHash: string | null;
  errorMessage: string | null;
  transaction: { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number };
};

export type SignerFeedback = { tone: "success" | "action" | "error"; title: string; body?: string };

const pendingStatuses = ["WAITING_FOR_WALLET", "SUBMITTED", "CONFIRMING", "INDEXING"];

export function CampaignLaunchSigner({
  campaignId,
  phase,
  request,
  onChanged,
  autoServer = false,
  onFeedback,
}: {
  campaignId: string;
  phase: SignPhase;
  request: TakeApiClient["request"];
  onChanged: () => Promise<void>;
  /** Sign with the TAKE server wallet without a click (set right after "Create campaign"). */
  autoServer?: boolean;
  onFeedback?: (feedback: SignerFeedback) => void;
}) {
  const { me } = useTakeMe();
  const { sendTransaction } = useSendTransaction();
  const { refreshUser } = useUser();
  const { wallets, ready: walletsReady } = useWallets();
  const [intents, setIntents] = useState<Intent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshingWallet, setRefreshingWallet] = useState(false);
  const [serverWallet, setServerWallet] = useState<string | null>(null);
  const [intentsLoaded, setIntentsLoaded] = useState(false);
  const autoTried = useRef<Set<string>>(new Set());
  const primaryWallet = me?.wallets.find((wallet) => wallet.primary && wallet.embedded)?.address
    ?? me?.wallets.find((wallet) => wallet.embedded)?.address
    ?? null;
  const action: LifecycleAction = phase === "SIGN_TO_PUBLISH" ? "PUBLISH" : "ACTIVATE";
  const pending = intents.find((intent) => pendingStatuses.includes(intent.status));
  const authority = pending?.requiredFromAddress ?? primaryWallet;
  const connected = wallets.find((wallet) => wallet.walletClientType === "privy" && wallet.address.toLowerCase() === authority?.toLowerCase());
  const walletReady = walletsReady && Boolean(connected);

  useEffect(() => {
    let cancelled = false;
    void request<Intent[]>(`/operator/campaigns/${campaignId}/lifecycle-intents`)
      .then((rows) => { if (!cancelled) { setIntents(rows); setIntentsLoaded(true); } })
      .catch((caught) => { if (!cancelled) setError(message(caught)); });
    return () => { cancelled = true; };
  }, [campaignId, request]);

  useEffect(() => {
    let cancelled = false;
    void request<{ configured: boolean; address: string | null }>("/operator/server-wallet")
      .then((wallet) => { if (!cancelled) setServerWallet(wallet.configured ? wallet.address : null); })
      .catch(() => { if (!cancelled) setServerWallet(null); });
    return () => { cancelled = true; };
  }, [request]);

  async function signWithServer() {
    setBusy(true);
    setError(null);
    try {
      const result = await request<{ outcome?: string; transactionHash?: string | null }>(`/operator/campaigns/${campaignId}/lifecycle/${action.toLowerCase()}/server-sign`, { method: "POST", body: "{}" });
      setIntents(await request<Intent[]>(`/operator/campaigns/${campaignId}/lifecycle-intents`));
      onFeedback?.(action === "PUBLISH"
        ? { tone: "success", title: "Signed onto Monad.", body: "The TAKE server wallet published it. Nominations open next; TAKE does that too." }
        : { tone: "success", title: "Nominations are opening.", body: "The TAKE server wallet signed. It shows as live in Explore once Monad confirms." });
      await onChanged();
    } catch (caught) {
      setError(message(caught));
      onFeedback?.({ tone: "error", title: "The TAKE server wallet could not sign.", body: message(caught) });
    } finally {
      setBusy(false);
    }
  }

  // Right after "Create campaign" with server signing on: publish, then open
  // nominations, without asking for a click. Each action is tried once.
  useEffect(() => {
    if (!autoServer || !serverWallet || !intentsLoaded || busy) return;
    if (intents.some((intent) => intent.action === action && pendingStatuses.includes(intent.status) && intent.transactionHash)) return;
    const key = `${campaignId}:${action}`;
    if (autoTried.current.has(key)) return;
    autoTried.current.add(key);
    void signWithServer();
  }, [autoServer, serverWallet, intentsLoaded, action, campaignId, intents, busy]);

  const signature = JSON.stringify(intents.map((intent) => [intent.id, intent.status, intent.transactionHash]));
  useEffect(() => {
    if (!intents.some((intent) => ["SUBMITTED", "CONFIRMING", "INDEXING"].includes(intent.status))) return;
    let cancelled = false;
    let timer = 0;
    async function poll() {
      try {
        const latest = await request<Intent[]>(`/operator/campaigns/${campaignId}/lifecycle-intents`);
        if (cancelled) return;
        if (JSON.stringify(latest.map((intent) => [intent.id, intent.status, intent.transactionHash])) !== signature) {
          setIntents(latest);
          await onChanged();
        }
      } catch (caught) {
        if (!cancelled) setError(message(caught));
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(), 3000);
      }
    }
    timer = window.setTimeout(() => void poll(), 3000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [campaignId, onChanged, request, signature, intents]);

  async function sign() {
    setBusy(true);
    setError(null);
    try {
      if (!walletReady || !authority) {
        throw new Error(walletsReady
          ? "Your TAKE wallet is not connected in this browser. Retry the connection, or sign out and back in with the same account."
          : "Your TAKE wallet is still loading.");
      }
      const intent = await request<Intent>(`/operator/campaigns/${campaignId}/lifecycle/${action.toLowerCase()}/prepare`, {
        method: "POST",
        body: "{}",
      });
      setIntents((current) => [intent, ...current.filter((item) => item.id !== intent.id)]);
      if (intent.transactionHash) {
        await onChanged();
        return;
      }
      if (intent.requiredFromAddress && primaryWallet?.toLowerCase() !== intent.requiredFromAddress.toLowerCase()) {
        throw new Error(`Sign with the campaign wallet ${intent.requiredFromAddress}.`);
      }
      const sent = await sendTransaction({
        to: intent.transaction.to,
        data: intent.transaction.data,
        value: BigInt(intent.transaction.value),
        chainId: intent.transaction.chainId,
      }, { address: authority, sponsor: import.meta.env.VITE_PRIVY_SPONSOR_TRANSACTIONS === "true" });
      await request(`/operator/campaigns/${campaignId}/lifecycle-intents/${intent.id}/submit`, {
        method: "POST",
        body: JSON.stringify({ transactionHash: sent.hash, fromAddress: authority }),
      });
      await onChanged();
      const latest = await request<Intent[]>(`/operator/campaigns/${campaignId}/lifecycle-intents`);
      setIntents(latest);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  const waiting = pending && ["SUBMITTED", "CONFIRMING", "INDEXING"].includes(pending.status);
  const shownWallet = serverWallet ?? authority;
  const label = phase == "SIGN_TO_PUBLISH" ? "Sign to publish" : "Sign to open nominations";
  return (
    <div className="organize-sign">
      <div className="organize-sign__wallet">
        <Wallet size={18} />
        <div>
          <span>{serverWallet ? "TAKE server wallet" : "Campaign wallet"}</span>
          <strong>{shownWallet ?? "No TAKE wallet yet"}</strong>
        </div>
        {shownWallet ? <SecondaryAction onClick={() => void copy(shownWallet, setCopied)}>{copied ? "Copied" : "Copy"}<Copy size={14} /></SecondaryAction> : null}
      </div>
      {serverWallet ? (
        <p>The TAKE server wallet {short(serverWallet)} signs this for you. No wallet pop-up.{action === "PUBLISH" ? " It becomes the campaign organizer, so TAKE also closes and finalizes the campaign after it ends." : ""}</p>
      ) : (
        <>
          <p>{walletReady
            ? "This opens a Monad testnet transaction for you to approve. TAKE does not send it until you sign."
            : "Connect the TAKE wallet above before signing. Do not create a second wallet."}</p>
          <p className="organize-sign__gas">{import.meta.env.VITE_PRIVY_SPONSOR_TRANSACTIONS === "true" ? "Gas sponsorship is on." : "This wallet needs testnet MON for gas."}</p>
        </>
      )}
      {error ? <p className="organize-sign__error" role="alert">{error}</p> : null}
      {pending?.errorMessage ? <p className="organize-sign__error" role="alert">{pending.errorMessage}</p> : null}
      {waiting ? <p role="status">{progress(pending.status)}</p> : null}
      <div className="organize-sign__actions">
        {serverWallet && !waiting ? (
          <>
            <PrimaryAction onClick={() => void signWithServer()} disabled={busy}>{busy ? "TAKE is signing…" : action === "PUBLISH" ? "Publish with TAKE" : "Open nominations with TAKE"}</PrimaryAction>
            <SecondaryAction onClick={() => void sign()} disabled={busy || !walletReady}>Sign with my wallet instead</SecondaryAction>
          </>
        ) : (
          <PrimaryAction onClick={() => void sign()} disabled={busy || waiting || !walletReady}>{busy ? "Waiting for wallet…" : label}</PrimaryAction>
        )}
        {!walletReady ? <SecondaryAction onClick={() => void refreshWallet(refreshUser, setRefreshingWallet, setError)} disabled={refreshingWallet}>{refreshingWallet ? "Checking wallet…" : "Retry wallet"}</SecondaryAction> : null}
        {pending?.transactionHash ? <a className="organize-sign__tx" href={`https://testnet.monadexplorer.com/tx/${pending.transactionHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={14} /></a> : null}
      </div>
    </div>
  );
}

async function copy(value: string, setCopied: (copied: boolean) => void) {
  await navigator.clipboard.writeText(value);
  setCopied(true);
  window.setTimeout(() => setCopied(false), 1400);
}

async function refreshWallet(
  refreshUser: () => Promise<unknown>,
  setRefreshing: (value: boolean) => void,
  setError: (value: string | null) => void,
) {
  setRefreshing(true);
  setError(null);
  try { await refreshUser(); }
  catch (caught) { setError(message(caught)); }
  finally { setRefreshing(false); }
}

function progress(status: string) {
  if (status === "SUBMITTED" || status === "CONFIRMING") return "Monad is confirming the signature.";
  if (status === "INDEXING") return "Confirmed. TAKE is recording it now.";
  return "The signature is in progress.";
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "TAKE could not open the wallet.";
}

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
