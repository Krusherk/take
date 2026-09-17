import { Check, Copy, Link2, LockKeyhole, RefreshCw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { PrimaryAction, SecondaryAction } from "../components/Actions";
import { OrganizerEligibilityWorkspace } from "../components/eligibility/OrganizerEligibilityWorkspace";
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
  const { campaigns, refetch: refetchProducts } = useTakeProduct();
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
  const [organizationName, setOrganizationName] = useState("");
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [campaignRequests, setCampaignRequests] = useState<CampaignRequestView[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [submittedRequestTitle, setSubmittedRequestTitle] = useState<string | null>(null);
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
      const [result, submittedRequests] = await Promise.all([
        request<TakeOrganizationMembership[]>("/organizations/mine"),
        request<CampaignRequestView[]>("/campaign-requests/mine"),
      ]);
      setOrganizations(result);
      setCampaignRequests(submittedRequests);
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

  async function createOrganization() {
    if (organizationName.trim().length < 2) return setError("Enter a community or organization name.");
    setCreatingOrganization(true); setError(null);
    try {
      await request("/organizations", { method: "POST", body: JSON.stringify({ name: organizationName }) });
      setOrganizationName("");
      await loadOrganizations();
    } catch (caught) { setError(message(caught)); } finally { setCreatingOrganization(false); }
  }

  async function submitCampaignRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = normalizeCampaignRequest(new FormData(form), organizationId);
    setFieldErrors(parsed.errors);
    if (!parsed.value) return;
    setCreatingCampaign(true); setError(null);
    try {
      const created = await request<{ id: string }>("/campaign-requests", {
        method: "POST",
        body: JSON.stringify(parsed.value),
      });
      await request(`/campaign-requests/${created.id}/submit`, { method: "POST", body: "{}" });
      setSubmittedRequestTitle(parsed.value.title);
      form.reset();
      setFieldErrors({});
      await loadOrganizations();
    } catch (caught) { setError(message(caught)); } finally { setCreatingCampaign(false); }
  }

  if (state === "loading") return <div className="page-container"><ProductLoading label="Loading organizer access" /></div>;
  if (state === "error") return <div className="page-container"><ProductError message={error ?? "Organizer access could not load."} onRetry={() => void loadOrganizations()} /></div>;

  return (
    <div className="page-container organize-page">
      <header className="page-intro organize-intro">
        <div><span className="eyebrow">ORGANIZE</span><h1>Your opportunities.</h1></div>
        <p>Request a campaign, prepare the people involved, and review eligibility before TAKE launches it.</p>
      </header>

      {discordConnected ? <div className="organize-notice"><Check size={18} />Discord community evidence is connected.</div> : null}
      {submittedRequestTitle ? <div className="organize-notice" role="status"><Check size={18} /><span><strong>Request submitted.</strong> TAKE will review and provision {submittedRequestTitle}.</span></div> : null}
      {error ? <div className="organize-error" role="alert"><ShieldAlert size={18} /><span>{error}</span></div> : null}

      {!manageableOrganizations.length ? (
        <section className="organize-create-panel"><span className="eyebrow">START HERE</span><h2>Create your community.</h2><p>You need one organizer space before you can create an opportunity and define selector eligibility.</p><label className="field"><span>COMMUNITY OR ORGANIZATION NAME</span><input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Monad Creators" /></label><PrimaryAction onClick={() => void createOrganization()} disabled={creatingOrganization}>{creatingOrganization ? "CREATING" : "CREATE ORGANIZATION"}</PrimaryAction></section>
      ) : (
        <>
          <section className="organize-selector" aria-label="Organizer scope">
            <label><span>ORGANIZATION</span><select value={organizationId ?? ""} onChange={(event) => setOrganizationId(event.target.value)}>{manageableOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} / {organization.role}</option>)}</select></label>
            <label><span>CAMPAIGN</span><select value={campaignId ?? ""} onChange={(event) => setCampaignId(event.target.value)} disabled={!organizationCampaigns.length}>{organizationCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title} / {campaign.sourceStatus}</option>)}</select></label>
          </section>

          <details className="organize-create-panel organize-create-panel--details" open={!organizationCampaigns.length && !campaignRequests.length}>
            <summary>{campaignRequests.length ? "REQUEST ANOTHER CAMPAIGN" : "REQUEST A CAMPAIGN"}</summary>
            <form onSubmit={(event) => void submitCampaignRequest(event)} noValidate>
              <span className="eyebrow">MANAGED CAMPAIGN REQUEST</span>
              <h2>What are you giving?</h2>
              <p>Send TAKE the opportunity details. A TAKE operator provisions the real campaign before eligibility setup begins.</p>
              <div className="organize-create-grid">
                <RequestField name="title" label="CAMPAIGN TITLE" error={fieldErrors.title} onChange={() => clearFieldError("title", setFieldErrors)}>
                  <input id="campaign-request-title" name="title" autoComplete="off" required placeholder="Monad community creator spots" />
                </RequestField>
                <RequestField name="resourceName" label="OPPORTUNITY" error={fieldErrors.resourceName} onChange={() => clearFieldError("resourceName", setFieldErrors)}>
                  <input id="campaign-request-resourceName" name="resourceName" autoComplete="off" required placeholder="Creator residency access" />
                </RequestField>
                <RequestField name="description" label="SHORT DESCRIPTION" error={fieldErrors.description} wide onChange={() => clearFieldError("description", setFieldErrors)}>
                  <textarea id="campaign-request-description" name="description" required placeholder="Five creators will receive access to..." />
                </RequestField>
                <RequestField name="seats" label="NUMBER OF SPOTS" error={fieldErrors.seats} onChange={() => clearFieldError("seats", setFieldErrors)}>
                  <input id="campaign-request-seats" name="seats" type="number" min="1" step="1" defaultValue="5" required />
                </RequestField>
                <RequestField name="startTime" label="CAMPAIGN OPENS" error={fieldErrors.startTime} onChange={() => clearFieldError("startTime", setFieldErrors)}>
                  <input id="campaign-request-startTime" name="startTime" type="datetime-local" required />
                </RequestField>
                <RequestField name="endTime" label="CAMPAIGN ENDS" error={fieldErrors.endTime} onChange={() => clearFieldError("endTime", setFieldErrors)}>
                  <input id="campaign-request-endTime" name="endTime" type="datetime-local" required />
                </RequestField>
              </div>
              <PrimaryAction type="submit" disabled={creatingCampaign}>{creatingCampaign ? "SUBMITTING REQUEST" : "SUBMIT CAMPAIGN REQUEST"}</PrimaryAction>
            </form>
          </details>

          {campaignRequests.length ? <section className="campaign-request-list" aria-label="Campaign requests">
            <span className="eyebrow">YOUR REQUESTS</span>
            {campaignRequests.map((item) => <article key={item.id}><div><strong>{item.title}</strong><p>{item.resourceName} / {item.seatCount} spots</p></div><span>{item.status.replaceAll("_", " ")}</span></article>)}
          </section> : null}

          {!selectedCampaign ? (
            <SocialEmpty title="No campaign assigned yet.">Submit a campaign request above. TAKE will review it and provision the offchain campaign for setup.</SocialEmpty>
          ) : <>
            <div className="organize-preview-link"><SecondaryAction onClick={() => navigate(`/campaign/${selectedCampaign.id}`)}>{selectedCampaign.onchain?.published ? "OPEN PARTICIPANT VIEW" : "PREVIEW OFFCHAIN DRAFT"}</SecondaryAction></div>
            {organizationId ? <OrganizerEligibilityWorkspace campaign={selectedCampaign} organizationId={organizationId} request={request} managed discordGuildId={discord?.integrations.find((item) => item.status === "ACTIVE")?.guildId} onMechanismChanged={() => void loadMechanism(selectedCampaign.id)} /> : null}
            {mechanism ? <details className="advanced-mechanism"><summary>Advanced mechanism and snapshot controls</summary><MechanismWorkspace
              campaign={selectedCampaign}
              mechanism={mechanism}
              snapshots={snapshotDetails}
              action={action}
              confirmingLock={confirmingLock}
              copiedHash={copiedHash}
              onBuildSnapshots={() => undefined}
              onConfirmLock={() => undefined}
              onCancelLock={() => setConfirmingLock(false)}
              onLock={() => void lockMechanism()}
              onCopyHash={() => void copyHash()}
            /></details> : <ProductLoading label="Loading mechanism" />}
            <div className="campaign-launch"><div><span className="eyebrow">MANAGED LIFECYCLE</span><strong>{managedLifecycleLabel(selectedCampaign.sourceStatus)}</strong><p>TAKE operators control final lock, publication, activation, close, and result commitment. Locked campaign rules cannot be changed by lifecycle actions.</p></div></div>
          </>}

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
          <p className="mechanism-empty">{locked ? "Campaign artifacts are locked." : ready ? "Snapshots are ready for TAKE operator review." : "TAKE will build and lock final snapshots after organizer setup is complete."}</p>
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

interface CampaignRequestView {
  id: string;
  organizationId: string;
  status: "DRAFT" | "SUBMITTED" | "CHANGES_REQUESTED" | "PROVISIONED" | "REJECTED";
  title: string;
  description: string;
  resourceName: string;
  seatCount: number;
  endTime: string;
  startTime: string;
  provisionedCampaignId: string | null;
}

function normalizeCampaignRequest(form: FormData, organizationId: string | null) {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const title = text("title");
  const description = text("description");
  const resourceName = text("resourceName");
  const seatText = text("seats");
  const startText = text("startTime");
  const endText = text("endTime");
  const seats = Number(seatText);
  const start = new Date(startText);
  const end = new Date(endText);
  const errors: Record<string, string> = {};
  if (!organizationId) errors.organizationId = "Choose an organization.";
  if (!title) errors.title = "Enter a campaign title.";
  if (!resourceName) errors.resourceName = "Describe the opportunity.";
  if (!description) errors.description = "Add a short campaign description.";
  if (!Number.isInteger(seats) || seats < 1) errors.seats = "Spots must be a positive whole number.";
  if (!startText || Number.isNaN(start.getTime())) errors.startTime = "Choose a valid campaign start time.";
  else if (start.getTime() <= Date.now()) errors.startTime = "Campaign start must be in the future.";
  if (!endText || Number.isNaN(end.getTime())) errors.endTime = "Choose a valid campaign end time.";
  else if (end.getTime() <= Date.now()) errors.endTime = "Campaign end must be in the future.";
  else if (!Number.isNaN(start.getTime()) && end <= start) errors.endTime = "Campaign end must be after its start.";
  if (Object.keys(errors).length || !organizationId) return { value: null, errors };
  return {
    value: { organizationId, title, description, resourceName, seatCount: seats, startTime: start.toISOString(), endTime: end.toISOString(), selectorMode: "DISJOINT" },
    errors,
  };
}

function RequestField({ name, label, error, wide = false, onChange, children }: { name: string; label: string; error?: string; wide?: boolean; onChange: () => void; children: ReactNode }) {
  return <label className={`field${wide ? " field--wide" : ""}`} htmlFor={`campaign-request-${name}`} onChange={onChange}>
    <span>{label}</span>
    {children}
    {error ? <small id={`campaign-request-${name}-error`} role="alert">{error}</small> : null}
  </label>;
}

function clearFieldError(name: string, setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>) {
  setErrors((current) => {
    if (!current[name]) return current;
    const next = { ...current };
    delete next[name];
    return next;
  });
}

function managedLifecycleLabel(status: string) {
  if (status === "ACTIVE") return "Nominations are active on Monad.";
  if (status === "CREATED") return "Published on Monad; awaiting activation.";
  if (status === "CLOSED") return "Campaign closed; results are processing.";
  if (status === "FINALIZED") return "Results finalized on Monad.";
  return "Offchain setup in progress.";
}
