import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { PrimaryAction, SecondaryAction } from "../components/Actions";
import { Avatar } from "../components/Avatar";
import { Brand } from "../components/Brand";
import { HandoffBackdrop, HandoffPair } from "../components/Handoff";
import { ProductError, ProductLoading } from "../components/ProductState";
import { TakeMascotAccent } from "../components/TakeMascotAccent";
import { useTakeMe } from "../context/TakeIdentityContext";
import type { TakePath } from "../hooks/usePathRouter";
import type { Person } from "../types/product";

interface NominationStory {
  id: string;
  campaign: { id: string; title: string; status: string };
  giver: StoryPerson | null;
  recipient: StoryPerson | null;
  status: string;
  transactionHash: string | null;
  createdAt: string;
}

interface StoryPerson { displayName: string; username: string | null; avatarUrl: string | null; joined: boolean }

export function RecipientViewPage({ nominationId, navigate }: { nominationId: string; navigate: (path: TakePath) => void }) {
  const { authenticated } = usePrivy();
  const { request } = useTakeMe();
  const [story, setStory] = useState<NominationStory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    request<NominationStory>(`/nominations/${encodeURIComponent(nominationId)}/story`).then((response) => {
      if (active) setStory(response);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "This TAKE invitation could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [nominationId, request]);

  if (loading) return <main className="invite-page invite-page--state"><Brand light /><ProductLoading label="Opening your TAKE" /></main>;
  if (error || !story?.giver || !story.recipient) return <main className="invite-page invite-page--state"><Brand light /><ProductError message={error ?? "This TAKE invitation is no longer available."} onRetry={() => navigate("/")} /></main>;

  const giver = storyPerson(story.giver, `${story.id}:giver`);
  const recipient = storyPerson(story.recipient, `${story.id}:recipient`);

  return (
    <main className="invite-page">
      <div className="invite-page__noise" aria-hidden="true" />
      <HandoffBackdrop />
      <header className="invite-header"><Brand light /><span>YOU WERE CHOSEN</span></header>
      <section className="invite-message">
        <div className="invite-message__portraits"><Avatar person={giver} size="lg" /><span className="invite-message__track" aria-hidden="true"><i /></span><Avatar person={recipient} size="xl" /></div>
        <span className="eyebrow">A TAKE FROM {giver.name.toUpperCase()}</span>
        <h1><em>{giver.name}</em> gave you their TAKE.</h1>
        <p>They chose you for this opportunity.</p>
      </section>
      <section className="invite-campaign">
        <div><span className="live-signal"><i />{story.campaign.status}</span><h2>{story.campaign.title}</h2><p>Your choice is attached to this campaign.</p></div>
        <dl><div><dt>CHOSEN BY</dt><dd>{giver.name}{giver.handle ? ` · ${giver.handle}` : ""}</dd></div><div><dt>STATUS</dt><dd>{story.status}</dd></div></dl>
      </section>
      <TakeMascotAccent character="handoff" className="mascot-invite" />
      <HandoffPair from={giver} to={recipient} compact />
      <div className="invite-actions"><PrimaryAction full onClick={() => navigate(authenticated ? "/home" : "/")}>{authenticated ? "ENTER TAKE" : "JOIN TAKE"}</PrimaryAction><SecondaryAction full onClick={() => navigate(`/campaign/${story.campaign.id}`)}>VIEW CAMPAIGN <ArrowRight size={17} /></SecondaryAction></div>
    </main>
  );
}

function storyPerson(source: StoryPerson, id: string): Person {
  return {
    id,
    name: source.displayName,
    handle: source.username ? `@${source.username.replace(/^@/, "")}` : "",
    avatarUrl: source.avatarUrl,
    joined: source.joined,
    recipient: { type: "take_identity", takeIdentityId: id },
  };
}
