import type { ActivityItem, Person } from "../types/product";
import type { TakeHistory, TakeHistoryEntry, TakeHistoryPerson, TakeMe } from "../types/identity";

export function personFromMe(me: TakeMe): Person {
  return {
    id: me.user.takeIdentityId,
    name: me.user.displayName ?? "TAKE member",
    handle: me.user.username ? `@${me.user.username.replace(/^@/, "")}` : "",
    avatarUrl: me.user.avatarUrl,
    bio: me.user.bio ?? "",
    joined: true,
    recipient: { type: "take_identity", takeIdentityId: me.user.takeIdentityId },
  };
}

export function activityFromHistory(me: TakeMe, history: TakeHistory): ActivityItem[] {
  const current = personFromMe(me);
  const given = history.given.map((entry) => historyActivity(entry, "given", current));
  const received = history.received.map((entry) => historyActivity(entry, "received", current));

  return [...given, ...received].sort((left, right) => {
    const leftTime = Number(left.sortTime ?? 0);
    const rightTime = Number(right.sortTime ?? 0);
    return rightTime - leftTime;
  });
}

function historyActivity(entry: TakeHistoryEntry, direction: "given" | "received", current: Person): ActivityItem {
  const other = personFromHistoryPerson(entry.person, `${entry.id}:${direction}`);
  const occurredAt = entry.confirmedAt ?? entry.createdAt;
  const actor = direction === "given" ? current : other;
  const recipient = direction === "given" ? other : current;

  return {
    id: entry.id,
    kind: direction,
    actor,
    recipient,
    campaign: entry.campaignTitle,
    campaignId: entry.campaignId,
    time: formatHistoryTime(occurredAt),
    sortTime: Date.parse(occurredAt),
  };
}

export function personFromHistoryPerson(person: TakeHistoryPerson | null, id: string): Person {
  return {
    id,
    name: person?.displayName ?? "TAKE member",
    handle: person?.username ? `@${person.username.replace(/^@/, "")}` : "",
    avatarUrl: person?.avatarUrl ?? null,
    bio: "",
    joined: person?.joined ?? true,
    recipient: { type: "take_identity", takeIdentityId: id },
  };
}

function formatHistoryTime(value: string): string {
  const timestamp = Date.parse(value);
  const elapsed = Date.now() - timestamp;
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 60_000) return "now";
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))}m`;
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short" }).format(new Date(timestamp));
}
