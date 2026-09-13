import { Check, Copy, Link2, LockKeyhole, RefreshCw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PrimaryAction, SecondaryAction } from "../components/Actions";
import { ProductError, ProductLoading, SocialEmpty } from "../components/ProductState";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import type { Campaign } from "../types/product";
import type {
  CampaignMechanismView,
  DiscordIntegrationView,
  SnapshotDetail,
  TakeOrganizationMembership,
} from "../types/mechanism";

type LoadState = "loading" | "ready" | "error";

export function OrganizePage({ navigate }: { navigate: (path: TakePath) => void }) {
  const { request } = useTakeMe();
  const { campaigns } = useTakeProduct();
  const [organizations, setOrganizations] = useState<TakeOrganizationMembership[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [mechanism, setMechanism] = useState<CampaignMechanismView | null>(null);
  const [snapshotDetails, setSnapshotDetails] = useState<SnapshotDetail[]>([]);
  const [discord, setDiscord] = useState<DiscordIntegrationView | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"snapshot" | "lock" | "discord" | null>(null);
  const [confirmingLock, setConfirmingLock] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const discordConnected = new URLSearchParams(window.location.search).get("discord") === "connected";

  const manageableOrganizations = useMemo(
    () => organizations.filter((organization) => organization.role === "OWNER" || organization.role === "ADMIN"),
    [organizations],
  );
  const organizationCampaigns = useMemo(
    () => campaigns.filter((campaign) => campaign.organizationId === organizationId),
    [campaigns, organizationId],
  );
  const selectedCampaign = organizationCampaigns.find((campaign) => campaign.id === campaignId) ?? null;

  const loadOrganizations = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await request<TakeOrganizationMembership[]>("/organizations/mine");
      setOrganizations(result);
      const firstManager = result.find((organization) => organization.role === "OWNER" || organization.role === "ADMIN");
      setOrganizationId((current) => current && result.some((organization) => organization.id === current)
        ? current
        : firstManager?.id ?? null);
      setState("ready");
    } catch (caught) {
      setState("error");
      setError(message(caught));
    }
  }, [request]);

  const loadMechanism = useCallback(async (nextCampaignId: string) => {
    setError(null);
    try {
      const view = await request<CampaignMechanismView>(`/campaigns/${nextCampaignId}/mechanism`);
      setMechanism(view);
      const details = view.snapshots?.length
        ? await Promise.all(view.snapshots.map((snapshot) =>
            request<SnapshotDetail>(`/campaigns/${nextCampaignId}/evidence-snapshots/${snapshot.id}`),
          ))
        : [];
      setSnapshotDetails(details);
    } catch (caught) {
      setMechanism(null);
      setSnapshotDetails([]);
      setError(message(caught));
    }
  }, [request]);

  const loadDiscord = useCallback(async (nextOrganizationId: string) => {
    try {
      setDiscord(await request<DiscordIntegrationView>(`/organizations/${nextOrganizationId}/integrations/discord`));
    } catch {
      setDiscord(null);
    }
  }, [request]);

  useEffect(() => { void loadOrganizations(); }, [loadOrganizations]);

  useEffect(() => {
    if (!organizationId) return;
    const next = organizationCampaigns.find((campaign) => campaign.sourceStatus === "DRAFT")
      ?? organizationCampaigns[0];
    setCampaignId((current) => current && organizationCampaigns.some((campaign) => campaign.id === current)
      ? current
      : next?.id ?? null);
    void loadDiscord(organizationId);
  }, [loadDiscord, organizationCampaigns, organizationId]);

  useEffect(() => {
    if (campaignId) void loadMechanism(campaignId);
    else {
      setMechanism(null);
      setSnapshotDetails([]);
    }
  }, [campaignId, loadMechanism]);

  async function buildSnapshots() {
    if (!campaignId) return;
    setAction("snapshot");
    setError(null);
    try {
      await request(`/campaigns/${campaignId}/evidence-snapshots`, { method: "POST" });
      await loadMechanism(campaignId);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setAction(null);
    }
  }

  async function lockMechanism() {
    if (!campaignId) return;
    setAction("lock");
    setError(null);
    try {
      await request(`/campaigns/${campaignId}/mechanism/lock`, { method: "POST" });
      setConfirmingLock(false);
      await loadMechanism(campaignId);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setAction(null);
    }
  }

  async function installDiscord() {
    if (!organizationId) return;
    setAction("discord");
    setError(null);
    try {
      const result = await request<{ installUrl: string }>(`/organizations/${organizationId}/integrations/discord/install`, {
        method: "POST",
        body: "{}",
      });
      window.location.assign(result.installUrl);
    } catch (caught) {
      setError(message(caught));
      setAction(null);
    }
  }

  async function copyHash() {
    if (!mechanism?.configHash) return;
    try {
      await navigator.clipboard.writeText(mechanism.configHash);
      setCopiedHash(true);
      window.setTimeout(() => setCopiedHash(false), 1400);
    } catch {
      setError("Your browser could not copy the mechanism hash.");
    }
  }

  if (state === "loading") return <div className="page-container"><ProductLoading label="Loading organizer access" /></div>;
  if (state === "error") return <div className="page-container"><ProductError message={error ?? "Organizer access could not load."} onRetry={() => void loadOrganizations()} /></div>;

  return (
    <div className="page-container organize-page">
      <header className="page-intro organize-intro">
        <div><span className="eyebrow">ORGANIZE</span><h1>Mechanism control.</h1></div>
        <p>Evidence becomes eligibility only when the campaign snapshot is complete and locked.</p>
      </header>

      {discordConnected ? <div className="organize-notice"><Check size={18} />Discord community evidence is connected.</div> : null}
      {error ? <div className="organize-error" role="alert"><ShieldAlert size={18} /><span>{error}</span></div> : null}

      {!manageableOrganizations.length ? (
        <SocialEmpty title="No campaigns to manage." action="BACK TO HOME" onAction={() => navigate("/home")}>Organizer controls appear for organization owners and admins.</SocialEmpty>
      ) : (
        <>
          <section className="organize-selector" aria-label="Organizer scope">
            <label><span>ORGANIZATION</span><select value={organizationId ?? ""} onChange={(event) => setOrganizationId(event.target.value)}>{manageableOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} / {organization.role}</option>)}</select></label>
            <label><span>CAMPAIGN</span><select value={campaignId ?? ""} onChange={(event) => setCampaignId(event.target.value)} disabled={!organizationCampaigns.length}>{organizationCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title} / {campaign.sourceStatus}</option>)}</select></label>
          </section>

          {!selectedCampaign ? (
            <SocialEmpty title="No campaign drafts here.">Create a campaign draft before configuring evidence and eligibility.</SocialEmpty>
          ) : mechanism ? (
            <MechanismWorkspace
              campaign={selectedCampaign}
              mechanism={mechanism}
              snapshots={snapshotDetails}
              action={action}
              confirmingLock={confirmingLock}
              copiedHash={copiedHash}
              onBuildSnapshots={() => void buildSnapshots()}
              onConfirmLock={() => setConfirmingLock(true)}
              onCancelLock={() => setConfirmingLock(false)}
              onLock={() => void lockMechanism()}
              onCopyHash={() => void copyHash()}
            />
          ) : <ProductLoading label="Loading mechanism" />}

          <section className="organize-discord">
            <div><span className="eyebrow">DISCORD EVIDENCE</span><h2>Community connection</h2><p>TAKE checks only known candidate membership, role IDs, and join time. It does not read messages.</p></div>
            <div className="organize-discord__status">
              {discord?.integrations.length ? discord.integrations.map((integration) => <div key={integration.id}><i className="is-connected" /><span><strong>{integration.guildName}</strong><small>GUILD / {integration.guildId}</small></span><em>{integration.status}</em></div>) : <p>{discord?.configured ? "No Discord guild connected." : "Discord provider credentials are not configured."}</p>}
              <SecondaryAction onClick={() => void installDiscord()} disabled={!discord?.configured || action === "discord"} arrow="up"><Link2 size={16} />{action === "discord" ? "OPENING DISCORD" : "CONNECT GUILD"}</SecondaryAction>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function MechanismWorkspace({ campaign, mechanism, snapshots, action, confirmingLock, copiedHash, onBuildSnapshots, onConfirmLock, onCancelLock, onLock, onCopyHash }: {
  campaign: Campaign;
  mechanism: CampaignMechanismView;
  snapshots: SnapshotDetail[];
  action: "snapshot" | "lock" | "discord" | null;
  confirmingLock: boolean;
  copiedHash: boolean;
  onBuildSnapshots: () => void;
  onConfirmLock: () => void;
  onCancelLock: () => void;
  onLock: () => void;
  onCopyHash: () => void;
}) {
  const ready = snapshots.length === 2 && snapshots.every((snapshot) => snapshot.status === "READY");
  const locked = mechanism.status === "LOCKED";
  return (
    <section className="mechanism-workspace">
      <header>
        <div><span className="eyebrow">CAMPAIGN MECHANISM</span><h2>{campaign.title}</h2></div>
        <span className={`mechanism-state mechanism-state--${mechanism.status.toLowerCase()}`}>{mechanism.status}</span>
      </header>

      {mechanism.warning ? <p className="mechanism-warning"><ShieldAlert size={17} />{mechanism.warning}</p> : null}
      {mechanism.configHash ? <button className="mechanism-hash" type="button" onClick={onCopyHash}><span>CONFIG HASH</span><code>{shortHash(mechanism.configHash)}</code>{copiedHash ? <Check size={16} /> : <Copy size={16} />}</button> : <p className="mechanism-empty">No versioned mechanism draft is attached to this campaign yet.</p>}

      <div className="snapshot-list">
        {(["NOMINATOR", "RECIPIENT"] as const).map((audience) => {
          const snapshot = snapshots.find((item) => item.audience === audience);
          return <SnapshotRow key={audience} audience={audience} snapshot={snapshot} />;
        })}
      </div>

      {confirmingLock ? (
        <div className="mechanism-lock-confirm" role="alertdialog" aria-labelledby="mechanism-lock-title">
          <LockKeyhole size={21} />
          <div><strong id="mechanism-lock-title">Lock this mechanism?</strong><p>Candidate membership, roots, resource quantity, allocation strategy, and randomness commitment become immutable for this revision.</p></div>
          <SecondaryAction onClick={onCancelLock}>CANCEL</SecondaryAction>
          <PrimaryAction onClick={onLock} disabled={action === "lock"}>{action === "lock" ? "LOCKING" : "LOCK MECHANISM"}</PrimaryAction>
        </div>
      ) : (
        <div className="mechanism-actions">
          <SecondaryAction onClick={onBuildSnapshots} disabled={!mechanism.config || locked || action === "snapshot"}><RefreshCw size={16} />{action === "snapshot" ? "COLLECTING EVIDENCE" : "BUILD EVIDENCE SNAPSHOTS"}</SecondaryAction>
          <PrimaryAction onClick={onConfirmLock} disabled={!ready || locked}>{locked ? "ELIGIBILITY LOCKED" : "REVIEW AND LOCK"}</PrimaryAction>
        </div>
      )}
    </section>
  );
}

function SnapshotRow({ audience, snapshot }: { audience: "NOMINATOR" | "RECIPIENT"; snapshot?: SnapshotDetail }) {
  const errors = snapshot?.providerErrors?.providerErrors ?? [];
  return (
    <article className="snapshot-row">
      <div><span>{audience === "NOMINATOR" ? "WHO CAN GIVE" : "WHO CAN RECEIVE"}</span><strong>{audience}</strong></div>
      <dl><div><dt>CANDIDATES</dt><dd>{snapshot?.candidateCount ?? "—"}</dd></div><div><dt>ELIGIBLE</dt><dd>{snapshot?.eligibleCount ?? "—"}</dd></div></dl>
      <div className="snapshot-row__commitment"><span>{snapshot ? snapshot.status : "NOT BUILT"}</span><code>{snapshot?.root ? shortHash(snapshot.root) : "NO ROOT"}</code>{errors.map((error) => <small key={error.code}>{error.code.replaceAll("_", " ")} / {error.count}</small>)}</div>
    </article>
  );
}

function shortHash(value: string) {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "TAKE could not complete this organizer action.";
}
