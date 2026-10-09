import { usePrivy } from "../lib/privy";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { ProductError, ProductLoading } from "../components/ProductState";
import { FlowHandoff } from "../components/sticker/FlowParts";
import { MascotSticker, PaperLabel, Sticker } from "../components/sticker/Sticker";
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

  if (loading) return <div className="app-shell app-shell--sky app-shell--public"><main className="page-container sticker-page sticker-feed"><ProductLoading label="Opening your TAKE" /></main></div>;
  if (error || !story?.giver || !story.recipient) return <div className="app-shell app-shell--sky app-shell--public"><main className="page-container sticker-page sticker-feed"><ProductError message={error ?? "This TAKE invitation is no longer available."} onRetry={() => navigate("/")} /></main></div>;

  const giver = storyPerson(story.giver, `${story.id}:giver`);
  const recipient = storyPerson(story.recipient, `${story.id}:recipient`);

  return (
    <div className="app-shell app-shell--sky app-shell--public">
      <main className="page-container sticker-page sticker-feed sticker-flow invite-sticker">
        <section className="sticker-feed__stage" aria-labelledby="invite-heading">
          <Sticker tilt={4} className="feed-tag"><span>YOU WERE CHOSEN</span></Sticker>
          <MascotSticker kind="star" tilt={-10} delay={240} className="sticker-feed__mascot sticker-feed__mascot--star" />
          <div className="sticker-feed__headline">
            <h1 id="invite-heading"><PaperLabel size="lg" tilt={-2} delay={60}>{`${giver.name} gave you their TAKE.`}</PaperLabel></h1>
            <PaperLabel size="sm" tilt={1.5} delay={120}>{`They chose you for ${story.campaign.title}.`}</PaperLabel>
          </div>
          <FlowHandoff from={giver} to={recipient} fromLabel={giver.name} toLabel="you" label={`${giver.name} gave their TAKE to you`} />
        </section>
        <Sticker tilt={-0.4} delay={200} className="sticker-flow__card">
          <dl className="sticker-flow__facts"><div><dt>Campaign</dt><dd>{story.campaign.title}</dd></div><div><dt>Chosen by</dt><dd>{giver.name}{giver.handle ? ` · ${giver.handle}` : ""}</dd></div><div><dt>Status</dt><dd>{story.status}</dd></div></dl>
        </Sticker>
        <div className="sticker-flow__dock sticker-flow__dock--two">
          <button className="sticker-pill" type="button" onClick={() => navigate(authenticated ? "/home" : "/")}><span>{authenticated ? "Enter TAKE" : "Join TAKE"}</span><ArrowRight aria-hidden="true" /></button>
          <button className="sticker-pill sticker-pill--paper sticker-pill--sm" type="button" onClick={() => navigate(`/campaign/${story.campaign.id}`)}>View campaign</button>
        </div>
      </main>
    </div>
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
