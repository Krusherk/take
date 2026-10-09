import { ArrowRight, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { useCreateWallet, useUser, useWallets } from "@privy-io/react-auth";
import { Avatar } from "../components/Avatar";
import { MascotSticker, PaperLabel, Sticker } from "../components/sticker/Sticker";
import { useTakeMe } from "../context/TakeIdentityContext";
import type { TakePath } from "../hooks/usePathRouter";
import { personFromMe } from "../lib/currentIdentity";
import { clearPostAuthDestination, readPostAuthDestination } from "../lib/authDestination";

interface ProfileSetupPageProps {
  navigate: (path: TakePath) => void;
}

export function ProfileSetupPage({ navigate }: ProfileSetupPageProps) {
  const { me, refetch } = useTakeMe();
  const { refreshUser } = useUser();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasEmbeddedWallet = useMemo(() => wallets.some((wallet) => wallet.walletClientType === "privy"), [wallets]);
  const person = me ? personFromMe(me) : null;

  async function completeProfile() {
    setSaving(true);
    setError(null);
    try {
      if (!hasEmbeddedWallet) {
        await createWallet();
        await refreshUser();
        await refetch();
      }
      window.sessionStorage.removeItem("take-onboarding-pending");
      const destination = readPostAuthDestination();
      clearPostAuthDestination();
      navigate(destination);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your identity is ready, but wallet setup needs another try.");
    } finally {
      setSaving(false);
    }
  }

  if (!person || !me) return null;

  return (
    <div className="app-shell app-shell--sky app-shell--public">
      <main className="page-container sticker-page sticker-feed onboarding-sticker">
        <section className="sticker-feed__stage profile-sticker__stage" aria-labelledby="onboarding-title">
          <Sticker tilt={4} className="feed-tag"><span>WELCOME</span></Sticker>
          <MascotSticker kind="lime" tilt={8} delay={240} className="sticker-feed__mascot sticker-feed__mascot--lime" />
          <Sticker tilt={-4} delay={40} className="profile-sticker__avatar"><Avatar person={person} size="xl" /></Sticker>
          <div className="sticker-feed__headline profile-sticker__headline">
            <h1 id="onboarding-title"><PaperLabel size="lg" tilt={-2} delay={60}>{`Hi, ${person.name}.`}</PaperLabel></h1>
            <PaperLabel size="sm" tilt={1.5} delay={120}>This is how people see you when you give or receive a TAKE.</PaperLabel>
          </div>
        </section>

        <Sticker tilt={-0.6} delay={200} className="profile-sticker__card onboarding-sticker__card">
          <dl className="onboarding-sticker__facts">
            <div><dt>Name</dt><dd>{person.name}</dd></div>
            {person.handle ? <div><dt>Handle</dt><dd>{person.handle}</dd></div> : null}
            <div><dt>Signed in with</dt><dd>{me.socials.twitter.connected ? "X" : me.socials.github.connected ? "GitHub" : me.socials.discord.connected ? "Discord" : "Email or wallet"}</dd></div>
          </dl>
          <p className="onboarding-sticker__wallet">
            <Check size={16} aria-hidden="true" />
            <span>{hasEmbeddedWallet ? "Your TAKE wallet is ready. It signs your TAKE on Monad." : "TAKE will create a wallet for you. It signs your TAKE on Monad."}</span>
          </p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="sticker-pill onboarding-sticker__go" type="button" disabled={saving} onClick={() => void completeProfile()}>
            <span>{saving ? "Setting up…" : "Enter TAKE"}</span><ArrowRight aria-hidden="true" />
          </button>
        </Sticker>
      </main>
    </div>
  );
}
