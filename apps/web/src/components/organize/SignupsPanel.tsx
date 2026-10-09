import { Copy, Lock, UserMinus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "../Avatar";
import type { ToastTone } from "./OrganizeToast";
import "./organize-ui.css";

export interface SignupMember {
  takeIdentityId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  via: string;
  broughtBy: { takeIdentityId: string; displayName: string; username: string | null } | null;
  joinedAt: string;
}

export interface SignupsView {
  campaignId: string;
  code: string;
  joinEnabled: boolean;
  open: boolean;
  status: "OPEN" | "CLOSING" | "CLOSED" | "FAILED";
  campaignStatus: string;
  signupDeadline: string | null;
  recipientSelfJoin: boolean;
  autoOpen: boolean;
  canOpen: boolean;
  lastError: string | null;
  closeReport: { skippedGivers?: Array<{ name: string; reason: string }>; failure?: { message: string } } | null;
  interestCount: number;
  givers: SignupMember[];
  recipients: SignupMember[];
}

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Feedback = (tone: ToastTone, title: string, body?: string) => void;

export function joinUrl(code: string, forPerson?: { username: string | null; takeIdentityId: string }) {
  const base = `${window.location.origin}/join/${code}`;
  if (!forPerson) return base;
  return `${base}?for=${encodeURIComponent(forPerson.username ?? forPerson.takeIdentityId)}`;
}

/** The organizer's view of a campaign that is collecting sign-ups. */
export function SignupsPanel({ campaignId, request, onFeedback, onOpened }: {
  campaignId: string;
  request: Request;
  onFeedback: Feedback;
  onOpened: () => Promise<void> | void;
}) {
  const [view, setView] = useState<SignupsView | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await request<SignupsView>(`/organizer/campaigns/${campaignId}/signups`));
      setMissing(false);
    } catch {
      setMissing(true);
    }
  }, [campaignId, request]);

  useEffect(() => { void load(); }, [load]);
  // People keep joining while the organizer watches.
  useEffect(() => {
    if (!view?.open) return;
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load, view?.open]);

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      onFeedback("success", `${what} copied.`, text);
    } catch {
      onFeedback("action", `Copy this ${what.toLowerCase()}:`, text);
    }
  }

  async function remove(member: SignupMember) {
    setBusy(`remove:${member.takeIdentityId}`);
    try {
      setView(await request<SignupsView>(`/organizer/campaigns/${campaignId}/signups/members/${member.takeIdentityId}/remove`, { method: "POST", body: "{}" }));
      onFeedback("success", `${member.displayName} removed.`, "They can’t join this campaign again from the link.");
    } catch (caught) {
      onFeedback("error", "Could not remove them.", caught instanceof Error ? caught.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  async function toggleRecipientJoin(next: boolean) {
    setBusy("settings");
    try {
      setView(await request<SignupsView>(`/organizer/campaigns/${campaignId}/signups`, { method: "PATCH", body: JSON.stringify({ recipientSelfJoin: next }) }));
    } catch (caught) {
      onFeedback("error", "That setting did not save.", caught instanceof Error ? caught.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  async function closeAndOpen() {
    setBusy("close");
    onFeedback("action", "Locking the lists…", "TAKE is locking who can give and receive, then publishing and opening nominations with its server wallet.");
    try {
      const result = await request<SignupsView & { result: { outcome: string } }>(`/organizer/campaigns/${campaignId}/signups/close`, { method: "POST", body: "{}" });
      setView(result);
      if (result.result.outcome === "OPEN" || result.result.outcome === "ALREADY_OPEN") {
        onFeedback("success", "Nominations are open.", "Givers got a notification. The campaign is live in Explore.");
      } else {
        onFeedback("action", "Lists locked. Opening on Monad…", "TAKE finishes opening nominations within a few minutes.");
      }
      await onOpened();
    } catch (caught) {
      onFeedback("error", "Nominations did not open.", caught instanceof Error ? caught.message : undefined);
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (missing) return null;
  if (!view) return <p className="signups-loading" role="status">Loading sign-ups…</p>;

  const link = joinUrl(view.code);
  const locked = !["OPEN", "FAILED"].includes(view.status) || view.campaignStatus !== "DRAFT";
  const deadline = view.signupDeadline ? new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(view.signupDeadline)) : null;
  const skipped = view.closeReport?.skippedGivers ?? [];

  return (
    <section className="signups" aria-label="Sign-ups">
      {view.joinEnabled ? (
        <div className="signups-link">
          <span className="signups-tag">{view.open ? "SIGN-UPS OPEN" : locked ? "LISTS LOCKED" : "SIGN-UPS CLOSED"}</span>
          <p className="signups-link__url">{link.replace(/^https?:\/\//, "")}</p>
          <button type="button" className="signups-chip-button" onClick={() => void copy(link, "Join link")}><Copy size={15} aria-hidden="true" />Copy join link</button>
          <p className="signups-link__note">
            {deadline ? `Sign-ups close ${deadline}${view.autoOpen ? ", then TAKE opens nominations by itself." : "."}` : "Sign-ups stay open until you close them."}
            {view.interestCount ? ` ${view.interestCount} ${view.interestCount === 1 ? "person wants" : "people want"} to hear about the next one.` : ""}
          </p>
        </div>
      ) : null}

      <div className="signups-counts" role="group" aria-label="Counts">
        <span><strong>{view.givers.length}</strong> {view.givers.length === 1 ? "giver" : "givers"}</span>
        <span><strong>{view.recipients.length}</strong> to back</span>
      </div>

      {view.joinEnabled && !locked ? (
        <label className="signups-toggle">
          <input type="checkbox" checked={view.recipientSelfJoin} disabled={busy !== null} onChange={(event) => void toggleRecipientJoin(event.target.checked)} />
          <span>Let people join as recipients from the link too</span>
        </label>
      ) : null}

      <MemberList
        title="Givers"
        empty="No givers yet. Share the join link."
        members={view.givers}
        locked={locked}
        busy={busy}
        onRemove={(member) => void remove(member)}
      />
      <MemberList
        title="People to back"
        empty="No recipients yet. Add them when you create the campaign, or let them join from the link."
        members={view.recipients}
        locked={locked}
        busy={busy}
        onRemove={(member) => void remove(member)}
        shareLink={view.joinEnabled && view.open ? (member) => void copy(joinUrl(view.code, member), `${member.username ? `@${member.username}` : member.displayName}’s share link`) : undefined}
      />

      {skipped.length ? (
        <p className="signups-note">Not included because they had no wallet yet: {skipped.map((item) => item.name).join(", ")}.</p>
      ) : null}
      {view.status === "FAILED" && view.lastError ? <p className="signups-error" role="alert">{view.lastError}</p> : null}
      {view.status === "CLOSING" ? <p className="signups-note" role="status">Lists are locked. TAKE is opening nominations on Monad{view.lastError ? ` (last try: ${view.lastError})` : ""}.</p> : null}

      {!locked ? (
        view.canOpen ? (
          <button type="button" className="signups-primary" disabled={busy !== null || !view.givers.length || !view.recipients.length} onClick={() => void closeAndOpen()}>
            <Lock size={18} aria-hidden="true" />{busy === "close" ? "Opening nominations…" : view.joinEnabled ? "Close sign-ups and open" : "Lock lists and open"}
          </button>
        ) : (
          <p className="signups-note">Only a TAKE operator can open nominations. Your lists are saved.</p>
        )
      ) : null}
    </section>
  );
}

function MemberList({ title, empty, members, locked, busy, onRemove, shareLink }: {
  title: string;
  empty: string;
  members: SignupMember[];
  locked: boolean;
  busy: string | null;
  onRemove: (member: SignupMember) => void;
  shareLink?: (member: SignupMember) => void;
}) {
  return (
    <div className="signups-list">
      <h3><Users size={16} aria-hidden="true" />{title}</h3>
      {members.length ? (
        <ul>
          {members.map((member) => (
            <li key={member.takeIdentityId}>
              <Avatar person={{ id: member.takeIdentityId, name: member.displayName, avatarUrl: member.avatarUrl }} size="sm" />
              <span className="signups-person">
                <strong>{member.displayName}</strong>
                <small>
                  {member.username ? `@${member.username}` : "TAKE member"}
                  {member.broughtBy ? <em className="signups-brought">brought by {member.broughtBy.username ? `@${member.broughtBy.username}` : member.broughtBy.displayName}</em> : null}
                </small>
              </span>
              <span className="signups-actions">
                {shareLink ? (
                  <button type="button" className="signups-chip-button" onClick={() => shareLink(member)} aria-label={`Copy ${member.displayName}’s share link`}>
                    <Copy size={14} aria-hidden="true" />Share link
                  </button>
                ) : null}
                {!locked ? (
                  <button type="button" className="signups-icon-button" disabled={busy !== null} onClick={() => onRemove(member)} aria-label={`Remove ${member.displayName}`}>
                    <UserMinus size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="signups-empty">{empty}</p>}
    </div>
  );
}
