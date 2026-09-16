import { Check, ChevronDown, LockKeyhole, RefreshCw, Search, ShieldAlert, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PrimaryAction, SecondaryAction } from "../Actions";
import { Avatar } from "../Avatar";
import { EligibilityEvidenceSummary, IntegritySummary } from "./EligibilityEvidenceSummary";
import type { TakeApiClient } from "../../lib/takeApi";
import type { ApiPerson, Campaign } from "../../types/product";
import type {
  EligibilityPreset,
  EligibilityReview,
  DiscordGuildRolesView,
  IdentityAllowlistView,
  SelectorAssessment,
  SelectorEligibilityPolicy,
  SelectorEligibilityView,
} from "../../types/mechanism";

type Request = TakeApiClient["request"];
type Busy = "roster" | "save" | "evaluate" | "review" | "lock" | "integrity" | null;

const presetCopy: Record<Exclude<EligibilityPreset, "CUSTOM">, { title: string; copy: string }> = {
  MONAD_BUILDER: { title: "Monad builder", copy: "Community, Monad, GitHub and social history." },
  COMMUNITY_CONTRIBUTOR: { title: "Community contributor", copy: "Longstanding participation and visible contribution." },
  CREATOR_SOCIAL: { title: "Creator / social", copy: "Community context, social history and creator work." },
};

export function OrganizerEligibilityWorkspace({ campaign, organizationId, request, onMechanismChanged, managed = false, discordGuildId }: { campaign: Campaign; organizationId: string; request: Request; onMechanismChanged: () => void; managed?: boolean; discordGuildId?: string }) {
  const showDevTools = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_FIXTURES === "true";
  const [view, setView] = useState<SelectorEligibilityView | null>(null);
  const [assessments, setAssessments] = useState<SelectorAssessment[]>([]);
  const [reviews, setReviews] = useState<EligibilityReview[]>([]);
  const [allowlists, setAllowlists] = useState<IdentityAllowlistView[]>([]);
  const [people, setPeople] = useState<ApiPerson[]>([]);
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [recipientPeople, setRecipientPeople] = useState<string[]>([]);
  const [recipientAllowlistId, setRecipientAllowlistId] = useState("");
  const [populationMode, setPopulationMode] = useState<"OVERLAPPING" | "DISJOINT_SELECTOR_RECIPIENT">("DISJOINT_SELECTOR_RECIPIENT");
  const [candidateAllowlistId, setCandidateAllowlistId] = useState("");
  const [preset, setPreset] = useState<Exclude<EligibilityPreset, "CUSTOM">>("MONAD_BUILDER");
  const [discordRoles, setDiscordRoles] = useState<DiscordGuildRolesView["roles"]>([]);
  const [requiredDiscordRoleId, setRequiredDiscordRoleId] = useState("");
  const [draft, setDraft] = useState<SelectorEligibilityPolicy | null>(null);
  const [selectedAssessment, setSelectedAssessment] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<"ALL" | "ELIGIBLE" | "NEEDS_REVIEW" | "NOT_ELIGIBLE">("ALL");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [eligibility, rosterData, peopleData] = await Promise.all([
        request<SelectorEligibilityView | null>(`/campaigns/${campaign.id}/selector-eligibility`),
        request<IdentityAllowlistView[]>(`/organizations/${organizationId}/identity-allowlists`),
        request<{ people: ApiPerson[] }>("/people?includeSelf=true&limit=100"),
      ]);
      setView(eligibility);
      setDraft(eligibility?.policy ?? null);
      setAllowlists(rosterData);
      setPeople(peopleData.people.filter((person) => person.recipient.type === "take_identity"));
      if (discordGuildId) {
        const roleData = await request<DiscordGuildRolesView>(`/organizations/${organizationId}/integrations/discord/${discordGuildId}/roles`);
        setDiscordRoles(roleData.roles);
      } else {
        setDiscordRoles([]);
        setRequiredDiscordRoleId("");
      }
      if (eligibility) {
        const [assessmentData, reviewData] = await Promise.all([
          request<SelectorAssessment[]>(`/campaigns/${campaign.id}/selector-eligibility/assessments`),
          request<EligibilityReview[]>(`/campaigns/${campaign.id}/selector-eligibility/reviews`),
        ]);
        setAssessments(assessmentData);
        setReviews(reviewData);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [campaign.id, discordGuildId, organizationId, request]);

  useEffect(() => { void load(); }, [load]);

  const filteredPeople = useMemo(() => people.filter((person) => {
    const value = `${person.displayName} ${person.username ?? ""}`.toLowerCase();
    return value.includes(search.toLowerCase());
  }), [people, search]);
  const filteredAssessments = reviewFilter === "ALL" ? assessments : assessments.filter((item) => item.status === reviewFilter);
  const selected = assessments.find((item) => item.id === selectedAssessment) ?? null;

  async function createRoster() {
    if (!selectedPeople.length) return setError("Choose at least one known TAKE member.");
    setBusy("roster"); setError(null);
    try {
      const roster = await request<IdentityAllowlistView>(`/organizations/${organizationId}/identity-allowlists`, {
        method: "POST", body: JSON.stringify({ name: `${campaign.title} / selector candidates` }),
      });
      for (const takeIdentityId of selectedPeople) {
        await request(`/identity-allowlists/${roster.id}/members`, { method: "POST", body: JSON.stringify({ takeIdentityId }) });
      }
      setCandidateAllowlistId(roster.id);
      await load();
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(null); }
  }

  async function createRecipientRoster() {
    if (!recipientPeople.length) return setError("Choose at least one recipient.");
    setBusy("roster"); setError(null);
    try {
      const roster = await request<IdentityAllowlistView>(`/organizations/${organizationId}/identity-allowlists`, {
        method: "POST", body: JSON.stringify({ name: `${campaign.title} / recipients` }),
      });
      for (const takeIdentityId of recipientPeople) {
        await request(`/identity-allowlists/${roster.id}/members`, { method: "POST", body: JSON.stringify({ takeIdentityId }) });
      }
      setRecipientAllowlistId(roster.id);
      await load();
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(null); }
  }

  async function addDevelopmentFixtures() {
    setBusy("roster"); setError(null);
    try {
      const fixtures = await request<Array<{ takeIdentityId: string }>>("/dev/selector-eligibility/fixtures", { method: "POST", body: "{}" });
      setSelectedPeople(fixtures.map((fixture) => fixture.takeIdentityId));
      await load();
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(null); }
  }

  async function applyDevelopmentScenarios() {
    setBusy("evaluate"); setError(null);
    try { await request(`/dev/campaigns/${campaign.id}/selector-eligibility/scenarios`, { method: "POST", body: "{}" }); await load(); }
    catch (caught) { setError(errorMessage(caught)); } finally { setBusy(null); }
  }

  async function loadPreset() {
    if (!candidateAllowlistId) return setError("Create or choose a selector candidate roster first.");
    setBusy("save"); setError(null);
    try {
      const cutoffAt = new Date(Math.min(Date.now(), new Date(campaign.startsAt).getTime()) - 60_000).toISOString();
      const guild = discordGuildId ? `&guildId=${encodeURIComponent(discordGuildId)}` : "";
      const requiredRole = requiredDiscordRoleId ? `&requiredDiscordRoleId=${encodeURIComponent(requiredDiscordRoleId)}` : "";
      const values = await request<SelectorEligibilityPolicy[]>(`/campaigns/${campaign.id}/selector-eligibility/presets?candidateAllowlistId=${candidateAllowlistId}&cutoffAt=${encodeURIComponent(cutoffAt)}${guild}${requiredRole}`);
      const next = values.find((item) => item.preset === preset);
      if (!next) throw new Error("That preset is unavailable.");
      setDraft(next);
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(null); }
  }

  async function savePolicy() {
    if (!draft) return;
    setBusy("save"); setError(null);
    try {
      await request(`/campaigns/${campaign.id}/selector-eligibility`, { method: "PUT", body: JSON.stringify(draft) });
      await load();
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(null); }
  }

  async function runEvaluation() {
    setBusy("evaluate"); setError(null);
    try { await request(`/campaigns/${campaign.id}/selector-eligibility/evaluate`, { method: "POST", body: "{}" }); await load(); }
    catch (caught) { setError(errorMessage(caught)); } finally { setBusy(null); }
  }

  async function decide(caseId: string, decision: "VERIFY_EVIDENCE" | "REJECT_EVIDENCE" | "REQUEST_MORE_INFO") {
    const reason = window.prompt(decision === "VERIFY_EVIDENCE" ? "What evidence did you verify?" : decision === "REJECT_EVIDENCE" ? "Why could this evidence not be verified?" : "What additional information is needed?");
    if (!reason?.trim()) return;
    setBusy("review"); setError(null);
    try { await request(`/campaigns/${campaign.id}/selector-eligibility/reviews/${caseId}/decision`, { method: "POST", body: JSON.stringify({ decision, reason }) }); await load(); }
    catch (caught) { setError(errorMessage(caught)); } finally { setBusy(null); }
  }

  async function importIntegrity() {
    if (!selected) return;
    const publicExplanation = window.prompt("Describe the observed pilot evidence. Do not enter secrets.");
    if (!publicExplanation?.trim()) return;
    const evidenceFamily = window.prompt("Evidence family (for example: CAMPAIGN_HISTORY, TIMING, or FUNDING_CONTEXT)", "CAMPAIGN_HISTORY");
    if (!evidenceFamily?.trim()) return;
    const strengthInput = window.prompt("Strength: WEAK, MODERATE, or STRONG", "MODERATE")?.toUpperCase();
    if (!strengthInput || !["WEAK", "MODERATE", "STRONG"].includes(strengthInput)) return setError("Integrity evidence strength must be WEAK, MODERATE, or STRONG.");
    setBusy("integrity"); setError(null);
    try {
      await request(`/campaigns/${campaign.id}/selector-eligibility/integrity-observations`, {
        method: "POST", body: JSON.stringify({ takeIdentityId: selected.person.id, signalType: "PILOT_IMPORTED_CONTEXT", evidenceFamily, strength: strengthInput, publicExplanation }),
      });
      await load();
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(null); }
  }

  async function lockRoster() {
    if (!window.confirm("Lock this selector roster? Policies, evidence decisions, scores and membership cannot change after this.")) return;
    setBusy("lock"); setError(null);
    try { await request(`/campaigns/${campaign.id}/selector-eligibility/lock`, { method: "POST", body: "{}" }); await load(); }
    catch (caught) { setError(errorMessage(caught)); } finally { setBusy(null); }
  }

  async function prepareMechanism() {
    if (!recipientAllowlistId) return setError("Choose or create the campaign's recipient roster.");
    setBusy("save"); setError(null);
    try {
      await request(`/campaigns/${campaign.id}/selector-eligibility/prepare-mechanism`, { method: "POST", body: JSON.stringify({ recipientAllowlistId, selectorRecipientMode: populationMode }) });
      onMechanismChanged();
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(null); }
  }

  function updateCategoryCap(id: string, maximumPoints: number) {
    setDraft((current) => current ? {
      ...current,
      categories: current.categories.map((category) => {
        if (category.id !== id) return category;
        const oldTotal = category.rules.reduce((sum, rule) => sum + rule.points, 0);
        let allocated = 0;
        const rules = category.rules.map((rule, index) => {
          const points = index === category.rules.length - 1 ? maximumPoints - allocated : Math.max(1, Math.round(rule.points / oldTotal * maximumPoints));
          allocated += points;
          return { ...rule, points };
        });
        return { ...category, maximumPoints, rules };
      }),
    } : current);
  }

  const locked = view?.status === "LOCKED";
  return (
    <section className="eligibility-workspace">
      <header className="eligibility-workspace__header">
        <div><span className="eyebrow">SELECTOR ELIGIBILITY</span><h2>Who gets one TAKE?</h2><p>Choose the history that matters for this campaign. Everyone who qualifies receives exactly one TAKE.</p></div>
        <span className={`eligibility-state eligibility-state--${(view?.status ?? "SETUP").toLowerCase()}`}>{view?.status ?? "SETUP"}</span>
      </header>
      {error ? <div className="organize-error" role="alert"><ShieldAlert size={18} />{error}</div> : null}

      {!view ? (
        <div className="eligibility-setup">
          <section>
            <span className="step-kicker">01 / SELECTOR CANDIDATES</span>
            <h3>Create the people TAKE should evaluate.</h3>
            <label className="field"><span>USE AN EXISTING ROSTER</span><select value={candidateAllowlistId} onChange={(event) => setCandidateAllowlistId(event.target.value)}><option value="">Choose a roster</option>{allowlists.map((item) => <option value={item.id} key={item.id}>{item.name} / {item.members.length} people / {item.status}</option>)}</select></label>
            <div className="people-picker">
              <label><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search known TAKE members" /></label>
              <div>{filteredPeople.map((person) => {
                const id = person.recipient.type === "take_identity" ? person.recipient.takeIdentityId : "";
                const checked = selectedPeople.includes(id);
                return <button type="button" className={checked ? "is-selected" : ""} onClick={() => setSelectedPeople((items) => checked ? items.filter((item) => item !== id) : [...items, id])} key={id}><Avatar person={{ id, name: person.displayName, avatarUrl: person.avatarUrl }} size="sm" /><span><strong>{person.displayName}</strong><small>{person.username ? `@${person.username}` : "TAKE member"}</small></span>{checked ? <Check size={18} /> : <UserPlus size={18} />}</button>;
              })}{!filteredPeople.length ? <p className="people-picker__empty">No real TAKE members found. Onboard participants first, then return here to build the selector roster.</p> : null}</div>
            </div>
            <div className="roster-actions"><SecondaryAction onClick={() => void createRoster()} disabled={busy === "roster" || !selectedPeople.length}>{busy === "roster" ? "CREATING ROSTER" : `CREATE ROSTER (${selectedPeople.length})`}</SecondaryAction></div>
            {showDevTools ? <details className="developer-tools"><summary>Developer tools</summary><SecondaryAction onClick={() => void addDevelopmentFixtures()} disabled={busy === "roster"}>ADD 5 DEV TEST PEOPLE</SecondaryAction></details> : null}
          </section>
          <section>
            <span className="step-kicker">02 / CAMPAIGN POLICY</span>
            <h3>Start with a clear preset.</h3>
            <div className="preset-grid">{Object.entries(presetCopy).map(([key, value]) => <button className={preset === key ? "is-selected" : ""} key={key} type="button" onClick={() => setPreset(key as typeof preset)}><strong>{value.title}</strong><span>{value.copy}</span></button>)}</div>
            {discordGuildId ? <label className="field"><span>REQUIRED DISCORD ROLE (OPTIONAL)</span><select value={requiredDiscordRoleId} onChange={(event) => setRequiredDiscordRoleId(event.target.value)}><option value="">Any member of the connected guild</option>{discordRoles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select><small>The selected role becomes part of the locked campaign policy. TAKE checks only the participant being evaluated.</small></label> : null}
            <SecondaryAction onClick={() => void loadPreset()} disabled={!candidateAllowlistId || busy === "save"}>LOAD PRESET</SecondaryAction>
            {draft ? <PolicyEditor policy={draft} setPolicy={setDraft} onCapChange={updateCategoryCap} /> : null}
            {draft ? <PrimaryAction onClick={() => void savePolicy()} disabled={busy === "save"}>SAVE ELIGIBILITY POLICY</PrimaryAction> : null}
          </section>
        </div>
      ) : (
        <>
          <div className="eligibility-metrics"><div><span>ELIGIBLE</span><strong>{view.counts.eligible}</strong></div><div><span>NEEDS REVIEW</span><strong>{view.counts.needsReview}</strong></div><div><span>NOT ELIGIBLE</span><strong>{view.counts.notEligible}</strong></div><div><span>THRESHOLD</span><strong>{draft?.requiredTotalPoints ?? "-"}</strong></div></div>
          {draft ? <PolicyEditor policy={draft} setPolicy={setDraft} onCapChange={updateCategoryCap} disabled={view.status !== "DRAFT"} /> : null}
          <div className="eligibility-toolbar">
            {view.status === "DRAFT" ? <SecondaryAction onClick={() => void savePolicy()} disabled={busy === "save"}>SAVE CHANGES</SecondaryAction> : null}
            {showDevTools && assessments.length && !locked ? <SecondaryAction onClick={() => void applyDevelopmentScenarios()} disabled={busy === "evaluate"}>APPLY DEV TEST STATES</SecondaryAction> : null}
            {!locked ? <PrimaryAction onClick={() => void runEvaluation()} disabled={busy === "evaluate"}><RefreshCw size={16} />{busy === "evaluate" ? "CHECKING EVIDENCE" : assessments.length ? "REFRESH EVIDENCE" : "RUN ELIGIBILITY"}</PrimaryAction> : null}
          </div>
          {assessments.length ? <div className="eligibility-review-layout">
            <div className="assessment-list">
              <nav aria-label="Assessment status">{(["ALL", "ELIGIBLE", "NEEDS_REVIEW", "NOT_ELIGIBLE"] as const).map((item) => <button type="button" className={reviewFilter === item ? "is-active" : ""} onClick={() => setReviewFilter(item)} key={item}>{item.replaceAll("_", " ")}</button>)}</nav>
              {filteredAssessments.map((assessment) => <button className={selectedAssessment === assessment.id ? "is-selected" : ""} type="button" onClick={() => setSelectedAssessment(assessment.id)} key={assessment.id}><Avatar person={assessment.person} size="sm" /><span><strong>{assessment.person.name}</strong><small>{assessment.person.handle ?? "TAKE member"}</small></span><em className={`status-chip status-chip--${assessment.status.toLowerCase()}`}>{assessment.status.replaceAll("_", " ")}</em><b>{assessment.totalPoints}</b></button>)}
            </div>
            <div className="assessment-detail">{selected ? <><header><div><span className="eyebrow">EVIDENCE</span><h3>{selected.person.name}</h3><p>{selected.qualificationPath === "ALTERNATIVE" ? "Qualified through the campaign's declared alternative path." : `${selected.totalPoints} verified points. Scores only decide eligibility; they never change TAKE weight.`}</p></div><em className={`status-chip status-chip--${selected.status.toLowerCase()}`}>{selected.status.replaceAll("_", " ")}</em></header><EligibilityEvidenceSummary categories={selected.categories} /><IntegritySummary {...selected.integrity} />{!locked ? <SecondaryAction onClick={() => void importIntegrity()} disabled={busy === "integrity"}>IMPORT PILOT INTEGRITY EVIDENCE</SecondaryAction> : null}</> : <div className="assessment-empty"><ChevronDown size={22} /><p>Choose a person to inspect the evidence behind their eligibility.</p></div>}</div>
          </div> : <div className="eligibility-empty"><p>No assessments yet. Run eligibility to collect available evidence and expose missing data.</p></div>}

          {reviews.length ? <section className="review-queue"><header><span className="eyebrow">SUBMITTED FORMS</span><h3>Resolve evidence before lock.</h3></header>{reviews.map((review) => <article key={review.id}><div><Avatar person={review.person ?? undefined} size="sm" /><span><strong>{review.person?.name ?? "TAKE member"}</strong><small>{review.type.replaceAll("_", " ")} / {review.submission?.status ?? review.status}</small></span></div><p>{review.submission?.explanation}</p>{review.submission?.evidence.map((evidence) => <a href={evidence.url} target="_blank" rel="noreferrer" key={evidence.url}>{evidence.label ?? evidence.type}</a>)}{["OPEN", "UNDER_REVIEW"].includes(review.status) ? <footer><SecondaryAction onClick={() => void decide(review.id, "REQUEST_MORE_INFO")} disabled={busy === "review"}>MORE INFO</SecondaryAction><SecondaryAction onClick={() => void decide(review.id, "REJECT_EVIDENCE")} disabled={busy === "review"}>REJECT EVIDENCE</SecondaryAction><PrimaryAction onClick={() => void decide(review.id, "VERIFY_EVIDENCE")} disabled={busy === "review"}>VERIFY EVIDENCE</PrimaryAction></footer> : <span className="review-resolved">RESOLVED</span>}</article>)}</section> : null}

          <div className="eligibility-lock"><LockKeyhole size={24} /><div><strong>{locked ? "Selector roster locked" : "Final selector roster"}</strong><p>{locked ? `The policy, evidence decisions, assessments and ${view.counts.eligible}-person roster are immutable.` : managed ? "Resolve every review and prepare the roster. A TAKE operator performs the final immutable lock." : "All reviews must be resolved. Locking prevents ordinary eligibility changes after nominations begin."}</p>{view.finalAllowlistId ? <code>{view.finalAllowlistId}</code> : null}</div>{!locked && !managed ? <PrimaryAction onClick={() => void lockRoster()} disabled={busy === "lock" || view.status !== "REVIEW" || view.counts.needsReview > 0}>{busy === "lock" ? "LOCKING" : "LOCK FINAL ROSTER"}</PrimaryAction> : locked ? <Check size={24} /> : <span className="review-resolved">OPERATOR LOCK REQUIRED</span>}</div>
          {locked ? <section className="eligibility-handoff"><header><span className="eyebrow">NEXT / RECIPIENT ROSTER</span><h3>Connect eligibility to the campaign.</h3><p>Recipients remain a separate predefined roster. For serious pilots, the people choosing should not also be recipients.</p></header><div className="eligibility-handoff__controls"><label className="field"><span>WHO CAN RECEIVE</span><select value={recipientAllowlistId} onChange={(event) => setRecipientAllowlistId(event.target.value)}><option value="">Choose a recipient roster</option>{allowlists.filter((item) => item.id !== view.finalAllowlistId).map((item) => <option value={item.id} key={item.id}>{item.name} / {item.members.length} people</option>)}</select></label><label className="field"><span>POPULATION DESIGN</span><select value={populationMode} onChange={(event) => setPopulationMode(event.target.value as typeof populationMode)}><option value="DISJOINT_SELECTOR_RECIPIENT">People choosing cannot receive</option><option value="OVERLAPPING">People choosing may also receive</option></select></label></div><details><summary>Create a recipient roster from known TAKE people</summary><div className="recipient-picker">{people.map((person) => { const id = person.recipient.type === "take_identity" ? person.recipient.takeIdentityId : ""; const checked = recipientPeople.includes(id); return <button type="button" className={checked ? "is-selected" : ""} onClick={() => setRecipientPeople((items) => checked ? items.filter((item) => item !== id) : [...items, id])} key={id}><Avatar person={{ id, name: person.displayName, avatarUrl: person.avatarUrl }} size="xs" /><span>{person.displayName}</span>{checked ? <Check size={15} /> : <UserPlus size={15} />}</button>; })}{!people.length ? <p className="people-picker__empty">No real TAKE members are available yet. Ask recipients to onboard before building this roster.</p> : null}</div><SecondaryAction onClick={() => void createRecipientRoster()} disabled={!recipientPeople.length || busy === "roster"}>CREATE RECIPIENT ROSTER ({recipientPeople.length})</SecondaryAction></details>{managed ? <p className="mechanism-empty">A TAKE operator will select the prepared roster and lock the campaign artifacts.</p> : <PrimaryAction onClick={() => void prepareMechanism()} disabled={!recipientAllowlistId || busy === "save"}>PREPARE CAMPAIGN SNAPSHOTS</PrimaryAction>}</section> : null}
        </>
      )}
    </section>
  );
}

function PolicyEditor({ policy, setPolicy, onCapChange, disabled = false }: { policy: SelectorEligibilityPolicy; setPolicy: (value: SelectorEligibilityPolicy) => void; onCapChange: (id: string, value: number) => void; disabled?: boolean }) {
  return <div className="policy-editor"><div className="policy-editor__summary"><label><span>ELIGIBILITY THRESHOLD</span><input disabled={disabled} type="number" min="1" max="400" value={policy.requiredTotalPoints} onChange={(event) => setPolicy({ ...policy, requiredTotalPoints: Number(event.target.value) })} /></label><label><span>MINIMUM CATEGORIES</span><input disabled={disabled} type="number" min="1" max={policy.categories.filter((item) => item.enabled).length} value={policy.minimumDistinctCategories} onChange={(event) => setPolicy({ ...policy, minimumDistinctCategories: Number(event.target.value) })} /></label></div><div className="policy-categories">{policy.categories.map((category) => <article key={category.id}><header><label><input disabled={disabled} type="checkbox" checked={category.enabled} onChange={(event) => setPolicy({ ...policy, categories: policy.categories.map((item) => item.id === category.id ? { ...item, enabled: event.target.checked } : item) })} /><span>{category.label}</span></label><label><input disabled={disabled} type="number" min="1" max="100" value={category.maximumPoints} onChange={(event) => onCapChange(category.id, Number(event.target.value))} /><small>MAX</small></label></header>{category.rules.map((rule) => <div key={rule.id}><span>{rule.source === "AUTOMATED" ? "AUTO" : "REVIEW"}</span><strong>{rule.label}</strong><em>+{rule.points}</em></div>)}</article>)}</div><div className="policy-toggles"><label><input type="checkbox" disabled={disabled} checked={policy.allowAppeals} onChange={(event) => setPolicy({ ...policy, allowAppeals: event.target.checked })} />Allow evidence appeals</label><label><input type="checkbox" disabled={disabled} checked={policy.integrityScreeningEnabled} onChange={(event) => setPolicy({ ...policy, integrityScreeningEnabled: event.target.checked })} />Use available integrity observations</label><label><input type="checkbox" disabled={disabled} checked={policy.newcomerPath.enabled} onChange={(event) => setPolicy({ ...policy, newcomerPath: event.target.checked ? { enabled: true, title: "Relevant work alternative", description: "Qualify through campaign-relevant evidence.", requiredEvidence: ["GITHUB_OR_PROJECT"] } : { enabled: false } })} />Allow declared newcomer path</label></div></div>;
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : "TAKE could not complete this eligibility action."; }
