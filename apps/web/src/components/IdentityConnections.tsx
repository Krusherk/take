import {
  Copy,
  Link2,
  Wallet,
} from "lucide-react";
import {
  useLinkAccount,
  useUnlinkOAuth,
  useUnlinkWallet,
  useUser,
} from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTakeMe } from "../context/TakeIdentityContext";
import type { TakeMe } from "../types/identity";
import { SocialBrandIcon } from "./SocialBrandIcon";

type ConnectionKey = "twitter" | "discord" | "github" | `wallet:${string}`;

type DisconnectTarget =
  | { key: ConnectionKey; label: string; kind: "oauth"; provider: "twitter" | "discord" | "github"; subject: string }
  | { key: ConnectionKey; label: string; kind: "wallet"; address: string };

interface ConnectionRowProps {
  icon: ReactNode;
  label: string;
  identity: string;
  connected: boolean;
  actionLabel?: ReactNode;
  busy?: boolean;
  onAction?: () => void;
}

function ConnectionRow({ icon, label, identity, connected, actionLabel, busy, onAction }: ConnectionRowProps) {
  return (
    <div className="connection-row">
      <span className="connection-row__mark" aria-hidden="true">{icon}</span>
      <div className="connection-row__identity">
        <strong>{label}</strong>
        <span>{identity}</span>
      </div>
      <span className={`connection-row__state${connected ? " is-connected" : ""}`}>
        <i aria-hidden="true" />
        {connected ? "CONNECTED" : "NOT CONNECTED"}
      </span>
      {actionLabel && onAction ? (
        <button type="button" disabled={busy} onClick={onAction}>
          {busy ? "WORKING…" : actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function DisconnectDialog({ target, busy, error, onCancel, onConfirm }: {
  target: DisconnectTarget;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel]);

  return (
    <div className="disconnect-dialog-layer" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) onCancel();
    }}>
      <section className="disconnect-dialog" role="dialog" aria-modal="true" aria-labelledby="disconnect-title">
        <span className="eyebrow">CONNECTED IDENTITY</span>
        <h2 id="disconnect-title">Disconnect {target.label}?</h2>
        <p>Your TAKE history will remain. This only removes {target.label} from your connected identities.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="disconnect-dialog__actions">
          <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel}>CANCEL</button>
          <button className="is-danger" type="button" disabled={busy} onClick={onConfirm}>
            {busy ? "DISCONNECTING…" : "DISCONNECT"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function IdentityConnections({ me }: { me: TakeMe }) {
  const { refetch } = useTakeMe();
  const { refreshUser } = useUser();
  const { unlink: unlinkOAuth } = useUnlinkOAuth();
  const { unlink: unlinkWallet } = useUnlinkWallet();
  const [working, setWorking] = useState<ConnectionKey | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<DisconnectTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null);

  const synchronize = useCallback(async (message: string) => {
    await refreshUser();
    await refetch();
    setWorking(null);
    setError(null);
    setNotice(message);
  }, [refetch, refreshUser]);

  const { linkTwitter, linkDiscord, linkGithub, linkWallet } = useLinkAccount({
    onSuccess: () => void synchronize("CONNECTED TO TAKE"),
    onError: (caught) => {
      setWorking(null);
      setError(privyError(caught, "That identity could not be connected."));
    },
  });

  function beginLink(key: ConnectionKey, link: () => void) {
    setError(null);
    setNotice(null);
    setWorking(key);
    link();
  }

  async function confirmDisconnect() {
    if (!disconnectTarget) return;
    setWorking(disconnectTarget.key);
    setError(null);
    try {
      if (disconnectTarget.kind === "oauth") {
        await unlinkOAuth({ provider: disconnectTarget.provider, subject: disconnectTarget.subject });
      } else {
        await unlinkWallet({ address: disconnectTarget.address });
      }
      const label = disconnectTarget.label;
      setDisconnectTarget(null);
      await synchronize(`${label.toUpperCase()} DISCONNECTED`);
    } catch (caught) {
      setWorking(null);
      setError(privyError(caught, "That identity could not be disconnected. Keep at least one sign-in method connected."));
    }
  }

  async function copyWallet(address: string) {
    await navigator.clipboard.writeText(address);
    setCopiedWallet(address);
    setNotice("TAKE WALLET ADDRESS COPIED");
    window.setTimeout(() => setCopiedWallet((current) => current === address ? null : current), 1_500);
  }

  const twitter = me.socials.twitter;
  const discord = me.socials.discord;
  const github = me.socials.github;

  return (
    <section className="identity-connections" id="identity-connections" aria-labelledby="connections-heading">
      <header className="section-heading identity-connections__heading">
        <div>
          <span className="eyebrow">CONNECTED IDENTITIES</span>
          <h2 id="connections-heading">Where people know you.</h2>
        </div>
        <p>Social identity stays in front. Wallets remain underneath.</p>
      </header>

      <div className="connection-list">
        <ConnectionRow
          icon={<SocialBrandIcon brand="x" />}
          label="X"
          identity={twitter.connected ? socialIdentity(twitter.username, twitter.name) : "Connect your social profile"}
          connected={twitter.connected}
          actionLabel={twitter.connected && twitter.subject ? "DISCONNECT" : "CONNECT"}
          busy={working === "twitter"}
          onAction={twitter.connected && twitter.subject
            ? () => setDisconnectTarget({ key: "twitter", kind: "oauth", provider: "twitter", subject: twitter.subject!, label: "X" })
            : () => beginLink("twitter", linkTwitter)}
        />
        <ConnectionRow
          icon={<SocialBrandIcon brand="discord" />}
          label="DISCORD"
          identity={discord.connected ? socialIdentity(discord.username) : "Not connected"}
          connected={discord.connected}
          actionLabel={discord.connected && discord.subject ? "DISCONNECT" : "CONNECT"}
          busy={working === "discord"}
          onAction={discord.connected && discord.subject
            ? () => setDisconnectTarget({ key: "discord", kind: "oauth", provider: "discord", subject: discord.subject!, label: "Discord" })
            : () => beginLink("discord", linkDiscord)}
        />
        <ConnectionRow
          icon={<SocialBrandIcon brand="github" />}
          label="GITHUB"
          identity={github.connected ? socialIdentity(github.username, github.name) : "Not connected"}
          connected={github.connected}
          actionLabel={github.connected && github.subject ? "DISCONNECT" : "CONNECT"}
          busy={working === "github"}
          onAction={github.connected && github.subject
            ? () => setDisconnectTarget({ key: "github", kind: "oauth", provider: "github", subject: github.subject!, label: "GitHub" })
            : () => beginLink("github", linkGithub)}
        />

        {me.wallets.map((wallet) => {
          const key = `wallet:${wallet.address}` as const;
          return (
            <ConnectionRow
              key={wallet.address}
              icon={<Wallet size={18} strokeWidth={1.7} />}
              label={wallet.embedded ? "TAKE WALLET" : "WALLET"}
              identity={shortAddress(wallet.address)}
              connected
              actionLabel={wallet.embedded ? <><Copy size={14} />{copiedWallet === wallet.address ? "COPIED" : "COPY"}</> : "DISCONNECT"}
              busy={working === key}
              onAction={wallet.embedded ? () => void copyWallet(wallet.address) : () => setDisconnectTarget({ key, kind: "wallet", address: wallet.address, label: "wallet" })}
            />
          );
        })}
        <ConnectionRow
          icon={<Link2 size={18} strokeWidth={1.7} />}
          label="EXTERNAL WALLET"
          identity="Add another wallet"
          connected={false}
          actionLabel="CONNECT"
          busy={working === "wallet:new"}
          onAction={() => beginLink("wallet:new", () => linkWallet())}
        />
      </div>

      {notice ? <p className="connection-notice" role="status">{notice}</p> : null}
      {error && !disconnectTarget ? <p className="form-error connection-error" role="alert">{error}</p> : null}
      {disconnectTarget ? (
        <DisconnectDialog
          target={disconnectTarget}
          busy={working === disconnectTarget.key}
          error={error}
          onCancel={() => {
            if (working !== disconnectTarget.key) {
              setDisconnectTarget(null);
              setError(null);
            }
          }}
          onConfirm={() => void confirmDisconnect()}
        />
      ) : null}
    </section>
  );
}

function socialIdentity(username?: string, displayName?: string): string {
  if (username) return `@${username.replace(/^@/, "")}`;
  return displayName ?? "Connected";
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function privyError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
