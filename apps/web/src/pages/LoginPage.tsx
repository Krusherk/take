import { ArrowRight, Mail, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLogin, useLoginWithEmail, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { LandingHeader } from "../components/landing/LandingHeader";
import { LandingStickerSections } from "../components/landing/LandingStickerSections";
import { LandingSkyStickers } from "../components/landing/LandingSkyStickers";
import { PaperLabel, Sticker } from "../components/sticker/Sticker";
import type { Navigate } from "../hooks/usePathRouter";
import {
  clearPostAuthDestination,
  rememberPostAuthDestination,
  routeAfterAuthentication,
  type PostAuthDestination,
} from "../lib/authDestination";

interface LoginPageProps {
  navigate: Navigate;
}

export function LoginPage({ navigate }: LoginPageProps) {
  const { ready, authenticated } = usePrivy();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const completeAuthentication = ({ isNewUser }: { isNewUser?: boolean }) => {
    navigate(routeAfterAuthentication(isNewUser));
  };

  const { initOAuth, state: oauthState } = useLoginWithOAuth({
    onComplete: completeAuthentication,
    onError: () => setError("X sign-in could not be completed. Please try again."),
  });
  const { login } = useLogin({
    onComplete: completeAuthentication,
    onError: () => setError("Wallet sign-in could not be completed. Please try again."),
  });
  const { sendCode, loginWithCode, state: emailState } = useLoginWithEmail({
    onComplete: completeAuthentication,
    onError: () => setError("That code did not work. Check it and try again."),
  });

  useEffect(() => {
    if (ready && authenticated) navigate(routeAfterAuthentication(false), { replace: true });
  }, [authenticated, navigate, ready]);

  useEffect(() => {
    if (!dialogOpen) return;
    document.body.classList.add("landing-modal-open");
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearPostAuthDestination();
        setDialogOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href]'
      )];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.classList.remove("landing-modal-open");
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [dialogOpen]);

  const awaitingCode = emailState.status === "awaiting-code-input" || emailState.status === "submitting-code";
  const busy = oauthState.status === "loading" || emailState.status === "sending-code" || emailState.status === "submitting-code";

  function openAuthentication(destination: PostAuthDestination) {
    rememberPostAuthDestination(destination);
    setError(null);
    setDialogOpen(true);
  }

  function closeAuthentication() {
    if (busy) return;
    clearPostAuthDestination();
    setDialogOpen(false);
    setShowEmail(false);
    setError(null);
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (awaitingCode) {
      await loginWithCode({ code });
      return;
    }
    await sendCode({ email });
  }

  return (
    <main id="top" className="landing-page">
      <div className="landing-first-view landing-sky">
        <LandingHeader onSignIn={() => openAuthentication("/home")} />

        <section className="landing-sky__hero" aria-labelledby="landing-heading">
          <div className="landing-sky__copy">
            <PaperLabel size="sm" tilt={-3} className="landing-sky__kicker">people choose people</PaperLabel>
            <h1 id="landing-heading" className="landing-sky__headline">
              <Sticker tilt={-2} delay={80} as="span" className="landing-sky__line landing-sky__line--one"><span>You have one TAKE.</span></Sticker>
              <Sticker tilt={1.5} delay={160} as="span" className="landing-sky__line landing-sky__line--two"><span>Give it to someone else.</span></Sticker>
            </h1>
            <div className="landing-sky__actions">
              <Sticker tilt={-1} delay={260} className="sticker-cta">
                <button className="sticker-pill landing-sky__primary" type="button" onClick={() => openAuthentication("/organize")}>
                  <span>Start a campaign</span><ArrowRight aria-hidden="true" />
                </button>
              </Sticker>
              <Sticker tilt={1.5} delay={320} className="landing-sky__secondary-wrap">
                <a className="landing-sky__secondary" href="#how-it-works">See how TAKE works</a>
              </Sticker>
            </div>
          </div>

          <LandingSkyStickers />
        </section>
      </div>

      <LandingStickerSections onStartCampaign={() => openAuthentication("/organize")} onExplore={() => openAuthentication("/explore")} />

      {dialogOpen ? (
        <div className="landing-auth-layer" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeAuthentication();
        }}>
          <section
            ref={dialogRef}
            className="landing-auth-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="landing-auth-heading"
          >
            <button ref={closeButtonRef} className="landing-auth-dialog__close" type="button" aria-label="Close sign in" onClick={closeAuthentication}>
              <X aria-hidden="true" />
            </button>
            <img className="landing-auth-dialog__logo" src="/assets/sticker/logo.webp" alt="" width="243" height="240" />
            <span className="landing-eyebrow">Welcome to TAKE</span>
            <h2 id="landing-auth-heading">Join as yourself.</h2>
            <p>Your social identity comes first. Your wallet stays underneath.</p>

            <div className="landing-auth-actions">
              <button className="landing-auth-primary" type="button" disabled={busy} onClick={() => {
                setError(null);
                void initOAuth({ provider: "twitter" });
              }}>
                <b aria-hidden="true">X</b>
                {oauthState.status === "loading" ? "Opening X…" : "Continue with X"}
                <ArrowRight aria-hidden="true" />
              </button>

              {showEmail ? (
                <form className="landing-email-login" onSubmit={(event) => void handleEmailSubmit(event)}>
                  <label htmlFor={awaitingCode ? "landing-auth-code" : "landing-auth-email"}>{awaitingCode ? "Enter your code" : "Your email"}</label>
                  <div>
                    {awaitingCode ? (
                      <input id="landing-auth-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.currentTarget.value)} placeholder="000000" maxLength={8} autoFocus required />
                    ) : (
                      <input id="landing-auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} placeholder="you@example.com" autoFocus required />
                    )}
                    <button type="submit" disabled={busy}>{awaitingCode ? "Verify" : "Send code"}</button>
                  </div>
                </form>
              ) : (
                <button className="landing-auth-secondary" type="button" onClick={() => setShowEmail(true)}>
                  <Mail size={18} aria-hidden="true" />Continue with email
                </button>
              )}

              <button className="landing-auth-wallet" type="button" onClick={() => login()}>
                <Wallet size={18} aria-hidden="true" />Use a wallet
              </button>
            </div>

            {error ? <p className="landing-auth-error" role="alert">{error}</p> : null}
            <small>By continuing, you agree to TAKE’s terms and privacy policy.</small>
          </section>
        </div>
      ) : null}
    </main>
  );
}
