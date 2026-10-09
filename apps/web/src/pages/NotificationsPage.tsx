import { CheckCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { SocialEmpty } from "../components/ProductState";
import { ActivityRow } from "../components/Social";
import { FeedStage } from "../components/sticker/FeedStage";
import { Sticker } from "../components/sticker/Sticker";
import { useTakeMe } from "../context/TakeIdentityContext";
import { useTakeProduct } from "../context/TakeProductContext";
import type { TakePath } from "../hooks/usePathRouter";
import { activityFromHistory } from "../lib/currentIdentity";
import type { ActivityItem } from "../types/product";

export function NotificationsPage({ navigate, read, onMarkRead }: { navigate: (path: TakePath) => void; read: boolean; onMarkRead: () => void }) {
  const { me, history, request } = useTakeMe();
  const { campaigns } = useTakeProduct();
  const [opened, setOpened] = useState<StoredNotification[]>([]);
  useEffect(() => {
    let active = true;
    void request<StoredNotification[]>("/me/notifications")
      .then((rows) => { if (active) setOpened(rows); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [request]);
  if (!me || !history) return null;

  const nominationsOpen: ActivityItem[] = opened.filter((row) => row.type === "NOMINATIONS_OPEN" && row.payload.campaignId).map((row) => ({
    id: `opened:${row.id}`,
    kind: "deadline",
    campaign: row.payload.title,
    campaignId: row.payload.campaignId,
    message: `Nominations are open in ${row.payload.title ?? "your campaign"}. Give your TAKE.`,
    time: "NOMINATIONS OPEN",
    sortTime: Date.parse(row.createdAt),
  }));
  const markRead = () => {
    onMarkRead();
    void request("/me/notifications/read", { method: "POST" }).catch(() => undefined);
  };

  const received = activityFromHistory(me, history).filter((item) => item.kind === "received");
  const deadlines: ActivityItem[] = campaigns.filter((campaign) => campaign.status === "LIVE").map((campaign) => ({
    id: `deadline:${campaign.id}`,
    kind: "deadline",
    campaign: campaign.title,
    campaignId: campaign.id,
    message: `${campaign.title} is open until ${campaign.ends}.`,
    time: `ENDS ${campaign.ends}`,
  }));
  const items = [...nominationsOpen, ...received, ...deadlines].map((item) => ({ ...item, unread: !read }));

  return (
    <div className="page-container sticker-page sticker-feed notifications-page">
      <FeedStage tag="NOTIFICATIONS" title="When someone chooses you, you’ll know." mascot="star" titleId="notifications-title">
        <Sticker tilt={-1.5} delay={180} className="sticker-cta">
          <button className="sticker-pill sticker-pill--paper sticker-pill--sm" type="button" onClick={markRead} disabled={read || !items.length}>
            <CheckCheck size={18} strokeWidth={2.2} aria-hidden="true" />{read ? "ALL READ" : "MARK ALL READ"}
          </button>
        </Sticker>
      </FeedStage>

      <section className="sticker-feed__list notification-feed" aria-label="Notifications">
        {items.length ? (
          <ol>
            {items.map((item, index) => (
              <Sticker as="li" key={`${item.id}:${item.kind}`} tilt={index % 2 ? 0.6 : -0.6} delay={Math.min(420, 220 + index * 40)} className="sticker-feed__item">
                <ActivityRow item={item} detailed onCampaign={(id) => navigate(`/campaign/${id}`)} />
              </Sticker>
            ))}
          </ol>
        ) : (
          <SocialEmpty title="Nothing new yet." action="EXPLORE CAMPAIGNS" onAction={() => navigate("/explore")}>TAKEs you receive and important campaign updates will appear here.</SocialEmpty>
        )}
      </section>
    </div>
  );
}

interface StoredNotification {
  id: string;
  type: string;
  payload: { campaignId?: string; title?: string; endTime?: string };
  readAt: string | null;
  createdAt: string;
}
