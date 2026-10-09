import { Check, Link2, Lock, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { PrimaryAction, SecondaryAction } from "../components/Actions";
import { Avatar } from "../components/Avatar";
import { CampaignLaunchSigner } from "../components/CampaignLaunchSigner";
import { OrganizerEligibilityWorkspace } from "../components/eligibility/OrganizerEligibilityWorkspace";
import { EvaluationPlanEditor, TeamReview } from "../components/SignalControls";
import { ProductError, ProductLoading } from "../components/ProductState";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { organizePhase, organizePhaseLabel, preferredCampaignId, type OrganizePhase } from "../lib/organizePhase";
import type { ApiPerson, Campaign } from "../types/product";
import type { DiscordIntegrationView, TakeOrganizationMembership } from "../types/mechanism";

type LoadState = "loading" | "ready" | "error";

export function OrganizePage({ navigate }: { navigate: (path: TakePath) => void }) {
  const { request } = useTakeMe();
  const { campaigns, refetch: refetchProducts } = useTakeProduct();
  const [organizations, setOrganizations] = useState<TakeOrganizationMembership[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [people, setPeople] = useState<ApiPerson[]>([]);
  const [operator, setOperator] = useState(false);
  const [discord, setDiscord] = useState<DiscordIntegrationView | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [openNow, setOpenNow] = useState(true);
  const [startLocal, setStartLocal] = useState(() => localInput(new Date(Date.now() + 60 * 60 * 1000)));
  const [endLocal, setEndLocal] = useState(() => localInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
  const [title, setTitle] = useState("");
  const [resourceName, setResourceName] = useState("");
  const [description, setDescription] = useState("");
  const [seats, setSeats] = useState("1");
  const [giverIds, setGiverIds] = useState<string[]>([]);
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [personQuery, setPersonQuery] = useState("");
  const [discordBusy, setDiscordBusy] = useState(false);
  const [checkOn, setCheckOn] = useState(false);
  const [checkPreset, setCheckPreset] = useState<CheckPresetKey>("SHIP");
  const [checkQuestion, setCheckQuestion] = useState(CHECK_PRESETS.SHIP.question);
  const [checkCriteria, setCheckCriteria] = useState(CHECK_PRESETS.SHIP.criteria);
  const [checkDays, setCheckDays] = useState(30);
  const [checkEvidence, setCheckEvidence] = useState(true);

  const manageableOrganizations = useMemo(
    () => organizations.filter((organization) => organization.role === "OWNER" || organization.role === "ADMIN"),
    [organizations],
  );
  const organizationCampaigns = useMemo(
    () => campaigns.filter((campaign) => campaign.organizationId === organizationId),
    [campaigns, organizationId],
  );
  const selectedCampaign = organizationCampaigns.find((campaign) => campaign.id === campaignId) ?? null;
  const selectedPhase = selectedCampaign ? organizePhase(selectedCampaign) : null;
  const members = useMemo(() => people.flatMap((person) => {
    if (person.recipient.type !== "take_identity") return [];
    return [{ id: person.recipient.takeIdentityId, name: person.displayName, handle: person.username ? `@${person.username.replace(/^@/, "")}` : "TAKE member", avatarUrl: person.avatarUrl }];
  }), [people]);
  const visibleMembers = useMemo(() => {
    const query = personQuery.trim().toLowerCase();
    if (!query) return members;
    return members.filter((person) => `${person.name} ${person.handle}`.toLowerCase().includes(query));
  }, [members, personQuery]);

  const loadOrganizations = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const [result, roster, access] = await Promise.all([
        request<TakeOrganizationMembership[]>("/organizations/mine"),
        request<{ people: ApiPerson[] }>("/people?includeSelf=true&limit=100"),
        request<{ operator: boolean }>("/operator/me").catch(() => ({ operator: false })),
      ]);
      setOrganizations(result);
      setPeople(roster.people);
      setOperator(access.operator);
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

  const loadDiscord = useCallback(async (nextOrganizationId: string) => {
    try {
      setDiscord(await request<DiscordIntegrationView>(`/organizations/${nextOrganizationId}/integrations/discord`));
    } catch {
      setDiscord(null);
    }
  }, [request]);

  useEffect(() => { void loadOrganizations(); }, [loadOrganizations]);
  // A campaign with a check opens a few minutes after creation. Re-render so
  // "Scheduled" turns into "Sign to open" without a reload.
  const [, setTick] = useState(0);
  const opensSoon = organizationCampaigns.some((campaign) => {
    const start = Date.parse(campaign.startsAt);
    return organizePhase(campaign) === "SCHEDULED" && start - Date.now() < 15 * 60 * 1000;
  });
  useEffect(() => {
    if (!opensSoon) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 10_000);
    return () => window.clearInterval(timer);
  }, [opensSoon]);
  useEffect(() => {
    setCampaignId((current) => current && organizationCampaigns.some((campaign) => campaign.id === current)
      ? current
      : preferredCampaignId(organizationCampaigns));
  }, [organizationCampaigns]);
  useEffect(() => {
    if (organizationId && selectedPhase === "SETUP") void loadDiscord(organizationId);
  }, [loadDiscord, organizationId, selectedPhase]);

  async function createOrganization() {
    if (organizationName.trim().length < 2) return setError("Enter a community or organization name.");
    setCreatingOrganization(true);
    setError(null);
    try {
      await request("/organizations", { method: "POST", body: JSON.stringify({ name: organizationName }) });
      setOrganizationName("");
      await loadOrganizations();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setCreatingOrganization(false);
    }
  }

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = readCampaignForm({
      organizationId,
      title,
      resourceName,
      description,
      seats,
      openNow,
      startLocal,
      endLocal,
      giverIds,
      recipientIds,
      check: checkOn ? { preset: checkPreset, question: checkQuestion, criteria: checkCriteria, days: checkDays, evidenceExpected: checkEvidence } : null,
    });
    setFieldErrors(parsed.errors);
    if (!parsed.value || !organizationId) return;
    setCreatingCampaign(true);
    setError(null);
    setNotice(null);
    try {
      const created = await request<{ campaignId: string; message: string }>(`/organizations/${organizationId}/campaigns`, {
        method: "POST",
        body: JSON.stringify(parsed.value),
      });
      setCampaignId(created.campaignId);
      setNotice(created.message);
      setTitle("");
      setResourceName("");
      setDescription("");
      setGiverIds([]);
      setRecipientIds([]);
      setPersonQuery("");
      setCheckOn(false);
      await refetchProducts();
    } catch (caught) {
      setError(message(caught));
      await refetchProducts();
    } finally {
      setCreatingCampaign(false);
    }
  }

  async function installDiscord() {
    if (!organizationId) return;
    setDiscordBusy(true);
    setError(null);
    try {
      const result = await request<{ installUrl: string }>(`/organizations/${organizationId}/integrations/discord/install`, {
        method: "POST",
        body: "{}",
      });
      window.location.assign(result.installUrl);
    } catch (caught) {
      setError(message(caught));
      setDiscordBusy(false);
    }
  }

  function assignPerson(id: string, role: "give" | "receive") {
    if (role === "give") {
      setGiverIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
      setRecipientIds((current) => current.filter((item) => item !== id));
    } else {
      setRecipientIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
      setGiverIds((current) => current.filter((item) => item !== id));
    }
    setFieldErrors((current) => {
      if (!current.people) return current;
      const next = { ...current };
      delete next.people;
      return next;
    });
  }

  if (state === "loading") return <div className="page-container"><ProductLoading label="Loading your campaigns" /></div>;
  if (state === "error") return <div className="page-container"><ProductError message={error ?? "Organizer access could not load."} onRetry={() => void loadOrganizations()} /></div>;

  const organization = manageableOrganizations.find((item) => item.id === organizationId) ?? null;

  return (
    <div className="page-container organize-page">
      <header className="page-intro organize-intro organize-intro--plain">
        <div>
          <span className="eyebrow">ORGANIZE</span>
          <h1>Create a campaign.</h1>
        </div>
        <p>{operator ? "Name the opportunity, choose who can give one TAKE and who can receive it, then sign it onto Monad. After you open nominations, it shows up as live in Explore." : "Name the opportunity and choose who can give one TAKE and who can receive it. A TAKE operator signs it onto Monad. After nominations open, it shows up as live in Explore."}</p>
      </header>

      <ol className="organize-steps" aria-label="How a campaign goes live">
        <li><span>1</span><strong>Describe it</strong><small>What you are giving, and when.</small></li>
        <li><span>2</span><strong>Choose people</strong><small>Givers and recipients stay separate.</small></li>
        <li><span>3</span><strong>Schedule a check</strong><small>Optional. What should have happened after, and when.</small></li>
        <li><span>4</span><strong>{operator ? "Sign twice" : "TAKE signs"}</strong><small>Publish, then open nominations.</small></li>
      </ol>

      {notice ? <div className="organize-notice" role="status"><Check size={18} /><span>{notice}</span></div> : null}
      {error ? <div className="organize-error" role="alert"><ShieldAlert size={18} /><span>{error}</span></div> : null}

      {!manageableOrganizations.length ? (
        <section className="organize-studio">
          <span className="eyebrow">START HERE</span>
          <h2>Create your community.</h2>
          <p>A community is the home for the campaigns you run.</p>
          <label className="field">
            <span>Community name</span>
            <input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Monad Creators" />
          </label>
          <PrimaryAction onClick={() => void createOrganization()} disabled={creatingOrganization}>{creatingOrganization ? "Creating…" : "Create community"}</PrimaryAction>
        </section>
      ) : (
        <>
          {manageableOrganizations.length > 1 ? (
            <label className="field organize-community">
              <span>Community</span>
              <select value={organizationId ?? ""} onChange={(event) => setOrganizationId(event.target.value)}>
                {manageableOrganizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          ) : organization ? <p className="organize-community-name">{organization.name}</p> : null}

          <section className="organize-campaigns" aria-label="Your campaigns">
            <header>
              <h2>Your campaigns</h2>
              <p>Pick one to see the single next step.</p>
            </header>
            {organizationCampaigns.length ? (
              <div className="organize-campaign-list">
                {organizationCampaigns.map((campaign) => {
                  const phase = organizePhase(campaign);
                  const selected = campaign.id === selectedCampaign?.id;
                  return (
                    <button
                      key={campaign.id}
                      type="button"
                      className={`organize-campaign${selected ? " is-selected" : ""}`}
                      aria-pressed={selected}
                      onClick={() => setCampaignId(campaign.id)}
                    >
                      <span className={`organize-phase organize-phase--${phase.toLowerCase()}`}>{organizePhaseLabel(phase)}</span>
                      <strong>{campaign.title}</strong>
                      <small>{campaign.resource} · {windowLabel(campaign)}</small>
                    </button>
                  );
                })}
              </div>
            ) : <p className="organize-empty">No campaign yet. The form below creates one you can sign yourself.</p>}
          </section>

          {selectedCampaign && selectedPhase ? (
            <CampaignNext
              campaign={selectedCampaign}
              phase={selectedPhase}
              operator={operator}
              request={request}
              onChanged={refetchProducts}
              navigate={navigate}
            />
          ) : null}

          <section className="organize-studio">
            <span className="eyebrow">NEW CAMPAIGN</span>
            <h2>What are you giving?</h2>
            <p>{operator ? "This creates the campaign now. You sign it onto Monad yourself." : "This saves a draft. A TAKE operator reviews it and signs it onto Monad."}</p>
            <form onSubmit={(event) => void createCampaign(event)} noValidate>
              <div className="organize-studio__grid">
                <Field label="Campaign title" error={fieldErrors.title}>
                  <input value={title} onChange={(event) => { setTitle(event.target.value); clearError("title", setFieldErrors); }} placeholder="Monad community spots" required />
                </Field>
                <Field label="Opportunity" error={fieldErrors.resourceName}>
                  <input value={resourceName} onChange={(event) => { setResourceName(event.target.value); clearError("resourceName", setFieldErrors); }} placeholder="Builder spot" required />
                </Field>
                <Field label="Short description" error={fieldErrors.description} wide>
                  <textarea value={description} onChange={(event) => { setDescription(event.target.value); clearError("description", setFieldErrors); }} placeholder="One TAKE each. Give it to someone else." required />
                </Field>
                <Field label="Number of spots" error={fieldErrors.seats}>
                  <input value={seats} onChange={(event) => { setSeats(event.target.value); clearError("seats", setFieldErrors); }} type="number" min="1" step="1" required />
                </Field>
                <Field label="Nominations end" error={fieldErrors.endTime}>
                  <input value={endLocal} onChange={(event) => { setEndLocal(event.target.value); clearError("endTime", setFieldErrors); }} type="datetime-local" required />
                </Field>
                <label className="organize-open-now">
                  <input type="checkbox" checked={openNow} onChange={(event) => setOpenNow(event.target.checked)} />
                  <span>Open as soon as I sign. Leave this on to publish and open nominations in one sitting.</span>
                </label>
                {openNow ? null : (
                  <Field label="Nominations open" error={fieldErrors.startTime}>
                    <input value={startLocal} onChange={(event) => { setStartLocal(event.target.value); clearError("startTime", setFieldErrors); }} type="datetime-local" required />
                  </Field>
                )}
              </div>

              <div className="organize-people">
                <div>
                  <h3>Who is involved?</h3>
                  <p>A person can give a TAKE or receive one, not both. Givers need a connected wallet.</p>
                </div>
                <label className="organize-people__search">
                  <span>Find a TAKE member</span>
                  <input value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="Search by name" />
                </label>
                {fieldErrors.people ? <p className="organize-field-error" role="alert">{fieldErrors.people}</p> : null}
                <div className="organize-people__list">
                  {visibleMembers.map((person) => {
                    const gives = giverIds.includes(person.id);
                    const receives = recipientIds.includes(person.id);
                    return (
                      <article key={person.id}>
                        <Avatar person={{ id: person.id, name: person.name, avatarUrl: person.avatarUrl }} size="sm" />
                        <span><strong>{person.name}</strong><small>{person.handle}</small></span>
                        <button type="button" aria-pressed={gives} className={gives ? "is-selected" : ""} onClick={() => assignPerson(person.id, "give")}>Can give</button>
                        <button type="button" aria-pressed={receives} className={receives ? "is-selected" : ""} onClick={() => assignPerson(person.id, "receive")}>Can receive</button>
                      </article>
                    );
                  })}
                  {!visibleMembers.length ? <p>No TAKE members match. People appear here after they sign in.</p> : null}
                </div>
                <p className="organize-people__count">{giverIds.length} can give · {recipientIds.length} can receive</p>
              </div>

              <CheckStep
                on={checkOn}
                onToggle={setCheckOn}
                preset={checkPreset}
                onPreset={(key) => { setCheckPreset(key); setCheckQuestion(CHECK_PRESETS[key].question); setCheckCriteria(CHECK_PRESETS[key].criteria); clearError("check", setFieldErrors); }}
                question={checkQuestion}
                onQuestion={(value) => { setCheckQuestion(value); clearError("check", setFieldErrors); }}
                criteria={checkCriteria}
                onCriteria={(value) => { setCheckCriteria(value); clearError("check", setFieldErrors); }}
                days={checkDays}
                onDays={setCheckDays}
                evidence={checkEvidence}
                onEvidence={setCheckEvidence}
                endLocal={endLocal}
                openNow={openNow}
                error={fieldErrors.check}
              />

              <PrimaryAction type="submit" disabled={creatingCampaign}>{creatingCampaign ? "Creating campaign…" : "Create campaign"}</PrimaryAction>
              {creatingCampaign ? <p className="organize-wait" role="status">Preparing who can give and receive. This can take a minute, then you sign.</p> : null}
            </form>
          </section>

          {selectedCampaign && selectedPhase === "SETUP" && organizationId ? (
            <details className="organize-advanced">
              <summary>Older setup tools</summary>
              <p>Use this for a draft that was started before campaigns could be created in one step.</p>
              <EvaluationPlanEditor key={selectedCampaign.id} campaignId={selectedCampaign.id} status={selectedCampaign.sourceStatus} request={request} />
              <OrganizerEligibilityWorkspace
                campaign={selectedCampaign}
                organizationId={organizationId}
                request={request}
                managed={!operator}
                discordGuildId={discord?.integrations.find((item) => item.status === "ACTIVE")?.guildId}
                onMechanismChanged={() => undefined}
              />
              <section className="organize-discord">
                <div>
                  <span className="eyebrow">OPTIONAL</span>
                  <h2>Discord</h2>
                  <p>Connect a guild only if this campaign should check Discord membership. TAKE does not read messages.</p>
                </div>
                <div className="organize-discord__status">
                  {discord?.integrations.length
                    ? discord.integrations.map((integration) => <div key={integration.id}><i className="is-connected" /><span><strong>{integration.guildName}</strong><small>Guild {integration.guildId}</small></span></div>)
                    : <p>{discord?.configured ? "No Discord guild connected." : "Discord is not configured for this environment."}</p>}
                  <SecondaryAction onClick={() => void installDiscord()} disabled={!discord?.configured || discordBusy}><Link2 size={16} />{discordBusy ? "Opening Discord…" : "Connect guild"}</SecondaryAction>
                </div>
              </section>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function CampaignNext({ campaign, phase, operator, request, onChanged, navigate }: {
  campaign: Campaign;
  phase: OrganizePhase;
  operator: boolean;
  request: Parameters<typeof CampaignLaunchSigner>[0]["request"];
  onChanged: () => Promise<void>;
  navigate: (path: TakePath) => void;
}) {
  const signable = phase === "SIGN_TO_PUBLISH" || phase === "SIGN_TO_OPEN";
  return (
    <section className="organize-next" aria-live="polite">
      <span className="eyebrow">NEXT STEP</span>
      <h2>{nextTitle(phase)}</h2>
      <p>{nextDetail(campaign, phase, operator)}</p>
      {signable && operator ? <CampaignLaunchSigner campaignId={campaign.id} phase={phase} request={request} onChanged={onChanged} /> : null}
      {phase === "LIVE" ? (
        <div className="organize-next__actions">
          <PrimaryAction onClick={() => navigate("/explore")}>Open Explore</PrimaryAction>
          <SecondaryAction onClick={() => navigate(`/campaign/${campaign.id}`)}>Open this campaign</SecondaryAction>
        </div>
      ) : null}
      {phase === "LIVE" || phase === "SCHEDULED" || phase === "ENDED" ? <TeamReview key={`review:${campaign.id}`} campaignId={campaign.id} request={request} /> : null}
    </section>
  );
}

function nextTitle(phase: OrganizePhase) {
  switch (phase) {
    case "SIGN_TO_PUBLISH": return "Sign to publish on Monad.";
    case "SIGN_TO_OPEN": return "Sign to open nominations.";
    case "LIVE": return "This campaign is live.";
    case "SCHEDULED": return "This campaign is scheduled.";
    case "ENDED": return "This window has ended.";
    case "SETUP": return "This draft still needs people.";
  }
}

function nextDetail(campaign: Campaign, phase: OrganizePhase, operator: boolean) {
  const when = windowLabel(campaign);
  switch (phase) {
    case "SIGN_TO_PUBLISH":
      return operator
        ? `Publish ${campaign.title} with your TAKE wallet, then sign once more to open nominations. It appears in Explore after that second signature. Window: ${when}.`
        : `${campaign.title} is ready. The TAKE campaign wallet has to sign it before Explore can list it. Window: ${when}.`;
    case "SIGN_TO_OPEN":
      return operator
        ? `${campaign.title} is already on Monad. One more signature opens nominations and makes it live in Explore. Window: ${when}.`
        : `${campaign.title} is on Monad. The campaign wallet still has to open nominations. Window: ${when}.`;
    case "LIVE":
      return `${campaign.title} is open. Eligible people can give their TAKE until ${campaign.ends}.`;
    case "SCHEDULED":
      return `${campaign.title} opens ${campaign.starts}. Come back then and sign to open nominations if it is not live yet.`;
    case "ENDED":
      return `${campaign.title} can no longer be opened on Monad. Create a new campaign with an end time that is still ahead.`;
    case "SETUP":
      return "Create a new campaign below and choose the people in the same form. That path ends at the signature, which is what Explore needs.";
  }
}

function windowLabel(campaign: Campaign) {
  const format = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const start = new Date(campaign.startsAt);
  const end = new Date(campaign.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${campaign.starts} – ${campaign.ends}`;
  return `${format.format(start)} – ${format.format(end)}`;
}

function readCampaignForm(input: {
  organizationId: string | null;
  title: string;
  resourceName: string;
  description: string;
  seats: string;
  openNow: boolean;
  startLocal: string;
  endLocal: string;
  giverIds: string[];
  recipientIds: string[];
  check?: { preset: CheckPresetKey; question: string; criteria: string; days: number; evidenceExpected: boolean } | null;
}) {
  const title = input.title.trim();
  const resourceName = input.resourceName.trim();
  const description = input.description.trim();
  const seatCount = Number(input.seats);
  // A scheduled check is locked before nominations can open, so "open now"
  // starts a few minutes after creation instead of in the past.
  const start = input.openNow ? new Date(Date.now() + (input.check ? CHECK_LEAD_MS : -5 * 60 * 1000)) : new Date(input.startLocal);
  const end = new Date(input.endLocal);
  const errors: Record<string, string> = {};
  if (!input.organizationId) errors.organizationId = "Choose a community.";
  if (!title) errors.title = "Enter a campaign title.";
  if (!resourceName) errors.resourceName = "Name the opportunity.";
  if (!description) errors.description = "Add a short description.";
  if (!Number.isInteger(seatCount) || seatCount < 1) errors.seats = "Spots must be a whole number of at least 1.";
  if (!input.openNow && (!input.startLocal || Number.isNaN(start.getTime()))) errors.startTime = "Choose when nominations open.";
  if (!input.endLocal || Number.isNaN(end.getTime())) errors.endTime = "Choose when nominations end.";
  else if (end.getTime() <= Date.now()) errors.endTime = "The end time has to be in the future.";
  else if (!Number.isNaN(start.getTime()) && end <= start) errors.endTime = "The end has to be after the start.";
  if (!input.giverIds.length || !input.recipientIds.length) errors.people = "Choose at least one person who can give and one person who can receive.";
  else if (input.recipientIds.some((id) => input.giverIds.includes(id))) errors.people = "The same person cannot both give and receive.";
  if (input.check) {
    if (input.check.question.trim().length < 5) errors.check = "Write the question you will check, like “Did they ship?”.";
    else if (input.check.criteria.trim().length < 10) errors.check = "Say what counts as yes, no, and unclear.";
    else if (!input.openNow && !Number.isNaN(start.getTime()) && start.getTime() <= Date.now() + 60_000) errors.check = "With a check, nominations have to open at least a few minutes from now.";
  }
  if (Object.keys(errors).length || !input.organizationId) return { value: null, errors };
  const evaluationPlan = input.check ? {
    domain: CHECK_PRESETS[input.check.preset].domain,
    question: input.check.question.trim(),
    criteria: input.check.criteria.trim(),
    evaluateAfter: new Date(end.getTime() + input.check.days * DAY_MS).toISOString(),
    evidenceExpected: input.check.evidenceExpected,
  } : undefined;
  return {
    value: {
      title,
      description,
      resourceName,
      seatCount,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      giverIdentityIds: input.giverIds,
      recipientIdentityIds: input.recipientIds,
      ...(evaluationPlan ? { evaluationPlan } : {}),
    },
    errors,
  };
}

function Field({ label, error, wide = false, children }: { label: string; error?: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`field${wide ? " field--wide" : ""}`}>
      <span>{label}</span>
      {children}
      {error ? <small role="alert">{error}</small> : null}
    </label>
  );
}

function clearError(name: string, setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>) {
  setErrors((current) => {
    if (!current[name]) return current;
    const next = { ...current };
    delete next[name];
    return next;
  });
}

function localInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "TAKE could not complete this organizer action.";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_LEAD_MS = 3 * 60 * 1000;
type CheckPresetKey = "SHIP" | "ATTEND" | "USE" | "CUSTOM";
const CHECK_PRESETS: Record<CheckPresetKey, { label: string; domain: "BUILDER" | "ACCESS" | "GRANT" | "OTHER"; question: string; criteria: string }> = {
  SHIP: { label: "Did they ship?", domain: "BUILDER", question: "Did they ship what they planned?", criteria: "Yes: there is a public link to what they shipped (repo, demo, or post). No: nothing shipped by the check date. Unclear: something exists, but it isn't what they planned." },
  ATTEND: { label: "Did they show up?", domain: "ACCESS", question: "Did they show up and take part?", criteria: "Yes: they attended or used the spot. No: they didn't show up. Unclear: they came for part of it, or we can't confirm." },
  USE: { label: "Did they use it?", domain: "GRANT", question: "Did they use it the way they said?", criteria: "Yes: a public update shows how it was used. No: it went unused or was used for something else. Unclear: not enough information yet." },
  CUSTOM: { label: "Write my own", domain: "OTHER", question: "", criteria: "" },
};
const CHECK_DAYS = [7, 30, 90];

function CheckStep(props: {
  on: boolean; onToggle: (value: boolean) => void;
  preset: CheckPresetKey; onPreset: (key: CheckPresetKey) => void;
  question: string; onQuestion: (value: string) => void;
  criteria: string; onCriteria: (value: string) => void;
  days: number; onDays: (value: number) => void;
  evidence: boolean; onEvidence: (value: boolean) => void;
  endLocal: string; openNow: boolean; error?: string;
}) {
  const end = new Date(props.endLocal);
  const checkDate = Number.isNaN(end.getTime()) ? null : new Date(end.getTime() + props.days * DAY_MS);
  return (
    <section className={`organize-check${props.on ? " is-on" : ""}`} aria-labelledby="organize-check-title">
      <div className="organize-check__head">
        <div>
          <span className="organize-check__tag">AFTER THE TAKE</span>
          <h3 id="organize-check-title">Schedule a check</h3>
          <p>Pick a question and a date. On that date, your team (you and TAKE operators) records Yes, No, or Unclear for each person who got the spot. Everyone sees the result on Signal. Nothing here changes who gets the spot.</p>
        </div>
        <label className="organize-check__switch">
          <input type="checkbox" checked={props.on} onChange={(event) => props.onToggle(event.target.checked)} />
          <span>{props.on ? "Check on" : "Add a check"}</span>
        </label>
      </div>
      {props.on ? (
        <div className="organize-check__body">
          <div className="organize-check__chips" role="group" aria-label="What to check">
            {(Object.keys(CHECK_PRESETS) as CheckPresetKey[]).map((key) => (
              <button key={key} type="button" aria-pressed={props.preset === key} className={props.preset === key ? "is-selected" : ""} onClick={() => props.onPreset(key)}>{CHECK_PRESETS[key].label}</button>
            ))}
          </div>
          <label className="field field--wide">
            <span>The question</span>
            <input value={props.question} onChange={(event) => props.onQuestion(event.target.value)} maxLength={500} placeholder="Did they ship what they planned?" />
          </label>
          <div className="organize-check__when">
            <span>Check</span>
            <div className="organize-check__chips" role="group" aria-label="When to check">
              {CHECK_DAYS.map((days) => (
                <button key={days} type="button" aria-pressed={props.days === days} className={props.days === days ? "is-selected" : ""} onClick={() => props.onDays(days)}>{days} days</button>
              ))}
            </div>
            <small>after nominations end{checkDate ? ` · from ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(checkDate)}` : ""}</small>
          </div>
          <label className="field field--wide">
            <span>What counts as yes, no, unclear</span>
            <textarea value={props.criteria} onChange={(event) => props.onCriteria(event.target.value)} maxLength={5000} />
          </label>
          <label className="organize-check__evidence">
            <input type="checkbox" checked={props.evidence} onChange={(event) => props.onEvidence(event.target.checked)} />
            <span>Ask for a link as evidence when the outcome is recorded.</span>
          </label>
          <p className="organize-check__lock"><Lock size={14} aria-hidden="true" /> Locked when you create the campaign. Nobody can change it later, including you.{props.openNow ? " Nominations open about 3 minutes after you create it, so the check is locked first." : ""}</p>
          {props.error ? <p className="organize-field-error" role="alert">{props.error}</p> : null}
        </div>
      ) : props.error ? <p className="organize-field-error" role="alert">{props.error}</p> : null}
    </section>
  );
}
