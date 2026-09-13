import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { useCreateWallet, useUser, useWallets } from "@privy-io/react-auth";
import { Avatar } from "../components/Avatar";
import { Brand } from "../components/Brand";
import { PrimaryAction } from "../components/Actions";
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
    <main className="onboarding-page">
      <div className="onboarding-page__rail" aria-hidden="true" />
      <header className="onboarding-header">
        <Brand light />
        <span>PROFILE / 01</span>
      </header>
      <section className="profile-setup">
        <div className="profile-setup__preview">
          <span className="profile-setup__marker">THIS IS YOU</span>
          <Avatar person={person} size="hero" />
          <div>
            <strong>{person.name}</strong>
            {person.handle ? <span>{person.handle}</span> : <span>TAKE MEMBER</span>}
          </div>
        </div>
        <div className="profile-form">
          <div className="profile-form__intro">
            <span className="eyebrow">YOUR TAKE IDENTITY</span>
            <h1>This is how people find you.</h1>
            <p>Your connected social identity will appear whenever you give or receive a TAKE.</p>
          </div>
          <dl className="profile-source">
            <div><dt>DISPLAY NAME</dt><dd>{person.name}</dd></div>
            {person.handle ? <div><dt>SOCIAL HANDLE</dt><dd>{person.handle}</dd></div> : null}
            <div><dt>PROFILE SOURCE</dt><dd>{me.socials.twitter.connected ? "X" : me.socials.github.connected ? "GITHUB" : me.socials.discord.connected ? "DISCORD" : "PRIVY"}</dd></div>
          </dl>
          <div className="profile-form__assurance">
            <Check size={16} aria-hidden="true" />
            <span>{hasEmbeddedWallet ? "Your TAKE wallet is ready. Your social profile remains your visible identity." : "A private wallet will be created for product actions. Your profile stays social."}</span>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <PrimaryAction full type="button" disabled={saving} onClick={() => void completeProfile()}>
            {saving ? "SETTING UP…" : "ENTER TAKE"}
          </PrimaryAction>
        </div>
      </section>
    </main>
  );
}
