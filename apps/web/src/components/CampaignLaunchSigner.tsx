import { useSendTransaction, useUser, useWallets } from "@privy-io/react-auth";
import { Copy, ExternalLink, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
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

const pendingStatuses = ["WAITING_FOR_WALLET", "SUBMITTED", "CONFIRMING", "INDEXING"];

export function CampaignLaunchSigner({
  campaignId,
  phase,
  request,
  onChanged,
}: {
  campaignId: string;
  phase: SignPhase;
  request: TakeApiClient["request"];
  onChanged: () => Promise<void>;
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
      .then((rows) => { if (!cancelled) setIntents(rows); })
      .catch((caught) => { if (!cancelled) setError(message(caught)); });
    return () => { cancelled = true; };
  }, [campaignId, request]);

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
  const label = phase === "SIGN_TO_PUBLISH" ? "Sign to publish" : "Sign to open nominations";
  return (
    <div className="organize-sign">
      <div className="organize-sign__wallet">
        <Wallet size={18} />
        <div>
          <span>Campaign wallet</span>
          <strong>{authority ?? "No TAKE wallet yet"}</strong>
        </div>
        {authority ? <SecondaryAction onClick={() => void copy(authority, setCopied)}>{copied ? "Copied" : "Copy"}<Copy size={14} /></SecondaryAction> : null}
      </div>
      <p>{walletReady
        ? "This opens a Monad testnet transaction for you to approve. TAKE does not send it until you sign."
        : "Connect the TAKE wallet above before signing. Do not create a second wallet."}</p>
      <p className="organize-sign__gas">{import.meta.env.VITE_PRIVY_SPONSOR_TRANSACTIONS === "true" ? "Gas sponsorship is on." : "This wallet needs testnet MON for gas."}</p>
      {error ? <p className="organize-sign__error" role="alert">{error}</p> : null}
      {pending?.errorMessage ? <p className="organize-sign__error" role="alert">{pending.errorMessage}</p> : null}
      {waiting ? <p role="status">{progress(pending.status)}</p> : null}
      <div className="organize-sign__actions">
        <PrimaryAction onClick={() => void sign()} disabled={busy || waiting || !walletReady}>{busy ? "Waiting for wallet…" : label}</PrimaryAction>
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
