import { CheckCheck } from "lucide-react";
import { TextAction } from "../components/Actions";
import { SocialEmpty } from "../components/ProductState";
import { ActivityRow } from "../components/Social";
import { TakeMascotAccent } from "../components/TakeMascotAccent";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { activityFromHistory } from "../lib/currentIdentity";
import type { ActivityItem } from "../types/product";

export function NotificationsPage({ navigate, read, onMarkRead }: { navigate: (path: TakePath) => void; read: boolean; onMarkRead: () => void }) {
  const { me, history } = useTakeMe();
  const { campaigns } = useTakeProduct();
  if (!me || !history) return null;

  const received = activityFromHistory(me, history).filter((item) => item.kind === "received");
  const deadlines: ActivityItem[] = campaigns.filter((campaign) => campaign.status === "LIVE").map((campaign) => ({
    id: `deadline:${campaign.id}`,
    kind: "deadline",
    campaign: campaign.title,
    campaignId: campaign.id,
    message: `${campaign.title} is open until ${campaign.ends}.`,
    time: `ENDS ${campaign.ends}`,
  }));
  const items = [...received, ...deadlines].map((item) => ({ ...item, unread: !read }));

  return (
    <div className="page-container notifications-page">
      <header className="page-intro compact-intro">
        <div><span className="eyebrow">NOTIFICATIONS</span><h1>When someone chooses you, you’ll know.</h1></div>
        <TextAction arrow="none" onClick={onMarkRead} disabled={read || !items.length}><span className="provider-label"><CheckCheck size={18} />{read ? "ALL READ" : "MARK ALL READ"}</span></TextAction>
        <TakeMascotAccent character="blue" className="mascot-intro mascot-intro--notifications" />
      </header>
      <section className="notification-feed" aria-label="Notifications">
        {items.length ? items.map((item) => <ActivityRow key={`${item.id}:${item.kind}`} item={item} detailed onCampaign={(id) => navigate(`/campaign/${id}`)} />) : (
          <SocialEmpty title="Nothing new yet." action="EXPLORE CAMPAIGNS" onAction={() => navigate("/explore")}>TAKEs you receive and important campaign updates will appear here.</SocialEmpty>
        )}
      </section>
    </div>
  );
}
