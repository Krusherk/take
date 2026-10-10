import { useCallback, useEffect, useState } from "react";
import { BellRing, Check } from "lucide-react";
import { CampaignSticker, EmptySlotSticker, FaceSticker, MascotSticker, PaperLabel, PassArrow, Sticker } from "../components/sticker/Sticker";
import { ProductError, ProductLoading } from "../components/ProductState";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { rememberPostAuthDestination, routeAfterAuthentication } from "../lib/authDestination";
import { personFromMe } from "../lib/currentIdentity";
import { useLoginWithOAuth, usePrivy } from "../lib/privy";
import { TAKE_API_BASE_URL } from "../lib/takeApi";
import type { Person } from "../types/product";
import "../components/join/join.css";

export interface JoinPerson {
  takeIdentityId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
}

export interface JoinView {
  code: string;
  open: boolean;
  campaign: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    endTime: string;
    organizationName: string | null;
    resourceName: string | null;
    seatCount: number | null;
  };
  signupDeadline: string | null;
  recipientSelfJoin: boolean;
  counts: { givers: number; recipients: number };
  for: JoinPerson | null;
  viewer: { joinedAs: "GIVER" | "RECIPIENT" | null; removed: boolean; interested: boolean } | null;
}

const FOR_KEY = (code: string) => `take-join-for:${code}`;

/** `?for=` survives the X sign-in round trip in session storage. */
export function readJoinFor(code: string, search = window.location.search): string | null {
  const fromUrl = new URLSearchParams(search).get("for")?.trim().replace(/^@/, "") ?? "";
  if (/^[A-Za-z0-9_-]{1,64}$/.test(fromUrl)) {
    window.sessionStorage.setItem(FOR_KEY(code), fromUrl);
    return fromUrl;
  }
  return window.sessionStorage.getItem(FOR_KEY(code));
}

export function joinPersonToPerson(person: JoinPerson): Person {
  return {
    id: person.takeIdentityId,
    name: person.displayName,
    handle: person.username ? `@${person.username}` : "",
    avatarUrl: person.avatarUrl,
    joined: true,
    recipient: { type: "take_identity", takeIdentityId: person.takeIdentityId },
  };
}

export function JoinPage({ code, navigate }: { code: string; navigate: (path: TakePath) => void }) {
  const { ready, authenticated } = usePrivy();
  const { me, request, status: identityStatus } = useTakeMe();
  const { refetch: refetchCampaigns } = useTakeProduct();
  const [forRef] = useState(() => readJoinFor(code));
  const [view, setView] = useState<JoinView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"GIVER" | "RECIPIENT" | "INTEREST" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ role: "GIVER" | "RECIPIENT"; gas: string | null } | null>(null);
  const signedIn = ready && authenticated && Boolean(me);
  // Wait for a signed-in session to resolve, so the page does not flash "Sign in".
  const identityPending = !ready || (authenticated && !me && identityStatus !== "profile-error" && identityStatus !== "unauthenticated");
  const { initOAuth, state: oauthState } = useLoginWithOAuth({
    onComplete: ({ isNewUser }) => navigate(routeAfterAuthentication(isNewUser)),
    onError: () => setActionError("X sign-in could not be completed. Please try again."),
  });

  const load = useCallback(async () => {
    setLoadError(null);
    const query = forRef ? `?for=${encodeURIComponent(forRef)}` : "";
    try {
      const next = signedIn
        ? await request<JoinView>(`/join/${code}${query}`)
        : await fetch(`${TAKE_API_BASE_URL}/join/${code}${query}`).then(async (response) => {
            if (!response.ok) throw new Error(response.status === 404 ? "This join link does not exist." : "This join link could not be loaded.");
            return response.json() as Promise<JoinView>;
          });
      setView(next);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "This join link could not be loaded.");
    }
  }, [code, forRef, request, signedIn]);

  useEffect(() => { if (!identityPending) void load(); }, [identityPending, load]);

  useEffect(() => {
    document.title = view ? `Join ${view.campaign.title} · TAKE` : "Join · TAKE";
  }, [view]);

  function signIn() {
    rememberPostAuthDestination(`/join/${code}`);
    setActionError(null);
    void initOAuth({ provider: "twitter" });
  }

  async function join(role: "GIVER" | "RECIPIENT") {
    setBusy(role);
    setActionError(null);
    try {
      const result = await request<{ campaignId: string; joinedAs: "GIVER" | "RECIPIENT"; gas: { outcome: string } | null }>(`/join/${code}`, {
        method: "POST",
        body: JSON.stringify({ role, for: forRef }),
      });
      window.sessionStorage.removeItem(FOR_KEY(code));
      setJoined({ role: result.joinedAs, gas: result.gas?.outcome ?? null });
      await refetchCampaigns().catch(() => undefined);
      window.setTimeout(() => navigate(`/campaign/${result.campaignId}`), 1400);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "You could not join right now. Try again.");
      void load();
    } finally {
      setBusy(null);
    }
  }

  async function notifyMe() {
    setBusy("INTEREST");
    setActionError(null);
    try {
      await request(`/join/${code}/interest`, { method: "POST" });
      setView((current) => current && current.viewer ? { ...current, viewer: { ...current.viewer, interested: true } } : current);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (loadError && !view) {
    return <JoinFrame><ProductError message={loadError} onRetry={() => void load()} /></JoinFrame>;
  }
  if (!view) return <JoinFrame><ProductLoading label="Opening the join link" /></JoinFrame>;

  const current = me ? personFromMe(me) : null;
  const backing = view.for ? joinPersonToPerson(view.for) : null;
  const joinedAs = joined?.role ?? view.viewer?.joinedAs ?? null;
  const deadline = view.signupDeadline ? formatDeadline(view.signupDeadline) : null;
  const campaignFace = { title: view.campaign.title, spots: view.campaign.seatCount ?? undefined, nominationLimit: 1 };

  return (
    <JoinFrame>
      <section className="join-hero" aria-labelledby="join-title">
        <Sticker tilt={3} delay={40} as="span" className="feed-tag join-hero__tag">
          <span>{view.open ? "SIGN-UPS OPEN" : "SIGN-UPS CLOSED"}</span>
        </Sticker>
        {backing ? (
          <>
            <div className="join-hero__handoff" role="group" aria-label={`You back ${backing.name}`}>
              {current ? <FaceSticker person={current} size="sm" tilt={-6} delay={120} label="you" /> : <EmptySlotSticker size="sm" tilt={-6} delay={120} label="you" />}
              <PassArrow className="pass-arrow--sm" />
              <FaceSticker person={backing} size="lg" tilt={4} delay={180} label={backing.name} sublabel={backing.handle || undefined} />
            </div>
            <h1 id="join-title" className="join-hero__title">
              <PaperLabel size="lg" tilt={-2} delay={220}>Back {backing.handle || backing.name} on TAKE</PaperLabel>
            </h1>
            <PaperLabel size="sm" tilt={1.5} delay={260}>{view.campaign.title}</PaperLabel>
          </>
        ) : (
          <>
            <div className="join-hero__art">
              <CampaignSticker campaign={campaignFace} tilt={-4} delay={80} />
              <MascotSticker kind="lime" tilt={-8} delay={200} className="join-hero__mascot" />
            </div>
            <h1 id="join-title" className="join-hero__title">
              <PaperLabel size="lg" tilt={2.5} delay={140}>{view.campaign.title}</PaperLabel>
            </h1>
            {view.campaign.organizationName ? <PaperLabel size="sm" tilt={-2} delay={190}>by {view.campaign.organizationName}</PaperLabel> : null}
          </>
        )}
      </section>

      <Sticker tilt={-0.8} delay={300} className="join-card">
        {joinedAs ? (
          <JoinedCard
            role={joinedAs}
            fresh={Boolean(joined)}
            gas={joined?.gas ?? null}
            open={view.open}
            deadline={deadline}
            onOpen={() => navigate(`/campaign/${view.campaign.id}`)}
          />
        ) : view.viewer?.removed ? (
          <>
            <h2 className="join-card__title">You’re not on this list</h2>
            <p className="join-card__body">The organizer removed you from this campaign.</p>
          </>
        ) : !view.open ? (
          <>
            <h2 className="join-card__title">Sign-ups closed.</h2>
            <p className="join-card__body">Get notified when the next {view.campaign.organizationName ?? "campaign"} campaign opens.</p>
            {signedIn ? (
              view.viewer?.interested
                ? <p className="join-card__done"><Check size={16} aria-hidden="true" /> We’ll let you know.</p>
                : <button className="sticker-pill join-card__primary" type="button" disabled={busy !== null} onClick={() => void notifyMe()}>
                    <BellRing size={16} aria-hidden="true" />{busy === "INTEREST" ? "Saving…" : "Notify me"}
                  </button>
            ) : (
              <button className="sticker-pill join-card__primary" type="button" disabled={oauthState.status === "loading"} onClick={signIn}>
                <b aria-hidden="true">X</b>{oauthState.status === "loading" ? "Opening X…" : "Sign in with X to get notified"}
              </button>
            )}
          </>
        ) : (
          <>
            <h2 className="join-card__title">{backing ? `Join as a giver to back ${backing.name}` : "Join this campaign"}</h2>
            <p className="join-card__body">
              Givers each get one TAKE to give to someone they believe in{view.campaign.resourceName ? ` for ${view.campaign.resourceName}` : ""}.
              {backing ? ` You can give yours to ${backing.name} or anyone else on the list.` : ""}
            </p>
            <ul className="join-card__facts">
              <li><strong>{deadline ? `Sign-ups close ${deadline}` : "Sign-ups close when the organizer opens nominations"}</strong></li>
              <li>{view.counts.givers} {view.counts.givers === 1 ? "giver" : "givers"} · {view.counts.recipients} {view.counts.recipients === 1 ? "person" : "people"} to back</li>
              <li>TAKE covers the gas for your first TAKE.</li>
            </ul>
            {signedIn ? (
              <div className="join-card__actions">
                <button className="sticker-pill join-card__primary" type="button" disabled={busy !== null} onClick={() => void join("GIVER")}>
                  {busy === "GIVER" ? "Joining…" : "Join as giver"}
                </button>
                {view.recipientSelfJoin && !backing ? (
                  <button className="join-card__secondary" type="button" disabled={busy !== null} onClick={() => void join("RECIPIENT")}>
                    {busy === "RECIPIENT" ? "Joining…" : "Join as recipient"}
                  </button>
                ) : null}
              </div>
            ) : (
              <button className="sticker-pill join-card__primary" type="button" disabled={oauthState.status === "loading"} onClick={signIn}>
                <b aria-hidden="true">X</b>{oauthState.status === "loading" ? "Opening X…" : "Sign in with X to join"}
              </button>
            )}
          </>
        )}
        {actionError ? <p className="join-card__error" role="alert">{actionError}</p> : null}
      </Sticker>

      {view.campaign.description && !joinedAs ? (
        <PaperLabel size="md" tilt={1} delay={360} className="join-about">{view.campaign.description}</PaperLabel>
      ) : null}
    </JoinFrame>
  );
}

function JoinedCard({ role, fresh, gas, open, deadline, onOpen }: {
  role: "GIVER" | "RECIPIENT";
  fresh: boolean;
  gas: string | null;
  open: boolean;
  deadline: string | null;
  onOpen: () => void;
}) {
  return (
    <>
      <h2 className="join-card__title"><Check size={20} aria-hidden="true" /> You’re in as a {role === "GIVER" ? "giver" : "recipient"}.</h2>
      <p className="join-card__body">
        {open
          ? `Nominations open when sign-ups close${deadline ? ` (${deadline})` : ""}. We’ll notify you.`
          : "Sign-ups are closed. Open the campaign to see where it stands."}
      </p>
      {fresh && gas === "SENT" ? <p className="join-card__done">TAKE sent a little MON to your wallet for gas.</p> : null}
      <button className="sticker-pill join-card__primary" type="button" onClick={onOpen}>Open campaign</button>
    </>
  );
}

function JoinFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell app-shell--sky app-shell--public">
      <main className="page-container sticker-page join-page">{children}</main>
    </div>
  );
}

function formatDeadline(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
